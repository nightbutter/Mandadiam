const assert = require("node:assert/strict");
const bs = require("../../src/game/services/battleService");
const driver = require("../helpers/rollDriver");
const {
    rulesForAction,
    applyActionStatuses,
    applyInstance,
    effectiveStat,
    effView,
    processTurnStart,
    clearStatus,
    activeStatus
} = require("../../src/game/statuses");

console.log("=== Status Effect Tests ===");

let channelSeq = 0;

// A rule row in the shape listRulesForCharacter returns (rule fields
// + joined definition fields).
function defRow(overrides = {}) {
    return {
        status_id: overrides.status_id ?? 1,
        key: "burn",
        name: "Burn",
        behavior: "periodic_damage",
        power: 4,
        is_percent: false,
        max_stacks: 1,
        default_duration: 3,
        reapply_policy: "refresh_duration",
        status_enabled: true,
        ...overrides
    };
}

function rule(overrides = {}) {
    return {
        ...defRow(overrides),
        id: overrides.id ?? 1,
        character_id: overrides.character_id ?? 99,
        scope: "character",
        action_key: "",
        enabled: true,
        chance: 100,
        duration: null,
        stacks: 1,
        timing: "per_action",
        conditions: {},
        ...overrides
    };
}

function fighter(overrides = {}) {
    return {
        name: "Fighter",
        hp: 100, maxHp: 100,
        atk: 20, def: 5, spe: 10,
        cost: 0, ex: 0,
        skills: [], cooldowns: {},
        statusRules: [],
        statuses: [],
        ...overrides
    };
}

function player(id, name, stats = {}) {
    return {
        discordId: id,
        character: fighter({ name, ...stats })
    };
}

function freshBattle(p1 = {}, p2 = {}) {
    const chan = `st_${++channelSeq}`;
    return driver.start(
        chan,
        player("u1", "Hero", p1),
        player("u2", "Foe", p2),
        { firstRolls: [18], secondRolls: [5] }
    ).session;
}

function cleanup(session) {
    if (session && bs.getSession(session.channelId)) {
        bs.forfeit(session, session.players[0].discordId);
    }
}

function run() {
    // --- scope precedence -------------------------------------------------

    {
        const characterRule = rule({ id: 1, chance: 50 });
        const attackRule = rule({
            id: 2, scope: "attack", chance: 80
        });
        const skillRule = rule({
            id: 3, scope: "skill", action_key: "power_strike",
            chance: 30
        });
        const otherSkillRule = rule({
            id: 4, scope: "skill", action_key: "piercing_strike",
            chance: 90
        });

        const rules = [
            characterRule, attackRule, skillRule, otherSkillRule
        ];

        // Normal attack → attack rule wins over character fallback.
        const forAttack = rulesForAction(
            rules, { type: "normal", key: null }
        );
        assert.equal(forAttack.length, 1);
        assert.equal(forAttack[0].id, 2);

        // power_strike → its own rule; piercing's doesn't leak in.
        const forSkill = rulesForAction(
            rules, { type: "skill", key: "power_strike" }
        );
        assert.equal(forSkill.length, 1);
        assert.equal(forSkill[0].id, 3);

        // A skill with no rule → the character fallback applies.
        const forFallback = rulesForAction(
            rules, { type: "skill", key: "desperation_burst" }
        );
        assert.equal(forFallback.length, 1);
        assert.equal(forFallback[0].id, 1);

        console.log(
            "PASS: scope precedence — action > attack > character"
        );
    }

    {
        // Disabled action-level override blocks the inherited rule.
        const rules = [
            rule({ id: 1 }),
            rule({ id: 2, scope: "attack", enabled: false })
        ];

        const forAttack = rulesForAction(
            rules, { type: "normal", key: null }
        );
        // The disabled override is the governing rule — it's
        // returned so applyActionStatuses can record the block.
        assert.equal(forAttack.length, 1);
        assert.equal(forAttack[0].enabled, false);

        const attacker = fighter({ statusRules: rules });
        const defender = fighter();
        const events = applyActionStatuses(
            attacker, defender,
            { type: "normal", key: null },
            { success: true, hits: [{}], defeated: false },
            { statusRolls: [0] }
        );

        assert.equal(defender.statuses.length, 0);
        assert.equal(events[0].type, "skipped");
        console.log("PASS: disabled override blocks inherited rule");
    }

    // --- reapplication policies -------------------------------------------

    {
        // REFRESH_DURATION: stacks kept, duration reset.
        const target = fighter();
        const base = {
            key: "burn", name: "Burn", statusId: 1,
            behavior: "periodic_damage", power: 4,
            isPercent: false, stacks: 1, maxStacks: 1,
            policy: "refresh_duration", remainingTurns: 3,
            sourceName: "S"
        };
        applyInstance(target, { ...base });
        target.statuses[0].remainingTurns = 1;
        const ev = applyInstance(target, { ...base });
        assert.equal(ev.type, "refreshed");
        assert.equal(target.statuses[0].remainingTurns, 3);
        assert.equal(target.statuses.length, 1);

        // STACK_INTENSITY: stacks grow to the cap, duration extends.
        const t2 = fighter();
        const stack = {
            ...base, key: "poison", policy: "stack_intensity",
            maxStacks: 3
        };
        applyInstance(t2, { ...stack });
        let e2 = applyInstance(t2, { ...stack });
        assert.equal(e2.type, "stacked");
        assert.equal(t2.statuses[0].stacks, 2);
        applyInstance(t2, { ...stack });
        e2 = applyInstance(t2, { ...stack }); // at cap → refresh
        assert.equal(t2.statuses[0].stacks, 3);
        assert.equal(e2.type, "refreshed");

        // REPLACE_IF_STRONGER: only a stronger instance replaces.
        const t3 = fighter();
        const strong = {
            ...base, key: "atk_up", policy: "replace_if_stronger",
            stacks: 2, remainingTurns: 5
        };
        applyInstance(t3, { ...strong });
        const weaker = applyInstance(
            t3, { ...strong, stacks: 1 }
        );
        assert.equal(weaker.type, "ignored");
        assert.equal(t3.statuses[0].stacks, 2);
        const stronger = applyInstance(
            t3, { ...strong, stacks: 3 }
        );
        assert.equal(stronger.type, "replaced");
        assert.equal(t3.statuses[0].stacks, 3);

        // IGNORE_IF_ACTIVE: nothing changes.
        const t4 = fighter();
        const stun = {
            ...base, key: "stun", policy: "ignore_if_active",
            remainingTurns: 1
        };
        applyInstance(t4, { ...stun });
        const ig = applyInstance(t4, { ...stun });
        assert.equal(ig.type, "ignored");
        assert.equal(t4.statuses.length, 1);

        // REPLACE_DURATION: duration+stacks replaced outright.
        const t5 = fighter();
        const bleed = {
            ...base, key: "bleed", policy: "replace_duration",
            remainingTurns: 4, stacks: 1
        };
        applyInstance(t5, { ...bleed });
        applyInstance(t5, { ...bleed, remainingTurns: 2, stacks: 2 });
        assert.equal(t5.statuses[0].remainingTurns, 2);
        assert.equal(t5.statuses[0].stacks, 2);

        console.log(
            "PASS: all five reapplication policies behave per spec"
        );
    }

    // --- application chance -----------------------------------------------

    {
        const attacker = fighter({
            statusRules: [rule({ chance: 0 })]
        });
        const defender = fighter();
        const events = applyActionStatuses(
            attacker, defender, { type: "normal", key: null },
            { success: true, hits: [{}], defeated: false },
            { statusRolls: [0, 0, 0] } // 0% can never pass
        );
        assert.equal(defender.statuses.length, 0);
        assert.equal(events[0].type, "missed");

        const attacker2 = fighter({
            statusRules: [rule({ chance: 100 })]
        });
        const defender2 = fighter();
        applyActionStatuses(
            attacker2, defender2, { type: "normal", key: null },
            { success: true, hits: [{}], defeated: false },
            { statusRolls: [0.999] }
        );
        assert.equal(defender2.statuses.length, 1);
        assert.equal(defender2.statuses[0].key, "burn");

        // Intermediate chance — deterministic via injected queue.
        const a3 = fighter({
            statusRules: [rule({ chance: 50 })]
        });
        const d3 = fighter();
        const evMiss = applyActionStatuses(
            a3, d3, { type: "normal", key: null },
            { success: true, hits: [{}], defeated: false },
            { statusRolls: [0.5] } // 50 is not < 50 → miss
        );
        assert.equal(evMiss[0].type, "missed");
        assert.equal(d3.statuses.length, 0);

        console.log("PASS: 0% never, 100% always, injected RNG exact");
    }

    // --- zero damage applies; reflected/miss/defeated don't ---------------

    {
        const attacker = fighter({ statusRules: [rule()] });
        const defender = fighter();

        // Successful hit with damage 0 → still applies.
        applyActionStatuses(
            attacker, defender, { type: "normal", key: null },
            {
                success: true, outcome: "hit",
                hits: [{ damage: 0 }], defeated: false
            },
            { statusRolls: [0.1] }
        );
        assert.equal(defender.statuses.length, 1);
        console.log("PASS: zero-damage hit still applies status");

        // Reflected → the defender's reflect is not the attacker's
        // action — no application.
        const d2 = fighter();
        const ev = applyActionStatuses(
            attacker, d2, { type: "normal", key: null },
            {
                success: true, outcome: "reflected",
                hits: [], defeated: false
            },
            { statusRolls: [0.1] }
        );
        assert.equal(d2.statuses.length, 0);
        assert.equal(ev.length, 0);

        // Failed action → nothing.
        const d3 = fighter();
        applyActionStatuses(
            attacker, d3, { type: "normal", key: null },
            { success: false },
            { statusRolls: [0.1] }
        );
        assert.equal(d3.statuses.length, 0);
        console.log(
            "PASS: reflected + failed actions apply no statuses"
        );

        // Defeated target gains no status.
        const d4 = fighter();
        applyActionStatuses(
            attacker, d4, { type: "normal", key: null },
            {
                success: true, outcome: "hit",
                hits: [{ damage: 50 }], defeated: true
            },
            { statusRolls: [0.1] }
        );
        assert.equal(d4.statuses.length, 0);
        console.log("PASS: defeated target gains no statuses");
    }

    // --- per_hit vs per_action on a double attack ---------------------------

    {
        const hits = [{ damage: 10 }, { damage: 8 }];
        const result = {
            success: true, outcome: "double_attack",
            hits, defeated: false
        };

        // per_action: one application despite two hits.
        const a1 = fighter({
            statusRules: [rule({ timing: "per_action" })]
        });
        const d1 = fighter();
        const ev1 = applyActionStatuses(
            a1, d1, { type: "normal", key: null }, result,
            { statusRolls: [0.1] }
        );
        assert.equal(d1.statuses.length, 1);
        assert.equal(
            ev1.filter(e => e.type === "applied").length, 1
        );

        // per_hit: each hit rolls independently — first can miss,
        // second can land, each consuming its own statusRoll.
        const a2 = fighter({
            statusRules: [
                rule({
                    timing: "per_hit", chance: 50,
                    reapply_policy: "stack_intensity", max_stacks: 5
                })
            ]
        });
        const d2 = fighter();
        applyActionStatuses(
            a2, d2, { type: "normal", key: null }, result,
            { statusRolls: [0.9, 0.1] } // hit0 misses, hit1 lands
        );
        assert.equal(d2.statuses.length, 1);
        assert.equal(d2.statuses[0].stacks, 1);

        // per_hit, both succeed → two applications → stacks 2.
        const d3 = fighter();
        const ev3 = applyActionStatuses(
            a2, d3, { type: "normal", key: null }, result,
            { statusRolls: [0.1, 0.1] }
        );
        assert.equal(d3.statuses[0].stacks, 2);
        assert.equal(
            ev3.map(e => e.type).join(","), "applied,stacked"
        );

        // KO on hit 1 of a double → hits array has 1 entry →
        // killing hit grants no status.
        const d4 = fighter();
        applyActionStatuses(
            a2, d4, { type: "normal", key: null },
            {
                success: true, outcome: "double_attack",
                hits: [{ damage: 999 }], defeated: true
            },
            { statusRolls: [0.1] }
        );
        assert.equal(d4.statuses.length, 0);

        console.log(
            "PASS: per_hit/per_action on double attack + KO guard"
        );
    }

    // --- conditions ---------------------------------------------------------

    {
        const rules = [
            rule({
                conditions: { target_hp_at_or_below_pct: 50 }
            })
        ];
        const attacker = fighter({ statusRules: rules });
        const healthy = fighter({ hp: 80, maxHp: 100 });
        const hurt = fighter({ hp: 40, maxHp: 100 });

        applyActionStatuses(
            attacker, healthy, { type: "normal", key: null },
            { success: true, hits: [{}], defeated: false },
            { statusRolls: [0.1] }
        );
        assert.equal(healthy.statuses.length, 0);

        applyActionStatuses(
            attacker, hurt, { type: "normal", key: null },
            { success: true, hits: [{}], defeated: false },
            { statusRolls: [0.1] }
        );
        assert.equal(hurt.statuses.length, 1);
        console.log("PASS: condition gates application");
    }

    // --- snapshot semantics ---------------------------------------------------

    {
        const ruleRow = rule({ power: 4 });
        const attacker = fighter({ statusRules: [ruleRow] });
        const defender = fighter();

        applyActionStatuses(
            attacker, defender, { type: "normal", key: null },
            { success: true, hits: [{}], defeated: false },
            { statusRolls: [0.1] }
        );

        // "Admin edits mid-battle" → rule row mutates; the live
        // instance keeps the snapshot values.
        ruleRow.power = 99;
        ruleRow.name = "Mutated";
        assert.equal(defender.statuses[0].power, 4);
        assert.equal(defender.statuses[0].name, "Burn");
        console.log("PASS: instances snapshot the definition");
    }

    // --- effective stats ------------------------------------------------------

    {
        const f = fighter({ atk: 20, def: 5 });
        f.statuses.push({
            key: "atk_down", name: "ATK Down",
            statusId: 5, behavior: "modify_atk",
            power: -5, isPercent: false,
            stacks: 2, maxStacks: 3,
            policy: "stack_intensity", remainingTurns: 2,
            sourceName: "S"
        });

        assert.equal(effectiveStat(f, "atk"), 10);
        assert.equal(f.atk, 20, "base stat unchanged");

        const view = effView(f);
        assert.equal(view.atk, 10);
        assert.equal(view.def, 5);
        assert.equal(view.hp, 100);
        view.hp = 42; // writes pass through the proxy
        assert.equal(f.hp, 42);

        // Percent modifier: floor(20 * -50% ) * 1 = -10
        const f2 = fighter({ atk: 21 });
        f2.statuses.push({
            key: "atk_pct", name: "Hex", statusId: 6,
            behavior: "modify_atk", power: -50, isPercent: true,
            stacks: 1, maxStacks: 1, policy: "refresh_duration",
            remainingTurns: 1, sourceName: "S"
        });
        assert.equal(effectiveStat(f2, "atk"), 11);

        console.log(
            "PASS: effective-stat view modifies without mutating base"
        );
    }

    // --- turn-start lifecycle -------------------------------------------------

    {
        const battle = { characters: [] };
        const f = fighter({ hp: 50 });

        f.statuses.push({
            key: "burn", name: "Burn", statusId: 1,
            behavior: "periodic_damage", power: 4,
            isPercent: false, stacks: 1, maxStacks: 1,
            policy: "refresh_duration", remainingTurns: 2,
            sourceName: "S"
        });
        f.statuses.push({
            key: "stun", name: "Stun", statusId: 4,
            behavior: "skip_turn", power: 0, isPercent: false,
            stacks: 1, maxStacks: 1, policy: "ignore_if_active",
            remainingTurns: 1, sourceName: "S"
        });

        const first = processTurnStart(battle, f);
        assert.equal(f.hp, 46, "burn ticked 4");
        assert(first.skipped, "stun consumed the turn");
        assert.equal(f.statuses.length, 1, "stun expired");
        assert.equal(
            f.statuses[0].remainingTurns, 1, "burn decremented"
        );
        assert.equal(
            first.events.map(e => e.type).join(","),
            "tick,skipped,expired"
        );

        const second = processTurnStart(battle, f);
        assert(!second.skipped);
        assert.equal(f.hp, 42);
        assert.equal(f.statuses.length, 0, "burn expired at 0");
        assert(!second.ko);
        console.log(
            "PASS: turn-start tick → skip → decrement → expire"
        );

        // Status damage can KO.
        const dead = fighter({ hp: 3 });
        dead.statuses.push({
            key: "burn", name: "Burn", statusId: 1,
            behavior: "periodic_damage", power: 5,
            isPercent: false, stacks: 1, maxStacks: 1,
            policy: "refresh_duration", remainingTurns: 1,
            sourceName: "S"
        });
        const ko = processTurnStart(battle, dead);
        assert.equal(dead.hp, 0);
        assert(ko.ko);
        console.log("PASS: status tick can knock out");

        // Status damage grants no attack rewards — hp only.
        const guarded = fighter({ hp: 50, cost: 0, ex: 0 });
        guarded.statuses.push({
            key: "poison", name: "Poison", statusId: 2,
            behavior: "periodic_damage", power: 3,
            isPercent: false, stacks: 2, maxStacks: 5,
            policy: "stack_intensity", remainingTurns: 1,
            sourceName: "S"
        });
        processTurnStart(battle, guarded);
        assert.equal(guarded.hp, 44);
        assert.equal(guarded.cost, 0, "no COST from status damage");
        assert.equal(guarded.ex, 0, "no EX gauge from status damage");
        console.log("PASS: status damage grants no COST or EX");

        // Cleansing.
        clearStatus(attached => attached, "burn");
        const cl = fighter();
        cl.statuses.push(
            { key: "burn", name: "Burn" },
            { key: "stun", name: "Stun" }
        );
        assert(clearStatus(cl, "burn"));
        assert.equal(cl.statuses.length, 1);
        assert(activeStatus(cl, "stun"));
        assert(!activeStatus(cl, "burn"));
        console.log("PASS: cleansing removes one status");
    }

    // --- full battle integration ----------------------------------------------

    {
        // 100% burn on normal attacks → applies at resolution,
        // ticks at the DEFENDER's turn start.
        const session = freshBattle(
            { statusRules: [rule()] },
            {}
        );
        const hero = session.battle.characters[0];
        const foe = session.battle.characters[1];

        const done = driver.attack(session, "u1", {
            attackerRolls: [15], defenderRolls: [10],
            damageRolls: [5]
        });

        assert.equal(done.result.damage, 20);
        assert.equal(
            done.result.statusEvents[0].type, "applied"
        );

        // The foe's turn start already ran inside the resolve —
        // the burn ticked once (4 dmg) and decremented to 2.
        assert.equal(foe.statuses.length, 1);
        assert.equal(foe.statuses[0].key, "burn");
        assert.equal(foe.statuses[0].remainingTurns, 2);
        assert.equal(foe.hp, 76); // 100 - 20 hit - 4 tick
        assert.equal(
            done.turnEvents.find(e => e.type === "tick")?.damage, 4
        );
        console.log(
            "PASS: status applies at resolution, ticks at the " +
            "owner's next turn start"
        );

        // Foe attacks back: 3+20-5 = 18 to hero. Its burn stays
        // at 2 remaining until its NEXT turn start.
        const back = driver.attack(session, "u2", {
            attackerRolls: [15], defenderRolls: [10],
            damageRolls: [3]
        });
        assert.equal(hero.hp, 100 - 18);
        assert.equal(foe.hp, 76);
        assert.equal(foe.statuses[0].remainingTurns, 2);
        assert(!back.turnEvents?.some(e => e.type === "tick"));
        console.log(
            "PASS: durations tick once per owner turn, not per action"
        );

        cleanup(session);
    }

    {
        // Stun skips the owner's entire turn — foe never acts.
        const session = freshBattle(
            {
                statusRules: [
                    rule({
                        status_id: 4, key: "stun", name: "Stun",
                        behavior: "skip_turn", power: 0,
                        default_duration: 1,
                        reapply_policy: "ignore_if_active"
                    })
                ]
            },
            {}
        );
        const foe = session.battle.characters[1];

        const applied = driver.attack(session, "u1", {
            attackerRolls: [15], defenderRolls: [10],
            damageRolls: [5]
        });
        // The stun applied, then the foe's turn start inside the
        // same resolve skipped the turn and expired it — observe
        // via the event trail instead of the (now empty) list.
        assert.equal(applied.result.statusEvents[0].key, "stun");
        assert(
            applied.turnEvents.some(e => e.type === "skipped"),
            "foe turn was skipped"
        );

        // Foe's turn start ran inside the resolve: the stun skipped
        // it, so the current turn belongs to Hero again — no foe
        // action, no roll sequence.
        assert.equal(
            session.battle.currentTurn.character.name, "Hero"
        );
        assert.equal(foe.statuses.length, 0, "stun expired");
        // COST: +1 from damage taken, +1 at the (skipped) turn start.
        assert.equal(foe.cost, 2, "skipped turn still ticked COST");
        assert.equal(heroHp(session), 100, "foe never attacked");
        console.log(
            "PASS: stun skips the turn, bookkeeping preserved"
        );
        cleanup(session);
    }

    {
        // Status KO finalizes the battle idempotently.
        const session = freshBattle(
            { statusRules: [rule({ power: 50 })] },
            { hp: 40 }
        );
        const foe = session.battle.characters[1];

        const done = driver.attack(session, "u1", {
            attackerRolls: [15], defenderRolls: [10],
            damageRolls: [1]
        });
        // Hit: 1+20-5=16 → foe at 24, burn applied. Foe's turn
        // start ticks 50 → KO → battle finished by startTurn.
        assert(done.finished);
        assert.equal(session.battle.status, "finished");
        assert.equal(foe.hp, 0);
        assert.equal(done.winner, "Hero");
        assert(!session.pending);
        console.log("PASS: status KO ends the battle at turn start");
    }

    {
        // ATK Down reduces actual damage via the effective-stat
        // view without touching base stats.
        const session = freshBattle(
            {},
            {
                // Foe has a rule that applies ATK Down to... itself?
                // Rules apply attacker→defender, so give HERO the
                // debuff by giving FOE the rule and letting foe
                // attack on its turn.
                statusRules: [
                    rule({
                        status_id: 5, key: "atk_down",
                        name: "ATK Down", behavior: "modify_atk",
                        power: -10, reapply_policy: "refresh_duration"
                    })
                ]
            }
        );
        const hero = session.battle.characters[0];
        const foe = session.battle.characters[1];

        // Hero attacks first (initiative), then foe applies debuff.
        driver.attack(session, "u1", {
            attackerRolls: [15], defenderRolls: [10],
            damageRolls: [1]
        });
        driver.attack(session, "u2", {
            attackerRolls: [15], defenderRolls: [10],
            damageRolls: [1]
        });
        assert.equal(hero.statuses[0].key, "atk_down");
        assert.equal(hero.atk, 20, "base ATK untouched");

        // Hero's next attack uses effective ATK 10:
        // roll 5 + 10 - 5 = 10 (was 20).
        const done = driver.attack(session, "u1", {
            attackerRolls: [15], defenderRolls: [10],
            damageRolls: [5]
        });
        assert.equal(done.result.damage, 10);
        assert.equal(hero.atk, 20);
        console.log(
            "PASS: ATK Down reduces damage via effective stats"
        );
        cleanup(session);
    }

    {
        // Deterministic statusRolls ride the pending action — the
        // queue is consumed only by status checks, never dice.
        const session = freshBattle(
            { statusRules: [rule({ chance: 50 })] },
            {}
        );
        const foe = session.battle.characters[1];

        bs.attack(session, "u1");
        bs.recordRoll(session, "u1", 15);
        bs.recordRoll(session, "u2", 10);
        // Inject a failing status roll before the damage die.
        session.pending.statusRolls.push(0.9);
        const done = bs.recordRoll(session, "u1", 5);

        assert(done.resolved);
        assert.equal(foe.statuses.length, 0);
        assert.equal(done.result.statusEvents[0].type, "missed");
        assert.equal(done.result.damage, 20, "damage unchanged");
        console.log(
            "PASS: injected statusRolls drive chance, dice untouched"
        );
        cleanup(session);
    }

    {
        // No rules configured → identical combat, no status work.
        const session = freshBattle();
        const done = driver.attack(session, "u1", {
            attackerRolls: [15], defenderRolls: [10],
            damageRolls: [5]
        });
        assert.equal(done.result.damage, 20);
        assert.deepEqual(done.result.statusEvents, []);
        assert.equal(
            session.battle.characters[1].statuses.length, 0
        );
        console.log("PASS: no rules → zero behavior change");
        cleanup(session);
    }

    {
        // Skill-scoped rule only fires on that skill, not attacks.
        const session = freshBattle(
            {
                cost: 6,
                skills: ["power_strike"],
                statusRules: [
                    rule({
                        id: 7, scope: "skill",
                        action_key: "power_strike"
                    })
                ]
            },
            {}
        );
        const foe = session.battle.characters[1];

        // Normal attack — skill rule must not leak.
        driver.attack(session, "u1", {
            attackerRolls: [15], defenderRolls: [10],
            damageRolls: [5]
        });
        assert.equal(foe.statuses.length, 0);

        driver.attack(session, "u2", {
            attackerRolls: [10], defenderRolls: [5],
            damageRolls: [1]
        });

        const done = driver.useSkill(
            session, "u1", "power_strike", {
                attackerRolls: [15], defenderRolls: [10],
                damageRolls: [5]
            }
        );
        assert.equal(foe.statuses.length, 1);
        assert.equal(done.result.skillKey, "power_strike");
        console.log("PASS: skill-scoped rule fires only on the skill");
        cleanup(session);
    }

    {
        // EX-scoped rule on fang_barrage: per_hit across 3 hits.
        const session = freshBattle(
            {
                cost: 6, ex: 100, exKey: "fang_barrage",
                statusRules: [
                    rule({
                        id: 9, scope: "ex",
                        action_key: "fang_barrage",
                        timing: "per_hit", chance: 50,
                        status_id: 2, key: "poison", name: "Poison",
                        reapply_policy: "stack_intensity",
                        max_stacks: 5
                    })
                ]
            },
            { hp: 500, maxHp: 500 }
        );
        const foe = session.battle.characters[1];

        bs.useEx(session, "u1");
        bs.recordRoll(session, "u1", 15);
        bs.recordRoll(session, "u2", 10);
        // statusRolls consumed per hit at resolution — after the
        // contest; fail hit 1, land hits 2+3.
        session.pending.statusRolls.push(0.9, 0.1, 0.1);
        bs.recordRoll(session, "u1", 5);
        bs.recordRoll(session, "u1", 5);
        const done = bs.recordRoll(session, "u1", 5);

        assert(done.resolved);
        assert.equal(done.result.hits.length, 3);
        assert.equal(foe.statuses[0].stacks, 2);
        console.log(
            "PASS: EX multi-hit applies per_hit with separate rolls"
        );
        cleanup(session);
    }

    {
        // EX multi-hit KO mid-sequence → no statuses, no extra hits.
        const session = freshBattle(
            {
                cost: 6, ex: 100, exKey: "fang_barrage",
                statusRules: [
                    rule({
                        id: 9, scope: "ex",
                        action_key: "fang_barrage",
                        timing: "per_hit"
                    })
                ]
            },
            { hp: 10 }
        );
        const foe = session.battle.characters[1];

        bs.useEx(session, "u1");
        bs.recordRoll(session, "u1", 15);
        bs.recordRoll(session, "u2", 10);
        const done = bs.recordRoll(session, "u1", 5);

        assert(done.resolved && done.finished);
        assert.equal(done.result.hits.length, 1);
        assert.equal(foe.statuses.length, 0);
        console.log("PASS: EX KO stops hits and applies no statuses");
    }
}

function heroHp(session) {
    return session.battle.characters[0].hp;
}

try {
    run();
    console.log("=== Status Effect Tests — ALL PASS ===");
} catch (err) {
    console.error("FAIL:", err);
    process.exit(1);
}
