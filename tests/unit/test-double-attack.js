const assert = require("node:assert/strict");

console.log("=== Double Attack / Double Skill Formula Tests ===");

const { resolveAttack } = require("../../src/game/combat");
const bs = require("../../src/game/services/battleService");
const driver = require("../helpers/rollDriver");

const ALL = ["power_strike", "piercing_strike", "desperation_burst"];
let channelSeq = 0;

function player(id, name, stats = {}) {
    return {
        discordId: id,
        character: {
            name,
            hp: stats.hp ?? 200,
            maxHp: stats.maxHp ?? 200,
            atk: stats.atk ?? 20,
            def: stats.def ?? 5,
            spe: stats.spe ?? 7,
            cost: stats.cost ?? 0,
            skills: stats.skills ?? [...ALL],
            ex: stats.ex ?? 0,
            exKey: stats.exKey
        }
    };
}

// Attack component = d8 + ATK (+ SPE for skills); crit doubles it;
// hit 2 halves it via Math.round; DEF subtracted once per hit.
function fighter(overrides = {}) {
    return {
        name: overrides.name ?? "Noctis",
        hp: overrides.hp ?? 200,
        atk: overrides.atk ?? 20,
        def: overrides.def ?? 5,
        spe: overrides.spe ?? 7,
        statuses: []
    };
}

function doubleAttackResult(type, damageRolls, stats = {}) {
    const player = fighter({ name: "P", ...stats.attacker });
    const enemy = fighter({ name: "E", ...stats.defender });

    return resolveAttack(player, enemy, {
        type,
        attackerRolls: [20],
        defenderRolls: [10],
        damageRolls
    });
}

// ---------- Approved formula branches — ATK 20, SPE 7, DEF 5 ----------

{
    // Hit 1 normal: max(0, d8 + ATK - DEF) — NOT forcibly doubled.
    const r = doubleAttackResult("normal", [5, 4]);
    assert.equal(r.hits[0].damage, 20); // 5+20-5
    assert.equal(r.hits[0].critical, false);
    console.log("PASS: DA hit 1 normal — ordinary formula, no forced double");
}

{
    // Hit 1 critical: max(0, (8 + ATK) * 2 - DEF).
    const r = doubleAttackResult("normal", [8, 4]);
    assert.equal(r.hits[0].damage, 51); // (8+20)*2-5
    assert.equal(r.hits[0].critical, true);
    console.log("PASS: DA hit 1 critical — d8=8 doubles attack component");
}

{
    // Hit 2 normal: max(0, Math.round((d8 + ATK) / 2) - DEF).
    const r = doubleAttackResult("normal", [5, 4]);
    assert.equal(r.hits[1].damage, 7); // round(24/2)-5 = 12-5
    assert.equal(r.hits[1].critical, false);
    console.log("PASS: DA hit 2 normal — halved attack component");
}

{
    // Approved reference case — hit 2 with d8 = 5:
    // max(0, Math.round((5 + 20) / 2) - 5) = 13 - 5 = 8.
    const r = doubleAttackResult("normal", [1, 5]);
    assert.equal(r.hits[1].damage, 8); // round(25/2)-5
    console.log("PASS: DA hit 2 normal — reference d8=5 case");
}

{
    // Hit 2 critical: max(0, Math.round(((8 + ATK) * 2) / 2) - DEF).
    const r = doubleAttackResult("normal", [5, 8]);
    assert.equal(r.hits[1].damage, 23); // round(56/2)-5 = 28-5
    assert.equal(r.hits[1].critical, true);
    console.log("PASS: DA hit 2 critical — doubled then halved");
}

{
    // Skill hit 1 normal: max(0, d8 + ATK + SPE - DEF).
    const r = doubleAttackResult("skill", [5, 4]);
    assert.equal(r.hits[0].damage, 27); // 5+20+7-5
    console.log("PASS: DS hit 1 normal — includes SPE");
}

{
    // Skill hit 1 critical: max(0, (8 + ATK + SPE) * 2 - DEF).
    const r = doubleAttackResult("skill", [8, 4]);
    assert.equal(r.hits[0].damage, 65); // (8+27)*2-5
    assert.equal(r.hits[0].critical, true);
    console.log("PASS: DS hit 1 critical — SPE in doubled component");
}

{
    // Skill hit 2 normal: max(0, Math.round((d8 + ATK + SPE) / 2) - DEF).
    const r = doubleAttackResult("skill", [5, 4]);
    assert.equal(r.hits[1].damage, 11); // round(32/2)-5 = 16-5
    console.log("PASS: DS hit 2 normal — SPE in halved component");
}

{
    // Skill hit 2 critical: max(0, Math.round(((8 + ATK + SPE) * 2) / 2) - DEF).
    const r = doubleAttackResult("skill", [5, 8]);
    assert.equal(r.hits[1].damage, 30); // round(70/2)-5 = 35-5
    assert.equal(r.hits[1].critical, true);
    console.log("PASS: DS hit 2 critical — doubled+halved with SPE");
}

// ---------- Rounding, clamp, DEF-once ----------

{
    // Odd attack component on hit 2: 3+20 = 23 → round(11.5) = 12.
    const r = doubleAttackResult("normal", [5, 3]);
    assert.equal(r.hits[1].damage, 7); // 12-5
    // Even component: 4+20 = 24 → 12 exactly.
    const r2 = doubleAttackResult("normal", [5, 4]);
    assert.equal(r2.hits[1].damage, 7);
    console.log("PASS: hit 2 Math.round — odd and even components");
}

{
    // DEF once per hit, clamped at zero: hit2 = round(12) - 15 < 0 → 0.
    const r = doubleAttackResult("normal", [5, 4], {
        defender: { def: 15 }
    });
    assert.equal(r.hits[0].damage, 10); // 5+20-15
    assert.equal(r.hits[1].damage, 0); // max(0, 12-15)
    console.log("PASS: DEF subtracted once per hit, damage clamps at 0");
}

// ---------- KO ordering ----------

{
    // Hit 1 KO stops hit 2 — enemy hp 20, hit1 deals exactly 20.
    const r = doubleAttackResult("normal", [5, 4], {
        defender: { hp: 20 }
    });
    assert.equal(r.hits.length, 1);
    assert.equal(r.defeated, true);
    console.log("PASS: hit 1 knockout prevents hit 2 resolution");
}

{
    // Hit 2 KO resolves correctly — enemy survives hit1 only.
    const r = doubleAttackResult("normal", [5, 4], {
        defender: { hp: 25 }
    });
    assert.equal(r.hits.length, 2);
    assert.equal(r.hits[1].damage, 7);
    assert.equal(r.defeated, true);
    console.log("PASS: hit 2 knockout handled correctly");
}

// ---------- Single attacks unaffected ----------

{
    const enemy = fighter({ name: "E" });
    const r = resolveAttack(fighter({ name: "P" }), enemy, {
        attackerRolls: [15],
        defenderRolls: [10],
        damageRolls: [5]
    });
    assert.equal(r.outcome, "hit");
    assert.equal(r.hits.length, 1);
    assert.equal(r.hits[0].damage, 20); // unchanged full formula
    console.log("PASS: single normal attack formula unchanged");
}

// ---------- Manual dice: roll mapping, preview parity, exactly-once ----------

{
    const chan = `da_${++channelSeq}`;
    const { session } = driver.start(
        chan,
        player("u1", "Hero"),
        player("u2", "Foe", { hp: 200, maxHp: 200 }),
        { firstRolls: [18], secondRolls: [5] }
    );

    bs.attack(session, "u1");
    bs.recordRoll(session, "u1", 20);
    bs.recordRoll(session, "u2", 10);

    // Preview after hit 1 must equal resolved damage (same helper).
    bs.recordRoll(session, "u1", 5);
    assert.equal(session.pending.projectedDefenderHp, 180); // 200-20
    const done = bs.recordRoll(session, "u1", 4);

    assert(done.resolved);
    assert.equal(done.result.hits[0].damage, 20); // d8 #1 → hit 1
    assert.equal(done.result.hits[1].damage, 7); // d8 #2 → hit 2
    assert.equal(
        session.battle.characters[1].hp,
        180 - 7 // preview matched resolution for both hits
    );

    // Exactly-once: no pending left; a stray click is rejected.
    assert(!session.pending);
    const stray = bs.recordRoll(session, "u1");
    assert.equal(stray.ok, false);
    assert.equal(stray.error, "no_pending");

    bs.forfeit(session, "u1");
    console.log("PASS: manual rolls — correct d8 per hit, preview == resolved");
}

{
    // Double skill through the service path (cost + cooldown intact).
    const chan = `da_${++channelSeq}`;
    const { session } = driver.start(
        chan,
        player("u1", "Hero", { cost: 5 }),
        player("u2", "Foe", { hp: 200, maxHp: 200 }),
        { firstRolls: [18], secondRolls: [5] }
    );

    const done = driver.useSkill(session, "u1", "power_strike", {
        attackerRolls: [20],
        defenderRolls: [10],
        damageRolls: [8, 5]
    });

    assert.equal(done.result.outcome, "double_attack");
    assert.equal(done.result.hits[0].damage, 65); // (8+27)*2-5 crit
    assert.equal(done.result.hits[1].damage, 11); // round(32/2)-5
    assert.equal(done.result.skillCost, 3);
    assert.equal(session.battle.characters[0].cooldowns.power_strike, 2);

    bs.forfeit(session, "u1");
    console.log("PASS: double skill via service — COST/cooldown intact");
}

// ---------- Rewards + effective stats unchanged ----------

{
    // Halved hit 2 dealing 0 grants no damage-taken COST/EX for it.
    const chan = `da_${++channelSeq}`;
    const { session } = driver.start(
        chan,
        player("u1", "Hero"),
        player("u2", "Foe", { hp: 200, maxHp: 200, def: 15 }),
        { firstRolls: [18], secondRolls: [5] }
    );

    const done = driver.attack(session, "u1", {
        attackerRolls: [20],
        defenderRolls: [10],
        damageRolls: [5, 4]
    });

    assert.equal(done.result.hits[0].damage, 10); // 5+20-15
    assert.equal(done.result.hits[1].damage, 0); // 12-15 < 0
    // Defender: +1 COST and +10 EX from hit 1 only (hit 2 dealt 0).
    assert.equal(done.result.defenderCost, 1); // one positive instance
    assert.equal(session.battle.characters[1].ex, 10);
    // Attacker: +1 hit COST once per action, +20 action EX.
    assert.equal(done.result.attackerCost, 2); // turn +1, hit +1
    assert.equal(session.battle.characters[0].ex, 20);

    bs.forfeit(session, "u1");
    console.log("PASS: zero-damage hit 2 grants no rewards — rules intact");
}

{
    // Effective DEF flows into the halved formula via effView.
    const chan = `da_${++channelSeq}`;
    const { session } = driver.start(
        chan,
        player("u1", "Hero"),
        player("u2", "Foe", { hp: 200, maxHp: 200 }),
        { firstRolls: [18], secondRolls: [5] }
    );

    session.battle.characters[1].statuses.push({
        key: "def_down", name: "DEF Down", statusId: 1,
        behavior: "modify_def", power: -5, isPercent: false,
        stacks: 1, maxStacks: 3, policy: "stack_intensity",
        remainingTurns: 5, sourceName: "test"
    });

    const done = driver.attack(session, "u1", {
        attackerRolls: [20],
        defenderRolls: [10],
        damageRolls: [5, 4]
    });

    assert.equal(session.battle.characters[1].def, 5); // base untouched
    assert.equal(done.result.hits[0].damage, 25); // 5+20-0
    assert.equal(done.result.hits[1].damage, 12); // round(24/2)-0

    bs.forfeit(session, "u1");
    console.log("PASS: effective stats (def_down) apply inside halved hit");
}

console.log("\nAll double-attack formula tests passed.");
