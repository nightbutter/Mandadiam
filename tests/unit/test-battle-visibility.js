const assert = require("node:assert/strict");
const bs = require("../../src/game/services/battleService");
const {
    buildPrivateView,
    buildBattleRow
} = require("../../src/bot/battleFormat");
const {
    sendPrivatePanels,
    updatePrivatePanels
} = require("../../src/bot/battlePanel");
const { handleButton } = require("../../src/bot/buttons");
const driver = require("../helpers/rollDriver");

console.log("=== Battle Visibility Tests ===");

const ALL = ["power_strike", "piercing_strike", "desperation_burst"];
let channelSeq = 0;

function player(id, name, stats = {}) {
    return {
        discordId: id,
        character: {
            name,
            hp: stats.hp ?? 100,
            maxHp: stats.maxHp ?? 100,
            atk: stats.atk ?? 20,
            def: stats.def ?? 5,
            spe: stats.spe ?? 10,
            cost: stats.cost ?? 0,
            skills: stats.skills ?? [...ALL],
            ex: stats.ex ?? 0,
            exKey: stats.exKey
        }
    };
}

function customIds(view) {
    const ids = [];
    for (const row of view.components ?? []) {
        for (const c of row.components ?? []) {
            ids.push(c.data?.custom_id ?? c.customId);
        }
    }
    return ids;
}

// One fake DM user per player — records sends and message edits.
function mockDmUser(id, opts = {}) {
    const user = {
        id,
        sent: [],
        createDM: async () => {
            if (opts.failCreate) {
                throw new Error("Cannot send messages to this user");
            }
            return user.channel;
        }
    };
    user.channel = {
        send: async payload => {
            if (opts.failSend) {
                throw new Error("Cannot send messages to this user");
            }
            user.sent.push(payload);
            const message = {
                id: `dm_${id}_${user.sent.length}`,
                edits: [],
                edit: async p => {
                    if (opts.failEdit) {
                        throw new Error("Unknown Message");
                    }
                    message.edits.push(p);
                }
            };
            return message;
        }
    };
    return user;
}

function mockClient(users) {
    return {
        users: {
            fetch: async id => {
                const u = users.get(id);
                if (!u) throw new Error("Unknown User");
                return u;
            }
        },
        // Public channel unresolved in these tests — private-only.
        channels: {
            fetch: async () => {
                throw new Error("Unknown Channel");
            }
        }
    };
}

function mockDmButton({ customId, userId, channelId, client }) {
    const calls = { replies: [], updates: [] };
    return {
        calls,
        customId,
        channelId,
        client,
        user: { id: userId },
        channel: { send: async () => ({ id: "m" }) },
        reply: async p => calls.replies.push(p),
        update: async p => calls.updates.push(p)
    };
}

function startSession() {
    const chan = `vis_${++channelSeq}`;
    return driver.start(
        chan,
        player("u1", "Hero"),
        player("u2", "Foe"),
        { firstRolls: [18], secondRolls: [5] }
    ).session;
}

function cleanup(session) {
    if (session && bs.getSession(session.channelId)) {
        bs.forfeit(session, session.players[0].discordId);
    }
}

async function run() {
    // --- session carries private-panel state ----------------------------

    {
        const session = startSession();
        assert(session.privatePanels instanceof Map);
        assert(session.dmFailed instanceof Set);
        console.log("PASS: session initialises privatePanels + dmFailed");
        cleanup(session);
    }

    // --- private view: actor vs inactive ------------------------------

    {
        const session = startSession(); // u1 to act (initiative 18 > 5)
        const mine = customIds(buildPrivateView(session, "u1"));
        const theirs = customIds(buildPrivateView(session, "u2"));

        assert(mine.includes("battle:attack"));
        assert(mine.includes("battle:skills"));
        assert(mine.includes("battle:ultimate"));
        assert(!theirs.includes("battle:attack"));
        assert(!theirs.includes("battle:skills"));
        assert(!theirs.includes("battle:ultimate"));
        assert(theirs.includes("battle:forfeit"));
        console.log("PASS: actor-only controls hidden from inactive player");
        cleanup(session);
    }

    // --- private view: roll button to expected roller only ------------

    {
        const session = startSession();
        bs.attack(session, "u1"); // pending: u1 owes contest d20

        const roller = customIds(buildPrivateView(session, "u1"));
        const other = customIds(buildPrivateView(session, "u2"));
        const rollId = `battle:roll:${session.pending.id}`;

        assert(roller.includes(rollId));
        assert(!roller.includes("battle:attack"));
        assert(!other.includes(rollId));
        assert(other.includes("battle:forfeit"));
        console.log("PASS: roll button only on expected roller's panel");
        cleanup(session);
    }

    // --- public row: slim when DM works, full on DM failure ------------

    {
        const session = startSession();
        let ids = customIds({ components: [buildBattleRow(session)] });

        assert(!ids.includes("battle:attack"));
        assert(ids.includes("battle:refresh"));
        assert(ids.includes("battle:forfeit"));

        session.dmFailed.add("u2");
        ids = customIds({ components: [buildBattleRow(session)] });
        assert(ids.includes("battle:attack"));
        assert(ids.includes("battle:skills"));
        assert(ids.includes("battle:ultimate"));
        console.log("PASS: public fallback restores controls on DM failure");
        cleanup(session);
    }

    // --- sendPrivatePanels: success + per-player failure ---------------

    {
        const session = startSession();
        const users = new Map([
            ["u1", mockDmUser("u1")],
            ["u2", mockDmUser("u2")]
        ]);
        await sendPrivatePanels(mockClient(users), session);

        assert.equal(session.privatePanels.size, 2);
        assert.equal(session.dmFailed.size, 0);
        assert.equal(users.get("u1").sent.length, 1);
        assert.equal(users.get("u2").sent.length, 1);
        console.log("PASS: one private panel sent per participant");

        // DM failure → dmFailed + public fallback row.
        const s2 = startSession();
        const users2 = new Map([
            ["u1", mockDmUser("u1")],
            ["u2", mockDmUser("u2", { failSend: true })]
        ]);
        await sendPrivatePanels(mockClient(users2), s2);

        assert.equal(s2.privatePanels.size, 1);
        assert(s2.dmFailed.has("u2"));
        const ids = customIds({ components: [buildBattleRow(s2)] });
        assert(ids.includes("battle:attack"));
        console.log("PASS: DM failure flags dmFailed and keeps public controls");

        cleanup(session);
        cleanup(s2);
    }

    // --- updatePrivatePanels: edit existing, resend deleted, recover ---

    {
        const session = startSession();
        const users = new Map([
            ["u1", mockDmUser("u1")],
            ["u2", mockDmUser("u2")]
        ]);
        const client = mockClient(users);
        await sendPrivatePanels(client, session);

        await updatePrivatePanels(client, session);
        const u1Panel = session.privatePanels.get("u1");
        assert.equal(users.get("u1").sent.length, 1); // edited, not resent
        assert.equal(u1Panel.message.edits.length, 1);
        console.log("PASS: turn transition edits the existing DM panel");

        // Deleted DM message → resend, not a crash.
        session.privatePanels.delete("u2");
        await updatePrivatePanels(client, session);
        assert.equal(users.get("u2").sent.length, 2);
        console.log("PASS: missing DM message is resent once");

        // DM recovery clears dmFailed instead of duplicating panels.
        session.dmFailed.add("u1");
        session.privatePanels.delete("u1");
        await updatePrivatePanels(client, session);
        assert(!session.dmFailed.has("u1"));
        assert.equal(session.privatePanels.size, 2);
        console.log("PASS: DM recovery clears failure flag without duplicates");

        cleanup(session);
    }

    // --- DM-origin interaction: session by player, private ack ---------

    {
        const session = startSession();
        const users = new Map([
            ["u1", mockDmUser("u1")],
            ["u2", mockDmUser("u2")]
        ]);
        const client = mockClient(users);
        await sendPrivatePanels(client, session);

        const btn = mockDmButton({
            customId: "battle:attack",
            userId: "u1",
            channelId: "dm_u1", // NOT the battle channel
            client
        });
        await handleButton(btn);

        // Session found via player id; DM ack carries the roll control.
        assert.equal(btn.calls.updates.length, 1);
        const ids = customIds(btn.calls.updates[0]);
        assert(ids.some(id => id?.startsWith("battle:roll:")));
        // Partner's DM panel got the state push too.
        assert(session.privatePanels.get("u2").message.edits.length >= 1);
        console.log("PASS: DM attack click resolves session + updates panels");

        cleanup(session);
    }

    // --- stale/duplicate interactions stay rejected from any surface ---

    {
        const session = startSession();
        const client = mockClient(new Map([
            ["u1", mockDmUser("u1")],
            ["u2", mockDmUser("u2")]
        ]));

        bs.attack(session, "u1");
        const rollId = `battle:roll:${session.pending.id}`;

        // Wrong roller from DM → ephemeral rejection, state unchanged.
        const wrong = mockDmButton({
            customId: rollId, userId: "u2",
            channelId: "dm_u2", client
        });
        await handleButton(wrong);
        assert(wrong.calls.replies[0].ephemeral);
        assert(session.pending);
        assert.equal(session.pending.stage, "contest_attacker");

        // Stale action id → rejected.
        const stale = mockDmButton({
            customId: "battle:roll:act_old", userId: "u1",
            channelId: "dm_u1", client
        });
        await handleButton(stale);
        assert(
            stale.calls.replies[0].content.includes("no longer needed")
        );
        console.log("PASS: wrong-roller + stale id rejected from DM too");

        cleanup(session);
    }

    // --- battle end strips private controls ----------------------------

    {
        const session = startSession();
        bs.forfeit(session, "u1");

        const view = buildPrivateView(session, "u1");
        assert.equal(view.components.length, 0);
        assert(view.content.includes("finished"));
        console.log("PASS: finished battle yields control-free DM panel");

        cleanup(session);
    }

    console.log("\nAll battle visibility tests passed.");
}

run().catch(err => {
    console.error("FAIL:", err);
    process.exit(1);
});
