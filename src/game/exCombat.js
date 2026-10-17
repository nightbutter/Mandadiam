const { resolveContest, getRoll } = require("./combat");
const {
    onAttackHit,
    onAttackDamageTaken
} = require("./cost");
const { onDamageTakenEx } = require("./exGauge");

// EX (Ultimate) attack resolution — a separate path from resolveAttack
// that reuses the same d20 contest, reflect semantics, double-attack
// semantics, crit timing and the per-instance COST/EX hooks. It never
// alters the normal attack or skill formulas.
//
// Per-hit damage:
//   raw = d8 + ATK + SPE            (d8 === 8 → raw × 2, crit)
//   dmg = max(0, floor(raw * multNum / multDen) − effectiveDef)
//
// The EX action grants NO attack EX to the user — the gauge is
// consumed by the activation (see performExAction). The target still
// gains +10 per actual damage instance via onDamageTakenEx.

// Effective DEF after an optional pierce_defense effect — explicit
// floor rounding, never below 0.
function effectiveDef(defender, effect) {
    const def = defender.def ?? 0;

    if (effect.type === "pierce_defense") {
        const pierced = Math.floor(def * effect.piercePercent / 100);
        return Math.max(0, def - pierced);
    }

    return def;
}

// Effective multiplier as an integer fraction — the desperation
// effect adds its bonus when the actor's HP is at/below hpPercent%
// of max (integer comparison, no floating-point percentages).
function effectiveMultiplier(attacker, exDef) {
    const { multNum, multDen, effect } = exDef;

    if (effect.type !== "desperation") {
        return { num: multNum, den: multDen };
    }

    const desperate =
        attacker.hp * 100 <= attacker.maxHp * effect.hpPercent;

    if (!desperate) {
        return { num: multNum, den: multDen };
    }

    // num/den + bonusNum/bonusDen as a single exact fraction.
    return {
        num: multNum * effect.bonusDen + effect.bonusNum * multDen,
        den: multDen * effect.bonusDen
    };
}

// Per-hit EX damage — the exact math the resolveExAttack hits loop
// uses, extracted so the manual-roll system can preview a collected
// d8 without mutating state. EX crits double the raw roll+ATK+SPE
// before the multiplier (unlike normal double-attack suppression).
function exHit(attacker, roll, num, den, effDef) {
    const critical = roll === 8;

    let raw = roll + (attacker.atk ?? 0) + (attacker.spe ?? 0);
    if (critical) {
        raw *= 2;
    }

    return {
        roll,
        critical,
        damage: Math.max(0, Math.floor(raw * num / den) - effDef)
    };
}

// Read-only preview of one EX hit with a known die — identical math
// to exHit applied inside resolveExAttack.
function previewExHit(attacker, defender, exDef, roll) {
    const { num, den } = effectiveMultiplier(attacker, exDef);
    const effDef = effectiveDef(defender, exDef.effect);
    return exHit(attacker, roll, num, den, effDef);
}

function resolveExAttack(attacker, defender, exDef, options = {}) {
    if (attacker.hp <= 0) {
        return {
            success: false,
            message: `${attacker.name} ไม่สามารถโจมตีได้`
        };
    }

    if (defender.hp <= 0) {
        return {
            success: false,
            message: `${defender.name} พ่ายแพ้ไปแล้ว`
        };
    }

    const contest = resolveContest(options);

    // Defender wins the contest with d20 = 20: the EX is reflected
    // using the existing reflect formula (no EX multiplier) — the
    // attacker's gauge was already consumed by performExAction.
    if (contest.winner === "defender" && contest.defenderRoll === 20) {
        const reflectRoll = getRoll(8, options.reflectRolls, 0);
        const reflectDamage = Math.max(
            0,
            reflectRoll + (defender.def ?? 0) - (attacker.def ?? 0)
        );

        attacker.hp = Math.max(0, attacker.hp - reflectDamage);
        onAttackDamageTaken(attacker, reflectDamage);
        onDamageTakenEx(attacker, reflectDamage);

        return {
            success: true,
            outcome: "reflected",
            ...contest,
            attacker: attacker.name,
            defender: defender.name,
            reflectRoll,
            damage: reflectDamage,
            remainingHp: attacker.hp,
            defeated: attacker.hp === 0
        };
    }

    const { num, den } = effectiveMultiplier(attacker, exDef);
    const effDef = effectiveDef(defender, exDef.effect);
    const effect = exDef.effect;

    // One d20 contest for the whole action. Attacker 20 doubles the
    // hit sequence (existing double-attack semantics); a multi_hit
    // effect multiplies the base count.
    const doubleAttack = contest.attackerRoll === 20;
    const baseHits = effect.type === "multi_hit" ? effect.hits : 1;
    const hitCount = baseHits * (doubleAttack ? 2 : 1);

    const hits = [];
    let totalDamage = 0;

    for (let i = 0; i < hitCount; i++) {
        const roll = getRoll(8, options.damageRolls, i);
        const hit = exHit(attacker, roll, num, den, effDef);
        const damage = hit.damage;

        defender.hp = Math.max(0, defender.hp - damage);
        totalDamage += damage;
        hits.push({ roll, critical: hit.critical, damage: hit.damage });

        // Hit COST once per action (guarded by turnState); damage-
        // received COST and EX per actual damage instance.
        if (damage > 0) {
            onAttackHit(attacker, options.turnState ?? (
                options.turnState = { attackCostGranted: false }
            ));
        }

        onAttackDamageTaken(defender, damage);
        onDamageTakenEx(defender, damage);

        if (defender.hp <= 0) {
            break;
        }
    }

    return {
        success: true,
        outcome: doubleAttack ? "double_attack" : "hit",
        ...contest,
        attacker: attacker.name,
        defender: defender.name,
        hits,
        damage: totalDamage,
        remainingHp: defender.hp,
        defeated: defender.hp === 0
    };
}

module.exports = {
    resolveExAttack,
    previewExHit,
    effectiveDef,
    effectiveMultiplier
};
