const assert = require("node:assert/strict");
const { pool } = require("../../src/database/db");
const playerService = require("../../src/services/playerService");
const characterService = require("../../src/services/characterService");
const playerRepository = require("../../src/database/repositories/playerRepository");

const TAG = `__pc_test_${Date.now()}__`;
const P1 = `${TAG}_p1`;
const P2 = `${TAG}_p2`;

function test(title, result) {
    assert(result, title);
    console.log(`PASS: ${title}`);
}

const CHAR = { name: "Noctis", maxHp: 100, atk: 20, def: 5, spe: 4 };

(async () => {
    try {
        console.log("=== Player & Character Integration Tests ===");

        // --- registration ---
        const first = await playerService.registerPlayer(P1, "tester_one");
        test("first registration creates a player", first.registered);

        const again = await playerService.registerPlayer(P1, "tester_one");
        test(
            "repeat registration is idempotent",
            !again.registered && again.player.id === first.player.id
        );

        const { rows: [count] } = await pool.query(
            `SELECT count(*)::int AS n FROM players WHERE discord_id = $1`, [P1]
        );
        test("only one player row exists", count.n === 1);

        await playerService.registerPlayer(P2, "tester_two");

        // --- profile ---
        test(
            "unregistered profile returns null",
            (await playerService.getProfile(`${TAG}_ghost`)) === null
        );

        const profile = await playerService.getProfile(P1);
        test(
            "profile loads without active character",
            profile.player.username === "tester_one" &&
            profile.activeCharacter === null
        );

        // --- character creation ---
        test(
            "create for unregistered user rejected",
            (await characterService.createCharacter(`${TAG}_ghost`, CHAR))
                .error === "not_registered"
        );

        test(
            "invalid stats rejected before insert",
            (await characterService.createCharacter(P1, { ...CHAR, maxHp: 0 }))
                .error === "invalid"
        );

        const overBudget = await characterService.createCharacter(
            P1, { name: "Cheater", maxHp: 150, atk: 30, def: 30, spe: 30 }
        );
        test(
            "over-budget stats rejected at service level",
            overBudget.error === "invalid" &&
            overBudget.details.some(d => d.includes("budget"))
        );

        const { rows: [noRow] } = await pool.query(
            `SELECT count(*)::int AS n FROM characters WHERE name = 'Cheater'`
        );
        test("rejected insert left no row", noRow.n === 0);

        const created = await characterService.createCharacter(P1, CHAR);
        test("character created for own player", created.ok);

        test(
            "duplicate name rejected",
            (await characterService.createCharacter(P1, CHAR))
                .error === "duplicate_name"
        );

        const p2Char = await characterService.createCharacter(
            P2, { name: "Slime", maxHp: 50, atk: 8, def: 7, spe: 2 }
        );
        test("second player creates a character", p2Char.ok);

        // --- listing ---
        const list = await characterService.listCharacters(P1);
        test(
            "list returns only own characters",
            list.characters.length === 1 &&
            list.characters[0].name === "Noctis"
        );

        test(
            "list for unregistered user rejected",
            (await characterService.listCharacters(`${TAG}_ghost`))
                .error === "not_registered"
        );

        // --- selection & ownership ---
        const selected = await characterService.selectCharacter(P1, "Noctis");
        test("select own character works", selected.ok);

        const afterSelect = await playerService.getProfile(P1);
        test(
            "profile shows active character",
            afterSelect.activeCharacter.name === "Noctis"
        );

        test(
            "cannot select another player's character by name",
            (await characterService.selectCharacter(P1, "Slime"))
                .error === "not_found"
        );

        // Even a guessed character id must fail — the composite FK
        // (active_character_id, id) -> characters (id, player_id) enforces it.
        let fkBlocked = false;
        try {
            await playerRepository.setActiveCharacter(
                (await playerService.getProfile(P1)).player.id,
                p2Char.character.id
            );
        } catch (err) {
            fkBlocked = err.code === "23503";
        }
        test("composite FK blocks selecting another player's character by id", fkBlocked);

        test(
            "select unknown name rejected",
            (await characterService.selectCharacter(P1, "Ghost"))
                .error === "not_found"
        );

        // The intentional test character must remain untouched by anything
        // this suite does (it predates the suite and must not be modified).
        const { rows: [legacy] } = await pool.query(
            `SELECT max_hp, atk, def, spe FROM characters
             WHERE name = 'noctis'`
        );
        if (legacy) {
            test(
                "existing 'noctis' test character unchanged",
                legacy.max_hp === 9999 && legacy.atk === 100 &&
                legacy.def === 50 && legacy.spe === 50
            );
        } else {
            console.log("SKIP: 'noctis' test character not present");
        }

        console.log("\nPlayer & character tests passed.");
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
