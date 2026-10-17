const assert = require("node:assert/strict");
const bs = require("../../src/game/services/battleService");
const driver = require("../helpers/rollDriver");
const { handleButton } = require("../../src/bot/buttons");
const {
    buildSkillSelectMenu,
    buildBattleResultEmbed
} = require("../../src/bot/battleFormat");
const { resolveExAttack } = require("../../src/game/exCombat");
const { getExSkill } = require("../../src/game/exSkills");
const { pool } = require("../../src/database/db");

console.log("=== Skill Cooldown + Battle Finalization Tests ===");

const ALL_SKILLS =
    ["power_strike", "piercing_strike", "desperation_burst"];

let channelSeq = 0;

function mkPlayer(id, name, stats = {}) {
    return {
        discordId: id,
        character: {
            name,
            hp: stats.hp ?? 100,
            maxHp: stats.hp ?? 100,
            atk: stats.atk ?? 20,
            def: stats.def ?? 5,
            spe: stats.spe ?? 4,
            cost: stats.cost ?? 0,
            skills: stats.skills ?? [],
            ex: 0
        }
    };
}

// Hero always wins initiative and has plenty of HP/COST; Foe is a
// durable punching bag so turns can cycle without a knockout.
function freshBattle() {
    const chan = `cd_${++channelSeq}`;
    const { session } = driver.start(
        chan,
        mkPlayer("u1", "Hero", { skills: ALL_SKILLS, cost: 6 }),
        mkPlayer("u2", "Foe", { hp: 400, atk: 10 }),
        { firstRolls: [18], secondRolls: [5] }
    );
    return session;
}

// Click the panel roll button for whoever is expected next until
// the pending action resolves — returns the roll mocks used.
async function clickRolls(session, channelId, makeButton) {
    const mocks = [];
    while (session.pending) {
        const exp = bs.expectedRoll(session);
        const m = makeButton({
            customId: `battle:roll:${session.pending.id}`,
            userId: exp.discordId,
            channelId
        });
        mocks.push(m);
        await handleButton(m);
    }
    return mocks;
}

const HIT = {
    attackerRolls: [15], defenderRolls: [5], damageRolls: [4]
};

function mockButton({ customId, userId, channelId }) {
    const calls = { replies: [], updates: [], sent: [] };
    return {
        calls, customId, channelId,
        user: { id: userId },
        channel: {
            send: async payload => {
                calls.sent.push(payload);
                return { id: `msg_${calls.sent.length}` };
            },
            messages: { fetch: async () => null }
        },
        reply: async p => calls.replies.push(p),
        update: async p => calls.updates.push(p),
        deferUpdate: async () => {},
        editReply: async p => calls.updates.push(p)
    };
}

async function run() {
    // --- cooldown lifecycle ---

    {
        const session = freshBattle();
        const hero = session.battle.characters[0];

        assert.deepEqual(hero.cooldowns, {});
        const menu = buildSkillSelectMenu(session);
        const statuses = menu.components[0].toJSON().options.map(
            o => o.description
        );
        // No cooldowns yet — only condition/COST statuses show.
        assert(statuses.every(s => !s.includes("Cooldown")));
        assert(statuses.some(s => s.includes("ready")));
        console.log("PASS: all skills start ready in a new battle");
        bs.forfeit(session, "u1");
    }

    {
        const session = freshBattle();
        const hero = session.battle.characters[0];

        const used = driver.useSkill(session, "u1", "power_strike", HIT);
        assert(used.ok);
        assert.equal(hero.cooldowns.power_strike, 2);
        console.log(
            "PASS: successful skill use arms its cooldown (2)"
        );

        // Foe's turn — hero's counters must not tick.
        driver.attack(session, "u2", HIT);
        assert.equal(hero.cooldowns.power_strike, 2);
        console.log("PASS: opponent turn does not tick my cooldown");

        // Hero's turn N+1 — cooldown still blocks, nothing mutates.
        const costBefore = hero.cost;
        const turnBefore = session.battle.turnNumber;
        const early = bs.useSkill(session, "u1", "power_strike", HIT);
        assert(!early.ok);
        assert.equal(early.error, "on_cooldown");
        assert.equal(early.remaining, 2);
        assert.equal(hero.cost, costBefore);
        assert.equal(session.battle.turnNumber, turnBefore);
        console.log(
            "PASS: on-cooldown skill rejected with no side effects"
        );

        // The picker shows the cooling state while it's my turn.
        const coolMenu = buildSkillSelectMenu(session);
        const coolDescs = Object.fromEntries(
            coolMenu.components[0].toJSON().options.map(o => [
                o.value, o.description
            ])
        );
        assert(coolDescs.power_strike.includes("Cooldown: 2"));
        console.log("PASS: picker shows cooldown state");

        // A different skill is independently usable (desperation
        // needs hero at ≤40% — 30/100 qualifies).
        hero.hp = 30;
        const other = driver.useSkill(
            session, "u1", "desperation_burst", HIT
        );
        assert(other.ok);
        assert.equal(hero.cooldowns.desperation_burst, 3);
        // That was hero's own turn — power_strike ticked 2→1.
        assert.equal(hero.cooldowns.power_strike, 1);
        console.log(
            "PASS: other skills stay usable; own turn ticks others"
        );

        // Turn N+2 for hero — still blocked (1 left).
        driver.attack(session, "u2", HIT);
        const still = bs.useSkill(session, "u1", "power_strike", HIT);
        assert.equal(still.error, "on_cooldown");
        assert.equal(still.remaining, 1);

        // Spend the turn on a normal attack — tick brings it to 0.
        driver.attack(session, "u1", HIT);
        assert.equal(hero.cooldowns.power_strike, 0);

        driver.attack(session, "u2", HIT);
        hero.cost = 6;
        const ready = driver.useSkill(session, "u1", "power_strike", HIT);
        assert(ready.ok);
        console.log(
            "PASS: skill ready exactly when its counter reaches 0"
        );
        bs.forfeit(session, "u1");
    }

    {
        // Failed validation must not arm a cooldown or charge COST.
        const session = freshBattle();
        const hero = session.battle.characters[0];
        const costBefore = hero.cost;

        // piercing_strike requires target ≤50% — Foe is at full.
        const fail = bs.useSkill(session, "u1", "piercing_strike", HIT);
        assert.equal(fail.error, "condition_failed");
        assert.equal(hero.cooldowns.piercing_strike ?? 0, 0);
        assert.equal(hero.cost, costBefore);
        console.log("PASS: rejected skill never starts a cooldown");

        // A reflected skill WAS executed — cooldown still arms.
        const reflected = driver.useSkill(session, "u1", "power_strike", {
            attackerRolls: [15], defenderRolls: [20],
            reflectRolls: [3]
        });
        assert(reflected.ok);
        assert.equal(reflected.result.outcome, "reflected");
        assert.equal(hero.cooldowns.power_strike, 2);
        console.log("PASS: reflected skill still starts cooldown");

        bs.forfeit(session, "u1");
    }

    {
        // Double attack executes once → one cooldown arm, not two.
        const session = freshBattle();
        const hero = session.battle.characters[0];
        const out = driver.useSkill(session, "u1", "power_strike", {
            attackerRolls: [20], defenderRolls: [5],
            damageRolls: [3, 4]
        });
        assert(out.ok);
        assert.equal(out.result.outcome, "double_attack");
        assert.equal(hero.cooldowns.power_strike, 2);
        console.log(
            "PASS: double attack arms cooldown exactly once"
        );
        bs.forfeit(session, "u1");
    }

    {
        // Fresh battle → fresh counters (no cross-battle leak).
        const s1 = freshBattle();
        const h1 = s1.battle.characters[0];
        driver.useSkill(s1, "u1", "power_strike", HIT);
        assert.equal(h1.cooldowns.power_strike, 2);

        const s2 = freshBattle();
        const h2 = s2.battle.characters[0];
        assert.deepEqual(h2.cooldowns, {});
        console.log("PASS: cooldowns reset on a new battle");
        bs.forfeit(s1, "u1");
        bs.forfeit(s2, "u1");
    }

    // --- battle finalization ---

    {
        // Multi-hit EX stops applying hits once the defender drops.
        const ex = getExSkill("fang_barrage");
        const attacker = {
            name: "A", hp: 100, maxHp: 100, atk: 30, def: 5,
            spe: 5, cost: 6, ex: 100
        };
        const defender = {
            name: "D", hp: 1, maxHp: 100, atk: 5, def: 0,
            spe: 0, cost: 0, ex: 0
        };
        const result = resolveExAttack(attacker, defender, ex, {
            attackerRolls: [15], defenderRolls: [5],
            damageRolls: [8, 8, 8]
        });
        assert(result.success);
        assert.equal(result.hits.length, 1);
        assert.equal(defender.hp, 0);
        console.log(
            "PASS: multi-hit EX stops at terminal HP"
        );
    }

    {
        // Knockout via a real attack → dedicated result card sent.
        const session = driver.start(
            "end_1",
            mkPlayer("u1", "Hero", { skills: ALL_SKILLS, cost: 6 }),
            mkPlayer("u2", "Foe", { hp: 10 }),
            { firstRolls: [18], secondRolls: [5] }
        ).session;

        const btn = mockButton({
            customId: "battle:attack", userId: "u1",
            channelId: "end_1"
        });
        // d20 18 vs 7 → hit, d8 5 → 20 dmg kills the 10-HP Foe.
        // A constant stub would tie the contest and reroll forever.
        const rolls = [0.85, 0.3, 0.5];
        const realRandom = Math.random;
        Math.random = () => rolls.length ? rolls.shift() : 0.5;
        let rollMocks;
        try {
            await handleButton(btn);
            rollMocks = await clickRolls(session, "end_1", mockButton);
        } finally {
            Math.random = realRandom;
        }

        const lastRoll = rollMocks[rollMocks.length - 1];
        assert.equal(session.battle.status, "finished");
        assert.equal(session.battle.winner, "Hero");
        assert.equal(lastRoll.calls.updates[0].components.length, 0);
        assert.equal(lastRoll.calls.sent.length, 1);
        const card = lastRoll.calls.sent[0].embeds[0].data;
        assert.equal(card.title, "🏆 Battle Finished");
        assert(card.description.includes("knockout"));
        console.log("PASS: knockout sends one dedicated result card");

        // Session is gone — every stale control hits the safe path.
        assert.equal(bs.getSession("end_1"), null);
        const stale = mockButton({
            customId: "battle:attack", userId: "u1",
            channelId: "end_1"
        });
        await handleButton(stale);
        assert(stale.calls.replies[0].content
            .includes("no longer active"));
        assert.equal(stale.calls.sent.length, 0);
        console.log(
            "PASS: stale clicks after finish can't re-finalize"
        );
    }

    {
        // Forfeit produces its own result card with the forfeit reason.
        const session = driver.start(
            "end_2",
            mkPlayer("u1", "Hero", { skills: ALL_SKILLS }),
            mkPlayer("u2", "Foe"),
            { firstRolls: [18], secondRolls: [5] }
        ).session;

        const confirm = mockButton({
            customId: "battle:forfeit:confirm", userId: "u1",
            channelId: "end_2"
        });
        await handleButton(confirm);

        assert.equal(session.battle.winner, "Foe");
        assert.equal(confirm.calls.sent.length, 1);
        const card = confirm.calls.sent[0].embeds[0].data;
        assert.equal(card.title, "🏆 Battle Finished");
        assert(card.description.includes("forfeit"));
        console.log("PASS: forfeit sends a forfeit result card");

        // buildBattleResultEmbed carries the full summary.
        const embed = buildBattleResultEmbed(session, "forfeit");
        const fields = Object.fromEntries(
            embed.data.fields.map(f => [f.name, f.value])
        );
        assert(fields["🥇 Foe"].includes("HP"));
        assert(fields["🥈 Hero"].includes("COST"));
        assert(fields.Result.includes("Forfeit"));
        console.log("PASS: result card shows winner/loser/HP/COST");
    }

    {
        // A skill that kills finalizes the same way — and stale
        // skill selects hit the safe path afterwards.
        const session = driver.start(
            "end_3",
            mkPlayer("u1", "Hero", { skills: ALL_SKILLS, cost: 6 }),
            mkPlayer("u2", "Foe", { hp: 5 }),
            { firstRolls: [18], secondRolls: [5] }
        ).session;

        const sel = {
            customId: "battle:skill",
            channelId: "end_3",
            user: { id: "u1" },
            values: ["power_strike"],
            calls: { replies: [], updates: [], sent: [] },
            channel: {
                send: async p => {
                    sel.calls.sent.push(p);
                    return { id: "m1" };
                },
                messages: { fetch: async () => null }
            },
            reply: async p => sel.calls.replies.push(p),
            update: async p => sel.calls.updates.push(p)
        };

        const rolls = [0.85, 0.3, 0.5];
        const realRandom = Math.random;
        Math.random = () => rolls.length ? rolls.shift() : 0.5;
        let rollMocks;
        try {
            const { handleBattleSelect } =
                require("../../src/bot/buttons");
            await handleBattleSelect(sel);
            rollMocks = await clickRolls(session, "end_3", mockButton);
        } finally {
            Math.random = realRandom;
        }

        const lastRoll = rollMocks[rollMocks.length - 1];
        assert.equal(session.battle.status, "finished");
        assert.equal(lastRoll.calls.sent.length, 1);
        assert.equal(
            lastRoll.calls.sent[0].embeds[0].data.title,
            "🏆 Battle Finished"
        );
        console.log("PASS: lethal skill ends battle with result card");

        const staleCalls = { replies: [], updates: [], sent: [] };
        const staleSel = {
            customId: "battle:skill",
            channelId: "end_3",
            user: { id: "u1" },
            values: ["power_strike"],
            calls: staleCalls,
            channel: sel.channel,
            reply: async p => staleCalls.replies.push(p),
            update: async p => staleCalls.updates.push(p)
        };
        const { handleBattleSelect } = require("../../src/bot/buttons");
        await handleBattleSelect(staleSel);
        assert(staleCalls.updates[0].content
            .includes("no longer active"));
        console.log("PASS: stale skill select fails safely");
    }

    console.log("\nCooldown + finalization tests passed.");
}

run()
    .then(() => pool.end())
    .catch(err => {
        console.error("FAIL:", err);
        pool.end().finally(() => process.exit(1));
    });
