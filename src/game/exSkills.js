// EX Skill (Ultimate) catalog — character-specific ultimates.
// Definitions are the single source of truth for name, COST,
// multiplier and effect. Resolution lives in exCombat.js; nothing
// here or in the Discord layer reimplements combat formulas.
//
// Damage model (all EX):
//   per hit: max(0, floor((d8 + ATK + SPE) * crit * multNum/multDen)
//                 - effectiveDef)
//   crit:   d8 === 8 doubles (d8 + ATK + SPE) before the multiplier —
//           the multiplier applies once, DEF is deducted once per hit.
//   The d20 contest is identical to normal attacks: defender 20
//   reflects (existing reflect formula), attacker 20 doubles the
//   action's hit sequence. Multi-hit uses ONE contest for the whole
//   action, then N independent d8 damage rolls.
//
// Multipliers are integer fractions (multNum/multDen) so damage is
// exact integer math — floor() is the explicit rounding rule.
//
// Effect types:
//   heavy          — plain high multiplier, no special behavior
//   pierce_defense — ignores piercePercent% of target DEF for this EX
//                    (floor rounding: effDef = def - floor(def*pct/100))
//   multi_hit      — hits separate damage instances (DEF per instance,
//                    damage-received COST/EX per instance, hit-COST
//                    bonus still once per action)
//   desperation    — adds bonusNum/bonusDen to the multiplier when the
//                    actor's HP is at/below hpPercent% of max
//                    (integer compare: hp*100 <= maxHp*percent)

const EX_SKILLS = {
    oblivion_edge: {
        key: "oblivion_edge",
        name: "Oblivion Edge",
        cost: 4,
        multNum: 5,
        multDen: 2,
        effect: { type: "heavy" },
        description:
            "A massive single strike — raw 2.5x damage, no condition."
    },
    void_piercer: {
        key: "void_piercer",
        name: "Void Piercer",
        cost: 4,
        multNum: 2,
        multDen: 1,
        effect: { type: "pierce_defense", piercePercent: 50 },
        description:
            "2x damage that ignores half of the target's DEF."
    },
    fang_barrage: {
        key: "fang_barrage",
        name: "Fang Barrage",
        cost: 4,
        multNum: 1,
        multDen: 1,
        effect: { type: "multi_hit", hits: 3 },
        description:
            "Three separate 1x hits — brutal vs low DEF, " +
            "blunted vs high DEF."
    },
    last_light: {
        key: "last_light",
        name: "Last Light",
        cost: 4,
        multNum: 3,
        multDen: 2,
        effect: {
            type: "desperation",
            hpPercent: 40,
            bonusNum: 3,
            bonusDen: 2
        },
        description:
            "1.5x damage — rises to 3x while at 40% HP or lower."
    }
};

// Deterministic default assignment order — character_ex rows are
// provisioned as EX_KEYS[character_id % length] (same formula in the
// SQL backfill), so keep this array order stable.
const EX_KEYS = Object.keys(EX_SKILLS);
const DEFAULT_EX_COST = 4;

function getExSkill(key) {
    return EX_SKILLS[key] ?? null;
}

module.exports = { EX_SKILLS, EX_KEYS, DEFAULT_EX_COST, getExSkill };
