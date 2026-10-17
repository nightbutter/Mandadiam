// Deterministic driver for the manual-roll state machine. Feeds the
// same injected roll arrays the old auto-resolve tests used straight
// into battleService.recordRoll — every die is still a distinct,
// authorized "click"; nothing is rolled automatically.
const bs = require("../../src/game/services/battleService");

// Roll every die the current pending action asks for. `options`
// takes the engine's old injection shape:
//   { attackerRolls, defenderRolls, damageRolls, reflectRolls }
// or the initiative shape { firstRolls, secondRolls }.
// Empty queues fall back to real server-side randomness.
function drive(session, options = {}) {
    const q = {
        a: [...(options.attackerRolls ?? options.firstRolls ?? [])],
        d: [...(options.defenderRolls ?? options.secondRolls ?? [])],
        dmg: [...(options.damageRolls ?? [])],
        ref: [...(options.reflectRolls ?? [])]
    };

    let last = null;

    for (let guard = 0; session.pending && guard < 200; guard++) {
        const exp = bs.expectedRoll(session);

        if (!exp) {
            throw new Error("pending action has no expected roll");
        }

        let value;

        if (exp.die === 20) {
            value = exp.discordId === session.pending.attackerId
                ? q.a.shift()
                : q.d.shift();
        } else if (exp.kind === "reflect") {
            value = q.ref.shift();
        } else {
            value = q.dmg.shift();
        }

        last = bs.recordRoll(session, exp.discordId, value ?? null);

        if (!last.ok) {
            throw new Error(`roll rejected: ${last.error}`);
        }
    }

    if (session.pending) {
        throw new Error("roll driver guard exhausted");
    }

    return last;
}

function act(started, session, options) {
    if (!started || !started.ok) {
        return started;
    }

    return drive(session, options);
}

// Old-style startBattle — resolves the manual initiative with the
// given firstRolls/secondRolls and re-exposes firstTurn.
function start(channelId, playerOne, playerTwo, options = {}) {
    const started = bs.startBattle(channelId, playerOne, playerTwo);

    if (!started.ok) {
        return started;
    }

    const resolved = drive(started.session, options);

    return {
        ...started,
        firstTurn: resolved.firstTurn,
        initiative: resolved.initiative
    };
}

// Old-style action calls — start the pending action, then drive it.
function attack(session, discordId, options) {
    return act(bs.attack(session, discordId), session, options);
}

function useSkill(session, discordId, skillKey, options) {
    return act(bs.useSkill(session, discordId, skillKey), session, options);
}

function useEx(session, discordId, options) {
    return act(bs.useEx(session, discordId), session, options);
}

module.exports = { drive, start, attack, useSkill, useEx };
