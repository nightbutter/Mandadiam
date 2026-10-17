const assert = require("node:assert/strict");
const { pool } = require("../../src/database/db");
const playerService = require("../../src/services/playerService");
const characterService = require("../../src/services/characterService");
const bs = require("../../src/game/services/battleService");
const { handleModalSubmit, handleSelectMenu, handleMenuButton } =
    require("../../src/bot/menu");
const uiSessions = require("../../src/bot/uiSessions");

// Dashboard flows against real Neon: character creation via modal,
// active-character selection, and challenge through the opponent picker.

const TAG = `__menu_test_${Date.now()}__`;
const P1 = `${TAG}_p1`;
const P2 = `${TAG}_p2`;
const CHANNEL = `${TAG}_channel`;

function test(title, result) {
    assert(result, title);
    console.log(`PASS: ${title}`);
}

let nextId = 0;

function mockComponent({ customId, userId, ownerId }) {
    const calls = {
        replies: [], updates: [], modals: [], sent: []
    };

    // Model the production shape: interactionMetadata (not the
    // deprecated interaction field) + a bound UI session.
    const messageId = `m${++nextId}`;
    uiSessions.bind(messageId, ownerId ?? userId);

    return {
        calls,
        customId,
        channelId: CHANNEL,
        user: { id: userId, username: `user_${userId}` },
        message: {
            id: messageId,
            interactionMetadata: { user: { id: ownerId ?? userId } },
            edit: async p => calls.edits?.push(p)
        },
        channel: {
            send: async p => {
                calls.sent.push(p);
                return { id: `msg_${calls.sent.length}` };
            }
        },
        reply: async p => calls.replies.push(p),
        update: async p => calls.updates.push(p),
        deferUpdate: async () => {
            calls.deferred = (calls.deferred ?? 0) + 1;
        },
        // editReply after deferUpdate targets the same message —
        // record it as an update so existing assertions hold.
        editReply: async p => calls.updates.push(p),
        showModal: async m => calls.modals.push(m),
        followUp: async p => calls.replies.push(p)
    };
}

function mockModal(userId, fields) {
    const base = mockComponent({
        customId: "modal:create", userId
    });
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

function mockSelect(userId, customId, extra = {}) {
    const base = mockComponent({ customId, userId });
    base.values = extra.values ?? [];
    base.users = { first: () => extra.users?.[0] };
    // Opponent StringSelect resolves discord ids through
    // client.users.fetch — the options list itself is DB-backed.
    base.client = {
        users: {
            fetch: async id =>
                extra.users?.find(u => u.id === id) ??
                { id, bot: false }
        }
    };
    return base;
}

(async () => {
    try {
        console.log("=== RPG Menu Integration Tests ===");

        await playerService.registerPlayer(P1, "menu_one");
        await playerService.registerPlayer(P2, "menu_two");

        // --- modal character creation ---

        let modal = mockModal(P1, {
            name: "MenuKnight", max_hp: "100", atk: "30",
            def: "15", spe: "5"
        });
        await handleModalSubmit(modal);
        test(
            "modal create succeeds within budget (150)",
            modal.calls.updates[0].embeds[0].data.description.includes("MenuKnight")
        );
        test(
            "success reply offers Select as Active",
            modal.calls.updates[0].components[0].components[0]
                .data.custom_id.startsWith("menu:setactive:")
        );

        modal = mockModal(P1, {
            name: "MenuKnight", max_hp: "100", atk: "30",
            def: "15", spe: "5"
        });
        await handleModalSubmit(modal);
        test(
            "duplicate name via modal rejected",
            modal.calls.updates[0].embeds[0].data.description.includes("same name") ||
            modal.calls.updates[0].embeds[0].data.description.includes("that name")
        );

        modal = mockModal(P1, {
            name: "OverBudget", max_hp: "150", atk: "30",
            def: "30", spe: "30"
        });
        await handleModalSubmit(modal);
        test(
            "budget 240 rejected with readable errors",
            modal.calls.updates[0].embeds[0].data.description.includes("Invalid stats")
        );
        test(
            "error reply offers form retry",
            modal.calls.updates[0].components[0].components[0]
                .data.custom_id === "menu:create"
        );

        modal = mockModal(P1, {
            name: "Edge150", max_hp: "90", atk: "30", def: "30", spe: "0"
        });
        await handleModalSubmit(modal);
        test(
            "exactly 150 points accepted",
            modal.calls.updates[0].embeds[0].data.description.includes("Edge150")
        );

        modal = mockModal(P1, {
            name: "Edge151", max_hp: "90", atk: "30", def: "30", spe: "1"
        });
        await handleModalSubmit(modal);
        test(
            "151 points rejected",
            modal.calls.updates[0].embeds[0].data.description.includes("Invalid stats")
        );

        modal = mockModal(P1, {
            name: "BadInt", max_hp: "abc", atk: "10", def: "10", spe: "10"
        });
        await handleModalSubmit(modal);
        test(
            "non-integer field rejected",
            modal.calls.updates[0].embeds[0].data.description.includes("Invalid stats")
        );

        // Double submission creates exactly one character.
        const dupFields = {
            name: "SingleInsert", max_hp: "60", atk: "30",
            def: "30", spe: "30"
        };
        await handleModalSubmit(mockModal(P2, dupFields));
        await handleModalSubmit(mockModal(P2, dupFields));
        const { rows: dupRows } = await pool.query(
            `SELECT COUNT(*)::int AS n FROM characters c
             JOIN players p ON p.id = c.player_id
             WHERE p.discord_id = $1 AND c.name = 'SingleInsert'`,
            [P2]
        );
        test(
            "double submission inserts exactly one character",
            dupRows[0].n === 1
        );

        // --- active character selection via pickchar ---

        await characterService.selectCharacter(P1, "MenuKnight");
        const { characters } = await characterService.listCharacters(P1);
        const edge = characters.find(c => c.name === "Edge150");

        const sel = mockSelect(P1, "menu:pickchar", {
            values: [String(edge.id)]
        });
        await handleSelectMenu(sel);
        test(
            "pickchar updates the dashboard",
            sel.calls.updates[0].embeds[0].data.title
                .includes("Active character")
        );

        const profile = await playerService.getProfile(P1);
        test(
            "pickchar set the active character",
            profile.activeCharacter.name === "Edge150"
        );

        // Ownership: P1 cannot pick P2's character id.
        const { characters: p2chars } =
            await characterService.listCharacters(P2);
        const steal = mockSelect(P1, "menu:pickchar", {
            values: [String(p2chars[0].id)]
        });
        await handleSelectMenu(steal);
        const after = await playerService.getProfile(P1);
        test(
            "cannot select another player's character",
            after.activeCharacter.name === "Edge150"
        );

        // --- setactive button id check ---

        const stealBtn = mockComponent({
            customId: `menu:setactive:${p2chars[0].id}`,
            userId: P1
        });
        await handleMenuButton(stealBtn);
        test(
            "setactive button rejects foreign character id",
            stealBtn.calls.replies[0].content.includes("Couldn't select")
        );

        const ownBtn = mockComponent({
            customId: `menu:setactive:${characters[0].id}`,
            userId: P1
        });
        await handleMenuButton(ownBtn);
        test(
            "setactive button selects own character",
            ownBtn.calls.updates[0].embeds[0].data.description
                .includes(characters[0].name)
        );

        // --- opponent picker -> real challenge message ---

        await characterService.selectCharacter(P2, "SingleInsert");
        const pick = mockSelect(P1, "menu:opponent", {
            values: [P2]
        });
        await handleSelectMenu(pick);
        test(
            "opponent picker sends public challenge message",
            pick.calls.sent.length === 1 &&
            pick.calls.sent[0].components.length === 1
        );
        test(
            "dashboard confirms the challenge",
            pick.calls.updates[0].embeds[0].data.title
                .includes("Challenge sent")
        );
        test(
            "challenge pending in service",
            bs.getPendingChallenge(CHANNEL)?.opponentId === P2
        );

        bs.cancelChallenge(CHANNEL, P1);

        // --- new-player registration via the dashboard button ---

        const P3 = `${TAG}_p3`;
        const regBtn = mockComponent({
            customId: "menu:register", userId: P3
        });
        await handleMenuButton(regBtn);
        test(
            "register button creates the player",
            regBtn.calls.updates.length === 1 &&
            regBtn.calls.updates[0].embeds[0].data.description
                .includes("Registered")
        );

        const p3Profile = await playerService.getProfile(P3);
        test(
            "player row persisted",
            p3Profile?.player.discord_id === P3
        );

        const regIds = regBtn.calls.updates[0].components
            .flatMap(r => r.components)
            .map(c => c.data.custom_id);
        test(
            "post-register view is the full menu",
            regIds.includes("menu:battle") &&
            !regIds.includes("menu:register")
        );

        const dup = mockComponent({
            customId: "menu:register", userId: P3
        });
        await handleMenuButton(dup);
        test(
            "re-registering is a safe no-op",
            dup.calls.updates.length === 1
        );

        const { rows: p3Count } = await pool.query(
            `SELECT COUNT(*)::int AS n FROM players
             WHERE discord_id = $1`,
            [P3]
        );
        test("exactly one player row", p3Count[0].n === 1);

        // --- challengeable-opponent list (registration bug) --------

        // A registered player with no character is NOT eligible.
        let eligible = await playerService.listChallengeable();
        test(
            "registered-but-characterless player not listed",
            !eligible.some(p => p.discord_id === P3)
        );

        // Eligible players appear immediately — no restart needed.
        test(
            "players with active characters are listed",
            eligible.some(p => p.discord_id === P1) &&
            eligible.some(p => p.discord_id === P2)
        );

        // The dashboard picker renders them (minus self).
        const battleBtn = mockComponent({
            customId: "menu:battle", userId: P1
        });
        await handleMenuButton(battleBtn);
        const picker = battleBtn.calls.updates.at(-1)
            .components[0].components[0];
        // toJSON() mirrors the payload Discord receives — option
        // builders keep the submitted id under data.value.
        const pickIds = picker.toJSON().options.map(o => o.value);
        test(
            "picker lists eligible opponents",
            pickIds.includes(P2)
        );
        test(
            "picker excludes the challenger themself",
            !pickIds.includes(P1)
        );
        test(
            "picker excludes characterless players",
            !pickIds.includes(P3)
        );

        // A player with a pending challenge drops out of the list.
        const issue = bs.issueChallenge({
            channelId: `${CHANNEL}_2`,
            challengerId: P1, opponentId: P2
        });
        test("fixture challenge issued", issue.ok);
        const busyBtn = mockComponent({
            customId: "menu:battle", userId: P3
        });
        await handleMenuButton(busyBtn);
        const busyIds = busyBtn.calls.updates.at(-1)
            .components[0].components[0].toJSON().options
            .map(o => o.value);
        // Both parties of a pending challenge are busy — neither
        // appears in a third player's picker.
        test(
            "busy challenger + opponent filtered from picker",
            !busyIds.includes(P2) && !busyIds.includes(P1)
        );
        bs.cancelChallenge(`${CHANNEL}_2`, P1);

        // Newly eligible (register + character + set active) shows up
        // on the very next render.
        const P4 = `${TAG}_p4`;
        await playerService.registerPlayer(P4, "menu_four");
        await characterService.createCharacter(P4, {
            name: "Newbie", maxHp: 60, atk: 30, def: 30, spe: 30
        });
        test(
            "character created but not active stays unlisted",
            !(await playerService.listChallengeable())
                .some(p => p.discord_id === P4)
        );
        await characterService.selectCharacter(P4, "Newbie");
        test(
            "newly eligible player appears without restart",
            (await playerService.listChallengeable())
                .some(p => p.discord_id === P4)
        );

        console.log("\nRPG menu integration tests passed.");
    } finally {
        const session = bs.getSession(CHANNEL);
        if (session) {
            bs.forfeit(session, session.players[0].discordId);
        }
        bs.cancelChallenge(CHANNEL, P1);
        await pool.query(
            `DELETE FROM players WHERE discord_id LIKE $1`, [`${TAG}%`]
        );
        await pool.end();
    }
})().catch(err => {
    console.error("FAIL:", err);
    process.exit(1);
});
