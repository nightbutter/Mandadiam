const assert = require("node:assert/strict");
const { pool } = require("../../src/database/db");
const { migrate } = require("../../src/database/migrations/migrate");

const TAG = `__schema_test_${Date.now()}__`;

function test(title, result) {
    assert(result, title);
    console.log(`PASS: ${title}`);
}

async function expectViolation(promise, title) {
    try {
        await promise;
    } catch {
        console.log(`PASS: ${title}`);
        return;
    }
    throw new Error(`FAIL: ${title} — expected a constraint violation`);
}

(async () => {
    const createdPlayers = [];
    const createdCharacters = [];
    const createdBattles = [];

    try {
        console.log("=== Schema Migration Tests ===");

        await migrate();
        await migrate();
        test("migration runs twice without error", true);

        const { rows: tables } = await pool.query(
            `SELECT table_name FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = ANY($1)
             ORDER BY table_name`,
            [["players", "characters", "battles"]]
        );
        test(
            "players, characters, battles exist",
            tables.length === 3
        );

        // --- CRUD ---
        const { rows: [p1] } = await pool.query(
            `INSERT INTO players (discord_id, username)
             VALUES ($1, $2) RETURNING id`,
            [`${TAG}p1`, "tester_one"]
        );
        const { rows: [p2] } = await pool.query(
            `INSERT INTO players (discord_id, username)
             VALUES ($1, $2) RETURNING id`,
            [`${TAG}p2`, "tester_two"]
        );
        createdPlayers.push(p1.id, p2.id);
        test("insert players", p1.id && p2.id);

        const { rows: [c1] } = await pool.query(
            `INSERT INTO characters (player_id, name, max_hp, atk, def, spe)
             VALUES ($1, 'Noctis', 100, 20, 5, 4) RETURNING id`,
            [p1.id]
        );
        const { rows: [c2] } = await pool.query(
            `INSERT INTO characters (player_id, name, max_hp, atk, def, spe)
             VALUES ($1, 'Slime', 100, 8, 7, 2) RETURNING id`,
            [p2.id]
        );
        createdCharacters.push(c1.id, c2.id);
        test("insert characters", c1.id && c2.id);

        const { rows: [sel] } = await pool.query(
            `SELECT name, atk FROM characters WHERE id = $1`,
            [c1.id]
        );
        test("select character back", sel.name === "Noctis" && sel.atk === 20);

        // --- active_character_id composite FK ---
        await pool.query(
            `UPDATE players SET active_character_id = $1 WHERE id = $2`,
            [c1.id, p1.id]
        );
        test("set own character as active", true);

        await expectViolation(
            pool.query(
                `UPDATE players SET active_character_id = $1 WHERE id = $2`,
                [c2.id, p1.id]
            ),
            "cannot set another player's character as active"
        );

        // --- battles consistency ---
        const { rows: [b1] } = await pool.query(
            `INSERT INTO battles
             (player_one_id, character_one_id, player_two_id, character_two_id)
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [p1.id, c1.id, p2.id, c2.id]
        );
        createdBattles.push(b1.id);
        test("insert battle with correct owners", !!b1.id);

        await expectViolation(
            pool.query(
                `INSERT INTO battles
                 (player_one_id, character_one_id, player_two_id, character_two_id)
                 VALUES ($1, $2, $3, $4)`,
                [p1.id, c2.id, p2.id, c2.id]
            ),
            "battle rejects character owned by another player"
        );

        await expectViolation(
            pool.query(`DELETE FROM players WHERE id = $1`, [p1.id]),
            "RESTRICT blocks deleting a player referenced by battles"
        );

        await pool.query(`DELETE FROM battles WHERE id = $1`, [b1.id]);
        createdBattles.pop();
        test("delete test battle", true);

        // --- ON DELETE SET NULL (active_character_id) ---
        await pool.query(`DELETE FROM characters WHERE id = $1`, [c1.id]);
        createdCharacters.shift();
        const { rows: [p1After] } = await pool.query(
            `SELECT active_character_id FROM players WHERE id = $1`,
            [p1.id]
        );
        test(
            "deleting active character nulls active_character_id",
            p1After.active_character_id === null
        );

        console.log("\nSchema tests passed.");
    } finally {
        if (createdBattles.length) {
            await pool.query(`DELETE FROM battles WHERE id = ANY($1)`, [createdBattles]);
        }
        if (createdCharacters.length) {
            await pool.query(`DELETE FROM characters WHERE id = ANY($1)`, [createdCharacters]);
        }
        if (createdPlayers.length) {
            await pool.query(`DELETE FROM players WHERE id = ANY($1)`, [createdPlayers]);
        }
        await pool.end();
    }
})().catch(err => {
    console.error("FAIL:", err.message);
    process.exit(1);
});
