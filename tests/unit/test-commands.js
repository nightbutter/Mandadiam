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
    "character-image",
    "rpg",
    "clear"
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

console.log("=== /clear behaviour ===");

const { PermissionFlagsBits } = require("discord.js");
const clear = commands.get("clear");

// --- command shape ---------------------------------------------------

{
    const json = clear.data.toJSON();
    const opt = json.options.find(o => o.name === "amount");
    assert.equal(opt.required, true);
    assert.equal(opt.min_value, 1);
    assert.equal(opt.max_value, 100);
    assert.equal(json.dm_permission, false);
    console.log("PASS: /clear amount is required 1-100, guild-only");
}

// --- interaction mocks ------------------------------------------------

async function runClearTests() {

function mockClear({ amount = 10, manage = true, bulkDelete = true } = {}) {
    const calls = { replies: [], edits: [], deletes: [] };
    const channel = bulkDelete
        ? {
              bulkDelete: async (n, filterOld) => {
                  calls.deletes.push({ n, filterOld });
                  return new Map(
                      Array.from({ length: n }, (_, i) => [`m${i}`, i])
                  );
              },
              permissionsFor: () => ({
                  has: () => true
              })
          }
        : { permissionsFor: () => ({ has: () => true }) };

    return {
        calls,
        channel,
        guild: { members: { me: {} } },
        memberPermissions: { has: () => manage },
        inGuild: () => bulkDelete,
        options: { getInteger: () => amount },
        reply: async p => calls.replies.push(p),
        deferReply: async () => calls.deferred = true,
        editReply: async p => calls.edits.push(p)
    };
}

// --- authorization + channel guards -----------------------------------

{
    const denied = mockClear({ manage: false });
    await clear.execute(denied);
    assert(denied.calls.replies[0].ephemeral);
    assert(denied.calls.replies[0].content.includes("Manage Messages"));
    assert.equal(denied.calls.deletes.length, 0);
    console.log("PASS: /clear rejects users without Manage Messages");

    const dm = mockClear({ bulkDelete: false });
    dm.inGuild = () => true;
    await clear.execute(dm);
    assert(dm.calls.replies[0].content.includes("guild text"));
    assert.equal(dm.calls.deletes.length, 0);
    console.log("PASS: /clear rejects non-text channels");

    const out = mockClear({ amount: 0 });
    await clear.execute(out);
    assert(out.calls.replies[0].content.includes("1 to 100"));
    assert.equal(out.calls.deletes.length, 0);
    console.log("PASS: /clear rejects out-of-range amounts");
}

// --- happy path + 14-day filter ----------------------------------------

{
    const ok = mockClear({ amount: 25 });
    await clear.execute(ok);
    assert.equal(ok.calls.deletes.length, 1);
    assert.equal(ok.calls.deletes[0].n, 25);
    // filterOld: messages older than 14 days are dropped pre-request.
    assert.equal(ok.calls.deletes[0].filterOld, true);
    assert(ok.calls.edits[0].includes("25"));
    console.log("PASS: /clear bulk-deletes ≤14d, reports real count");

    const none = mockClear({ amount: 5 });
    none.channel.bulkDelete = async () => new Map();
    await clear.execute(none);
    assert(none.calls.edits[0].includes("14 days"));
    console.log("PASS: /clear reports when nothing was deleted");
}

}

runClearTests()
    .then(() => console.log("\nCommand loader tests passed."))
    .catch(err => {
        console.error("FAIL:", err);
        process.exit(1);
    });
