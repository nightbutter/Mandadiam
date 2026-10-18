const assert = require("node:assert/strict");
const {
    EX_SKILLS, EX_KEYS, DEFAULT_EX_COST, getExSkill
} = require("../../src/game/exSkills");
const {
    EX_MAX, addEx, onAttackActionEx, onDamageTakenEx, consumeEx
} = require("../../src/game/exGauge");
const {
    resolveExAttack, effectiveDef, effectiveMultiplier
} = require("../../src/game/exCombat");
const bs = require("../../src/game/services/battleService");
const driver = require("../helpers/rollDriver");
const { handleButton } = require("../../src/bot/buttons");
const { buildExPrompt, exBar } = require("../../src/bot/battleFormat");
const { pool } = require("../../src/database/db");

console.log("=== EX / Ultimate System Tests ===");

const ALL = ["power_strike", "piercing_strike", "desperation_burst"];

function player(id, name, stats = {}) {
    return {
        discordId: id,
        character: {
            name,
            hp: stats.hp ?? 100,
            maxHp: stats.maxHp ?? 100,
            atk: stats.atk ?? 20,
            def: stats.def ?? 10,
            spe: stats.spe ?? 10,
            cost: stats.cost ?? 0,
            skills: stats.skills ?? [...ALL],
            ex: stats.ex ?? 0,
            exKey: stats.exKey === undefined ? "oblivion_edge" : stats.exKey
        }
    };
}

function freshSession(p1Stats, p2Stats) {
    return driver.start(
        `ex_${Math.random()}`,
        player("u1", "Hero", p1Stats),
        player("u2", "Enemy", p2Stats),
        { firstRolls: [18], secondRolls: [5] } // u1 goes first
    ).session;
}

function cleanup(session) {
    if (bs.getSession(session.channelId)) {
        bs.forfeit(session, session.players[0].discordId);
    }
}

function mockButton({ customId, userId, channelId }) {
    const calls = { replies: [], updates: [] };
    return {
        calls,
        customId,
        channelId: channelId ?? "x",
        user: { id: userId },
        channel: {
            send: async p => ({ id: "m1" }),
            messages: { fetch: async () => ({ edit: async () => {} }) }
        },
        reply: async p => calls.replies.push(p),
        update: async p => calls.updates.push(p)
    };
}

async function run() {
    // --- A. catalog ---

    {
        assert.equal(EX_KEYS.length, 4);
        assert.equal(new Set(EX_KEYS).size, 4);
        for (const key of EX_KEYS) {
            const ex = EX_SKILLS[key];
            assert(ex.name && ex.description, key);
            assert(Number.isInteger(ex.cost) && ex.cost >= 0, key);
            assert(Number.isInteger(ex.multNum) && ex.multNum > 0, key);
            assert(Number.isInteger(ex.multDen) && ex.multDen > 0, key);
            assert(
                ["heavy", "pierce_defense", "multi_hit", "desperation"]
                    .includes(ex.effect.type),
                key
            );
        }
        assert.equal(DEFAULT_EX_COST, 4);
        assert.equal(getExSkill("bogus"), null);
        console.log("PASS: EX catalog — unique keys, valid fields");
    }

    // --- B. gauge primitives ---

    {
        const c = { ex: 0 };
        addEx(c, 20); assert.equal(c.ex, 20);
        addEx(c, 95); assert.equal(c.ex, 100); // clamp
        assert.equal(consumeEx(c), true);
        assert.equal(c.ex, 0);
        assert.equal(consumeEx(c), false);

        const noGauge = {};
        assert.equal(addEx(noGauge, 20), 0); // non-battle char safe
        assert.equal(onDamageTakenEx(c, 0), 0);
        onDamageTakenEx(c, 15); assert.equal(c.ex, 10);
        onAttackActionEx(c); assert.equal(c.ex, 30);
        console.log("PASS: gauge clamps, consume, zero-damage no gain");
    }

    // --- B2. gauge gains through real combat actions ---

    {
        const session = freshSession(
            { cost: 0 }, { hp: 200, maxHp: 200 }
        );
        const hero = session.battle.characters[0];
        const enemy = session.battle.characters[1];
        assert.equal(hero.ex, 0);

        driver.attack(session, "u1", {
            attackerRolls: [15], defenderRolls: [10],
            damageRolls: [5]
        });
        assert.equal(hero.ex, 20);  // successful action once
        assert.equal(enemy.ex, 10); // one damage instance
        console.log("PASS: attack +20 once, defender +10 per instance");
        cleanup(session);
    }

    {
        // double attack → still +20 total
        const session = freshSession(
            { cost: 0 }, { hp: 500, maxHp: 500 }
        );
        const hero = session.battle.characters[0];
        driver.attack(session, "u1", {
            attackerRolls: [20], defenderRolls: [10],
            damageRolls: [3, 4]
        });
        assert.equal(hero.ex, 20);
        assert.equal(session.battle.characters[1].ex, 20); // 2 hits
        console.log("PASS: double attack +20 total, not +40");
        cleanup(session);
    }

    {
        // reflected → attacker +0 action EX, +10 if reflect dmg >0
        const session = freshSession({}, {});
        const hero = session.battle.characters[0];
        driver.attack(session, "u1", {
            attackerRolls: [15], defenderRolls: [20],
            reflectRolls: [5]
        });
        // reflect dmg = 5 + 10(def) - 10(def) = 5 > 0 → +10
        assert.equal(hero.ex, 10);
        console.log("PASS: reflected attack — +0 action, +10 received");
        cleanup(session);
    }

    {
        // rejected action → no EX
        const session = freshSession({}, {});
        const hero = session.battle.characters[0];
        const out = bs.attack(session, "u9"); // not participant
        assert.equal(out.ok, false);
        assert.equal(hero.ex, 0);
        console.log("PASS: rejected action grants no EX");
        cleanup(session);
    }

    // --- D. EX resolution formulas ---

    {
        // oblivion_edge: 2.5x — (5+20+10)*5/2 = floor(87.5)=87 −10 = 77
        const a = { hp: 100, maxHp: 100, atk: 20, def: 10, spe: 10 };
        const d = { hp: 200, maxHp: 200, atk: 5, def: 10, spe: 5 };
        const out = resolveExAttack(a, d, EX_SKILLS.oblivion_edge, {
            attackerRolls: [15], defenderRolls: [10],
            damageRolls: [5]
        });
        assert(out.success);
        assert.equal(out.hits[0].damage, 77);
        assert.equal(d.hp, 123);
        console.log("PASS: heavy EX formula — floor(raw×2.5)−DEF");
    }

    {
        // crit: (8+20+10)*2*5/2 = 190 − 10 = 180 (mult once, def once)
        const a = { hp: 100, maxHp: 100, atk: 20, def: 10, spe: 10 };
        const d = { hp: 300, maxHp: 300, atk: 5, def: 10, spe: 5 };
        const out = resolveExAttack(a, d, EX_SKILLS.oblivion_edge, {
            attackerRolls: [15], defenderRolls: [10],
            damageRolls: [8]
        });
        assert(out.hits[0].critical);
        assert.equal(out.hits[0].damage, 180);
        console.log("PASS: EX crit — doubles raw once, DEF once");
    }

    {
        // void_piercer on def=10: effDef = 10 − floor(5) = 5
        assert.equal(
            effectiveDef(
                { def: 10 },
                { type: "pierce_defense", piercePercent: 50 }
            ),
            5
        );
        // odd def=7: floor(7*50/100)=3 → 4
        assert.equal(
            effectiveDef(
                { def: 7 },
                { type: "pierce_defense", piercePercent: 50 }
            ),
            4
        );
        const a = { hp: 100, maxHp: 100, atk: 20, def: 10, spe: 10 };
        const d = { hp: 200, maxHp: 200, atk: 5, def: 10, spe: 5 };
        const out = resolveExAttack(a, d, EX_SKILLS.void_piercer, {
            attackerRolls: [15], defenderRolls: [10],
            damageRolls: [5]
        });
        // (5+20+10)*2 = 70 − 5 = 65
        assert.equal(out.hits[0].damage, 65);
        console.log("PASS: pierce_defense — floor rounding, applies");
    }

    {
        // fang_barrage: 3 hits, one contest, each def applied
        const a = { hp: 100, maxHp: 100, atk: 20, def: 10, spe: 10 };
        const d = {
            hp: 200, maxHp: 200, atk: 5, def: 10, spe: 5,
            cost: 0, ex: 0
        };
        const out = resolveExAttack(a, d, EX_SKILLS.fang_barrage, {
            attackerRolls: [15], defenderRolls: [10],
            damageRolls: [5, 5, 5]
        });
        assert.equal(out.hits.length, 3);
        // each: 35 − 10 = 25 → total 75
        assert.equal(out.damage, 75);
        // defender gained +10 EX per instance + 1 COST per instance
        assert.equal(d.ex, 30);
        assert.equal(d.cost, 3);
        // attacker hit-COST only once
        assert.equal(a.cost, 1);
        console.log("PASS: multi_hit — 3 instances, COST/EX per hit, hit-bonus once");
    }

    {
        // last_light desperation boundary: 40% exact triggers
        const at40 = { hp: 40, maxHp: 100, atk: 20, def: 10, spe: 10 };
        const above40 = { hp: 41, maxHp: 100, atk: 20, def: 10, spe: 10 };
        assert.equal(
            effectiveMultiplier(at40, EX_SKILLS.last_light).num /
            effectiveMultiplier(at40, EX_SKILLS.last_light).den,
            3
        );
        assert.equal(
            effectiveMultiplier(above40, EX_SKILLS.last_light).num /
            effectiveMultiplier(above40, EX_SKILLS.last_light).den,
            1.5
        );
        console.log("PASS: desperation — 3x at 40%, 1.5x at 41%");
    }

    {
        // reflected EX — defender d20 20 reflects standard formula
        const a = { hp: 100, maxHp: 100, atk: 20, def: 10, spe: 10, ex: 0 };
        const d = { hp: 200, maxHp: 200, atk: 5, def: 10, spe: 5 };
        const out = resolveExAttack(a, d, EX_SKILLS.oblivion_edge, {
            attackerRolls: [15], defenderRolls: [20],
            reflectRolls: [5]
        });
        assert.equal(out.outcome, "reflected");
        assert.equal(d.hp, 200); // no EX damage applied
        console.log("PASS: EX reflection — existing formula, no EX dmg");
    }

    // --- C. activation through the service ---

    {
        const session = freshSession(
            { cost: 5, ex: 100 }, { hp: 300, maxHp: 300 }
        );
        const hero = session.battle.characters[0];

        const out = driver.useEx(session, "u1", {
            attackerRolls: [15], defenderRolls: [10],
            damageRolls: [5]
        });

        assert(out.ok);
        assert.equal(hero.ex, 0);          // gauge consumed
        // COST: 5 +1 turn start = 6, −4 EX, +1 hit → 3
        assert.equal(hero.cost, 3);
        assert.equal(session.battle.turnNumber, 2); // one transition
        assert.equal(out.result.exName, "Oblivion Edge");
        console.log("PASS: activation consumes 100 EX + 4 COST, one turn");
        cleanup(session);
    }

    {
        const session = freshSession(
            { cost: 5, ex: 99 }, { hp: 100 }
        );
        const hero = session.battle.characters[0];
        const out = bs.useEx(session, "u1");
        assert.equal(out.error, "ex_not_ready");
        assert.equal(hero.ex, 99);
        assert.equal(hero.cost, 6); // 5 + 1 turn start — unchanged
        assert.equal(session.battle.turnNumber, 1);
        console.log("PASS: gauge <100 rejected — nothing consumed");

        // insufficient COST at full gauge
        hero.ex = 100; hero.cost = 3;
        const out2 = bs.useEx(session, "u1");
        assert.equal(out2.error, "insufficient_cost");
        assert.equal(hero.ex, 100);
        assert.equal(hero.cost, 3);
        console.log("PASS: insufficient COST — EX and COST untouched");

        // no assignment
        hero.exKey = null;
        assert.equal(bs.useEx(session, "u1").error, "no_ex_assigned");
        hero.exKey = "forged_key";
        assert.equal(bs.useEx(session, "u1").error, "unknown_ex");
        hero.exKey = "oblivion_edge";
        console.log("PASS: missing/forged EX assignment rejected");

        // out of turn / spectator
        assert.equal(bs.useEx(session, "u2").error, "not_your_turn");
        assert.equal(bs.useEx(session, "u9").error, "not_participant");
        console.log("PASS: out-of-turn and spectator EX rejected");

        cleanup(session);
    }

    {
        // finished battle rejects EX
        const session = freshSession({ cost: 5 }, { hp: 1 });
        driver.attack(session, "u1", {
            attackerRolls: [15], defenderRolls: [10], damageRolls: [8]
        });
        assert.equal(session.battle.status, "finished");
        assert.equal(bs.useEx(session, "u1").error, "finished");
        console.log("PASS: finished battle rejects EX");
    }

    // --- F. UI handlers ---

    {
        // Enemy HP high enough that any EX roll (double + crit) can't
        // end the battle — the turn advance stays deterministic.
        const session = freshSession(
            { cost: 5, ex: 100 }, { hp: 600, maxHp: 600 }
        );

        // spectator / out-of-turn
        const spec = mockButton({
            customId: "battle:ultimate", userId: "u9",
            channelId: session.channelId
        });
        await handleButton(spec);
        assert(spec.calls.replies[0].content.includes("participants"));

        const oot = mockButton({
            customId: "battle:ultimate", userId: "u2",
            channelId: session.channelId
        });
        await handleButton(oot);
        // Participant surface heals in place — the rejection text is
        // rendered on top of their current private view.
        assert(oot.calls.updates[0].content.includes("not your turn"));
        console.log("PASS: spectator/out-of-turn Ultimate rejected");

        // turn owner gets the detail prompt — in place on the
        // private surface (not a separate ephemeral).
        const owner = mockButton({
            customId: "battle:ultimate", userId: "u1",
            channelId: session.channelId
        });
        await handleButton(owner);
        assert.equal(owner.calls.replies.length, 0);
        assert(
            owner.calls.updates[0].content.includes("Oblivion Edge")
        );
        console.log("PASS: Ultimate button opens detail prompt");

        // confirm executes exactly once + turn advances
        const confirm = mockButton({
            customId: "battle:ultimate:confirm", userId: "u1",
            channelId: session.channelId
        });
        const before = session.battle.turnNumber;
        // Deterministic rolls — a defender d20=20 would reflect the
        // EX and grant the attacker +10 damage-received EX, which is
        // correct behavior but not what this assertion checks.
        const rolls = [0.75, 0.4, 0.5];
        const realRandom = Math.random;
        Math.random = () => rolls.length ? rolls.shift() : 0.5;
        try {
            await handleButton(confirm);
            // Manual dice — one authorized click per required die.
            while (session.pending) {
                const exp = bs.expectedRoll(session);
                await handleButton(mockButton({
                    customId: `battle:roll:${session.pending.id}`,
                    userId: exp.discordId,
                    channelId: session.channelId
                }));
            }
        } finally {
            Math.random = realRandom;
        }
        const hero = session.battle.characters[0];
        assert.equal(hero.ex, 0);
        assert.equal(session.battle.turnNumber, before + 1);
        console.log("PASS: confirm executes once, gauge consumed");

        // second confirm — stale, now u2's turn
        await handleButton(confirm);
        assert(
            confirm.calls.updates[1].content.includes("not your turn")
        );
        console.log("PASS: duplicate confirm cannot re-execute");

        cleanup(session);
    }

    {
        // gauge display in prompt + bar helper
        assert.equal(exBar(0), "░░░░░░░░░░");
        assert.equal(exBar(50), "█████░░░░░");
        assert.equal(exBar(100), "██████████");
        const foe = { hp: 100, cost: 0 };
        const notReady = buildExPrompt({ ex: 60, cost: 5, exKey: "oblivion_edge" }, foe);
        assert(!notReady.ready);
        assert(notReady.content.includes("not full"));
        const noCost = buildExPrompt({ ex: 100, cost: 2, exKey: "oblivion_edge" }, foe);
        assert(!noCost.ready);
        assert(noCost.content.includes("COST"));
        const ready = buildExPrompt({ ex: 100, cost: 5, exKey: "oblivion_edge" }, foe);
        assert(ready.ready);
        console.log("PASS: EX bar + availability reasons");
    }

    console.log("\nEX system tests passed.");
}

run()
    .then(() => pool.end())
    .catch(err => {
        console.error("FAIL:", err);
        pool.end().finally(() => process.exit(1));
    });
