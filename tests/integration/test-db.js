(async () => {
    let db;

    try {
        db = require("../../src/database/db");
    } catch (err) {
        console.error(`FAIL: ${err.message}`);
        process.exit(1);
    }

    const { pool, testConnection } = db;

    try {
        const result = await testConnection();
        console.log("Connection OK — server time:", result.serverTime);
    } catch (err) {
        console.error("Connection failed:", err.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
})();
