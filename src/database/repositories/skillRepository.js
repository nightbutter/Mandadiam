const { pool } = require("../db");
const { INITIAL_LOADOUT } = require("../../game/skills");

// Per-character equipped skills. All queries parameterized; ownership
// checks live in the service layer.

// Inserts the initial loadout for a character — idempotent.
async function provision(characterId) {
    await pool.query(
        `INSERT INTO character_skills (character_id, skill_key)
         SELECT $1, s.key FROM (VALUES ${INITIAL_LOADOUT
             .map((_, i) => `($${i + 2})`)
             .join(", ")}) AS s (key)
         ON CONFLICT DO NOTHING`,
        [characterId, ...INITIAL_LOADOUT]
    );
}

async function listKeys(characterId) {
    const { rows } = await pool.query(
        `SELECT skill_key FROM character_skills
         WHERE character_id = $1 ORDER BY skill_key`,
        [characterId]
    );

    return rows.map(r => r.skill_key);
}

module.exports = { provision, listKeys };
