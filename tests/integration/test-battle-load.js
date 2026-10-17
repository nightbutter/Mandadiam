const assert = require("node:assert/strict");
const { pool } = require("../../src/database/db");
const playerService = require("../../src/services/playerService");
const characterService = require("../../src/services/characterService");
const { createBattle } = require("../../src/game/battle");

const TAG = `__bl_test_${Date.now()}__`;
const P1 = `${TAG}_p1`;
const P2 = `${TAG}_p2`;

function test(title, result) {
    assert(result, title);
    console.log(`PASS: ${title}`);
}

(async () => {
    try {
        console.log("=== Battle Character Loading Tests ===");

        await playerService.registerPlayer(P1, "tester_one");
        await playerService.registerPlayer(P2, "tester_two");

        const oddStats = {
            name: "Oddball", maxHp: 90, atk: 30, def: 10, spe: 20
        };
        const created = await characterService.createCharacter(P1, oddStats);
        await characterService.createCharacter(
            P2, { name: "Slime", maxHp: 60, atk: 8, def: 7, spe: 2 }
        );
        test("characters created", created.ok);

        // --- stat persistence: raw row must equal submitted input ---
        const { rows: [rawRow] } = await pool.query(
            `SELECT max_hp, atk, def, spe FROM characters WHERE id = $1`,
            [created.character.id]
        );
        test(
            "stored stats match submitted input exactly",
            rawRow.max_hp === 90 && rawRow.atk === 30 &&
            rawRow.def === 10 && rawRow.spe === 20
        );

        // --- no active character yet ---
        const noActive = await characterService.getActiveBattleCharacter(P1);
        test(
            "no active character reported",
            !noActive.ok && noActive.error === "no_active_character"
        );

        // --- select then load battle character ---
        await characterService.selectCharacter(P1, "Oddball");
        const loaded = await characterService.getActiveBattleCharacter(P1);
        test(
            "active character loads in combat shape",
            loaded.ok &&
            loaded.character.hp === 90 &&
            loaded.character.atk === 30 &&
            loaded.character.cost === 0
        );
        test(
            "hp equals stored max_hp (not a default)",
            loaded.character.hp === rawRow.max_hp
        );

        // --- ownership: unregistered user cannot load ---
        test(
            "unregistered user cannot load a battle character",
            (await characterService.getActiveBattleCharacter(`${TAG}_ghost`))
                .error === "not_registered"
        );

        // --- loaded character actually starts a battle ---
        await characterService.selectCharacter(P2, "Slime");
        const other = await characterService.getActiveBattleCharacter(P2);
        const battle = createBattle(
            loaded.character, other.character,
            { firstRolls: [15], secondRolls: [10] }
        );
        test(
            "db-loaded characters can start a battle",
            battle.status === "active" &&
            battle.orderedCharacters[0].name === "Oddball"
        );

        console.log("\nBattle character loading tests passed.");
    } finally {
        await pool.query(
            `DELETE FROM players WHERE discord_id LIKE $1`, [`${TAG}%`]
        );
        await pool.end();
    }
})().catch(err => {
    console.error("FAIL:", err.message);
    process.exit(1);
});
