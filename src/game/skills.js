// Central skill catalog — definitions are the single source of truth
// for names, COST, and usage conditions. Damage resolution always goes
// through the existing combat engine (type: "skill" → d8 + ATK + SPE
// − DEF); nothing here reimplements formulas.
//
// Conditions compare integer HP without floating-point percentages:
//   target <= 50%  →  target.hp * 2 <= target.maxHp
//   user   <= 40%  →  actor.hp * 5  <= actor.maxHp * 2

// Cooldown counts the fighter's OWN subsequent turns: a skill used
// on turn N is blocked on the owner's next `cooldown` turns and
// becomes ready when the counter reaches zero at that fighter's
// turn start (decremented in startTurn, engine-side).
const SKILLS = {
    power_strike: {
        key: "power_strike",
        name: "Power Strike",
        cost: 3,
        cooldown: 2,
        type: "attack",
        description: "A heavy blow — no condition.",
        canUse() {
            return { ok: true };
        }
    },
    piercing_strike: {
        key: "piercing_strike",
        name: "Piercing Strike",
        cost: 2,
        cooldown: 3,
        type: "attack",
        description: "Target must be at 50% HP or lower.",
        canUse(actor, target) {
            return target.hp * 2 <= target.maxHp
                ? { ok: true }
                : {
                      ok: false,
                      reason: "Target HP is above 50%."
                  };
        }
    },
    desperation_burst: {
        key: "desperation_burst",
        name: "Desperation Burst",
        cost: 2,
        cooldown: 3,
        type: "attack",
        description: "Usable only at 40% HP or lower.",
        canUse(actor) {
            return actor.hp * 5 <= actor.maxHp * 2
                ? { ok: true }
                : {
                      ok: false,
                      reason: "Your HP is above 40%."
                  };
        }
    }
};

// The initial loadout every character is provisioned with. Every
// character owns its own persisted character_skills rows — the set is
// identical for now (catalog has three entries); unique loadouts need
// a bigger catalog + selection UI later.
const INITIAL_LOADOUT = Object.keys(SKILLS);

function getSkill(skillKey) {
    return SKILLS[skillKey] ?? null;
}

module.exports = { SKILLS, INITIAL_LOADOUT, getSkill };
