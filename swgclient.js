const SOEProtocol = require("./SOEProtocol");
const dgram = require('dgram');
const config = require('./config');

var server = {};
module.exports.login = function(cfg) {
    server = cfg;
    Login();
}

var verboseSWGLogging = config.SWG.verboseSWGLogging;
module.exports.debug = function() {
    verboseSWGLogging = true;
    SOEProtocol.debug();
    console.log(getFullTimestamp() + " - Enabled verbose SWG logging");
}

module.exports.isConnected = false;
module.exports.paused = false;
module.exports.sendChat = function(message, user) {
    if (!module.exports.isConnected) return;
    if (verboseSWGLogging) console.log(getFullTimestamp() + " - sending chat to game: " + user + ": " + message);
    if (server.ChatRoomID)
        send("ChatSendToRoom", {Message: ' \\#ff3333' + user + ': \\#ff66ff' + message, RoomID: server.ChatRoomID});
}
module.exports.recvChat = function(message, player) {}
module.exports.serverDown = function() {}
module.exports.serverUp = function() {}
module.exports.reconnected = function() {}
module.exports.sendTell = function(player, message) {
    if (!module.exports.isConnected) return;
    if (player != config.SWG.Character)
    	console.log(getFullTimestamp() + " - sending tell to: " + player + ": " + message);
    send("ChatInstantMessageToCharacter", {ServerName: server.ServerName, PlayerName: player, Message: message});
}
module.exports.recvTell = function(from, message) {}

var lastMessageTime = new Date();
function handleMessage(msg, info) {
    lastMessageTime = new Date();
    if (info.port == server.PingPort) return;
    var packets;
    try {
        var header = msg.readUInt16BE(0);
        packets = SOEProtocol.Decode(msg);
    } catch (ex) {
        console.log(getFullTimestamp() + " - Exception with header: " + header.toString(16).toUpperCase().padStart(4, 0))
        console.log(getFullTimestamp() + " - " + ex.toString());
        Login();
        return;
    }
    if (!packets) return;
    for (var packet of packets) {
        if (verboseSWGLogging)
            console.log(getFullTimestamp() + " - recv: " + packet.type);
        if (handlePacket[packet.type])
            handlePacket[packet.type](packet);
    }
}

function getConfiguredChatRooms() {
    if (Array.isArray(server.ChatRooms) && server.ChatRooms.length > 0)
        return server.ChatRooms;
    if (server.ChatRoom)
        return [server.ChatRoom];
    return [];
}

function getRoomPath(chatRoom) {
    if (chatRoom.startsWith("SWG."))
        return chatRoom;
    return `SWG.${server.ServerName}.${chatRoom}`;
}

function getRoomLabel(roomPath) {
    var parts = roomPath.split(".");
    return parts[parts.length - 1];
}

var socket;
var loggedIn;

var handlePacket = {};
handlePacket["Ack"] = function(packet) {}   //This is Ack packet from server, no response required
handlePacket["SessionResponse"] = function(packet) {
    if (!loggedIn) {
        send("LoginClientID", {Username: server.Username, Password:server.Password});
    }
    else {
        send("ClientIdMsg");
    }
}
handlePacket["LoginClientToken"] = function(packet) {
    console.log(getFullTimestamp() + " - Logged into SWG login server");
    loggedIn = true;
}
handlePacket["LoginEnumCluster"] = function(packet) {
    server.ServerNames = packet.Servers;
}
handlePacket["LoginClusterStatus"] = function(packet) {
    if (verboseSWGLogging) console.log(packet);
    server.Servers = packet.Servers;
}
handlePacket["EnumerateCharacterId"] = function(packet) {
    var character = packet.Characters[server.Character];
    if (!character)
        for (var c in packet.Characters)
            if (packet.Characters[c].Name.startsWith(server.Character))
                character = packet.Characters[c];
    var serverData = server.Servers[character.ServerID];
    server.Address = serverData.IPAddress;
    server.Port = serverData.Port;
    server.PingPort = serverData.PingPort;
    server.CharacterID = character.CharacterID;
    server.ServerName = server.ServerNames[character.ServerID].Name;
    send("SessionRequest");
}
handlePacket["ClientPermissions"] = function(packet) {
    send("SelectCharacter", {CharacterID: server.CharacterID});
    setTimeout(() => {
        for (var configuredRoom of getConfiguredChatRooms()) {
            send("ChatCreateRoom", {RoomPath: getRoomPath(configuredRoom)});
        }
        setTimeout(() => send("CmdSceneReady"), 1000);
    }, 1000);
}
handlePacket["ChatRoomList"] = function(packet) {
    if (verboseSWGLogging) console.log(JSON.stringify(packet, null, 2));
    var roomPaths = getConfiguredChatRooms().map(getRoomPath);
    for (var roomID in packet.Rooms) {
        var room = packet.Rooms[roomID];
        if (roomPaths.includes(room.RoomPath)) {
            server.ChatRoomIDs[room.RoomID] = room.RoomPath;
            if (!server.ChatRoomID)
                server.ChatRoomID = room.RoomID;
            send("ChatEnterRoomById", {RoomID: room.RoomID});
        }
    }
}
handlePacket["ChatOnEnteredRoom"] = function(packet) {
    if (verboseSWGLogging) console.log(JSON.stringify(packet, null, 2));
    if (server.ChatRoomIDs[packet.RoomID] && packet.PlayerName == server.Character) {
        if (!module.exports.isConnected) {
            module.exports.isConnected = true;
            console.log(getFullTimestamp() + " - Character " + packet.PlayerName + " logged into SWG and entered chatroom ID# " + packet.RoomID);
            module.exports.reconnected();
        }
        console.log(getFullTimestamp() + " - Joined chat room " + server.ChatRoomIDs[packet.RoomID] + " (ID# " + packet.RoomID + ")");
        if (fails >= 3) module.exports.serverUp();
        fails = 0;
    }
}
handlePacket["ChatRoomMessage"] = function(packet) {
    if (verboseSWGLogging) console.log(JSON.stringify(packet, null, 2));
    if (server.ChatRoomIDs[packet.RoomID] && packet.CharacterName != server.Character.toLowerCase())
        module.exports.recvChat(packet.Message, packet.CharacterName, getRoomLabel(server.ChatRoomIDs[packet.RoomID]), server.ChatRoomIDs[packet.RoomID]);
}
handlePacket["ChatInstantMessageToClient"] = function(packet) {
    module.exports.recvTell(packet.PlayerName, packet.Message);
}
handlePacket["ChatOnLeaveRoom"] = function(packet) {
    if (server.ChatRoomIDs[packet.RoomID] && packet.PlayerName == server.Character) {
        console.log(getFullTimestamp() + " - Character " + packet.PlayerName + " has left chatroom ID# " + packet.RoomID + " with error code " + packet.Error);
    }
}

var disconnectCount = 0;
handlePacket["Disconnect"] = function(packet) {
    console.log(getFullTimestamp() + " - Received Disconnect packet from server.  Connection ID = " + packet.connectionID + ".  Reason code = " + packet.reasonID + ".  Disconnect count = " + disconnectCount++);
}

//handlePacket["ServerNetStatusUpdate"] = function(packet) {} //This is network status packet from server, no response required

function Login() {
    loggedIn = false;
    module.exports.isConnected = false;

    server.Address = server.LoginAddress; 
    server.Port = server.LoginPort;
    server.PingPort = undefined;    //Undefined until we get ping port from login server
    server.ChatRoomID = undefined;
    server.ChatRoomIDs = {};

    socket = dgram.createSocket('udp4');
    socket.on('message', handleMessage);

    send("SessionRequest");
}

function send(type, data) {
    var buf = SOEProtocol.Encode(type, data);
    if (buf) {
        if (verboseSWGLogging)
            console.log(getFullTimestamp() + " - send: " + type);
        if (Array.isArray(buf)) {
            for (var b of buf) {
                socket.send(b, server.Port, server.Address);
            }
        }
        else
            socket.send(buf, server.Port, server.Address);
    }
}

var fails = 0;
setInterval(() => {
    if (module.exports.paused) return;
    send("Ack");
    if (new Date() - lastMessageTime > 10000) {
        fails++;
        module.exports.isConnected = false;
        if (fails == 3) module.exports.serverDown();
        lastMessageTime = new Date();
        Login();
    }
}, 100);

setInterval(() => {
    if (!server.PingPort || !module.exports.isConnected)
        return;
    var buf = Buffer.alloc(4);                          //Server requires 4 byte packet, going to have it match what standard client sends, not what is in the documentation
    var tick = new Date().getTime() & 0xFFFF;           //Convert to uint16 
    buf.writeUInt16BE(tick, 0);                         //Big or Little Endian?  Doesn't matter right now.
    buf.writeUInt16BE(0x7701, 2);                       //77 01 matches client ping
    socket.send(buf, server.PingPort, server.Address);  //Send to the ping server IP and port
}, 1 * 1000);                                           //Let's send a ping every 1.0 seconds like the client

setInterval(() => {
    if (!module.exports.isConnected) return;
	send("ClientNetStatusRequest");                     //Going to send a net status packet every 15 seconds (standard client is 15)
}, 15 * 1000);

 //Custom timestamp generator
 function getFullTimestamp() {

    date = new Date();
    year = date.getFullYear().toString().padStart(4, '0') + "-";
    month = (date.getMonth()+1).toString().padStart(2, '0') + "-";
    day = date.getDate().toString().padStart(2, '0') + " ";
    hours = date.getHours().toString().padStart(2, '0') + ":";
    minutes = date.getMinutes().toString().padStart(2, '0') + ":";
    seconds = date.getSeconds().toString().padStart(2, '0') + ".";
    millisecs = date.getMilliseconds().toString().padStart(3, '0');

    return year + month + day + hours + minutes + seconds + millisecs;
}
