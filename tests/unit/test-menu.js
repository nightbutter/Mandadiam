const assert = require("node:assert/strict");
const {
    ownsDashboard,
    handleMenuButton,
    handleSelectMenu,
    handleModalSubmit
} = require("../../src/bot/menu");
const { pool } = require("../../src/database/db");

console.log("=== Menu / Dashboard Tests ===");

// Discord interaction double for dashboard components. `owner` is the
// original /rpg invoker recorded on the message; `user` is the clicker.
function mockComponent({ customId, userId = "u1", ownerId }) {
    const calls = {
        replies: [], updates: [], modals: [], sent: [], edits: []
    };

    return {
        calls,
        customId,
        user: { id: userId, username: `user_${userId}` },
        message: {
            interaction: { user: { id: ownerId ?? userId } },
            edit: async p => calls.edits.push(p)
        },
        reply: async p => calls.replies.push(p),
        update: async p => calls.updates.push(p),
        showModal: async m => calls.modals.push(m),
        followUp: async p => calls.replies.push(p)
    };
}

function mockSelect({ customId, userId = "u1", ownerId,
    values = [], users = [] }) {
    const base = mockComponent({ customId, userId, ownerId });
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

        const other = mockComponent({ userId: "u9", ownerId: "u1" });
        assert(!ownsDashboard(other));
        await handleMenuButton(other);
        assert(other.calls.replies[0].content.includes("someone else"));
        console.log("PASS: non-owner menu click rejected");

        const noMsg = mockComponent({ userId: "u9" });
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
        const modal = intr.calls.modals[0];
        assert.equal(modal.components.length, 5);
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
        assert(
            modal.calls.replies[0].content.includes("not registered")
        );
        console.log("PASS: modal submit for unregistered user rejected");
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
