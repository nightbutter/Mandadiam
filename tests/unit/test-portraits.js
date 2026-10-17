const assert = require("node:assert/strict");
const { validateImageAttachment, IMAGE_RULES } =
    require("../../src/services/characterService");
const { handleModalSubmit, handleMenuButton } =
    require("../../src/bot/menu");
const { uploadImageModal } = require("../../src/bot/menuViews");
const { pool } = require("../../src/database/db");

console.log("=== Portrait Validation & Upload Modal Tests ===");

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

let nextId = 0;

function mockComponent({ customId, userId = "u1", ownerId }) {
    const messageId = `m${++nextId}`;
    const message = {
        id: messageId,
        interactionMetadata: { user: { id: ownerId ?? userId } },
        edit: async () => {}
    };

    const calls = { replies: [], updates: [], modals: [] };

    return {
        calls,
        customId,
        message,
        user: { id: userId, username: `user_${userId}` },
        reply: async p => {
            calls.replies.push(p);
            return { id: `m${++nextId}` };
        },
        update: async p => calls.updates.push(p),
        showModal: async m => calls.modals.push(m),
        followUp: async p => calls.replies.push(p)
    };
}

function mockImageModal({ userId = "u1", characterId = "42", file }) {
    const base = mockComponent({
        customId: `modal:image:${characterId}`, userId
    });
    base.fields = {
        getUploadedFiles: () =>
            file ? { first: () => file, size: 1 } : null
    };
    return base;
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

    // --- upload modal builder ---

    {
        const modal = uploadImageModal({ id: 42, name: "Knight" });
        const json = modal.toJSON();
        assert.equal(json.custom_id, "modal:image:42");
        assert.equal(json.components[0].component.type, 19);
        console.log("PASS: upload modal carries FileUpload component");
    }

    // --- Set Image button opens the modal ---

    {
        // Unregistered owner of dashboard → ownership check fails.
        const btn = mockComponent({
            customId: "menu:img:42", userId: "ghost_u"
        });
        await handleMenuButton(btn);
        assert.equal(btn.calls.modals.length, 0);
        assert(
            btn.calls.replies[0].content.includes("Couldn't load")
        );
        console.log("PASS: Set Image for unregistered user rejected");
    }

    // --- modal submit paths ---

    {
        // Missing file → validation failure view, no writes.
        const modal = mockImageModal({ file: null });
        await handleModalSubmit(modal);
        assert.equal(
            modal.calls.updates[0].embeds[0].data.title,
            "🖼️ Portrait not saved"
        );
        console.log("PASS: missing file rejected with retry view");

        // Invalid file type.
        const badType = mockImageModal({
            file: attachment({ contentType: "image/gif" })
        });
        await handleModalSubmit(badType);
        assert(
            badType.calls.updates[0].embeds[0].data.description
                .includes("PNG")
        );
        console.log("PASS: invalid type rejected via dashboard");

        // Oversized file.
        const big = mockImageModal({
            file: attachment({ size: IMAGE_RULES.maxBytes + 1 })
        });
        await handleModalSubmit(big);
        assert(
            big.calls.updates[0].embeds[0].data.description
                .includes("MB")
        );
        console.log("PASS: oversized file rejected via dashboard");

        // Valid file but unregistered/foreign character → fail closed.
        const ghost = mockImageModal({
            userId: "ghost_u", characterId: "1", file: attachment()
        });
        await handleModalSubmit(ghost);
        assert(
            ghost.calls.updates[0].embeds[0].data.description
                .includes("isn't yours")
        );
        console.log("PASS: submit for non-owned character rejected");
    }

    console.log("\nPortrait unit tests passed.");
}

run()
    .then(() => pool.end())
    .catch(err => {
        console.error("FAIL:", err);
        pool.end().finally(() => process.exit(1));
    });
