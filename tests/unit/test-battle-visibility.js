const assert = require("node:assert/strict");
const bs = require("../../src/game/services/battleService");
const {
    buildPrivateView,
    buildBattleRow,
    buildBattleEmbed
} = require("../../src/bot/battleFormat");
const {
    sendPrivatePanels,
    updatePrivatePanels,
    updateBattlePanel,
    refreshBattleViews
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
    // --- root-cause regression: DM interactions require Partials.Channel
    // Without it discord.js drops DM button clicks before routing —
    // panels send fine (REST) but every click dies → stranded battle.

    {
        const { createClient } = require("../../src/bot/client");
        const { Partials, GatewayIntentBits } = require("discord.js");
        const client = createClient();
        assert(client.options.partials?.includes(Partials.Channel));
        assert(client.options.intents.has(GatewayIntentBits.Guilds));
        client.destroy();
        console.log("PASS: client enables Partials.Channel for DM clicks");
    }

    // --- initiative pending: the reported deadlock state ----------------
    // Public row is slim (correct — DMs delivered), roll button lives
    // only in the expected roller's private view, embed hints at DMs.

    {
        const started = bs.startBattle(
            `vis_${++channelSeq}`,
            player("u1", "Hero"),
            player("u2", "Foe")
        );
        const session = started.session;
        assert.equal(session.pending?.type, "initiative");

        const pub = customIds({ components: [buildBattleRow(session)] });
        assert(!pub.some(id => id?.startsWith("battle:roll:")));
        assert(pub.includes("battle:refresh"));

        const rollId = `battle:roll:${session.pending.id}`;
        const u1ids = customIds(buildPrivateView(session, "u1"));
        const u2ids = customIds(buildPrivateView(session, "u2"));
        assert(u1ids.includes(rollId));
        assert(!u2ids.some(id => id?.startsWith("battle:roll:")));

        const embed = buildBattleEmbed(session).data;
        const current = embed.fields.find(f => f.name.includes("Current"));
        assert(current.value.includes("d20 contest"));
        assert(embed.footer.text.includes("My Controls"));
        console.log("PASS: initiative pending — roll in roller's DM only");

        // Both roll → initiative resolves → winner sees action controls.
        bs.recordRoll(session, "u1", 18);
        bs.recordRoll(session, "u2", 5);
        assert(!session.pending);
        assert(session.battle.currentTurn?.character);
        const actor = session.players.find(
            p => p.character === session.battle.currentTurn.character
        );
        const actorIds = customIds(
            buildPrivateView(session, actor.discordId)
        );
        assert(actorIds.includes("battle:attack"));
        console.log("PASS: initiative resolves into first-turn controls");
        cleanup(session);
    }

    // --- public Refresh resends a lost DM panel -------------------------

    {
        const session = startSession();
        const users = new Map([
            ["u1", mockDmUser("u1")],
            ["u2", mockDmUser("u2")]
        ]);
        const client = mockClient(users);
        await sendPrivatePanels(client, session);
        assert.equal(users.get("u1").sent.length, 1);

        // u1 lost their DM → public Refresh resends it, row stays slim.
        const btn = mockDmButton({
            customId: "battle:refresh",
            userId: "u1",
            channelId: session.channelId,
            client
        });
        await handleButton(btn);
        assert.equal(users.get("u1").sent.length, 2);
        assert.equal(users.get("u2").sent.length, 1); // edited, not resent
        assert.equal(session.dmFailed.size, 0);
        assert(
            customIds(btn.calls.updates[0]).includes("battle:refresh")
        );
        console.log("PASS: Refresh resends a lost DM panel");

        // Resend fails → dmFailed → clicker's row gains real controls.
        const u1 = users.get("u1");
        const okSend = u1.channel.send;
        u1.channel.send = async () => {
            throw new Error("Cannot send messages to this user");
        };
        const btn2 = mockDmButton({
            customId: "battle:refresh",
            userId: "u1",
            channelId: session.channelId,
            client
        });
        await handleButton(btn2);
        assert(session.dmFailed.has("u1"));
        assert(
            customIds(btn2.calls.updates[0]).includes("battle:attack")
        );
        u1.channel.send = okSend;
        console.log("PASS: failed resend flags dmFailed → fallback row");
        cleanup(session);
    }

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
        assert(ids.includes("battle:mypanel"));
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

        // Wrong roller from DM → private view healed in place, the
        // action is NOT consumed, no extra ephemeral is spawned.
        const wrong = mockDmButton({
            customId: rollId, userId: "u2",
            channelId: "dm_u2", client
        });
        await handleButton(wrong);
        assert.equal(wrong.calls.replies.length, 0);
        assert.equal(wrong.calls.updates.length, 1);
        assert(
            !customIds(wrong.calls.updates[0]).some(
                id => id?.startsWith("battle:roll:")
            ) // u2 is not the roller — no roll button in their view
        );
        assert(session.pending);
        assert.equal(session.pending.stage, "contest_attacker");

        // Stale action id → rejected, message healed to current view.
        const stale = mockDmButton({
            customId: "battle:roll:act_old", userId: "u1",
            channelId: "dm_u1", client
        });
        await handleButton(stale);
        assert.equal(stale.calls.replies.length, 0);
        assert.equal(stale.calls.updates.length, 1);
        assert(
            customIds(stale.calls.updates[0]).includes(rollId)
        );
        console.log("PASS: wrong-roller + stale id rejected from DM too");

        cleanup(session);
    }

    // --- "My Controls": ephemeral private view, no DM needed -----------

    {
        const session = startSession(); // u1 to act
        session.panelMessageId = "panel_1";
        const client = mockClient(new Map([
            ["u1", mockDmUser("u1")],
            ["u2", mockDmUser("u2")]
        ]));

        // Participant gets their private view ephemerally.
        const mine = mockDmButton({
            customId: "battle:mypanel", userId: "u1",
            channelId: session.channelId, client
        });
        mine.message = { id: "panel_1" };
        await handleButton(mine);
        assert(mine.calls.replies[0].ephemeral);
        assert(
            customIds(mine.calls.replies[0]).includes("battle:attack")
        );

        // Spectator gets rejected.
        const spec = mockDmButton({
            customId: "battle:mypanel", userId: "u9",
            channelId: session.channelId, client
        });
        spec.message = { id: "panel_1" };
        await handleButton(spec);
        assert(spec.calls.replies[0].content.includes("not in this"));
        console.log("PASS: My Controls — ephemeral view, participant only");

        // Clicking Attack inside the ephemeral: private-view ack AND
        // the real public panel is edited (message.id ≠ panelMessageId).
        const panelMsg = { edits: [], edit: async p => panelMsg.edits.push(p) };
        const eph = mockDmButton({
            customId: "battle:attack", userId: "u1",
            channelId: session.channelId, client
        });
        eph.message = { id: "eph_1" };
        eph.channel = {
            send: async () => ({ id: "m" }),
            messages: { fetch: async () => panelMsg }
        };
        await handleButton(eph);

        const ackIds = customIds(eph.calls.updates[0]);
        assert(ackIds.some(id => id?.startsWith("battle:roll:")));
        assert.equal(panelMsg.edits.length, 1); // public panel refreshed
        console.log("PASS: ephemeral action click updates all surfaces");

        cleanup(session);
    }

    // --- canonical public panel: deleted → one deliberate resend -------

    {
        const session = startSession();
        session.panelMessageId = "panel_dead";

        const sends = [];
        const pubChannel = {
            send: async p => {
                sends.push(p);
                return { id: `pub_${sends.length}` };
            },
            messages: {
                // 10008 = Unknown Message — the panel was deleted.
                fetch: async () => {
                    throw Object.assign(
                        new Error("Unknown Message"), { code: 10008 }
                    );
                }
            }
        };
        const client = {
            users: { fetch: async () => { throw new Error("x"); } },
            channels: { fetch: async () => pubChannel }
        };
        const btn = mockDmButton({
            customId: "battle:attack", userId: "u1",
            channelId: "dm_u1", client
        });
        // DM-origin refresh → public panel is fetched, found deleted
        // (10008) → exactly one deliberate replacement is sent.
        await refreshBattleViews(btn, session);

        assert.equal(sends.length, 1); // exactly one replacement panel
        assert.equal(session.panelMessageId, "pub_1");
        console.log("PASS: deleted canonical panel recovered once");
        cleanup(session);
    }

    // --- transient fetch error keeps the canonical reference ----------

    {
        const session = startSession();
        session.panelMessageId = "panel_ok";

        const sends = [];
        const channel = {
            send: async () => { sends.push(1); return { id: "x" }; },
            messages: {
                // Transient gateway error — message still exists.
                fetch: async () => {
                    throw Object.assign(
                        new Error("Service Unavailable"), { code: 0 }
                    );
                }
            }
        };

        const r = await updateBattlePanel(channel, session);
        assert.equal(r, null);
        assert.equal(session.panelMessageId, "panel_ok"); // kept!
        assert.equal(sends.length, 0); // no duplicate send
        console.log("PASS: transient panel error keeps reference");
        cleanup(session);
    }

    // --- transient DM edit failure: no duplicate send, dmFailed set ---

    {
        const session = startSession();
        const users = new Map([
            ["u1", mockDmUser("u1")],
            ["u2", mockDmUser("u2")]
        ]);
        const client = mockClient(users);
        await sendPrivatePanels(client, session);

        const panel = session.privatePanels.get("u1");
        const realEdit = panel.message.edit;
        panel.message.edit = async () => {
            throw Object.assign(new Error("timeout"), { code: 0 });
        };

        await updatePrivatePanels(client, session);
        assert.equal(users.get("u1").sent.length, 1); // no resend
        assert(session.dmFailed.has("u1"));

        panel.message.edit = realEdit;
        await updatePrivatePanels(client, session);
        assert(!session.dmFailed.has("u1")); // healed on next edit
        assert.equal(users.get("u1").sent.length, 1);
        console.log("PASS: transient DM edit failure — no duplicate");
        cleanup(session);
    }

    // --- stale private click heals the message instead of piling on ---

    {
        const session = startSession();
        const client = mockClient(new Map([
            ["u1", mockDmUser("u1")],
            ["u2", mockDmUser("u2")]
        ]));
        await sendPrivatePanels(client, session);

        bs.attack(session, "u1"); // pending exists
        const stale = mockDmButton({
            customId: "battle:roll:act_obsolete", userId: "u1",
            channelId: "dm_u1", client
        });
        stale.message = { id: "dm_panel_u1" };
        await handleButton(stale);

        // In-place heal: the stale DM becomes the CURRENT private view
        // — a fresh ephemeral rejection is NOT spawned.
        assert.equal(stale.calls.replies.length, 0);
        assert.equal(stale.calls.updates.length, 1);
        const ids = customIds(stale.calls.updates[0]);
        assert(
            ids.includes(`battle:roll:${session.pending.id}`)
        );
        assert.equal(session.pending.stage, "contest_attacker");
        console.log("PASS: stale private click heals to current view");
        cleanup(session);
    }

    // --- dead session: stale panel controls stripped on click ---------

    {
        const session = startSession();
        bs.forfeit(session, "u1"); // session removed from the map
        assert.equal(bs.getSession(session.channelId), null);

        const dead = mockDmButton({
            customId: "battle:attack", userId: "u1",
            channelId: "dm_u1",
            client: mockClient(new Map())
        });
        dead.message = { id: "old_dm" };
        await handleButton(dead);

        assert.equal(dead.calls.updates.length, 1);
        assert.equal(dead.calls.updates[0].components.length, 0);
        assert(
            dead.calls.updates[0].content.includes("ended")
        );
        console.log("PASS: dead-session click strips stale controls");
    }

    // --- repeated My Controls: ephemeral each time, DM not duplicated -

    {
        const session = startSession();
        const users = new Map([
            ["u1", mockDmUser("u1")],
            ["u2", mockDmUser("u2")]
        ]);
        const client = mockClient(users);
        await sendPrivatePanels(client, session);
        session.panelMessageId = "panel_1";

        for (let i = 0; i < 3; i++) {
            const btn = mockDmButton({
                customId: "battle:mypanel", userId: "u1",
                channelId: session.channelId, client
            });
            btn.message = { id: "panel_1" };
            await handleButton(btn);
            assert(btn.calls.replies[0].ephemeral);
        }
        // DM panel was edited in place, never resent.
        assert.equal(users.get("u1").sent.length, 1);
        console.log("PASS: repeated My Controls — no DM duplicates");
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
