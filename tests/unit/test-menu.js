const assert = require("node:assert/strict");
const {
    ownsDashboard,
    mainMenuView,
    handleMenuButton,
    handleSelectMenu,
    handleModalSubmit
} = require("../../src/bot/menu");
const menuViews = require("../../src/bot/menuViews");
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
        deferUpdate: async () => {},
        // editReply after deferUpdate targets the same message —
        // record it as an update so existing assertions hold.
        editReply: async p => calls.updates.push(p),
        showModal: async m => calls.modals.push(m),
        followUp: async p => calls.replies.push(p)
    };
}

function mockSelect({ customId, userId = "u1", ownerId,
    values = [], users = [], ...rest }) {
    const base = mockComponent({ customId, userId, ownerId, ...rest });
    base.values = values;
    base.users = { first: () => users[0] };
    // StringSelect opponent picks resolve via client.users.fetch;
    // `users` fixtures stand in for Discord's resolved users.
    base.client = {
        users: {
            fetch: async id =>
                users.find(u => u.id === id) ?? { id, bot: false }
        }
    };
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
            values: ["u2"],
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
            values: ["bot1"],
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

    // --- register button on the main menu (reported bug) ----------

    const customIdsOf = view =>
        view.components.flatMap(row =>
            row.components.map(c => c.data.custom_id));

    {
        const view = mainMenuView(null);
        const ids = customIdsOf(view);
        assert(
            ids.includes("menu:register"),
            `unregistered menu lacks Register button: ${ids}`
        );
        assert(
            !ids.includes("menu:battle"),
            "unregistered menu should not show Battle"
        );
        console.log(
            "PASS: new player sees Register on the main menu"
        );
    }

    {
        const view = mainMenuView({
            player: { username: "reg_u" },
            activeCharacter: null
        });
        const ids = customIdsOf(view);
        assert(!ids.includes("menu:register"));
        assert(ids.includes("menu:battle"));
        console.log(
            "PASS: registered player gets the full menu, no Register"
        );
    }

    {
        const ids = customIdsOf(menuViews.notRegisteredView());
        assert(ids.includes("menu:register"));
        console.log("PASS: notRegisteredView still offers Register");
    }

    {
        // Full click path: register a ghost user, verify the view
        // update shows the registered menu, then clean up.
        const intr = mockComponent({
            customId: "menu:register", userId: "ghost_reg"
        });
        await handleMenuButton(intr);
        assert.equal(intr.calls.updates.length, 1);
        const ids = customIdsOf(intr.calls.updates[0]);
        assert(
            intr.calls.updates[0].embeds[0].data.description
                .includes("Registered")
        );
        assert(ids.includes("menu:battle"));
        assert(!ids.includes("menu:register"));
        console.log(
            "PASS: register click creates player + shows full menu"
        );

        // Double-click must not error — registration is idempotent.
        const again = mockComponent({
            customId: "menu:register", userId: "ghost_reg"
        });
        await handleMenuButton(again);
        assert.equal(again.calls.updates.length, 1);
        console.log("PASS: duplicate register click is idempotent");

        await pool.query(
            `DELETE FROM players WHERE discord_id = 'ghost_reg'`
        );

        // Register belongs to the dashboard owner only.
        const stranger = mockComponent({
            customId: "menu:register", userId: "u9", ownerId: "u1"
        });
        await handleMenuButton(stranger);
        assert(
            stranger.calls.replies[0].content.includes("someone else")
        );
        console.log("PASS: register click enforces ownership");
    }

    // --- customId coverage sweep -----------------------------------
    // Every interactive component emitted by the views must route to
    // a real handler — no "Unknown menu action" dead ends.

    {
        const views = [
            mainMenuView(null),
            mainMenuView({
                player: { username: "x" }, activeCharacter: null
            }),
            menuViews.notRegisteredView(),
            menuViews.profileView(
                { player: { username: "x", created_at: new Date() },
                  activeCharacter: null },
                0
            ),
            menuViews.charactersView(
                { active_character_id: 1 },
                [{ id: 1, name: "A", max_hp: 10, atk: 1, def: 1,
                   spe: 1 }]
            ),
            menuViews.characterDetailView(
                { id: 1, name: "A", max_hp: 10, atk: 1, def: 1,
                  spe: 1, image_url: null },
                2
            ),
            menuViews.selectCharacterView(
                [{ id: 1, name: "A", max_hp: 10, atk: 1, def: 1,
                   spe: 1 }]
            ),
            menuViews.battleView(),
            menuViews.helpView()
        ];

        const allComponents = views.flatMap(view =>
            view.components.flatMap(row => row.components));

        // discord.js ComponentType: Button=2, StringSelect=3,
        // UserSelect=5, RoleSelect=6, MentionableSelect=7,
        // ChannelSelect=8.
        const buttonIds = new Set(
            allComponents
                .filter(c => c.data.type === 2)
                .map(c => c.data.custom_id)
                .filter(id => id.startsWith("menu:"))
        );
        const selectIds = new Set(
            allComponents
                .filter(c => c.data.type === 3 || c.data.type === 5)
                .map(c => c.data.custom_id)
        );

        for (const id of buttonIds) {
            const intr = mockComponent({
                customId: id.startsWith("menu:setactive")
                    ? "menu:setactive:999999"
                    : id.startsWith("menu:imgdel")
                        ? "menu:imgdel:999999"
                        : id.startsWith("menu:img:")
                            ? "menu:img:999999"
                            : id,
                userId: "ghost_sweep"
            });
            await handleMenuButton(intr);
            const bad = intr.calls.replies.find(
                r => r.content?.includes("Unknown menu action")
            );
            assert(!bad, `button ${id} routed to nothing`);
        }
        console.log(
            `PASS: all ${buttonIds.size} menu buttons route to handlers`
        );

        for (const id of selectIds) {
            const sel = mockSelect({
                customId: id, userId: "ghost_sweep",
                values: ["999999"],
                users: [{ id: "u2", bot: false }]
            });
            await handleSelectMenu(sel);
            const bad = sel.calls.replies.find(
                r => r.content?.includes("Unknown menu action")
            );
            assert(!bad, `select ${id} routed to nothing`);
        }
        console.log(
            `PASS: all ${selectIds.size} select menus route to handlers`
        );
    }

    console.log("\nMenu tests passed.");
}

run()
    .then(() => pool.end())
    .catch(err => {
        console.error("FAIL:", err);
        pool.end().finally(() => process.exit(1));
    });
