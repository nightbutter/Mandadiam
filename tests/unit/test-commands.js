const assert = require("node:assert/strict");
const { commands, commandData } = require("../../src/bot/commands");

console.log("=== Command Loader Tests ===");

const expected = [
    "ping",
    "register",
    "profile",
    "characters",
    "character-create",
    "character-select",
    "battle-challenge",
    "battle-accept",
    "battle-status",
    "battle-attack",
    "battle-forfeit",
    "rpg"
];

for (const name of expected) {
    const command = commands.get(name);

    assert(command, `command /${name} is registered`);
    assert.equal(command.data.name, name);
    assert.equal(typeof command.execute, "function");
    console.log(`PASS: /${name} exposes data + execute`);
}

// commandData must serialize for the REST payload in deploy-commands.
assert.equal(commandData.length, expected.length);
assert.doesNotThrow(() => JSON.stringify(commandData));
console.log("PASS: commandData serializes for registration");

console.log("\nCommand loader tests passed.");
