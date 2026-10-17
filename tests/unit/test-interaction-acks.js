const assert = require("node:assert/strict");
const handler = require("../../src/bot/events/interactionCreate");
const { commands } = require("../../src/bot/commands");
const playerService = require("../../src/services/playerService");
const { pool } = require("../../src/database/db");

console.log("=== Interaction Acknowledgement Tests ===");

const UID = `__ack_test_${Date.now()}__`;

// Interaction double tracking ack state and each response call.
function mockCommandInteraction(commandName, overrides = {}) {
    const calls = { replies: [], edits: [], follows: [], defers: 0 };
    const ix = {
        calls,
        commandName,
        channelId: "ack_chan",
        user: { id: UID, username: "ack_user" },
        channel: {
            send: async () => ({ id: "sent_1" }),
            messages: { fetch: async () => ({ edit: async () => {} }) }
        },
        isButton: () => false,
        isAnySelectMenu: () => false,
        isModalSubmit: () => false,
        isChatInputCommand: () => true,
        replied: false,
        deferred: false,
        deferReply: async () => {
            calls.defers++;
            ix.deferred = true;
        },
        reply: async p => {
            if (ix.replied || ix.deferred) {
                throw Object.assign(
                    new Error("already acknowledged"), { code: 40060 }
                );
            }
            calls.replies.push(p);
            ix.replied = true;
        },
        editReply: async p => {
            calls.edits.push(p);
            ix.replied = true;
            return { id: "msg_1" };
        },
        followUp: async p => {
            calls.follows.push(p);
        },
        ...overrides
    };
    return ix;
}

async function run() {
    // --- /rpg acknowledges via defer + editReply, never raw reply ---

    {
        await playerService.registerPlayer(UID, "ack_user");
        const rpg = commands.get("rpg");
        const ix = mockCommandInteraction("rpg");

        await rpg.execute(ix);

        assert.equal(ix.calls.defers, 1);
        assert.equal(ix.calls.replies.length, 0);
        assert.equal(ix.calls.edits.length, 1);
        // dashboard payload actually rendered
        assert(ix.calls.edits[0].components.length > 0);
        console.log("PASS: /rpg defers then editReply — no raw reply");
    }

    // --- command throwing before any ack → ephemeral reply ---

    {
        commands.set("__boom_pre", {
            execute: async () => {
                throw new Error("pre-ack failure");
            }
        });
        const ix = mockCommandInteraction("__boom_pre");
        await handler.execute(ix); // must not throw

        assert.equal(ix.calls.replies.length, 1);
        assert(ix.calls.replies[0].ephemeral);
        commands.delete("__boom_pre");
        console.log("PASS: pre-ack error gets ephemeral reply, no throw");
    }

    // --- command throwing after defer → editReply ---

    {
        commands.set("__boom_defer", {
            execute: async ix => {
                await ix.deferReply({ ephemeral: true });
                throw new Error("post-defer failure");
            }
        });
        const ix = mockCommandInteraction("__boom_defer");
        await handler.execute(ix);

        assert.equal(ix.calls.edits.length, 1);
        assert.equal(ix.calls.replies.length, 0);
        commands.delete("__boom_defer");
        console.log("PASS: post-defer error uses editReply");
    }

    // --- error after a real reply → followUp ---

    {
        commands.set("__boom_reply", {
            execute: async ix => {
                await ix.reply({ content: "ok", ephemeral: true });
                throw new Error("post-reply failure");
            }
        });
        const ix = mockCommandInteraction("__boom_reply");
        await handler.execute(ix);

        assert.equal(ix.calls.replies.length, 1); // the real reply
        assert.equal(ix.calls.follows.length, 1); // error via followUp
        commands.delete("__boom_reply");
        console.log("PASS: post-reply error uses followUp");
    }

    // --- 10062 expired token: no second ack attempt, no throw ---

    {
        commands.set("__boom_expired", {
            execute: async () => {
                throw Object.assign(
                    new Error("Unknown interaction"), { code: 10062 }
                );
            }
        });
        const ix = mockCommandInteraction("__boom_expired", {
            reply: async () => {
                throw Object.assign(
                    new Error("Unknown interaction"), { code: 10062 }
                );
            }
        });

        await handler.execute(ix); // must resolve, not crash
        console.log("PASS: 10062 logged + swallowed, no crash");
    }

    // --- 40060 during recovery: swallowed, no unhandled rejection ---

    {
        commands.set("__boom_double", {
            execute: async ix => {
                await ix.reply({ content: "ok" });
                throw new Error("late failure");
            }
        });
        const ix = mockCommandInteraction("__boom_double", {
            followUp: async () => {
                throw Object.assign(
                    new Error("already acknowledged"), { code: 40060 }
                );
            }
        });

        await handler.execute(ix);
        console.log("PASS: 40060 on recovery path swallowed safely");
    }

    // --- button path error also goes through safe recovery ---

    {
        const ix = {
            calls: { replies: [] },
            isButton: () => true,
            isAnySelectMenu: () => false,
            isModalSubmit: () => false,
            isChatInputCommand: () => false,
            customId: "battle:bogus",
            channelId: "nowhere",
            user: { id: "u1" },
            replied: false,
            deferred: false,
            reply: async p => ix.calls.replies.push(p),
            editReply: async p => ix.calls.replies.push(p),
            followUp: async p => ix.calls.replies.push(p)
        };
        await handler.execute(ix);
        // "battle:bogus" has no handler → safeReply unknown action
        assert.equal(ix.calls.replies.length, 1);
        console.log("PASS: unknown button handled without crash");
    }

    console.log("\nAcknowledgement tests passed.");
}

run()
    .then(() => pool.end())
    .catch(err => {
        console.error("FAIL:", err);
        pool.end().finally(() => process.exit(1));
    });
