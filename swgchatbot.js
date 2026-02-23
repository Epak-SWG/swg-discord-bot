const Discord = require('discord.js');
const { Client, Events, GatewayIntentBits, Partials, ActivityType, ChannelType } = require('discord.js');
const SWG = require('./swgclient.js');
const config = require('./config.json');
var verboseDiscordLogging = config.Discord.verboseDiscordLogging;

//Make sure these are global
var server, chatChannel, chatRoomChannels, allowedGuildChannelNames, notificationChannel, notificationTag, notificationUserID, autoRestartTimer;

const client = new Client({
    intents: [
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel]
});

console.log(getFullTimestamp() + " - Starting SWG Discord Bot");
client.login(config.Discord.BotToken);                          //Log Bot into Discord

// When the client is ready, run this code (only once)
client.once(Events.ClientReady, c => {
    console.log(getFullTimestamp() + " - Discord client ready.  Logged in as " + client.user.tag);

    SWG.login(config.SWG);  //Login with SWG Client

    client.user.setPresence({ activities: [{ name: config.Discord.PresenceName, type: ActivityType.Watching }], status: 'online' });
    server = client.guilds.cache.get(config.Discord.ServerID);
    chatChannel = client.channels.cache.find(cc => cc.name === config.Discord.ChatChannel);
    chatRoomChannels = {};
    allowedGuildChannelNames = new Set([config.Discord.ChatChannel, config.Discord.NotificationChannel].filter(Boolean));

    if (!chatChannel) {
        console.log(getFullTimestamp() + " - No default chat channel could be found: " + config.Discord.ChatChannel);
    }

    var configuredRoomChannels = config.Discord.ChatRoomChannels || {};
    for (const roomKey in configuredRoomChannels) {
        const discordChannelName = configuredRoomChannels[roomKey];
        const configuredChannel = client.channels.cache.find(cc => cc.name === discordChannelName);
        if (!configuredChannel) {
            console.log(getFullTimestamp() + " - No Discord channel found for SWG room mapping " + roomKey + " => " + discordChannelName);
            continue;
        }

        chatRoomChannels[roomKey.toLowerCase()] = configuredChannel;
        const roomParts = roomKey.split(".");
        chatRoomChannels[roomParts[roomParts.length - 1].toLowerCase()] = configuredChannel;
        allowedGuildChannelNames.add(discordChannelName);

        if (verboseDiscordLogging)
            console.log(getFullTimestamp() + " - Mapped SWG room " + roomKey + " to Discord channel #" + configuredChannel.name);
    }

    //Server up/down notification stuff here
    notificationChannel = client.channels.cache.find(nc => nc.name === config.Discord.NotificationChannel);
    if (!notificationChannel) {
        console.log(getFullTimestamp() + " - No notification channel could be found.  There will be no server up/down notifications");
    }

    var notificationRole = server.roles.cache.find(nr => nr.name === config.Discord.NotificationMentionRole);
    notificationUserID = config.Discord.NotificationMentionUserID;

    if (notificationRole) {//Found a valid role
        if (verboseDiscordLogging) 
            console.log(getFullTimestamp() + " - Found valid notification role = " + notificationRole);
        notificationTag = "<@&" + notificationRole + "> ";
    }
    else {
        notificationRole = notificationUserID;
        if (verboseDiscordLogging && notificationRole) 
            console.log(getFullTimestamp() + " - Found a notification user ID = " + notificationRole);
        notificationTag = (notificationRole) ? "<@" + notificationRole + "> " : "";
    }

    // Restart bot every X minutes if configured
    autoRestartTimer = config.Discord.AutoRestartTimer;
    if (autoRestartTimer) {
        console.log(getFullTimestamp() + " - Scheduling restart in " + autoRestartTimer + " minutes");
        setTimeout(() => {
            console.log(getFullTimestamp() + " - Auto-restarting chat bot");
            process.exit(0);
        }, autoRestartTimer * 60 * 1000);
    }

    //Let's see if a ping every 30 seconds prevents desync
    //setInterval(() => SWG.sendTell(config.SWG.Character, "ping"), 30 * 1000);
});

client.on("messageCreate", async (message) => {

    if (verboseDiscordLogging) {
        console.log("message.author.username = " + message.author.username);
        console.log("message.channel.name = " + message.channel.name);
        console.log("message.channel.type = " + message.channel.type);
    }

    if (message.author.username.toLowerCase() === config.Discord.BotName.toLowerCase())
        return;

    if (message.channel.type === ChannelType.DM && message.author.id != notificationUserID)    // Ignore DMs from everyone except the notificationUserID user
        return;

    if (message.channel.type === ChannelType.GuildText && !allowedGuildChannelNames.has(message.channel.name))
        return;

    var sender = server.members.cache.get(message.author.id).displayName;    // Get server displayName, if not available will use global displayName

    if (verboseDiscordLogging) {
        console.log(getFullTimestamp() + " - sender = " + sender);
        console.log(getFullTimestamp() + " - message.author.username = " + message.author.username);
        console.log(getFullTimestamp() + " - message.content = " + message.content);
    }

    var messageContent = message.content.toLowerCase();
    if (messageContent.startsWith('!server')) {
        message.reply(config.SWG.SWGServerName + (SWG.isConnected ? " is UP!" : " is DOWN :("));
    }
    if (messageContent.startsWith('!fixchat')) {
        message.reply("Rebooting chat bot");
        console.log(getFullTimestamp() + " - Received !fixchat request from " + sender);
        setTimeout(() => { process.exit(0); }, 500);  //Exit in 500 ms, allow time for reply to be sent
    }
    if (messageContent.startsWith('!debugchat') && message.author.id == notificationUserID) {
        message.reply("Enabling chatbot debug mode");
        console.log(getFullTimestamp() + " - Received !debugchat request from " + sender + ", sender = " + message.author.username);
        verboseDiscordLogging = true;
        SWG.debug();
    }

    // SWG chat bridge is intentionally one-way (SWG -> Discord).
    // Discord messages are no longer forwarded to SWG.
});

client.on('disconnect', event => {
    try {       
        notificationChannel.send(config.Discord.BotName + " disconnected");
    }
    catch (ex) {}
    client = server = chatChannel = notificationChannel = notificationTag = notificationUsername = autoRestartTimer = null;
    console.log(getFullTimestamp() + " - Discord disconnect: " + JSON.stringify(event,null,2));
    process.exit(0);
});

SWG.serverDown = function() {
    if (notificationChannel) {
        notificationChannel.send(notificationTag + "The server " + config.SWG.SWGServerName + " is DOWN!");
        console.log(getFullTimestamp() + " - The server " + config.SWG.SWGServerName + " is DOWN!");
    }
}

SWG.serverUp = function() {
    if (notificationChannel) {
        notificationChannel.send(notificationTag + "The server " + config.SWG.SWGServerName + " is UP!");
        console.log(getFullTimestamp() + " - The server " + config.SWG.SWGServerName + " is UP!");
    }
}

SWG.recvChat = function(message, player) {
    var includeRoomLabel = Array.isArray(config.SWG.ChatRooms) && config.SWG.ChatRooms.length > 1;
    var roomLabel = arguments[2];
    var roomPath = arguments[3];
    var mappedChannel = undefined;

    if (chatRoomChannels) {
        mappedChannel = chatRoomChannels[(roomPath || "").toLowerCase()] || chatRoomChannels[(roomLabel || "").toLowerCase()];
    }

    var targetChannel = mappedChannel || chatChannel;

    if (verboseDiscordLogging)
        console.log(getFullTimestamp() + " - Sending chat to Discord.  Player = " + player + ", message = " + message + (roomLabel ? ", room = " + roomLabel : "") + (targetChannel ? ", channel = #" + targetChannel.name : ""));

    if (targetChannel) {
        var shouldPrefixRoom = includeRoomLabel && roomLabel && !mappedChannel;
        targetChannel.send((shouldPrefixRoom ? "[" + roomLabel + "] " : "") + "**" + player + ":**  " + message);
    }
    else {
        console.log(getFullTimestamp() + " - Discord disconnected");
    }
}

SWG.recvTell = function(from, message) {
    if (from != config.SWG.Character) {
    	console.log(getFullTimestamp() + " - received tell from: " + from + " : " + message);
    	SWG.sendTell(from, "Sorry, I don't talk to strangers ... XOXO");
    }
}

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
