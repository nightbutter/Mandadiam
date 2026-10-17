const assert = require("node:assert/strict");
const { pool } = require("../../src/database/db");
const characterCreate = require("../../src/bot/commands/character-create");
const { registerPlayer } = require("../../src/services/playerService");

// Exercises the real command execute() with mocked Discord interactions —
// regression coverage for the eager `replies` object that crashed on
// `result.details.join()` even on successful creation.

const TAG = `__cc_test_${Date.now()}__`;
const P1 = `${TAG}_p1`;

function mockInteraction(userId, options = {}) {
    const replies = [];

    return {
        interaction: {
            user: { id: userId, username: "tester" },
            options: {
                getString: n => options.strings?.[n] ?? null,
                getInteger: n => options.integers?.[n] ?? null
            },
            reply: async r => replies.push(r)
        },
        replies
    };
}

const VALID = {
    strings: { name: "Noctis" },
    integers: { max_hp: 100, atk: 20, def: 5, spe: 4 }
};

function test(title, result) {
    assert(result, title);
    console.log(`PASS: ${title}`);
}

(async () => {
    try {
        console.log("=== /character-create Command Tests ===");

        await registerPlayer(P1, "tester_one");

        // 1. Successful creation replies with the character summary.
        const ok = mockInteraction(P1, VALID);
        await characterCreate.execute(ok.interaction);
        test(
            "successful creation replies Created",
            ok.replies[0]?.content.startsWith("Created **Noctis**")
        );
        test("reply is ephemeral", ok.replies[0].ephemeral === true);

        // 2. Duplicate name returns a friendly error.
        const dup = mockInteraction(P1, VALID);
        await characterCreate.execute(dup.interaction);
        test(
            "duplicate name returns friendly error",
            dup.replies[0].content.includes("already have a character")
        );

        // 3. Invalid input returns the validation details.
        const bad = mockInteraction(P1, {
            strings: { name: "" },
            integers: VALID.integers
        });
        await characterCreate.execute(bad.interaction);
        test(
            "invalid input returns validation errors",
            bad.replies[0].content.startsWith("Invalid stats:")
        );

        // 4. Unregistered users get the registration prompt.
        const ghost = mockInteraction(`${TAG}_ghost`, VALID);
        await characterCreate.execute(ghost.interaction);
        test(
            "unregistered user gets register prompt",
            ghost.replies[0].content.includes("/register")
        );

        console.log("\n/character-create command tests passed.");
    } finally {
        await pool.query(
            `DELETE FROM players WHERE discord_id LIKE $1`, [`${TAG}%`]
        );
        await pool.end();
    }
})().catch(err => {
    console.error("FAIL:", err.message);
    process.exit(1);
});
