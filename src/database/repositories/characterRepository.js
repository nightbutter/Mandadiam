const { pool } = require("../db");

// Data access for the characters table. All queries are parameterized.

async function createCharacter(playerId, { name, maxHp, atk, def, spe }) {
    const { rows: [character] } = await pool.query(
        `INSERT INTO characters (player_id, name, max_hp, atk, def, spe)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, player_id, name, max_hp, atk, def, spe, created_at`,
        [playerId, name, maxHp, atk, def, spe]
    );

    return character;
}

async function listByPlayer(playerId) {
    const { rows } = await pool.query(
        `SELECT id, player_id, name, max_hp, atk, def, spe, created_at
         FROM characters WHERE player_id = $1 ORDER BY id`,
        [playerId]
    );

    return rows;
}

async function findById(characterId) {
    const { rows: [character] } = await pool.query(
        `SELECT id, player_id, name, max_hp, atk, def, spe, created_at
         FROM characters WHERE id = $1`,
        [characterId]
    );

    return character ?? null;
}

async function findByName(playerId, name) {
    const { rows: [character] } = await pool.query(
        `SELECT id, player_id, name, max_hp, atk, def, spe, created_at
         FROM characters WHERE player_id = $1 AND name = $2`,
        [playerId, name]
    );

    return character ?? null;
}

module.exports = {
    createCharacter,
    listByPlayer,
    findById,
    findByName
};
