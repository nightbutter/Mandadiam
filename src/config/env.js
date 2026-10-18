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
    discordGuildId: optionalEnv("DISCORD_GUILD_ID"),
    // Comma-separated Discord user ids allowed into the admin
    // dashboard. Empty/absent = no admins; every admin interaction
    // re-checks membership server-side.
    adminIds: new Set(
        (optionalEnv("ADMIN_IDS") ?? "")
            .split(",")
            .map(id => id.trim())
            .filter(Boolean)
    )
};

function isAdmin(discordId) {
    return env.adminIds.has(String(discordId));
}

module.exports = {
    env,
    isAdmin,
    requireEnv,
    optionalEnv
};
