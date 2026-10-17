const { env } = require("./config/env");
const { createClient } = require("./bot/client");

async function main() {
    if (!env.discordToken) {
        throw new Error(
            "DISCORD_TOKEN is not set. Copy .env.example to .env " +
            "and add your bot token."
        );
    }

    const client = createClient();

    // Login can fail outright when a privileged intent isn't enabled
    // in the Developer Portal (error 4014) — retry with the optional
    // intents stripped so the rest of the bot still comes up.
    const login = async () => {
        try {
            await client.login(env.discordToken);
        } catch (err) {
            if (err.code === "DisallowedIntents" ||
                err.message?.includes("disallowed intent")) {
                console.warn(
                    "Privileged MessageContent intent is not enabled — " +
                    "the in-channel portrait upload flow is disabled. " +
                    "(/character-image still works.)"
                );
                client.destroy();
                const fallback = createClient({ messageContent: false });
                await fallback.login(env.discordToken);
                return fallback;
            }
            throw err;
        }
        return client;
    };

    // Optional database check — the bot can still serve commands like
    // /ping without it, so a missing DATABASE_URL only warns.
    let db = null;
    if (env.databaseUrl) {
        db = require("./database/db");
        try {
            await db.testConnection();
            console.log("PostgreSQL connection OK.");
        } catch (err) {
            console.error("PostgreSQL connection failed:", err.message);
        }
    } else {
        console.warn("DATABASE_URL is not set — database features disabled.");
    }

    const activeClient = await login();

    const shutdown = async signal => {
        console.log(`${signal} received — shutting down.`);
        activeClient.destroy();
        if (db) {
            await db.closePool().catch(() => {});
        }
        process.exit(0);
    };

    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch(err => {
    console.error("Startup failed:", err.message);
    process.exit(1);
});
