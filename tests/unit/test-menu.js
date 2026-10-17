const assert = require("node:assert/strict");
const {
    ownsDashboard,
    handleMenuButton,
    handleSelectMenu,
    handleModalSubmit
} = require("../../src/bot/menu");
const uiSessions = require("../../src/bot/uiSessions");
const { pool } = require("../../src/database/db");

console.log("=== Menu / Dashboard Tests ===");

let nextId = 0;

// Discord interaction double modeling the real message shapes:
// - a /rpg dashboard: message bound in uiSessions + interactionMetadata
//   naming the invoker.
// - production also hits messages where Discord sends NO interaction
//   metadata (ephemeral replies, modal submits) — simulate via
//   metadata: "none".
function mockComponent({
    customId,
    userId = "u1",
    ownerId = userId,
    metadata = "interactionMetadata", // "interaction" | "none" | null
    bindSession = true
}) {
    const messageId = `m${++nextId}`;

    const message = { id: messageId, edit: async () => {} };

    if (metadata && ownerId) {
        message[metadata] = { user: { id: ownerId } };
    }

    if (bindSession && ownerId) {
        uiSessions.bind(messageId, ownerId);
    }

    const calls = {
        replies: [], updates: [], modals: [], sent: []
    };

    return {
        calls,
        customId,
        message,
        user: { id: userId, username: `user_${userId}` },
        reply: async p => {
            calls.replies.push(p);
            const msg = { id: `m${++nextId}` };
            if (p?.fetchReply) {
                // Production binds inside replyOwned; emulate that the
                // returned message exists so binds can target it.
            }
            return msg;
        },
        update: async p => calls.updates.push(p),
        showModal: async m => calls.modals.push(m),
        followUp: async p => calls.replies.push(p)
    };
}

function mockSelect({ customId, userId = "u1", ownerId,
    values = [], users = [], ...rest }) {
    const base = mockComponent({ customId, userId, ownerId, ...rest });
    base.values = values;
    base.users = { first: () => users[0] };
    base.channel = {
        send: async p => {
            base.calls.sent.push(p);
            return { id: `msg_${base.calls.sent.length}` };
        }
    };
    return base;
}

function mockModal({ customId = "modal:create", userId = "u1",
    fields = {} }) {
    // A modal submit edits the message that opened it — model the
    // dashboard message it targets.
    const base = mockComponent({ customId, userId });
    base.fields = {
        getTextInputValue: id => {
            if (!(id in fields)) {
                throw new Error(`missing field ${id}`);
            }
            return String(fields[id]);
        }
    };
    return base;
}

async function run() {
    // --- ownership ---

    {
        const intr = mockComponent({ userId: "u1", ownerId: "u1" });
        assert(ownsDashboard(intr));
        console.log("PASS: dashboard owner recognized");
    }

    {
        // Regression for the reported bug: a component on a message
        // whose interaction metadata is absent (real shape for
        // ephemeral/modal-origin messages) must still work when the
        // server-side session binds it to the owner.
        const intr = mockComponent({
            customId: "menu:help",
            userId: "u1",
            metadata: "none"
        });
        assert(ownsDashboard(intr));
        await handleMenuButton(intr);
        assert.equal(intr.calls.updates.length, 1);
        console.log(
            "PASS: session-bound message without metadata works"
        );
    }

    {
        // interactionMetadata only (new API field), no deprecated
        // interaction field, no session — still identifies the owner.
        const intr = mockComponent({
            customId: "menu:help",
            userId: "u1",
            metadata: "interactionMetadata",
            bindSession: false
        });
        assert(ownsDashboard(intr));
        console.log("PASS: interactionMetadata fallback works");
    }

    {
        // Deprecated field only (older API payloads).
        const intr = mockComponent({
            customId: "menu:help",
            userId: "u1",
            metadata: "interaction",
            bindSession: false
        });
        assert(ownsDashboard(intr));
        console.log("PASS: deprecated interaction field still honored");
    }

    {
        // Unknown/stale message: no session, no metadata → reject.
        const intr = mockComponent({
            customId: "menu:help",
            userId: "u1",
            ownerId: "u1",
            metadata: "none",
            bindSession: false
        });
        assert(!ownsDashboard(intr));
        await handleMenuButton(intr);
        assert(intr.calls.replies[0].content.includes("someone else"));
        console.log("PASS: unknown/stale UI session rejected safely");

        const expired = `m${++nextId}`;
        uiSessions.bind(expired, "u1");
        uiSessions.release(expired);
        const stale = mockComponent({
            customId: "menu:help", userId: "u1",
            metadata: "none", bindSession: false
        });
        stale.message.id = expired;
        await handleMenuButton(stale);
        assert(stale.calls.replies[0].content.includes("someone else"));
        console.log("PASS: released session rejected");
    }

    {
        // User B clicks a component on A's dashboard.
        const other = mockComponent({
            customId: "menu:help", userId: "u9", ownerId: "u1"
        });
        await handleMenuButton(other);
        assert(other.calls.replies[0].content.includes("someone else"));
        console.log("PASS: non-owner menu click rejected");

        const noMsg = mockComponent({ customId: "menu:help" });
        noMsg.message = null;
        await handleMenuButton(noMsg);
        assert(noMsg.calls.replies[0].content.includes("someone else"));
        console.log("PASS: missing owner info rejected");
    }

    // --- menu routing ---

    {
        const intr = mockComponent({ customId: "menu:main" });
        await handleMenuButton(intr);
        assert.equal(intr.calls.updates.length, 1);
        assert(intr.calls.updates[0].embeds[0]);
        console.log("PASS: menu:main updates the dashboard");

        const help = mockComponent({ customId: "menu:help" });
        await handleMenuButton(help);
        assert(help.calls.updates[0].embeds[0].data.title
            .includes("Help"));
        console.log("PASS: menu:help renders rules view");

        const unknown = mockComponent({ customId: "menu:bogus" });
        await handleMenuButton(unknown);
        assert(
            unknown.calls.replies[0].content.includes("Unknown")
        );
        console.log("PASS: unknown menu action rejected");
    }

    // --- unregistered flows (fake users hit real DB, no rows) ---

    {
        const intr = mockComponent({
            customId: "menu:profile", userId: "ghost_u"
        });
        await handleMenuButton(intr);
        assert.equal(
            intr.calls.updates[0].embeds[0].data.title,
            "Not registered"
        );
        console.log("PASS: profile view guides unregistered user");

        const chars = mockComponent({
            customId: "menu:chars", userId: "ghost_u"
        });
        await handleMenuButton(chars);
        assert.equal(
            chars.calls.updates[0].embeds[0].data.title,
            "Not registered"
        );
        console.log("PASS: characters view guides unregistered user");
    }

    // --- create modal ---

    {
        const intr = mockComponent({ customId: "menu:create" });
        await handleMenuButton(intr);
        assert.equal(intr.calls.modals.length, 1);
        assert.equal(intr.calls.modals[0].components.length, 5);
        console.log("PASS: create button opens 5-field modal");
    }

    {
        const modal = mockModal({
            userId: "ghost_u",
            fields: {
                name: "X", max_hp: "100", atk: "20", def: "5", spe: "4"
            }
        });
        await handleModalSubmit(modal);
        // Modal submit now edits the dashboard — not a new reply.
        assert(
            modal.calls.updates[0].embeds[0].data.description
                .includes("not registered")
        );
        console.log(
            "PASS: modal submit edits dashboard + rejects unregistered"
        );

        // The Open-form-again button sits on that same dashboard
        // message — a second modal submit path must work for the owner.
        const again = mockComponent({
            customId: "menu:create",
            userId: "ghost_u",
            metadata: "none" // message still recognized via session
        });
        await handleMenuButton(again);
        assert.equal(again.calls.modals.length, 1);
        console.log(
            "PASS: Open form again works for the rightful owner"
        );
    }

    // --- select menus ---

    {
        const sel = mockSelect({
            customId: "menu:pickchar",
            userId: "ghost_u",
            values: ["123"]
        });
        await handleSelectMenu(sel);
        assert.equal(
            sel.calls.updates[0].embeds[0].data.title,
            "Not registered"
        );
        console.log("PASS: pickchar for unregistered user rejected");
    }

    {
        const sel = mockSelect({
            customId: "menu:opponent",
            userId: "ghost_u",
            users: [{ id: "u2", bot: false }]
        });
        await handleSelectMenu(sel);
        assert(
            sel.calls.updates[0].embeds[0].data.title
                .includes("Challenge failed")
        );
        console.log("PASS: unregistered challenger cannot pick opponent");
    }

    {
        const sel = mockSelect({
            customId: "menu:opponent",
            userId: "ghost_u",
            users: [{ id: "bot1", bot: true }]
        });
        await handleSelectMenu(sel);
        assert(
            sel.calls.updates[0].embeds[0].data.description
                .includes("bot")
        );
        console.log("PASS: cannot pick a bot opponent");
    }

    {
        const wrong = mockSelect({
            customId: "menu:pickchar",
            userId: "u9", ownerId: "u1",
            values: ["1"]
        });
        await handleSelectMenu(wrong);
        assert(wrong.calls.replies[0].content.includes("someone else"));
        console.log("PASS: select menu enforces dashboard ownership");
    }

    console.log("\nMenu tests passed.");
}

run()
    .then(() => pool.end())
    .catch(err => {
        console.error("FAIL:", err);
        pool.end().finally(() => process.exit(1));
    });
