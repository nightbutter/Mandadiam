const { pool } = require("../db");
const { EX_KEYS, getExSkill } = require("../../game/exSkills");

// One EX assignment per character (character_ex PK on character_id).
// All queries parameterized; ownership checks live in the service
// layer. Deterministic default: EX_KEYS[character_id % length] — the
// migration backfill uses the same formula and key order.

async function provision(characterId) {
    const key = EX_KEYS[Number(characterId) % EX_KEYS.length];

    await pool.query(
        `INSERT INTO character_ex (character_id, ex_key)
         VALUES ($1, $2)
         ON CONFLICT (character_id) DO NOTHING`,
        [characterId, key]
    );

    return key;
}

async function getExKey(characterId) {
    const { rows } = await pool.query(
        `SELECT ex_key FROM character_ex WHERE character_id = $1`,
        [characterId]
    );

    return rows[0]?.ex_key ?? null;
}

// Reassigns a character's EX — validated against the catalog so
// forged keys can never be stored.
async function assign(characterId, exKey) {
    if (!getExSkill(exKey)) {
        return { ok: false, error: "unknown_ex" };
    }

    await pool.query(
        `INSERT INTO character_ex (character_id, ex_key)
         VALUES ($1, $2)
         ON CONFLICT (character_id)
         DO UPDATE SET ex_key = EXCLUDED.ex_key`,
        [characterId, exKey]
    );

    return { ok: true };
}

module.exports = { provision, getExKey, assign };
