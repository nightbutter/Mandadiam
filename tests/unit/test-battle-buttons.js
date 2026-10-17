const assert = require("node:assert/strict");
const bs = require("../../src/game/services/battleService");
const { handleButton } = require("../../src/bot/buttons");
const { pool } = require("../../src/database/db");

console.log("=== Battle Button Tests ===");

// Minimal discord.js-like interaction double.
function mockButton({ customId, userId, channelId = "c1" }) {
    const calls = { replies: [], updates: [], sent: [] };

    return {
        calls,
        customId,
        channelId,
        user: { id: userId },
        channel: {
            send: async payload => {
                calls.sent.push(payload);
                return { id: `msg_${calls.sent.length}` };
            }
        },
        reply: async payload => calls.replies.push(payload),
        update: async payload => calls.updates.push(payload),
        deferUpdate: async () => {
            calls.deferred = (calls.deferred ?? 0) + 1;
        },
        editReply: async payload => calls.updates.push(payload)
    };
}

function player(id, name, stats = {}) {
    return {
        discordId: id,
        character: {
            name,
            hp: stats.hp ?? 100,
            maxHp: stats.hp ?? 100,
            atk: stats.atk ?? 20,
            def: stats.def ?? 5,
            spe: stats.spe ?? 4,
            cost: 0
        }
    };
}

async function run() {
    // --- challenge buttons ---

    {
        bs.issueChallenge({
            channelId: "c1", challengerId: "u1", opponentId: "u2"
        });
        const btn = mockButton({
            customId: "challenge:decline", userId: "u9"
        });
        await handleButton(btn);
        assert(btn.calls.replies[0].ephemeral);
        console.log("PASS: unrelated user decline rejected");
    }

    {
        const btn = mockButton({
            customId: "challenge:decline", userId: "u1"
        });
        await handleButton(btn);
        assert(
            btn.calls.replies[0].content.includes(
                "Only the challenged player"
            )
        );
        console.log("PASS: challenger cannot decline own challenge");
    }

    {
        const btn = mockButton({
            customId: "challenge:decline", userId: "u2"
        });
        await handleButton(btn);
        assert(btn.calls.updates[0].components.length === 0);
        assert.equal(bs.getPendingChallenge("c1"), null);
        console.log("PASS: opponent decline clears challenge + buttons");
    }

    {
        bs.issueChallenge({
            channelId: "c1", challengerId: "u1", opponentId: "u2",
            ttlMs: -1
        });
        const btn = mockButton({
            customId: "challenge:accept", userId: "u2"
        });
        await handleButton(btn);
        assert(btn.calls.replies[0].content.includes("expired"));
        console.log("PASS: expired challenge accept rejected");
    }

    {
        bs.issueChallenge({
            channelId: "c1", challengerId: "u1", opponentId: "u2"
        });
        const btn = mockButton({
            customId: "challenge:accept", userId: "u9"
        });
        await handleButton(btn);
        assert(btn.calls.replies[0].content.includes("wasn't issued"));
        console.log("PASS: non-opponent cannot accept via button");
    }

    {
        const btn = mockButton({
            customId: "challenge:accept", userId: "u2"
        });
        await handleButton(btn);
        // Fake users aren't registered — challenge is consumed and the
        // message is updated instead of replying.
        assert(btn.calls.updates[0].components.length === 0);
        assert.equal(bs.getPendingChallenge("c1"), null);
        console.log("PASS: accept consumes challenge exactly once");

        const again = mockButton({
            customId: "challenge:accept", userId: "u2"
        });
        await handleButton(again);
        assert(
            again.calls.replies[0].content.includes("no longer active")
        );
        console.log("PASS: second accept click is stale-rejected");
    }

    // --- battle buttons ---

    function freshSession() {
        return bs.startBattle(
            "c1", player("u1", "Noctis"), player("u2", "Slime"),
            { firstRolls: [18], secondRolls: [12] }
        ).session;
    }

    {
        const session = freshSession();
        const btn = mockButton({ customId: "battle:attack", userId: "u9" });
        await handleButton(btn);
        assert(
            btn.calls.replies[0].content.includes("participants")
        );
        console.log("PASS: spectator attack rejected");
        bs.forfeit(session, "u1");
    }

    {
        const session = freshSession();
        const btn = mockButton({ customId: "battle:attack", userId: "u2" });
        await handleButton(btn);
        assert(
            btn.calls.replies[0].content.includes("not your turn")
        );
        console.log("PASS: out-of-turn attack rejected");
        bs.forfeit(session, "u1");
    }

    {
        // Defender HP too high for any single attack (incl. double /
        // crit) to end the battle — the turn advance stays
        // deterministic.
        const session = bs.startBattle(
            "c1", player("u1", "Noctis"),
            player("u2", "Slime", { hp: 500 }),
            { firstRolls: [18], secondRolls: [12] }
        ).session;
        const before = session.battle.turnNumber;
        const btn = mockButton({ customId: "battle:attack", userId: "u1" });
        await handleButton(btn);

        assert(btn.calls.updates.length === 1);
        assert.equal(session.battle.turnNumber, before + 1);
        console.log("PASS: one click applies exactly one action");

        // Same button again — now it's u2's turn, not u1's.
        await handleButton(btn);
        assert(
            btn.calls.replies[0].content.includes("not your turn")
        );
        console.log("PASS: repeat click cannot double-apply");
        bs.forfeit(session, "u1");
    }

    {
        const session = bs.startBattle(
            "c1", player("u1", "Noctis"), player("u2", "Slime", { hp: 1 }),
            { firstRolls: [18], secondRolls: [12] }
        ).session;
        const btn = mockButton({
            customId: "battle:attack", userId: "u1"
        });

        // Deterministic hit: d20 18 vs 7 (attacker wins, no
        // reflection), d8 = 5 → 20 dmg ends the battle.
        const rolls = [0.85, 0.3, 0.5];
        const realRandom = Math.random;
        Math.random = () => rolls.length ? rolls.shift() : 0.5;
        try {
            await handleButton(btn);
        } finally {
            Math.random = realRandom;
        }
        assert(btn.calls.updates[0].components.length === 0);
        assert.equal(session.battle.status, "finished");
        console.log("PASS: finished battle disables action buttons");
    }

    {
        const session = freshSession();
        const btn = mockButton({ customId: "battle:forfeit", userId: "u9" });
        await handleButton(btn);
        assert(
            btn.calls.replies[0].content.includes("participants")
        );
        console.log("PASS: spectator forfeit rejected");

        // Step 1: forfeit asks for confirmation — nothing happens yet.
        const mine = mockButton({ customId: "battle:forfeit", userId: "u1" });
        await handleButton(mine);
        assert(mine.calls.replies[0].components.length === 1);
        assert.equal(session.battle.status, "active");
        console.log("PASS: forfeit asks for confirmation first");

        // Step 2: confirm applies the forfeit and clears the prompt.
        const confirm = mockButton({
            customId: "battle:forfeit:confirm", userId: "u1"
        });
        await handleButton(confirm);
        assert.equal(session.battle.winner, "Slime");
        assert.equal(confirm.calls.updates[0].components.length, 0);
        console.log("PASS: confirmed forfeit ends battle");

        // A stray cancel after the battle ended is still safe.
        const cancel = mockButton({
            customId: "battle:forfeit:cancel", userId: "u1"
        });
        await handleButton(cancel);
        assert(
            cancel.calls.updates[0].content.includes("cancelled")
        );
        console.log("PASS: forfeit cancel is safe");
    }

    {
        // Out-of-turn player cannot confirm a forfeit for someone else.
        const session = freshSession();
        const confirm = mockButton({
            customId: "battle:forfeit:confirm", userId: "u9"
        });
        await handleButton(confirm);
        assert.equal(session.battle.status, "active");
        assert(
            confirm.calls.updates[0].content.includes("participants")
        );
        console.log("PASS: spectator cannot confirm a forfeit");
        bs.forfeit(session, "u1");
    }

    {
        // Stale button after session ended (e.g. restart wiped state).
        const btn = mockButton({ customId: "battle:attack", userId: "u1" });
        await handleButton(btn);
        assert(
            btn.calls.replies[0].content.includes("no longer active")
        );
        console.log("PASS: stale button after state loss fails safely");
    }

    {
        const session = freshSession();
        const btn = mockButton({ customId: "battle:refresh", userId: "u9" });
        await handleButton(btn);
        assert(btn.calls.updates[0].embeds.length === 1);
        console.log("PASS: spectator can refresh the panel view");
        bs.forfeit(session, "u1");
    }

    console.log("\nBattle button tests passed.");
}

run()
    .then(() => pool.end())
    .catch(err => {
        console.error("FAIL:", err);
        pool.end().finally(() => process.exit(1));
    });
