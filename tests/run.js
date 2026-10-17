const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
require("dotenv").config();

// Runs every test file in tests/unit, and tests/integration when
// DATABASE_URL is configured. Each file runs in its own node process.

const rootDir = path.join(__dirname, "..");

function listTests(dir) {
    const fullDir = path.join(__dirname, dir);

    if (!fs.existsSync(fullDir)) {
        return [];
    }

    return fs.readdirSync(fullDir)
        .filter(file => file.endsWith(".js"))
        .sort()
        .map(file => path.join(fullDir, file));
}

function run(file) {
    console.log(`\n===== ${path.relative(rootDir, file)} =====`);

    const result = spawnSync(process.execPath, [file], {
        stdio: "inherit",
        cwd: rootDir
    });

    return result.status === 0;
}

const suite = process.argv[2] ?? "all";

let passed = 0;
let failed = 0;

if (suite === "all" || suite === "unit") {
    for (const file of listTests("unit")) {
        run(file) ? passed++ : failed++;
    }
}

if (suite === "all" || suite === "integration") {
    if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim()) {
        for (const file of listTests("integration")) {
            run(file) ? passed++ : failed++;
        }
    } else {
        console.log("\nSKIP: integration tests — DATABASE_URL is not set.");
    }
}

console.log(`\n${passed} passed, ${failed} failed.`);

if (failed > 0) {
    process.exit(1);
}
