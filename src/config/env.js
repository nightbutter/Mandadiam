require("dotenv").config();

// Central place to read environment variables.
// Values are never logged — only validated for presence.

function requireEnv(name) {
    const value = process.env[name];

    if (!value || !value.trim()) {
        throw new Error(
            `${name} is not set. Copy .env.example to .env and fill it in.`
        );
    }

    return value.trim();
}

function optionalEnv(name) {
    const value = process.env[name];
    return value && value.trim() ? value.trim() : null;
}

const env = {
    databaseUrl: optionalEnv("DATABASE_URL"),
    databaseUrlUnpooled: optionalEnv("DATABASE_URL_UNPOOLED"),
    discordToken: optionalEnv("DISCORD_TOKEN"),
    discordClientId: optionalEnv("DISCORD_CLIENT_ID"),
    discordGuildId: optionalEnv("DISCORD_GUILD_ID")
};

module.exports = {
    env,
    requireEnv,
    optionalEnv
};
