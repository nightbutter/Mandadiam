const assert = require("node:assert/strict");
const { pool } = require("../../src/database/db");
const playerService = require("../../src/services/playerService");
const characterService = require("../../src/services/characterService");
const command = require("../../src/bot/commands/character-image");

// Regression for the "/character-image did not respond" timeout: the
// command must deferReply() first, then answer via editReply() only —
// never reply() after acknowledgement.

const TAG = `__imgcmd_test_${Date.now()}__`;
const P1 = `${TAG}_p1`;
const P2 = `${TAG}_p2`;

const CDN = "https://cdn.discordapp.com/ephemeral-attachments/1/2/p.png";

function test(title, result) {
    assert(result, title);
    console.log(`PASS: ${title}`);
}

function mockInteraction(userId, { attachment, characterName = null }) {
    const calls = {
        order: [], replies: [], edits: [], defers: 0
    };

    return {
        calls,
        user: { id: userId, username: `u_${userId}` },
        channelId: `${TAG}_chan`,
        options: {
            getAttachment: () => attachment,
            getString: () => characterName
        },
        deferReply: async () => {
            calls.order.push("deferReply");
            calls.defers++;
        },
        editReply: async p => {
            calls.order.push("editReply");
            calls.edits.push(p);
        },
        reply: async p => {
            calls.order.push("reply");
            calls.replies.push(p);
        },
        followUp: async p => calls.replies.push(p)
    };
}

const png = {
    name: "p.png",
    contentType: "image/png",
    size: 2048,
    url: CDN
};

(async () => {
    try {
        console.log("=== /character-image Command Tests ===");

        await playerService.registerPlayer(P1, "imgcmd_one");
        await playerService.registerPlayer(P2, "imgcmd_two");
        await characterService.createCharacter(
            P1, { name: "Hero", maxHp: 100, atk: 20, def: 15, spe: 15 }
        );
        await characterService.createCharacter(
            P2, { name: "Theft", maxHp: 90, atk: 30, def: 15, spe: 15 }
        );
        await characterService.selectCharacter(P1, "Hero");

        // --- valid attachment: defer then editReply success ---

        let intr = mockInteraction(P1, { attachment: png });
        await command.execute(intr);

        test("valid image: defers exactly once",
            intr.calls.defers === 1);
        test("valid image: defer precedes editReply",
            intr.calls.order.join(",") === "deferReply,editReply");
        test("valid image: never calls reply()",
            intr.calls.replies.length === 0);
        test("valid image: success message",
            intr.calls.edits[0].includes("Hero"));

        const { rows: [row] } = await pool.query(
            `SELECT image_url FROM characters
             WHERE name = 'Hero' AND player_id = (
                 SELECT id FROM players WHERE discord_id = $1)`,
            [P1]
        );
        test("image persisted to owned character",
            row.image_url === CDN);

        // --- invalid attachments ---

        intr = mockInteraction(P1, {
            attachment: { ...png, contentType: "image/gif" }
        });
        await command.execute(intr);
        test("gif rejected via editReply",
            intr.calls.edits[0].includes("PNG"));

        intr = mockInteraction(P1, {
            attachment: { ...png, size: 6 * 1024 * 1024 }
        });
        await command.execute(intr);
        test("oversized rejected via editReply",
            intr.calls.edits[0].includes("MB"));

        // --- named character not owned ---

        intr = mockInteraction(P1, {
            attachment: png, characterName: "Theft"
        });
        await command.execute(intr);
        test("foreign character name rejected",
            intr.calls.edits[0].includes("no character"));

        // --- missing active character ---

        const { pool: db } = require("../../src/database/db");
        await db.query(
            `UPDATE players SET active_character_id = NULL
             WHERE discord_id = $1`, [P1]
        );

        intr = mockInteraction(P1, { attachment: png });
        await command.execute(intr);
        test("missing active character gives useful message",
            intr.calls.edits[0].includes("No active character"));

        await characterService.selectCharacter(P1, "Hero");

        // --- unregistered user ---

        intr = mockInteraction(`${TAG}_ghost`, { attachment: png });
        await command.execute(intr);
        test("unregistered user guided to register",
            intr.calls.edits[0].includes("register"));

        // --- database exception: logged, still acknowledged ---

        const original = pool.query;
        pool.query = async () => {
            throw new Error("simulated db outage");
        };

        intr = mockInteraction(P1, { attachment: png });
        await command.execute(intr);
        pool.query = original;

        test("db exception still acknowledges the interaction",
            intr.calls.defers === 1);
        test("db exception gives user-facing error",
            intr.calls.edits[0].includes("went wrong"));

        console.log("\ncharacter-image command tests passed.");
    } finally {
        await pool.query(
            `DELETE FROM players WHERE discord_id LIKE $1`, [`${TAG}%`]
        );
        await pool.end();
    }
})().catch(err => {
    console.error("FAIL:", err);
    process.exit(1);
});
