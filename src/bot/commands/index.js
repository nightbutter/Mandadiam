const { Collection } = require("discord.js");
const ping = require("./ping");
const register = require("./register");
const profile = require("./profile");
const characters = require("./characters");
const characterCreate = require("./character-create");
const characterSelect = require("./character-select");

const commands = new Collection();

for (const command of [
    ping,
    register,
    profile,
    characters,
    characterCreate,
    characterSelect
]) {
    commands.set(command.data.name, command);
}

// JSON payloads used by deploy-commands.js for manual registration.
const commandData = [...commands.values()].map(command => command.data.toJSON());

module.exports = {
    commands,
    commandData
};
