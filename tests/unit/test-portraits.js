const assert = require("node:assert/strict");
const { validateImageAttachment, IMAGE_RULES } =
    require("../../src/services/characterService");
const uploadSessions = require("../../src/bot/uploadSessions");
const messageCreate = require("../../src/bot/events/messageCreate");
const { pool } = require("../../src/database/db");

console.log("=== Portrait Validation & Upload Session Tests ===");

const CDN = "https://cdn.discordapp.com/attachments/1/2/img.png";

function attachment(overrides = {}) {
    return {
        name: "pic.png",
        contentType: "image/png",
        size: 1024,
        url: CDN,
        ...overrides
    };
}

function mockMessage(authorId, att = null) {
    const calls = { replies: [] };
    return {
        calls,
        author: { id: authorId, bot: false },
        attachments: { first: () => att },
        reply: async p => calls.replies.push(p)
    };
}

async function run() {
    // --- attachment validation ---

    const cases = [
        ["accepts png", attachment(), true],
        ["accepts jpeg", attachment({
            name: "a.jpg", contentType: "image/jpeg",
            url: "https://media.discordapp.net/x/y.jpg"
        }), true],
        ["accepts webp", attachment({
            name: "a.webp", contentType: "image/webp"
        }), true],
        ["rejects gif mime", attachment({ contentType: "image/gif" }), false],
        ["rejects wrong extension", attachment({ name: "pic.txt" }), false],
        ["rejects disguised exe", attachment({
            name: "pic.png.exe", contentType: "image/png"
        }), false],
        ["rejects oversized", attachment({
            size: IMAGE_RULES.maxBytes + 1
        }), false],
        ["rejects zero size", attachment({ size: 0 }), false],
        ["rejects http url", attachment({
            url: "http://cdn.discordapp.com/x/y.png"
        }), false],
        ["rejects non-cdn host", attachment({
            url: "https://evil.example.com/x.png"
        }), false],
        ["rejects missing attachment", null, false]
    ];

    for (const [title, att, expected] of cases) {
        const result = validateImageAttachment(att);
        assert.equal(result.ok, expected, title);
        console.log(`PASS: ${title}`);
    }

    // --- session lifecycle ---

    {
        uploadSessions.start("u1", 42);
        assert.equal(uploadSessions.get("u1").characterId, 42);
        console.log("PASS: session starts for user + character");

        // A second start replaces the first session.
        uploadSessions.start("u1", 43);
        assert.equal(uploadSessions.get("u1").characterId, 43);
        console.log("PASS: new upload replaces pending session");

        uploadSessions.cancel("u1");
        assert.equal(uploadSessions.get("u1"), null);
        console.log("PASS: cancel clears session");

        uploadSessions.start("u1", 42, null, -1);
        assert.equal(uploadSessions.get("u1"), null);
        console.log("PASS: expired session is rejected");

        assert.equal(uploadSessions.get("stranger"), null);
        console.log("PASS: no session for other users");
    }

    // --- messageCreate handler ---

    {
        // No session → message ignored silently.
        const msg = mockMessage("u_none", attachment());
        await messageCreate.execute(msg);
        assert.equal(msg.calls.replies.length, 0);
        console.log("PASS: messages without session are ignored");

        // Bot messages ignored even with forged session.
        uploadSessions.start("botmsg", 1);
        const botMsg = mockMessage("botmsg", attachment());
        botMsg.author.bot = true;
        await messageCreate.execute(botMsg);
        assert.equal(botMsg.calls.replies.length, 0);
        console.log("PASS: bot messages are ignored");
        uploadSessions.cancel("botmsg");

        // Invalid attachment → helpful error, session stays open.
        uploadSessions.start("u_bad", 42);
        const bad = mockMessage("u_bad", attachment({
            contentType: "image/gif"
        }));
        await messageCreate.execute(bad);
        assert(bad.calls.replies[0].includes("PNG"));
        assert(uploadSessions.get("u_bad"));
        console.log("PASS: invalid attachment errors but keeps session");

        // Another user's message is never consumed by u_bad's session.
        const other = mockMessage("u_other", attachment());
        await messageCreate.execute(other);
        assert.equal(other.calls.replies.length, 0);
        console.log("PASS: another user's message cannot fill session");

        // Valid attachment but unregistered user → session consumed,
        // friendly failure, nothing persisted.
        uploadSessions.start("u_ghost", 42);
        const ghost = mockMessage("u_ghost", attachment());
        await messageCreate.execute(ghost);
        assert(ghost.calls.replies[0].includes("isn't yours"));
        assert.equal(uploadSessions.get("u_ghost"), null);
        console.log("PASS: unregistered uploader fails closed");
    }

    console.log("\nPortrait unit tests passed.");
}

run()
    .then(() => pool.end())
    .catch(err => {
        console.error("FAIL:", err);
        pool.end().finally(() => process.exit(1));
    });
