const statusRepository = require("../database/repositories/statusRepository");
const characterRepository = require("../database/repositories/characterRepository");
const { getSkill } = require("../game/skills");
const { getExSkill } = require("../game/exSkills");
const {
    BEHAVIORS, REAPPLY_POLICIES, SCOPES, TIMINGS
} = require("../game/statuses");

// Admin-facing validation + persistence for status definitions and
// application rules. Every mutation validates before touching the
// database; service results use the project's { ok, error } shape.

const DEF_LIMITS = {
    key: /^[a-z][a-z0-9_]{0,31}$/,
    nameMax: 50,
    powerMin: -999,
    powerMax: 999,
    maxStacks: { min: 1, max: 10 },
    duration: { min: 1, max: 20 },
    descriptionMax: 200
};

const CONDITION_KEYS = new Set([
    "target_hp_at_or_below_pct",
    "self_hp_at_or_below_pct"
]);

function isIntIn(value, min, max) {
    return Number.isInteger(value) && value >= min && value <= max;
}

// Returns { errors } or { values } — the caller decides.
function validateDefinition(input) {
    const errors = [];

    const key = typeof input.key === "string" ? input.key.trim() : "";
    const name = typeof input.name === "string" ? input.name.trim() : "";
    const description = typeof input.description === "string"
        ? input.description.trim()
        : "";

    if (!DEF_LIMITS.key.test(key)) {
        errors.push("key must be lowercase letters/digits/underscore");
    }

    if (!name.length || name.length > DEF_LIMITS.nameMax) {
        errors.push(`name must be 1-${DEF_LIMITS.nameMax} characters`);
    }

    if (!BEHAVIORS.has(input.behavior)) {
        errors.push(
            `behavior must be one of: ${[...BEHAVIORS].join(", ")}`
        );
    }

    if (!isIntIn(input.power, DEF_LIMITS.powerMin, DEF_LIMITS.powerMax)) {
        errors.push("power must be an integer -999..999");
    }

    if (typeof input.is_percent !== "boolean") {
        errors.push("is_percent must be true/false");
    }

    if (
        !isIntIn(
            input.max_stacks,
            DEF_LIMITS.maxStacks.min, DEF_LIMITS.maxStacks.max
        )
    ) {
        errors.push("max_stacks must be 1-10");
    }

    if (
        !isIntIn(
            input.default_duration,
            DEF_LIMITS.duration.min, DEF_LIMITS.duration.max
        )
    ) {
        errors.push("default_duration must be 1-20 turns");
    }

    if (!REAPPLY_POLICIES.has(input.reapply_policy)) {
        errors.push(
            `reapply_policy must be one of: ` +
            [...REAPPLY_POLICIES].join(", ")
        );
    }

    if (description.length > DEF_LIMITS.descriptionMax) {
        errors.push(
            `description must be ≤${DEF_LIMITS.descriptionMax} chars`
        );
    }

    // skip_turn and percent modifiers don't take flat power.
    if (input.behavior === "skip_turn" && input.power !== 0) {
        errors.push("skip_turn status must have power 0");
    }

    if (errors.length) {
        return { errors };
    }

    return {
        values: {
            key, name, description,
            behavior: input.behavior,
            enabled: input.enabled !== false,
            power: input.power,
            is_percent: input.is_percent,
            max_stacks: input.max_stacks,
            default_duration: input.default_duration,
            reapply_policy: input.reapply_policy
        }
    };
}

async function createDefinition(input) {
    const { errors, values } = validateDefinition(input);

    if (errors) {
        return { ok: false, error: "invalid", details: errors };
    }

    try {
        return {
            ok: true,
            definition: await statusRepository.createDefinition(values)
        };
    } catch (err) {
        if (err.code === "23505") {
            return { ok: false, error: "duplicate_key" };
        }
        throw err;
    }
}

async function updateDefinition(id, input) {
    const existing = await statusRepository.findDefinition(Number(id));

    if (!existing) {
        return { ok: false, error: "not_found" };
    }

    const merged = { ...existing, ...input };
    const { errors, values } = validateDefinition(merged);

    if (errors) {
        return { ok: false, error: "invalid", details: errors };
    }

    try {
        return {
            ok: true,
            definition:
                await statusRepository.updateDefinition(id, values)
        };
    } catch (err) {
        if (err.code === "23505") {
            return { ok: false, error: "duplicate_key" };
        }
        throw err;
    }
}

// --- rules ----------------------------------------------------------

function validateConditions(input) {
    if (input == null) {
        return { value: {} };
    }

    if (typeof input !== "object" || Array.isArray(input)) {
        return { error: "conditions must be an object" };
    }

    for (const [key, value] of Object.entries(input)) {
        if (!CONDITION_KEYS.has(key)) {
            return { error: `unknown condition "${key}"` };
        }

        if (!isIntIn(value, 1, 100)) {
            return { error: `${key} must be 1-100` };
        }
    }

    return { value: input };
}

// Resolves and validates one rule before persistence. scope
// "character"/"attack" take no action_key; "skill"/"ex" require a
// catalog key. Returns { ok, error?, values? }.
function validateRule(input, { characterExists }) {
    const errors = [];

    if (!characterExists) {
        return { ok: false, error: "character_not_found" };
    }

    if (!SCOPES.has(input.scope)) {
        errors.push("scope must be character|attack|skill|ex");
    }

    const key = String(input.action_key ?? "").trim();

    if (input.scope === "skill" && !getSkill(key)) {
        errors.push(`unknown skill "${key}"`);
    }

    if (input.scope === "ex" && !getExSkill(key)) {
        errors.push(`unknown ex "${key}"`);
    }

    if (
        (input.scope === "character" || input.scope === "attack") &&
        key !== ""
    ) {
        errors.push(`scope ${input.scope} takes no action key`);
    }

    if (!isIntIn(input.chance, 0, 100)) {
        errors.push("chance must be 0-100");
    }

    if (
        input.duration != null &&
        !isIntIn(
            input.duration,
            DEF_LIMITS.duration.min, DEF_LIMITS.duration.max
        )
    ) {
        errors.push("duration must be 1-20 or empty");
    }

    if (!isIntIn(input.stacks, 1, DEF_LIMITS.maxStacks.max)) {
        errors.push("stacks must be 1-10");
    }

    if (!TIMINGS.has(input.timing)) {
        errors.push("timing must be per_action|per_hit");
    }

    const conditions = validateConditions(input.conditions);

    if (conditions.error) {
        errors.push(conditions.error);
    }

    if (errors.length) {
        return { errors };
    }

    return {
        values: {
            character_id: input.character_id,
            status_id: input.status_id,
            scope: input.scope,
            action_key: key,
            enabled: input.enabled !== false,
            chance: input.chance,
            duration: input.duration ?? null,
            stacks: input.stacks,
            timing: input.timing,
            conditions: conditions.value
        }
    };
}

async function upsertRule(input) {
    const character = await characterRepository.findById(
        Number(input.character_id)
    );

    const status = await statusRepository.findDefinition(
        Number(input.status_id)
    );

    if (!status) {
        return { ok: false, error: "status_not_found" };
    }

    const { errors, values } = validateRule(input, {
        characterExists: !!character
    });

    if (errors) {
        return { ok: false, error: "invalid", details: errors };
    }

    return {
        ok: true,
        rule: await statusRepository.upsertRule(values)
    };
}

// Rules attached to a battle character — joined definition fields,
// in application order.
async function battleRules(characterId) {
    return statusRepository.listRulesForCharacter(characterId);
}

module.exports = {
    DEF_LIMITS,
    CONDITION_KEYS,
    listDefinitions: statusRepository.listDefinitions,
    findDefinition: statusRepository.findDefinition,
    createDefinition,
    updateDefinition,
    deleteDefinition: statusRepository.deleteDefinition,
    listRulesForCharacter: statusRepository.listRulesForCharacter,
    findRule: statusRepository.findRule,
    upsertRule,
    deleteRule: statusRepository.deleteRule,
    battleRules,
    validateDefinition,
    validateRule
};
