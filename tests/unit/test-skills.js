const assert = require("node:assert/strict");
const { SKILLS, INITIAL_LOADOUT, getSkill } =
    require("../../src/game/skills");
const bs = require("../../src/game/services/battleService");
const driver = require("../helpers/rollDriver");
const { handleButton, handleBattleSelect } =
    require("../../src/bot/buttons");
const { buildSkillSelectMenu } = require("../../src/bot/battleFormat");
const { pool } = require("../../src/database/db");

console.log("=== Skill System Tests ===");

const ALL = ["power_strike", "piercing_strike", "desperation_burst"];

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
            skills: stats.skills ?? [...ALL]
        }
    };
}

function freshSession(p1Stats, p2Stats) {
    return driver.start(
        `sk_${Math.random()}`,
        player("u1", "Hero", p1Stats),
        player("u2", "Enemy", p2Stats),
        { firstRolls: [18], secondRolls: [5] } // u1 goes first
    ).session;
}

function mockButton({ customId, userId, channelId }) {
    const calls = { replies: [], updates: [], sent: [] };
    return {
        calls,
        customId,
        channelId: channelId ?? "x",
        user: { id: userId },
        channel: {
            send: async p => {
                calls.sent.push(p);
                return { id: "m1" };
            },
            messages: { fetch: async () => ({ edit: async () => {} }) }
        },
        reply: async p => calls.replies.push(p),
        update: async p => calls.updates.push(p),
        followUp: async p => calls.replies.push(p)
    };
}

function mockSelect(userId, channelId, values) {
    const base = mockButton({
        customId: "battle:skill", userId, channelId
    });
    base.values = values;
    return base;
}

function cleanup(session) {
    if (bs.getSession(session.channelId)) {
        bs.forfeit(session, session.players[0].discordId);
    }
}

async function run() {
    // --- catalog ---

    {
        assert.equal(SKILLS.power_strike.cost, 3);
        assert.equal(SKILLS.piercing_strike.cost, 2);
        assert.equal(SKILLS.desperation_burst.cost, 2);
        assert.deepEqual(INITIAL_LOADOUT, ALL);
        assert.equal(getSkill("bogus"), null);
        console.log("PASS: catalog definitions and costs correct");
    }

    // --- condition boundaries ---

    {
        const actor = { hp: 40, maxHp: 100 };
        const target = { hp: 50, maxHp: 100 };

        assert(SKILLS.power_strike.canUse(actor, target).ok);
        assert(SKILLS.piercing_strike.canUse(actor, target).ok);
        assert(
            !SKILLS.piercing_strike.canUse(
                actor, { hp: 51, maxHp: 100 }
            ).ok
        );
        console.log("PASS: piercing boundary — 50% ok, 51% rejected");

        assert(SKILLS.desperation_burst.canUse(actor, target).ok);
        assert(
            !SKILLS.desperation_burst.canUse(
                { hp: 41, maxHp: 100 }, target
            ).ok
        );
        console.log("PASS: desperation boundary — 40% ok, 41% rejected");
    }

    // --- service: useSkill ---

    {
        const session = freshSession({ cost: 4 }, { hp: 50 });
        const before = session.battle.characters[1].hp;

        const out = driver.useSkill(
            session, "u1", "piercing_strike",
            { attackerRolls: [15], defenderRolls: [10],
              damageRolls: [5] }
        );

        assert(out.ok);
        const hero = session.battle.characters[0];
        // COST: 4 +1 turn start, −2 skill, +1 hit → 4
        assert.equal(hero.cost, 4);
        assert(out.result.damage < before);
        assert.equal(out.result.skillKey, "piercing_strike");
        assert.equal(session.battle.turnNumber, 2); // one transition
        console.log("PASS: piercing strike resolves, COST charged once");

        cleanup(session);
    }

    {
        const session = freshSession({ cost: 2 }, { hp: 100 });
        const hero = session.battle.characters[0];
        const enemy = session.battle.characters[1];
        const snapshot = JSON.stringify([
            hero.hp, hero.cost, enemy.hp, enemy.cost,
            session.battle.turnNumber
        ]);

        // piercing at 100% target → condition fails, nothing changes
        const out = bs.useSkill(
            session, "u1", "piercing_strike",
            { attackerRolls: [15], defenderRolls: [10] }
        );

        assert.equal(out.error, "condition_failed");
        assert.equal(
            JSON.stringify([
                hero.hp, hero.cost, enemy.hp, enemy.cost,
                session.battle.turnNumber
            ]),
            snapshot
        );
        console.log(
            "PASS: failed condition leaves state completely unchanged"
        );

        cleanup(session);
    }

    {
        // cost 1 +1 turn start = 2 — power_strike needs 3
        const session = freshSession({ cost: 1 }, { hp: 50 });
        const hero = session.battle.characters[0];

        const out = bs.useSkill(session, "u1", "power_strike");
        assert.equal(out.error, "insufficient_cost");
        assert.equal(hero.cost, 2);
        console.log("PASS: insufficient COST rejects without charging");

        // unknown skill
        assert.equal(
            bs.useSkill(session, "u1", "fireball").error,
            "unknown_skill"
        );
        // skill not equipped
        hero.skills = ["piercing_strike"];
        assert.equal(
            bs.useSkill(session, "u1", "power_strike").error,
            "skill_not_owned"
        );
        console.log("PASS: unknown and unequipped skills rejected");

        // out of turn / spectator
        assert.equal(
            bs.useSkill(session, "u2", "power_strike").error,
            "not_your_turn"
        );
        assert.equal(
            bs.useSkill(session, "u9", "power_strike").error,
            "not_participant"
        );
        console.log("PASS: out-of-turn and spectator rejected");

        cleanup(session);
    }

    {
        // desperation at exactly 40%
        const session = freshSession(
            { hp: 40, cost: 6 }, { hp: 100 }
        );
        const out = driver.useSkill(
            session, "u1", "desperation_burst",
            { attackerRolls: [15], defenderRolls: [10],
              damageRolls: [5] }
        );
        assert(out.ok);
        // COST: 6 (capped at turn start) −2 +1 hit = 5
        assert.equal(session.battle.characters[0].cost, 5);
        console.log("PASS: desperation burst at exactly 40% HP");
        cleanup(session);
    }

    {
        // finished battle rejects
        const session = freshSession({ cost: 5 }, { hp: 1 });
        driver.attack(session, "u1", {
            attackerRolls: [15], defenderRolls: [10],
            damageRolls: [8]
        });
        assert.equal(session.battle.status, "finished");
        assert.equal(
            bs.useSkill(session, "u1", "power_strike").error,
            "finished"
        );
        console.log("PASS: finished battle rejects skills");
    }

    // --- UI handlers ---

    {
        // Enemy HP high enough that no skill roll (crit/double) can
        // end the battle — the turn advance stays deterministic.
        const session = freshSession({ cost: 4 }, { hp: 300, maxHp: 300 });

        // spectator clicks Skills
        const spec = mockButton({
            customId: "battle:skills", userId: "u9",
            channelId: session.channelId
        });
        await handleButton(spec);
        assert(spec.calls.replies[0].content.includes("participants"));
        console.log("PASS: spectator Skills click rejected");

        // out-of-turn participant
        const oot = mockButton({
            customId: "battle:skills", userId: "u2",
            channelId: session.channelId
        });
        await handleButton(oot);
        assert(oot.calls.replies[0].content.includes("not your turn"));
        console.log("PASS: out-of-turn Skills click rejected");

        // turn owner gets the ephemeral picker
        const owner = mockButton({
            customId: "battle:skills", userId: "u1",
            channelId: session.channelId
        });
        await handleButton(owner);
        assert.equal(owner.calls.replies.length, 1);
        assert(owner.calls.replies[0].ephemeral);
        console.log("PASS: Skills button opens ephemeral picker");

        // menu lists all three skills with cost
        const menu = buildSkillSelectMenu(session)
            .toJSON().components[0];
        assert.equal(menu.options.length, 3);
        assert(
            menu.options.some(o => o.value === "power_strike" &&
                o.label.includes("3 COST"))
        );
        console.log("PASS: skill menu lists skills with COST");

        // select a skill → pending rolls, then resolves once
        const sel = mockSelect(
            "u1", session.channelId, ["power_strike"]
        );
        const turnBefore = session.battle.turnNumber;
        await handleBattleSelect(sel);
        assert(session.pending);
        while (session.pending) {
            const exp = bs.expectedRoll(session);
            await handleButton(mockButton({
                customId: `battle:roll:${session.pending.id}`,
                userId: exp.discordId,
                channelId: session.channelId
            }));
        }
        assert.equal(session.battle.turnNumber, turnBefore + 1);
        assert.equal(sel.calls.updates[0].components.length, 0);
        console.log("PASS: skill selection resolves exactly one action");

        // stale session → safe failure (u9 has no session anywhere)
        const stale = mockSelect("u9", "nowhere", ["power_strike"]);
        await handleBattleSelect(stale);
        assert(
            stale.calls.updates[0].content.includes("no longer active")
        );
        console.log("PASS: stale skill selection fails safely");

        cleanup(session);
    }

    console.log("\nSkill tests passed.");
}

run()
    .then(() => pool.end())
    .catch(err => {
        console.error("FAIL:", err);
        pool.end().finally(() => process.exit(1));
    });
