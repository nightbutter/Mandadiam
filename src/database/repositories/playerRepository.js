const { pool } = require("../db");

// Data access for the players table. All queries are parameterized.

async function createPlayer(discordId, username) {
    const { rows: [player] } = await pool.query(
        `INSERT INTO players (discord_id, username)
         VALUES ($1, $2)
         ON CONFLICT (discord_id)
         DO UPDATE SET username = EXCLUDED.username
         RETURNING id, discord_id, username, active_character_id, created_at`,
        [discordId, username]
    );

    return player;
}

async function findByDiscordId(discordId) {
    const { rows: [player] } = await pool.query(
        `SELECT id, discord_id, username, active_character_id, created_at
         FROM players WHERE discord_id = $1`,
        [discordId]
    );

    return player ?? null;
}

async function setActiveCharacter(playerId, characterId) {
    // The composite FK (active_character_id, id) -> characters (id, player_id)
    // guarantees a player can only activate their own character.
    const { rows: [player] } = await pool.query(
        `UPDATE players SET active_character_id = $1
         WHERE id = $2
         RETURNING id, active_character_id`,
        [characterId, playerId]
    );

    return player ?? null;
}

module.exports = {
    createPlayer,
    findByDiscordId,
    setActiveCharacter
};
