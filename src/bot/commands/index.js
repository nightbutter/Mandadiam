const { Collection } = require("discord.js");
const ping = require("./ping");

const commands = new Collection();
commands.set(ping.data.name, ping);

// JSON payloads used by deploy-commands.js for manual registration.
const commandData = [...commands.values()].map(command => command.data.toJSON());

module.exports = {
    commands,
    commandData
};
