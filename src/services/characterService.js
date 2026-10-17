const playerRepository = require("../database/repositories/playerRepository");
const characterRepository = require("../database/repositories/characterRepository");

// Character management for Discord commands. The invoking user's own
// player row is always resolved from their Discord snowflake — callers
// never supply a player id.

const LIMITS = {
    name: { min: 1, max: 50 },
    maxHp: { min: 1, max: 9999 },
    stat: { min: 0, max: 999 }
};

function isIntInRange(value, min, max) {
    return Number.isInteger(value) && value >= min && value <= max;
}

// Returns { values } on success or { errors } describing every problem.
function validateCharacterInput(input) {
    const errors = [];
    const name = typeof input.name === "string" ? input.name.trim() : "";

    if (name.length < LIMITS.name.min || name.length > LIMITS.name.max) {
        errors.push(
            `name must be ${LIMITS.name.min}-${LIMITS.name.max} characters`
        );
    }

    const stats = {
        max_hp: input.maxHp,
        atk: input.atk,
        def: input.def,
        spe: input.spe
    };

    if (!isIntInRange(stats.max_hp, LIMITS.maxHp.min, LIMITS.maxHp.max)) {
        errors.push(`max_hp must be ${LIMITS.maxHp.min}-${LIMITS.maxHp.max}`);
    }

    for (const key of ["atk", "def", "spe"]) {
        if (!isIntInRange(stats[key], LIMITS.stat.min, LIMITS.stat.max)) {
            errors.push(`${key} must be ${LIMITS.stat.min}-${LIMITS.stat.max}`);
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

module.exports = {
    LIMITS,
    validateCharacterInput,
    createCharacter,
    listCharacters,
    selectCharacter
};
