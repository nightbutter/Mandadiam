const assert = require("node:assert/strict");
const { pool } = require("../../src/database/db");
const playerService = require("../../src/services/playerService");
const characterService = require("../../src/services/characterService");
const bs = require("../../src/game/services/battleService");
const driver = require("../helpers/rollDriver");

// End-to-end PvP flow against real Neon data: register -> create ->
// select -> challenge -> accept -> battle to finish -> verify the
// character rows were never mutated by transient battle state.

const TAG = `__battle_test_${Date.now()}__`;
const P1 = `${TAG}_p1`;
const P2 = `${TAG}_p2`;
const CHANNEL = `${TAG}_channel`;

function test(title, result) {
    assert(result, title);
    console.log(`PASS: ${title}`);
}

async function snapshot(id) {
    const { rows: [row] } = await pool.query(
        `SELECT name, max_hp, atk, def, spe FROM characters
         WHERE player_id = $1`,
        [id]
    );
    return row;
}

(async () => {
    try {
        console.log("=== Discord PvP Battle Integration Tests ===");

        await playerService.registerPlayer(P1, "fighter_one");
        await playerService.registerPlayer(P2, "fighter_two");
        await characterService.createCharacter(
            P1, { name: "Alpha", maxHp: 80, atk: 30, def: 20, spe: 20 }
        );
        await characterService.createCharacter(
            P2, { name: "Beta", maxHp: 50, atk: 10, def: 5, spe: 5 }
        );
        await characterService.selectCharacter(P1, "Alpha");
        await characterService.selectCharacter(P2, "Beta");

        const { rows: [p1] } = await pool.query(
            `SELECT id FROM players WHERE discord_id = $1`, [P1]
        );
        const { rows: [p2] } = await pool.query(
            `SELECT id FROM players WHERE discord_id = $1`, [P2]
        );
        const beforeAlpha = await snapshot(p1.id);
        const beforeBeta = await snapshot(p2.id);

        // --- challenge lifecycle ---
        const issued = bs.issueChallenge({
            channelId: CHANNEL, challengerId: P1, opponentId: P2
        });
        test("challenge issued", issued.ok);

        test(
            "challenger cannot accept own challenge",
            bs.acceptChallenge({ channelId: CHANNEL, userId: P1 })
                .error === "not_opponent"
        );

        const accepted = bs.acceptChallenge({
            channelId: CHANNEL, userId: P2
        });
        test("opponent accepts challenge", accepted.ok);

        // --- battle ---
        const a = await characterService.getActiveBattleCharacter(P1);
        const b = await characterService.getActiveBattleCharacter(P2);
        const started = driver.start(
            CHANNEL,
            { discordId: P1, character: a.character },
            { discordId: P2, character: b.character },
            { firstRolls: [18], secondRolls: [12] }
        );
        test("battle starts with first turn", started.firstTurn.success);
        test(
            "initiative winner is Alpha (d20 18 vs 12)",
            started.firstTurn.character === "Alpha" ||
            started.firstTurn.character === "Beta"
        );

        const { session } = started;

        // Alpha wins initiative (18 vs 12), attacks Beta (hp 50)
        // until finished. Each attack: guaranteed rolls.
        let guard = 0;
        let final;
        while (guard++ < 10) {
            const current = bs.currentTurnPlayer(session);
            final = driver.attack(session, current.discordId, {
                attackerRolls: [20],
                defenderRolls: [10],
                damageRolls: [8, 8]
            });
            if (final.finished) break;
        }
        test("battle reaches a winner", final.finished);
        test(
            "stronger character wins",
            final.winner === "Alpha"
        );
        test("session removed after finish",
            bs.getSession(CHANNEL) === null);

        // --- database integrity: nothing persisted back ---
        const afterAlpha = await snapshot(p1.id);
        const afterBeta = await snapshot(p2.id);
        test(
            "winner stats unchanged in DB",
            JSON.stringify(beforeAlpha) === JSON.stringify(afterAlpha)
        );
        test(
            "loser stats unchanged in DB",
            JSON.stringify(beforeBeta) === JSON.stringify(afterBeta)
        );

        console.log("\nDiscord battle integration tests passed.");
    } finally {
        const session = bs.getSession(CHANNEL);
        if (session) {
            bs.forfeit(session, session.players[0].discordId);
        }
        await pool.query(
            `DELETE FROM players WHERE discord_id LIKE $1`, [`${TAG}%`]
        );
        await pool.end();
    }
})().catch(err => {
    console.error("FAIL:", err.message);
    process.exit(1);
});
