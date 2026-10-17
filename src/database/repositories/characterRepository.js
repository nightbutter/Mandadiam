const { pool } = require("../db");

// Data access for the characters table. All queries are parameterized.

const COLUMNS =
    `id, player_id, name, max_hp, atk, def, spe, image_url, created_at`;

async function createCharacter(playerId, { name, maxHp, atk, def, spe }) {
    const { rows: [character] } = await pool.query(
        `INSERT INTO characters (player_id, name, max_hp, atk, def, spe)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${COLUMNS}`,
        [playerId, name, maxHp, atk, def, spe]
    );

    return character;
}

async function listByPlayer(playerId) {
    const { rows } = await pool.query(
        `SELECT ${COLUMNS}
         FROM characters WHERE player_id = $1 ORDER BY id`,
        [playerId]
    );

    return rows;
}

async function findById(characterId) {
    const { rows: [character] } = await pool.query(
        `SELECT ${COLUMNS}
         FROM characters WHERE id = $1`,
        [characterId]
    );

    return character ?? null;
}

async function findByName(playerId, name) {
    const { rows: [character] } = await pool.query(
        `SELECT ${COLUMNS}
         FROM characters WHERE player_id = $1 AND name = $2`,
        [playerId, name]
    );

    return character ?? null;
}

// Sets or clears the portrait URL for a character row. Ownership is
// enforced by callers — this only touches the image_url column.
async function updateImage(characterId, imageUrl) {
    const { rows: [character] } = await pool.query(
        `UPDATE characters SET image_url = $2
         WHERE id = $1 RETURNING ${COLUMNS}`,
        [characterId, imageUrl]
    );

    return character ?? null;
}

module.exports = {
    createCharacter,
    listByPlayer,
    findById,
    findByName,
    updateImage
};
