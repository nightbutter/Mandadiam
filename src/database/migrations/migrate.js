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

-- Phase 4.3: character portraits. Nullable — existing rows get the
-- default no-image behavior. Stores a URL only, never binary data.
ALTER TABLE characters ADD COLUMN IF NOT EXISTS image_url TEXT;

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

-- Phase 5: per-character equipped skills. Keys are validated against
-- the skill catalog in application code; the composite PK prevents
-- duplicate skills per character.
CREATE TABLE IF NOT EXISTS character_skills (
    character_id BIGINT NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
    skill_key    TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (character_id, skill_key)
);

-- Backfill the initial three-skill loadout for every existing
-- character. ON CONFLICT keeps the migration idempotent.
INSERT INTO character_skills (character_id, skill_key)
    SELECT c.id, s.key
    FROM characters c
    CROSS JOIN (
        VALUES
            ('power_strike'),
            ('piercing_strike'),
            ('desperation_burst')
    ) AS s (key)
    ON CONFLICT DO NOTHING;

-- Phase 6: one EX (Ultimate) assignment per character. The PK is
-- character_id so a character can never hold two EX rows. Keys are
-- validated against the EX catalog in application code.
CREATE TABLE IF NOT EXISTS character_ex (
    character_id BIGINT PRIMARY KEY REFERENCES characters (id) ON DELETE CASCADE,
    ex_key       TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Backfill a deterministic default EX for every existing character:
-- EX_KEYS[id % 4] matches exRepository.provision(). ON CONFLICT keeps
-- the migration idempotent and never overwrites an existing choice.
INSERT INTO character_ex (character_id, ex_key)
    SELECT c.id,
           (ARRAY[
               'oblivion_edge',
               'void_piercer',
               'fang_barrage',
               'last_light'
           ])[(c.id % 4 + 1)::int]
    FROM characters c
    ON CONFLICT (character_id) DO NOTHING;

-- Phase 7: status effects. Definitions are the catalog admins edit;
-- rules are per-character application configs. Both are persisted;
-- ACTIVE status instances stay in-memory like cost/ex/cooldowns.
CREATE TABLE IF NOT EXISTS status_definitions (
    id               BIGSERIAL PRIMARY KEY,
    key              TEXT NOT NULL UNIQUE,
    name             TEXT NOT NULL,
    behavior         TEXT NOT NULL CHECK (behavior IN (
                         'periodic_damage', 'skip_turn',
                         'modify_atk', 'modify_def')),
    enabled          BOOLEAN NOT NULL DEFAULT true,
    power            INT NOT NULL DEFAULT 0,
    is_percent       BOOLEAN NOT NULL DEFAULT false,
    max_stacks       INT NOT NULL DEFAULT 1 CHECK (max_stacks > 0),
    default_duration INT NOT NULL DEFAULT 1 CHECK (default_duration > 0),
    reapply_policy   TEXT NOT NULL DEFAULT 'refresh_duration'
                     CHECK (reapply_policy IN (
                         'refresh_duration', 'stack_intensity',
                         'replace_if_stronger', 'ignore_if_active',
                         'replace_duration')),
    description      TEXT NOT NULL DEFAULT '',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS status_rules (
    id           BIGSERIAL PRIMARY KEY,
    character_id BIGINT NOT NULL REFERENCES characters (id)
                 ON DELETE CASCADE,
    status_id    BIGINT NOT NULL REFERENCES status_definitions (id)
                 ON DELETE CASCADE,
    -- character = fallback for all actions; attack = normal attacks;
    -- skill/ex = one specific action key from the catalogs.
    scope        TEXT NOT NULL CHECK (scope IN
                     ('character', 'attack', 'skill', 'ex')),
    action_key   TEXT NOT NULL DEFAULT '',
    enabled      BOOLEAN NOT NULL DEFAULT true,
    chance       INT NOT NULL DEFAULT 100
                 CHECK (chance BETWEEN 0 AND 100),
    -- NULL duration falls back to the definition's default_duration.
    duration     INT CHECK (duration IS NULL OR duration > 0),
    stacks       INT NOT NULL DEFAULT 1 CHECK (stacks > 0),
    timing       TEXT NOT NULL DEFAULT 'per_action'
                 CHECK (timing IN ('per_action', 'per_hit')),
    conditions   JSONB NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (character_id, status_id, scope, action_key)
);

CREATE INDEX IF NOT EXISTS idx_status_rules_character
    ON status_rules (character_id);

-- Seed the default catalog. Enabled definitions are inert without
-- rules; nothing applies until an admin configures a rule.
INSERT INTO status_definitions
    (key, name, behavior, power, max_stacks, default_duration,
     reapply_policy, description)
VALUES
    ('burn', 'Burn', 'periodic_damage', 4, 1, 3, 'refresh_duration',
     'Takes damage at the start of each of its turns.'),
    ('poison', 'Poison', 'periodic_damage', 3, 5, 3, 'stack_intensity',
     'Stacking damage at the start of each of its turns.'),
    ('bleed', 'Bleed', 'periodic_damage', 2, 1, 4, 'replace_duration',
     'Lingering damage; reapplication replaces the duration.'),
    ('stun', 'Stun', 'skip_turn', 0, 1, 1, 'ignore_if_active',
     'Skips its next turn.'),
    ('atk_down', 'ATK Down', 'modify_atk', -5, 3, 2, 'stack_intensity',
     'Reduces effective ATK while active.'),
    ('def_down', 'DEF Down', 'modify_def', -5, 3, 2, 'stack_intensity',
     'Reduces effective DEF while active.')
ON CONFLICT (key) DO NOTHING;
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
