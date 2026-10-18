/**
 * EX gauge — per-battle-character ultimate meter.
 *
 * Range 0–100, starts at 0, in-memory only (transient battle state,
 * never persisted). Gains are applied at the single authoritative
 * event path — inside resolveAttack/resolveExAttack where the actual
 * outcomes are confirmed — mirroring how COST hooks live inside the
 * same functions. Nothing outside the engine may award EX, so an
 * outcome can never be counted twice.
 *
 * Semantics:
 *   successful attack action (hit or double_attack) → +20 once per action
 *   reflected outcome → +0 action EX (the attack did not land)
 *   actual damage received  → +10 per damage instance with damage > 0
 *   zero damage / rejected action / activation attempt → +0
 *
 * Characters without an `ex` field (direct engine calls outside a
 * battle session) are ignored — gains only apply to battle-shaped
 * characters created through createBattle/toBattleCharacter.
 */

const { getExSkill } = require("./exSkills");

const EX_MAX = 100;
const EX_ATTACK_GAIN = 20;
const EX_DAMAGE_TAKEN_GAIN = 10;

function addEx(character, amount) {
    if (character.ex == null || !Number.isInteger(amount) || amount < 0) {
        return 0;
    }

    const before = character.ex;
    character.ex = Math.min(EX_MAX, Math.max(0, character.ex + amount));

    return character.ex - before;
}

// Successful attack action — called once per resolved action, never
// per hit, so a double attack still grants exactly +20.
function onAttackActionEx(character) {
    return addEx(character, EX_ATTACK_GAIN);
}

// Called once per actual damage instance; zero damage grants nothing.
function onDamageTakenEx(character, damage) {
    if (!Number.isFinite(damage) || damage <= 0) {
        return 0;
    }

    return addEx(character, EX_DAMAGE_TAKEN_GAIN);
}

// Consumed on EX activation. Returns false without mutating unless the
// gauge is exactly full.
function consumeEx(character) {
    if (character.ex !== EX_MAX) {
        return false;
    }

    character.ex = 0;
    return true;
}

// Read-only Ultimate eligibility — the single source of truth used by
// both battleService.useEx (server-side gate) and every UI readiness
// display, so the two can never disagree. Error codes match useEx's
// historical gate order exactly.
function exReadiness(attacker, defender) {
    if (!attacker || attacker.hp <= 0) {
        return {
            ok: false, error: "invalid_actor",
            reason: "your character can't act"
        };
    }
    if (!attacker.exKey) {
        return {
            ok: false, error: "no_ex_assigned",
            reason: "no Ultimate assigned"
        };
    }
    const exDef = getExSkill(attacker.exKey);
    if (!exDef) {
        return {
            ok: false, error: "unknown_ex",
            reason: "unknown Ultimate"
        };
    }
    if (attacker.ex !== EX_MAX) {
        return {
            ok: false, error: "ex_not_ready",
            reason: `EX ${attacker.ex ?? 0}/${EX_MAX} — not full`
        };
    }
    if (!defender || defender.hp <= 0) {
        return {
            ok: false, error: "invalid_target",
            reason: "no valid target"
        };
    }
    if (attacker.cost < exDef.cost) {
        return {
            ok: false, error: "insufficient_cost",
            reason: `needs ${exDef.cost} COST (have ${attacker.cost})`
        };
    }
    return { ok: true, exDef };
}

module.exports = {
    EX_MAX,
    EX_ATTACK_GAIN,
    EX_DAMAGE_TAKEN_GAIN,
    addEx,
    onAttackActionEx,
    onDamageTakenEx,
    consumeEx,
    exReadiness
};
