const playerRepository = require("../database/repositories/playerRepository");
const characterRepository = require("../database/repositories/characterRepository");
const { toBattleCharacter } = require("../game/services/battleService");

// Character management for Discord commands. The invoking user's own
// player row is always resolved from their Discord snowflake — callers
// never supply a player id.

// Official character creation rules (approved): a single point-buy
// budget of 150 shared across max_hp + atk + def + spe. HP costs one
// point per hit point; each stat is capped at 30.
const RULES = {
    name: { min: 1, max: 30 },
    maxHp: { min: 50, max: 150 },
    stat: { min: 0, max: 30 },
    budget: 150
};

function isIntInRange(value, min, max) {
    return Number.isInteger(value) && value >= min && value <= max;
}

// Returns { values } on success or { errors } describing every problem.
function validateCharacterInput(input) {
    const errors = [];
    const name = typeof input.name === "string" ? input.name.trim() : "";

    if (name.length < RULES.name.min || name.length > RULES.name.max) {
        errors.push(
            `name must be ${RULES.name.min}-${RULES.name.max} characters`
        );
    }

    const stats = {
        max_hp: input.maxHp,
        atk: input.atk,
        def: input.def,
        spe: input.spe
    };

    if (!isIntInRange(stats.max_hp, RULES.maxHp.min, RULES.maxHp.max)) {
        errors.push(
            `max_hp must be ${RULES.maxHp.min}-${RULES.maxHp.max}`
        );
    }

    for (const key of ["atk", "def", "spe"]) {
        if (!isIntInRange(stats[key], RULES.stat.min, RULES.stat.max)) {
            errors.push(`${key} must be ${RULES.stat.min}-${RULES.stat.max}`);
        }
    }

    if (!errors.length) {
        const spent = stats.max_hp + stats.atk + stats.def + stats.spe;

        if (spent > RULES.budget) {
            errors.push(
                `stats total ${spent} exceeds the ${RULES.budget} ` +
                `point budget (hp + atk + def + spe)`
            );
        }
    }

    if (errors.length) {
        return { errors };
    }

    return {
        values: {
            name,
            maxHp: stats.max_hp,
            atk: stats.atk,
            def: stats.def,
            spe: stats.spe
        }
    };
}

async function createCharacter(discordId, input) {
    const player = await playerRepository.findByDiscordId(discordId);

    if (!player) {
        return { ok: false, error: "not_registered" };
    }

    const { errors, values } = validateCharacterInput(input);

    if (errors) {
        return { ok: false, error: "invalid", details: errors };
    }

    try {
        const character = await characterRepository.createCharacter(
            player.id, values
        );

        return { ok: true, character };
    } catch (err) {
        if (err.code === "23505") {
            return { ok: false, error: "duplicate_name" };
        }

        throw err;
    }
}

async function listCharacters(discordId) {
    const player = await playerRepository.findByDiscordId(discordId);

    if (!player) {
        return { ok: false, error: "not_registered" };
    }

    return {
        ok: true,
        player,
        characters: await characterRepository.listByPlayer(player.id)
    };
}

async function selectCharacter(discordId, name) {
    const player = await playerRepository.findByDiscordId(discordId);

    if (!player) {
        return { ok: false, error: "not_registered" };
    }

    const character = await characterRepository.findByName(
        player.id, String(name ?? "").trim()
    );

    if (!character) {
        return { ok: false, error: "not_found" };
    }

    await playerRepository.setActiveCharacter(player.id, character.id);

    return { ok: true, character };
}

// Loads the player's active character converted to combat-engine shape
// (hp = max_hp, cost = 0). Used when starting a battle from Discord.
async function getActiveBattleCharacter(discordId) {
    const player = await playerRepository.findByDiscordId(discordId);

    if (!player) {
        return { ok: false, error: "not_registered" };
    }

    if (!player.active_character_id) {
        return { ok: false, error: "no_active_character" };
    }

    const character = await characterRepository.findById(
        player.active_character_id
    );

    if (!character) {
        return { ok: false, error: "no_active_character" };
    }

    return { ok: true, character: toBattleCharacter(character) };
}

module.exports = {
    RULES,
    getActiveBattleCharacter,
    validateCharacterInput,
    createCharacter,
    listCharacters,
    selectCharacter
};
