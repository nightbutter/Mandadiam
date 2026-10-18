const { pool } = require("../db");

// Status definitions + per-character application rules. All queries
// parameterized; validation lives in statusService. Rule rows are
// joined with their definition so the returned shape is a complete
// rule ready to attach to a battle character's statusRules.

async function listDefinitions() {
    const { rows } = await pool.query(
        `SELECT * FROM status_definitions ORDER BY id`
    );

    return rows;
}

async function findDefinition(id) {
    const { rows } = await pool.query(
        `SELECT * FROM status_definitions WHERE id = $1`,
        [id]
    );

    return rows[0] ?? null;
}

async function createDefinition(fields) {
    const { rows } = await pool.query(
        `INSERT INTO status_definitions
            (key, name, behavior, enabled, power, is_percent,
             max_stacks, default_duration, reapply_policy, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
            fields.key, fields.name, fields.behavior,
            fields.enabled, fields.power, fields.is_percent,
            fields.max_stacks, fields.default_duration,
            fields.reapply_policy, fields.description
        ]
    );

    return rows[0];
}

async function updateDefinition(id, fields) {
    const { rows } = await pool.query(
        `UPDATE status_definitions SET
            key              = $2,
            name             = $3,
            behavior         = $4,
            enabled          = $5,
            power            = $6,
            is_percent       = $7,
            max_stacks       = $8,
            default_duration = $9,
            reapply_policy   = $10,
            description      = $11,
            updated_at       = now()
         WHERE id = $1
         RETURNING *`,
        [
            id, fields.key, fields.name, fields.behavior,
            fields.enabled, fields.power, fields.is_percent,
            fields.max_stacks, fields.default_duration,
            fields.reapply_policy, fields.description
        ]
    );

    return rows[0] ?? null;
}

async function deleteDefinition(id) {
    const { rowCount } = await pool.query(
        `DELETE FROM status_definitions WHERE id = $1`, [id]
    );

    return rowCount > 0;
}

// Rules joined with their definition — the row shape the combat
// engine consumes (status_id + definition fields + rule fields).
async function listRulesForCharacter(characterId) {
    const { rows } = await pool.query(
        `SELECT r.id, r.character_id, r.status_id, r.scope,
                r.action_key, r.enabled, r.chance, r.duration,
                r.stacks, r.timing, r.conditions,
                d.key, d.name, d.behavior, d.power, d.is_percent,
                d.max_stacks, d.default_duration, d.reapply_policy,
                d.enabled AS status_enabled
         FROM status_rules r
         JOIN status_definitions d ON d.id = r.status_id
         WHERE r.character_id = $1
         ORDER BY r.id`,
        [characterId]
    );

    return rows;
}

async function findRule(id) {
    const { rows } = await pool.query(
        `SELECT * FROM status_rules WHERE id = $1`, [id]
    );

    return rows[0] ?? null;
}

// One rule per (character, status, scope, action_key) — enforced by
// the UNIQUE constraint; upsert keeps admin edits idempotent.
async function upsertRule(fields) {
    const { rows } = await pool.query(
        `INSERT INTO status_rules
            (character_id, status_id, scope, action_key, enabled,
             chance, duration, stacks, timing, conditions)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (character_id, status_id, scope, action_key)
         DO UPDATE SET
             enabled    = EXCLUDED.enabled,
             chance     = EXCLUDED.chance,
             duration   = EXCLUDED.duration,
             stacks     = EXCLUDED.stacks,
             timing     = EXCLUDED.timing,
             conditions = EXCLUDED.conditions,
             updated_at = now()
         RETURNING *`,
        [
            fields.character_id, fields.status_id, fields.scope,
            fields.action_key, fields.enabled, fields.chance,
            fields.duration, fields.stacks, fields.timing,
            JSON.stringify(fields.conditions ?? {})
        ]
    );

    return rows[0];
}

async function deleteRule(id) {
    const { rowCount } = await pool.query(
        `DELETE FROM status_rules WHERE id = $1`, [id]
    );

    return rowCount > 0;
}

module.exports = {
    listDefinitions,
    findDefinition,
    createDefinition,
    updateDefinition,
    deleteDefinition,
    listRulesForCharacter,
    findRule,
    upsertRule,
    deleteRule
};
