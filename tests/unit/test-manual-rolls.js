const assert = require("node:assert/strict");
const bs = require("../../src/game/services/battleService");
const driver = require("../helpers/rollDriver");
const manual = require("../../src/game/manualRolls");
const { handleButton } = require("../../src/bot/buttons");
const { getSkill } = require("../../src/game/skills");
const { rollDice } = require("../../src/game/combat");
const { pool } = require("../../src/database/db");

console.log("=== Manual Dice Roll Tests ===");

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

// Start a battle WITHOUT resolving initiative — the pending state is
// asserted directly in several tests.
function rawBattle(p1Stats = {}, p2Stats = {}) {
    const chan = `mr_${++channelSeq}`;
    return bs.startBattle(
        chan,
        player("u1", "Hero", p1Stats),
        player("u2", "Foe", p2Stats)
    ).session;
}

function freshBattle(p1Stats = {}, p2Stats = {}) {
    const chan = `mr_${++channelSeq}`;
    return driver.start(
        chan,
        player("u1", "Hero", p1Stats),
        player("u2", "Foe", p2Stats),
        { firstRolls: [18], secondRolls: [5] }
    ).session;
}

function cleanup(session) {
    if (session && bs.getSession(session.channelId)) {
        bs.forfeit(session, session.players[0].discordId);
    }
}

function mockButton({ customId, userId, channelId }) {
    const calls = { replies: [], updates: [], sent: [] };
    return {
        calls, customId, channelId, user: { id: userId },
        channel: {
            send: async p => {
                calls.sent.push(p);
                return { id: "m1" };
            },
            messages: { fetch: async () => ({ edit: async () => {} }) }
        },
        reply: async p => calls.replies.push(p),
        update: async p => calls.updates.push(p)
    };
}

async function run() {
    // --- dice generator ranges ---

    {
        for (let i = 0; i < 500; i++) {
            const d8 = rollDice(8);
            const d20 = rollDice(20);
            assert(d8 >= 1 && d8 <= 8 && Number.isInteger(d8));
            assert(d20 >= 1 && d20 <= 20 && Number.isInteger(d20));
        }
        console.log("PASS: d8 in 1-8, d20 in 1-20 over 500 samples");
    }

    // --- initiative is manual ---

    {
        const session = rawBattle();
        assert(session.pending, "initiative pending exists");
        assert.equal(session.pending.type, "initiative");
        assert.equal(session.battle.currentTurn, null);

        // No combat action may start while initiative is pending.
        assert.equal(
            bs.attack(session, "u1").error, "action_in_progress"
        );

        // Wrong roller can't roll initiative.
        const bad = bs.recordRoll(session, "u2", 10);
        assert.equal(bad.error, "wrong_roller");

        const r1 = bs.recordRoll(session, "u1", 18);
        assert(r1.ok && r1.pending);
        const r2 = bs.recordRoll(session, "u2", 5);
        assert(r2.ok && r2.resolved && r2.type === "initiative");
        assert.equal(r2.initiative.firstRoll, 18);
        assert.equal(r2.initiative.secondRoll, 5);
        assert.equal(r2.firstTurn.character, "Hero");
        assert.equal(session.battle.turnNumber, 1);
        console.log("PASS: manual initiative — order, gates, first turn");
        cleanup(session);
    }

    {
        // Initiative tie → explicit reroll stage for both.
        const session = rawBattle();
        bs.recordRoll(session, "u1", 10);
        const r = bs.recordRoll(session, "u2", 10);
        assert(r.ok && r.pending);
        assert.equal(session.pending.ties, 1);
        assert.equal(r.expected.kind, "tie_reroll");
        assert.equal(r.expected.discordId, "u1");

        bs.recordRoll(session, "u1", 7);
        const r2 = bs.recordRoll(session, "u2", 9);
        assert(r2.resolved);
        assert.equal(r2.firstTurn.character, "Foe");
        console.log("PASS: initiative tie rerolls both dice explicitly");
        cleanup(session);
    }

    // --- pending creation instead of auto-resolve ---

    {
        const session = freshBattle();
        const hero = session.battle.characters[0];
        const foe = session.battle.characters[1];
        const snap = JSON.stringify([hero.hp, hero.cost, foe.hp]);

        const started = bs.attack(session, "u1");
        assert(started.ok && started.pending);
        assert(session.pending);
        assert.equal(
            JSON.stringify([hero.hp, hero.cost, foe.hp]), snap
        );
        assert.equal(session.battle.turnNumber, 1);
        console.log(
            "PASS: attack creates pending roll — nothing mutates"
        );

        // Another action cannot start while rolling.
        assert.equal(
            bs.attack(session, "u1").error, "action_in_progress"
        );
        assert.equal(
            bs.useSkill(session, "u1", "power_strike").error,
            "action_in_progress"
        );
        assert.equal(
            bs.useEx(session, "u1").error, "action_in_progress"
        );
        console.log("PASS: pending roll locks all other actions");
        cleanup(session);
    }

    // --- contest sequence: attacker then defender, one die/click ---

    {
        const session = freshBattle();
        bs.attack(session, "u1");

        let exp = bs.expectedRoll(session);
        assert.equal(exp.discordId, "u1");
        assert.equal(exp.die, 20);
        assert.equal(exp.kind, "contest");

        const r1 = bs.recordRoll(session, "u1", 15);
        assert(r1.ok && r1.pending);
        assert.equal(session.pending.damageRolls.length, 0);

        exp = bs.expectedRoll(session);
        assert.equal(exp.discordId, "u2");
        assert.equal(exp.die, 20);

        const r2 = bs.recordRoll(session, "u2", 10);
        assert(r2.ok && r2.pending);
        exp = bs.expectedRoll(session);
        assert.equal(exp.discordId, "u1"); // attacker rolls damage
        assert.equal(exp.die, 8);
        assert.equal(exp.kind, "damage");
        assert.equal(exp.hitCount, 1);

        // No damage dealt yet — still waiting for the d8.
        assert.equal(session.battle.characters[1].hp, 100);

        const r3 = bs.recordRoll(session, "u1", 5);
        assert(r3.ok && r3.resolved);
        assert.equal(r3.result.damage, 20); // 5+20-5
        assert.equal(r3.result.attackerRoll, 15);
        assert.equal(r3.result.defenderRoll, 10);
        assert.equal(session.battle.characters[1].hp, 80);
        assert.equal(session.battle.turnNumber, 2);
        console.log(
            "PASS: contest→damage sequence, one die per click, " +
            "resolve uses recorded dice"
        );
        cleanup(session);
    }

    // --- wrong roller / duplicate click ---

    {
        const session = freshBattle();
        bs.attack(session, "u1");
        const actionId = session.pending.id;

        assert.equal(
            bs.recordRoll(session, "u2", 10).error, "wrong_roller"
        );
        assert.equal(session.pending.id, actionId);
        assert.equal(session.pending.attackerRolls.length, 0);

        bs.recordRoll(session, "u1", 15);
        // Re-click as the same user — now defender's turn to roll.
        assert.equal(
            bs.recordRoll(session, "u1", 11).error, "wrong_roller"
        );
        assert.equal(session.pending.attackerRolls.length, 1);

        bs.recordRoll(session, "u2", 10);
        bs.recordRoll(session, "u1", 5);
        assert(!session.pending, "resolved clears pending");

        // A further click hits the no_pending rejection.
        assert.equal(
            bs.recordRoll(session, "u1", 7).error, "no_pending"
        );
        console.log(
            "PASS: wrong roller, duplicate click, replay rejected"
        );
        cleanup(session);
    }

    // --- invalid die values rejected (range enforcement) ---

    {
        const session = freshBattle();
        bs.attack(session, "u1");
        assert.equal(
            bs.recordRoll(session, "u1", 21).error, "invalid_die"
        );
        assert.equal(session.pending.attackerRolls.length, 0);
        driver.drive(session, {
            attackerRolls: [15], defenderRolls: [10],
            damageRolls: [5]
        });
        cleanup(session);
        console.log("PASS: out-of-range injected die rejected");
    }

    // --- tie reroll sequence ---

    {
        const session = freshBattle();
        bs.attack(session, "u1");
        bs.recordRoll(session, "u1", 12);
        const tie = bs.recordRoll(session, "u2", 12);
        assert(tie.pending);
        assert.equal(session.pending.ties, 1);
        assert.equal(bs.expectedRoll(session).kind, "tie_reroll");
        assert.equal(bs.expectedRoll(session).discordId, "u1");

        bs.recordRoll(session, "u1", 14);
        const exp2 = bs.expectedRoll(session);
        assert.equal(exp2.discordId, "u2");
        assert.equal(exp2.kind, "tie_reroll");
        bs.recordRoll(session, "u2", 9);

        const done = driver.drive(session, { damageRolls: [4] });
        assert(done.resolved);
        assert.equal(done.result.rerolls, 1);
        assert.equal(done.result.attackerRoll, 14);
        console.log("PASS: tie reroll — both players roll again");
        cleanup(session);
    }

    // --- defender natural 20 → reflection, defender rolls the d8 ---

    {
        const session = freshBattle();
        bs.attack(session, "u1");
        bs.recordRoll(session, "u1", 15);
        const r2 = bs.recordRoll(session, "u2", 20);
        assert(r2.pending);
        const exp = bs.expectedRoll(session);
        assert.equal(exp.kind, "reflect");
        assert.equal(exp.discordId, "u2"); // defender rolls it
        assert.equal(exp.die, 8);

        // Attacker can't roll the reflection die.
        assert.equal(
            bs.recordRoll(session, "u1", 6).error, "wrong_roller"
        );

        const done = bs.recordRoll(session, "u2", 6);
        assert(done.resolved);
        assert.equal(done.result.outcome, "reflected");
        // reflect = 6 + foe def(5) - hero def(5) = 6 to attacker
        assert.equal(done.result.damage, 6);
        assert.equal(session.battle.characters[0].hp, 94);
        assert.equal(session.battle.characters[1].hp, 100);
        console.log(
            "PASS: reflection — defender rolls the d8, one resolve"
        );
        cleanup(session);
    }

    // --- attacker natural 20 → two separate d8 clicks ---

    {
        const session = freshBattle({}, { hp: 200, maxHp: 200 });
        bs.attack(session, "u1");
        bs.recordRoll(session, "u1", 20);
        bs.recordRoll(session, "u2", 10);
        let exp = bs.expectedRoll(session);
        assert.equal(exp.kind, "damage");
        assert.equal(exp.hitCount, 2);
        assert.equal(exp.hitIndex, 0);

        const h1 = bs.recordRoll(session, "u1", 5);
        assert(h1.pending);
        exp = bs.expectedRoll(session);
        assert.equal(exp.hitIndex, 1);
        // Live HP untouched during pending — the projection tracks
        // the first hit (ordinary formula): 5+20-5 = 20.
        assert.equal(session.battle.characters[1].hp, 200);
        assert.equal(session.pending.projectedDefenderHp, 180);
        const h2 = bs.recordRoll(session, "u1", 4);
        assert(h2.resolved);
        assert.equal(h2.result.outcome, "double_attack");
        assert.equal(h2.result.hits.length, 2);
        assert.equal(h2.result.hits[0].damage, 20); // 5+20-5
        assert.equal(h2.result.hits[1].damage, 7); // round((4+20)/2)-5
        console.log(
            "PASS: double attack — two separate d8 clicks, " +
            "second hit halved"
        );
        cleanup(session);
    }

    {
        // Knockout on hit 1 stops the sequence — no second d8.
        const session = freshBattle({}, { hp: 30, maxHp: 100 });
        bs.attack(session, "u1");
        bs.recordRoll(session, "u1", 20);
        bs.recordRoll(session, "u2", 10);
        const done = bs.recordRoll(session, "u1", 8);
        assert(done.resolved);
        assert.equal(done.result.hits.length, 1);
        assert.equal(session.battle.characters[1].hp, 0);
        assert(done.finished);
        assert(!session.pending);
        console.log(
            "PASS: first-hit knockout stops further damage dice"
        );
    }

    // --- critical unchanged ---

    {
        const session = freshBattle();
        bs.attack(session, "u1");
        const done = driver.drive(session, {
            attackerRolls: [15], defenderRolls: [10],
            damageRolls: [8]
        });
        assert(done.result.hits[0].critical);
        // (8+20)*2-5 = 51
        assert.equal(done.result.hits[0].damage, 51);
        console.log("PASS: critical formula unchanged");
        cleanup(session);
    }

    // --- skill pending: rejected skills never start dice ---

    {
        const session = freshBattle({ cost: 1 }, {});
        const hero = session.battle.characters[0];
        const snap = JSON.stringify(hero.cooldowns);
        const costBefore = hero.cost;

        // power_strike needs 3; hero has 1+1 turn-start = 2.
        const fail = bs.useSkill(session, "u1", "power_strike");
        assert.equal(fail.error, "insufficient_cost");
        assert(!session.pending);
        assert.equal(hero.cost, costBefore);
        assert.equal(JSON.stringify(hero.cooldowns), snap);
        console.log(
            "PASS: insufficient COST rejected before dice — no pending"
        );
        cleanup(session);
    }

    {
        const session = freshBattle({ cost: 6 }, { hp: 200 });
        const hero = session.battle.characters[0];

        const started = bs.useSkill(session, "u1", "power_strike");
        assert(started.ok && started.pending);
        assert.equal(hero.cost, 6); // not spent until resolution

        const done = driver.drive(session, {
            attackerRolls: [15], defenderRolls: [10],
            damageRolls: [5]
        });
        assert(done.resolved);
        // skill: 5+20+10-5 = 30
        assert.equal(done.result.hits[0].damage, 30);
        // cost: 6 -3 +1 hit = 4
        assert.equal(hero.cost, 4);
        assert.equal(hero.cooldowns.power_strike, 2);
        assert.equal(done.result.skillKey, "power_strike");
        console.log(
            "PASS: skill — COST at resolve, cooldown arms, " +
            "formula unchanged"
        );
        cleanup(session);
    }

    // --- EX multi-hit: separate d8 per hit, stops on knockout ---

    {
        const session = freshBattle(
            { cost: 6, ex: 100, exKey: "fang_barrage" },
            { hp: 500, maxHp: 500 }
        );
        const started = bs.useEx(session, "u1");
        assert(started.ok && started.pending);
        bs.recordRoll(session, "u1", 15);
        bs.recordRoll(session, "u2", 10);
        // 3 hits expected — three separate d8 clicks.
        assert.equal(bs.expectedRoll(session).hitCount, 3);
        bs.recordRoll(session, "u1", 5);
        assert(session.pending);
        assert.equal(bs.expectedRoll(session).hitIndex, 1);
        bs.recordRoll(session, "u1", 5);
        assert(session.pending);
        assert.equal(bs.expectedRoll(session).hitIndex, 2);
        const done = bs.recordRoll(session, "u1", 5);
        assert(done.resolved);
        assert.equal(done.result.hits.length, 3);
        assert.equal(session.battle.characters[0].ex, 0);
        console.log(
            "PASS: fang barrage — 3 separate d8 clicks, one contest"
        );
        cleanup(session);
    }

    {
        // EX knockout stops further hit dice.
        const session = freshBattle(
            { cost: 6, ex: 100, exKey: "fang_barrage" },
            { hp: 10 }
        );
        bs.useEx(session, "u1");
        bs.recordRoll(session, "u1", 15);
        bs.recordRoll(session, "u2", 10);
        const done = bs.recordRoll(session, "u1", 5);
        assert(done.resolved && done.finished);
        assert.equal(done.result.hits.length, 1);
        assert(!session.pending);
        console.log("PASS: multi-hit EX stops at knockout");
    }

    // --- forfeit during pending ---

    {
        const session = freshBattle();
        bs.attack(session, "u1");
        bs.recordRoll(session, "u1", 15);
        const pendingId = session.pending.id;

        const f = bs.forfeit(session, "u2");
        assert(f.ok);
        assert.equal(session.pending.status, "cancelled");
        assert.equal(session.battle.status, "finished");
        assert.equal(bs.getSession(session.channelId), null);
        console.log(
            "PASS: forfeit during pending finalizes + cancels rolls"
        );

        // Stale roll button → session gone → safe stale message.
        const stale = mockButton({
            customId: `battle:roll:${pendingId}`,
            userId: "u2", channelId: session.channelId
        });
        await handleButton(stale);
        assert(
            stale.calls.replies[0].content.includes("no longer active")
        );
        console.log("PASS: stale roll button after forfeit is safe");
    }

    // --- stale action id / finished battle rejection ---

    {
        const session = freshBattle();
        bs.attack(session, "u1");
        const oldId = session.pending.id;
        driver.drive(session, {
            attackerRolls: [15], defenderRolls: [10],
            damageRolls: [5]
        });
        // Old action id button → mismatch → safe rejection.
        const stale = mockButton({
            customId: `battle:roll:${oldId}`,
            userId: "u2", channelId: session.channelId
        });
        await handleButton(stale);
        assert(
            stale.calls.replies[0].content.includes("no longer needed")
        );

        // New action gets a different id.
        driver.attack(session, "u2", {
            attackerRolls: [10], defenderRolls: [5],
            damageRolls: [3]
        });
        bs.attack(session, "u1");
        assert(session.pending);
        assert.notEqual(session.pending.id, oldId);
        console.log(
            "PASS: stale action ids rejected, new ids are unique"
        );
        cleanup(session);
    }

    // --- button-level flow: panel roll button end-to-end ---

    {
        const session = freshBattle();
        const atk = mockButton({
            customId: "battle:attack", userId: "u1",
            channelId: session.channelId
        });
        await handleButton(atk);
        assert(session.pending);
        // Panel update shows a roll button carrying the action id.
        const row = atk.calls.updates[0].components[0].toJSON();
        const rollBtn = row.components.find(
            c => c.custom_id?.startsWith("battle:roll:")
        );
        assert(rollBtn);
        assert(rollBtn.custom_id.includes(session.pending.id));
        assert(rollBtn.label.includes("d20"));

        // Wrong player clicks it → ephemeral rejection, no record.
        const wrong = mockButton({
            customId: rollBtn.custom_id, userId: "u2",
            channelId: session.channelId
        });
        await handleButton(wrong);
        assert(
            wrong.calls.replies[0].content.includes("not yours")
        );
        assert.equal(session.pending.attackerRolls.length, 0);

        // Correct player rolls → panel shows next expected roller.
        const right = mockButton({
            customId: rollBtn.custom_id, userId: "u1",
            channelId: session.channelId
        });
        await handleButton(right);
        assert.equal(session.pending.attackerRolls.length, 1);
        const embed = right.calls.updates[0].embeds[0].data;
        const diceField = embed.fields.find(f => f.name === "🎲 Dice");
        assert(diceField.value.includes("u2"));
        console.log(
            "PASS: roll button end-to-end — wrong player rejected, " +
            "panel tracks next roller"
        );
        cleanup(session);
    }

    console.log("\nManual dice roll tests passed.");
}

run()
    .then(() => pool.end())
    .catch(err => {
        console.error("FAIL:", err);
        pool.end().finally(() => process.exit(1));
    });
