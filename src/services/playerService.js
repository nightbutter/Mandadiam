const playerRepository = require("../database/repositories/playerRepository");
const characterRepository = require("../database/repositories/characterRepository");

// Registration and profile logic shared by the Discord commands.
// Keeps SQL details behind the repositories so commands stay thin.

async function registerPlayer(discordId, username) {
    const player = await playerRepository.registerPlayer(discordId, username);

    if (player) {
        return { registered: true, player };
    }

    // ON CONFLICT DO NOTHING returned nothing — the player exists already.
    return {
        registered: false,
        player: await playerRepository.findByDiscordId(discordId)
    };
}

async function getProfile(discordId) {
    const player = await playerRepository.findByDiscordId(discordId);

    if (!player) {
        return null;
    }

    const activeCharacter = player.active_character_id
        ? await characterRepository.findById(player.active_character_id)
        : null;

    return { player, activeCharacter };
}

// Challenge eligibility source for the opponent picker — same rule
// the challenge validator enforces (registered + active character).
// Busy/self filtering happens at the call site.
async function listChallengeable() {
    return playerRepository.listChallengeable();
}

module.exports = {
    registerPlayer,
    getProfile,
    listChallengeable
};
