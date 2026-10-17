const { pool } = require("../db");

// Idempotent schema — safe to run repeatedly.
// Circular FK between players/characters is resolved by adding
// players_active_character_fk via ALTER TABLE after both tables exist.
const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS players (
    id                  BIGSERIAL PRIMARY KEY,
    discord_id          TEXT NOT NULL UNIQUE,
    username            TEXT NOT NULL,
    active_character_id BIGINT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS characters (
    id         BIGSERIAL PRIMARY KEY,
    player_id  BIGINT NOT NULL REFERENCES players (id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    max_hp     INT NOT NULL CHECK (max_hp > 0),
    atk        INT NOT NULL,
    def        INT NOT NULL,
    spe        INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (player_id, name),
    UNIQUE (id, player_id)
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'players_active_character_fk'
    ) THEN
        ALTER TABLE players
            ADD CONSTRAINT players_active_character_fk
            FOREIGN KEY (active_character_id, id)
            REFERENCES characters (id, player_id)
            ON DELETE SET NULL (active_character_id);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS battles (
    id               BIGSERIAL PRIMARY KEY,
    player_one_id    BIGINT NOT NULL REFERENCES players (id) ON DELETE RESTRICT,
    player_two_id    BIGINT NOT NULL REFERENCES players (id) ON DELETE RESTRICT,
    character_one_id BIGINT NOT NULL,
    character_two_id BIGINT NOT NULL,
    winner_player_id BIGINT REFERENCES players (id) ON DELETE RESTRICT,
    started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at         TIMESTAMPTZ,
    CHECK (player_one_id <> player_two_id),
    FOREIGN KEY (character_one_id, player_one_id)
        REFERENCES characters (id, player_id) ON DELETE RESTRICT,
    FOREIGN KEY (character_two_id, player_two_id)
        REFERENCES characters (id, player_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_battles_player_one ON battles (player_one_id);
CREATE INDEX IF NOT EXISTS idx_battles_player_two ON battles (player_two_id);
`;

async function migrate() {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");
        await client.query(MIGRATION_SQL);
        await client.query("COMMIT");
        return { ok: true };
    } catch (err) {
        await client.query("ROLLBACK");
        throw err;
    } finally {
        client.release();
    }
}

if (require.main === module) {
    migrate()
        .then(() => console.log("Migration completed."))
        .catch(err => {
            console.error("Migration failed:", err.message);
            process.exitCode = 1;
        })
        .finally(() => pool.end());
}

module.exports = { migrate };
