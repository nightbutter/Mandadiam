const { REST, Routes } = require("discord.js");
const { env } = require("../config/env");
const { commandData } = require("./commands");

// Registers slash commands with Discord. Run manually:
//   npm run commands:register
// Guild-scoped when DISCORD_GUILD_ID is set (instant), global otherwise
// (global propagation can take up to an hour).

async function main() {
    if (!env.discordToken || !env.discordClientId) {
        throw new Error(
            "DISCORD_TOKEN and DISCORD_CLIENT_ID must be set in .env " +
            "to register commands."
        );
    }

    const rest = new REST().setToken(env.discordToken);

    const route = env.discordGuildId
        ? Routes.applicationGuildCommands(env.discordClientId, env.discordGuildId)
        : Routes.applicationCommands(env.discordClientId);

    await rest.put(route, { body: commandData });

    console.log(
        `Registered ${commandData.length} command(s)` +
        (env.discordGuildId ? " for the configured guild." : " globally.")
    );
}

if (require.main === module) {
    main().catch(err => {
        console.error("Command registration failed:", err.message);
        process.exitCode = 1;
    });
}

module.exports = { main };
