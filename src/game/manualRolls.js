const { rollDice, calculateHitDamage } = require("./combat");
const { previewExHit } = require("./exCombat");

// Manual dice-roll state machine. A pending action records every die
// the players roll via Discord buttons; NOTHING mutates HP/COST/EX/
// turns until the sequence completes and battleService resolves it
// once through performAction/performExAction with the collected roll
// arrays injected (the same injection points the engine already
// supports — formulas are never duplicated here).
//
// Stages:
//   contest_attacker   — attacker owes a d20 (also used for tie
//                        rerolls and initiative's first roller)
//   contest_defender   — defender owes a d20
//   damage_attacker    — attacker owes a d8 (hit i of N)
//   reflect_defender   — defender owes the reflect d8
//   ready              — all dice collected, awaiting resolution
//
// Dice ownership follows engine semantics: the attacker rolls their
// contest die and all outgoing damage d8s; the defender rolls their
// contest die and the reflection die (they cause the reflect).

let nextActionId = 0;

function createPending({
    type,                    // "initiative" | "normal" | "skill" | "ex"
    attacker, defender,      // battle character objects
    attackerId, defenderId,  // Discord ids authorized to roll
    skill = null,            // catalog skill for type "skill"
    exDef = null             // EX definition for type "ex"
}) {
    return {
        id: `act_${(++nextActionId).toString(36)}_${Date.now().toString(36)}`,
        type,
        skill,
        exDef,
        attacker,
        defender,
        attackerId,
        defenderId,
        stage: "contest_attacker",
        attackerRolls: [],   // d20s in order (ties append pairs)
        defenderRolls: [],
        damageRolls: [],     // d8s for hits
        reflectRolls: [],    // the single reflect d8
        contest: null,
        hitCount: null,      // decided once the contest resolves
        doubleAttack: false,
        ties: 0,
        // Preview of accumulated damage for early-stop decisions —
        // a projection only; live hp is untouched until resolution.
        projectedDefenderHp: defender.hp,
        status: "pending"
    };
}

// What the UI must request next: who clicks and which die.
function expectedRoll(pending) {
    switch (pending.stage) {
        case "contest_attacker":
            return {
                discordId: pending.attackerId,
                die: 20,
                kind: pending.ties > 0 || pending.attackerRolls.length
                    ? "tie_reroll"
                    : "contest"
            };
        case "contest_defender":
            return {
                discordId: pending.defenderId,
                die: 20,
                kind: pending.ties > 0 || pending.defenderRolls.length
                    ? "tie_reroll"
                    : "contest"
            };
        case "reflect_defender":
            return {
                discordId: pending.defenderId,
                die: 8,
                kind: "reflect"
            };
        case "damage_attacker":
            return {
                discordId: pending.attackerId,
                die: 8,
                kind: "damage",
                hitIndex: pending.damageRolls.length,
                hitCount: pending.hitCount
            };
        default:
            return null;
    }
}

// Read-only preview of what a collected d8 will do — decides whether
// more dice are needed (a projected knockout ends the sequence early,
// exactly like the engine's own "stop applying hits at 0 HP" rule).
function previewHit(pending, roll) {
    const index = pending.damageRolls.length - 1; // just-pushed hit

    if (pending.type === "ex") {
        return previewExHit(
            pending.attacker, pending.defender, pending.exDef, roll
        );
    }

    return calculateHitDamage(
        pending.attacker,
        pending.defender,
        roll,
        pending.type === "skill" ? "skill" : "normal",
        pending.doubleAttack && index === 0
    );
}

// Contest decided → pick the next stage per the engine's rules:
// defender-20 reflect, otherwise hits (double on attacker 20).
function finishContest(pending, attackerRoll, defenderRoll) {
    pending.contest = {
        attackerRoll,
        defenderRoll,
        winner: attackerRoll > defenderRoll ? "attacker" : "defender",
        rerolls: pending.ties
    };

    if (pending.type === "initiative") {
        pending.status = "ready";
        return;
    }

    if (attackerRoll < defenderRoll && defenderRoll === 20) {
        pending.stage = "reflect_defender";
        return;
    }

    pending.doubleAttack = attackerRoll === 20;
    const baseHits =
        pending.type === "ex" && pending.exDef.effect.type === "multi_hit"
            ? pending.exDef.effect.hits
            : 1;
    pending.hitCount = baseHits * (pending.doubleAttack ? 2 : 1);
    pending.stage = "damage_attacker";
}

// Record one server-side roll. `roll` is an optional test hook — the
// Discord path always uses rollDice server-side.
function recordRoll(pending, discordId, roll = null) {
    const expected = expectedRoll(pending);

    if (!expected || pending.status !== "pending") {
        return { ok: false, error: "no_roll_expected" };
    }

    if (discordId !== expected.discordId) {
        return { ok: false, error: "wrong_roller", expected };
    }

    const value = roll ?? rollDice(expected.die);

    if (!Number.isInteger(value) || value < 1 || value > expected.die) {
        return { ok: false, error: "invalid_die" };
    }

    switch (pending.stage) {
        case "contest_attacker":
            pending.attackerRolls.push(value);
            pending.stage = "contest_defender";
            break;

        case "contest_defender": {
            pending.defenderRolls.push(value);
            const a = pending.attackerRolls[pending.attackerRolls.length - 1];

            if (a === value) {
                pending.ties += 1;
                pending.stage = "contest_attacker";
            } else {
                finishContest(pending, a, value);
            }
            break;
        }

        case "reflect_defender":
            pending.reflectRolls.push(value);
            pending.status = "ready";
            break;

        case "damage_attacker": {
            pending.damageRolls.push(value);
            const hit = previewHit(pending, value);
            pending.projectedDefenderHp -= hit.damage;

            if (
                pending.projectedDefenderHp <= 0 ||
                pending.damageRolls.length >= pending.hitCount
            ) {
                pending.status = "ready";
            }
            break;
        }
    }

    return {
        ok: true,
        die: expected.die,
        value,
        kind: expected.kind,
        complete: pending.status === "ready",
        expected: pending.status === "pending"
            ? expectedRoll(pending)
            : null
    };
}

// Roll arrays the resolvers replay — identical ordering to how the
// engine consumes options.attackerRolls/defenderRolls/etc.
function rollOptions(pending) {
    return {
        attackerRolls: pending.attackerRolls,
        defenderRolls: pending.defenderRolls,
        damageRolls: pending.damageRolls,
        reflectRolls: pending.reflectRolls
    };
}

// Human-readable stage label for panel + button text.
function describeRoll(pending) {
    const exp = expectedRoll(pending);

    if (!exp) {
        return null;
    }

    const who = `<@${exp.discordId}>`;

    switch (exp.kind) {
        case "tie_reroll":
            return { ...exp, text: `${who} — d20 tie reroll` };
        case "contest":
            return { ...exp, text: `${who} — d20 contest roll` };
        case "reflect":
            return { ...exp, text: `${who} — d8 reflection` };
        case "damage":
            return {
                ...exp,
                text:
                    `${who} — d8 damage ` +
                    `(hit ${exp.hitIndex + 1}/${exp.hitCount})`
            };
        default:
            return { ...exp, text: `${who} — d${exp.die}` };
    }
}

module.exports = {
    createPending,
    expectedRoll,
    recordRoll,
    rollOptions,
    describeRoll
};
