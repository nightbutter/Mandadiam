const { env } = require("../../config/env");

// Replies and returns false when the bot has no database configured,
// so player/character commands degrade gracefully.
async function ensureDatabase(interaction) {
    if (env.databaseUrl) {
        return true;
    }

    await interaction.reply({
        content:
            "Database features are unavailable — " +
            "the bot is not configured with a database.",
        ephemeral: true
    });

    return false;
}

module.exports = { ensureDatabase };
