const { Pool } = require("pg");
const { env } = require("../config/env");

if (!env.databaseUrl) {
    throw new Error(
        "DATABASE_URL is not set. Copy your Neon connection string " +
        "into .env (see .env.example for the format)."
    );
}

const pool = new Pool({
    // Neon requires TLS; the connection string should carry ?sslmode=require
    connectionString: env.databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000
});

async function testConnection() {
    const { rows } = await pool.query("SELECT NOW() AS now");

    return {
        ok: true,
        serverTime: rows[0].now
    };
}

async function closePool() {
    await pool.end();
}

module.exports = {
    pool,
    testConnection,
    closePool
};
