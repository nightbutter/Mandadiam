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

    const shutdown = async signal => {
        console.log(`${signal} received — shutting down.`);
        client.destroy();
        if (db) {
            await db.closePool().catch(() => {});
        }
        process.exit(0);
    };

    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));

    await client.login(env.discordToken);
}

main().catch(err => {
    console.error("Startup failed:", err.message);
    process.exit(1);
});
