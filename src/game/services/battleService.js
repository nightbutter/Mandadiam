const { createBattle, startTurn, performAction, performExAction, endTurn } = require("../battle");
const { determineTurnOrder } = require("../combat");
const manualRolls = require("../manualRolls");
const { getSkill } = require("../skills");
const { getExSkill } = require("../exSkills");
const { EX_MAX } = require("../exGauge");

// In-memory PvP battle sessions and challenges, keyed by Discord channel.
// HP and COST are transient battle state, so sessions live in memory
// only — nothing is persisted. All state is lost on process restart.
const battlesByChannel = new Map();
const pendingChallenges = new Map();

const CHALLENGE_TTL_MS = 60_000;

// Maps a characters-table row to the shape the combat engine expects:
// base stats only — hp starts full, cost starts empty. Transient
// battle state is never persisted back to the row.
function toBattleCharacter(character, skills = [], exKey = null, statusRules = []) {
    return {
        name: character.name,
        hp: character.max_hp,
        maxHp: character.max_hp,
        atk: character.atk,
        def: character.def,
        spe: character.spe,
        cost: 0,
        imageUrl: character.image_url ?? null,
        skills,
        // Transient ultimate state — in-memory only, never persisted.
        ex: 0,
        exKey,
        // Per-skill cooldowns — in-memory, scoped to this battle.
        cooldowns: {},
        // Status config snapshot: resolved rules loaded at battle
        // start (edits during a battle don't reach live fighters).
        statusRules,
        statuses: []
    };
}

function challengeExpired(challenge) {
    return Date.now() >= challenge.expiresAt;
}

// True while the user is a challenger/opponent on a live challenge or a
// participant in an active battle — one pending/active battle at a time.
function isPlayerBusy(discordId) {
    for (const challenge of pendingChallenges.values()) {
        if (!challengeExpired(challenge) &&
            (challenge.challengerId === discordId ||
                challenge.opponentId === discordId)) {
            return true;
        }
    }

    for (const session of battlesByChannel.values()) {
        if (session.players.some(p => p.discordId === discordId)) {
            return true;
        }
    }

    return false;
}

function issueChallenge({ channelId, challengerId, opponentId, ttlMs = CHALLENGE_TTL_MS }) {
    if (challengerId === opponentId) {
        return { ok: false, error: "self_challenge" };
    }

    if (isPlayerBusy(challengerId)) {
        return { ok: false, error: "challenger_busy" };
    }

    if (isPlayerBusy(opponentId)) {
        return { ok: false, error: "opponent_busy" };
    }

    if (battlesByChannel.has(channelId)) {
        return { ok: false, error: "channel_busy" };
    }

    const existing = pendingChallenges.get(channelId);

    if (existing && !challengeExpired(existing)) {
        return { ok: false, error: "channel_busy" };
    }

    const challenge = {
        channelId,
        challengerId,
        opponentId,
        expiresAt: Date.now() + ttlMs
    };

    pendingChallenges.set(channelId, challenge);

    return { ok: true, challenge };
}

// Only the intended opponent may accept; consuming the challenge is
// atomic because command handling is synchronous.
function acceptChallenge({ channelId, userId }) {
    const challenge = pendingChallenges.get(channelId);

    if (!challenge) {
        return { ok: false, error: "no_challenge" };
    }

    if (challengeExpired(challenge)) {
        pendingChallenges.delete(channelId);
        return { ok: false, error: "expired" };
    }

    if (challenge.opponentId !== userId) {
        return { ok: false, error: "not_opponent" };
    }

    pendingChallenges.delete(channelId);

    return { ok: true, challenge };
}

function getPendingChallenge(channelId) {
    const challenge = pendingChallenges.get(channelId);
    return challenge && !challengeExpired(challenge) ? challenge : null;
}

function getPendingChallengeForPlayer(discordId) {
    for (const challenge of pendingChallenges.values()) {
        if (!challengeExpired(challenge) &&
            (challenge.challengerId === discordId ||
                challenge.opponentId === discordId)) {
            return challenge;
        }
    }

    return null;
}

// Removes a challenge only when it has actually expired — used by the
// challenge-message timeout to disable stale buttons.
function expireChallenge(channelId) {
    const challenge = pendingChallenges.get(channelId);

    if (!challenge || !challengeExpired(challenge)) {
        return false;
    }

    pendingChallenges.delete(channelId);
    return true;
}

// Cancels a live challenge — the challenger withdraws, the opponent
// declines. Either removes the pending entry.
function cancelChallenge(channelId, userId) {
    const challenge = pendingChallenges.get(channelId);

    if (!challenge || challengeExpired(challenge)) {
        return { ok: false, error: "no_challenge" };
    }

    if (challenge.challengerId !== userId &&
        challenge.opponentId !== userId) {
        return { ok: false, error: "not_participant" };
    }

    pendingChallenges.delete(channelId);

    return {
        ok: true,
        role: challenge.challengerId === userId
            ? "challenger"
            : "opponent"
    };
}

// playerOne/playerTwo: { discordId, character } where character is the
// combat-shaped object from toBattleCharacter.
//
// Initiative is a MANUAL roll now — the engine never rolls dice on a
// player's behalf. The battle starts with a pending "initiative"
// action; both players click their d20, then resolvePending installs
// the real turn order and starts the first turn.
function startBattle(channelId, playerOne, playerTwo, options = {}) {
    if (battlesByChannel.has(channelId)) {
        return { ok: false, error: "channel_busy" };
    }

    const battle = createBattle(
        playerOne.character,
        playerTwo.character,
        { ...options, deferInitiative: true }
    );

    const session = {
        channelId,
        battle,
        players: [playerOne, playerTwo],
        // Discord layer attaches panelMessageId and appends short lines
        // to log for the battle panel; the engine ignores both.
        log: [],
        pending: null
    };

    battlesByChannel.set(channelId, session);

    session.pending = manualRolls.createPending({
        type: "initiative",
        attacker: playerOne.character,
        defender: playerTwo.character,
        attackerId: playerOne.discordId,
        defenderId: playerTwo.discordId
    });

    return { ok: true, session };
}

function getSession(channelId) {
    return battlesByChannel.get(channelId) ?? null;
}

function getSessionForPlayer(discordId) {
    for (const session of battlesByChannel.values()) {
        if (session.players.some(p => p.discordId === discordId)) {
            return session;
        }
    }

    return null;
}

// The Discord user whose turn it currently is, or null.
function currentTurnPlayer(session) {
    const character = session.battle.currentTurn?.character;
    return session.players.find(p => p.character === character) ?? null;
}

function opponentOf(session, discordId) {
    return session.players.find(p => p.discordId !== discordId) ?? null;
}

// Shared action gate — identical order/meaning for every action
// type. A pending roll sequence locks the battle: nothing else can
// start until it resolves or the battle ends.
function gateAction(session, discordId) {
    if (session.battle.status !== "active") {
        return { ok: false, error: "finished" };
    }

    if (!session.players.some(p => p.discordId === discordId)) {
        return { ok: false, error: "not_participant" };
    }

    if (session.pending) {
        return {
            ok: false,
            error: "action_in_progress",
            expected: manualRolls.expectedRoll(session.pending)
        };
    }

    if (currentTurnPlayer(session)?.discordId !== discordId) {
        return { ok: false, error: "not_your_turn" };
    }

    return null;
}

function createActionPending(session, actor, action) {
    const opponent = opponentOf(session, actor.discordId);

    session.pending = manualRolls.createPending({
        ...action,
        attacker: session.battle.currentTurn.character,
        defender: session.battle.characters.find(
            c => c !== session.battle.currentTurn.character
        ),
        attackerId: actor.discordId,
        defenderId: opponent?.discordId ?? null
    });

    return {
        ok: true,
        pending: true,
        expected: manualRolls.describeRoll(session.pending)
    };
}

// Normal attack — validates, then waits for the manual d20/d8
// sequence. Nothing mutates until the rolls resolve through
// performAction, exactly as before.
function attack(session, discordId, options = {}) {
    const gate = gateAction(session, discordId);

    if (gate) {
        return gate;
    }

    return createActionPending(
        session,
        { discordId },
        { type: "normal" }
    );
}

// Skill attack — same gates as before plus catalog/ownership/target/
// cooldown/condition checks, all before the pending action exists.
// COST is still spent inside performAction at resolution; the
// cooldown arms only after a successful resolve + endTurn.
function useSkill(session, discordId, skillKey, options = {}) {
    const gate = gateAction(session, discordId);

    if (gate) {
        return gate;
    }

    const { battle } = session;
    const skill = getSkill(skillKey);

    if (!skill) {
        return { ok: false, error: "unknown_skill" };
    }

    const attacker = battle.currentTurn?.character;

    if (!attacker || !attacker.skills?.includes(skillKey)) {
        return { ok: false, error: "skill_not_owned" };
    }

    const defender = battle.characters.find(c => c !== attacker);

    if (!defender || defender.hp <= 0) {
        return { ok: false, error: "invalid_target" };
    }

    // Cooldown gate — counter = remaining own turns until ready.
    // Rejected here (before COST/changes), so a cooling skill can
    // never be re-fired early and the counter is untouched.
    const cooling = attacker.cooldowns?.[skillKey] ?? 0;

    if (cooling > 0) {
        return {
            ok: false,
            error: "on_cooldown",
            remaining: cooling
        };
    }

    const condition = skill.canUse(attacker, defender);

    if (!condition.ok) {
        return {
            ok: false,
            error: "condition_failed",
            reason: condition.reason
        };
    }

    // COST is validated BEFORE dice collection starts — the engine
    // still performs the authoritative spend at resolution (COST
    // cannot change while a roll is pending, so this pre-check is
    // exact, not a reservation).
    if (attacker.cost < skill.cost) {
        return { ok: false, error: "insufficient_cost" };
    }

    return createActionPending(
        session,
        { discordId },
        { type: "skill", skill }
    );
}

// EX/Ultimate activation — all the same gates as before; gauge and
// COST are only consumed inside performExAction at resolution.
function useEx(session, discordId, options = {}) {
    const gate = gateAction(session, discordId);

    if (gate) {
        return gate;
    }

    const { battle } = session;
    const attacker = battle.currentTurn?.character;

    if (!attacker || attacker.hp <= 0) {
        return { ok: false, error: "invalid_actor" };
    }

    if (!attacker.exKey) {
        return { ok: false, error: "no_ex_assigned" };
    }

    const exDef = getExSkill(attacker.exKey);

    if (!exDef) {
        return { ok: false, error: "unknown_ex" };
    }

    if (attacker.ex !== EX_MAX) {
        return { ok: false, error: "ex_not_ready" };
    }

    const defender = battle.characters.find(c => c !== attacker);

    if (!defender || defender.hp <= 0) {
        return { ok: false, error: "invalid_target" };
    }

    // Same pre-dice COST validation as skills — the authoritative
    // spend still happens inside performExAction at resolution.
    if (attacker.cost < exDef.cost) {
        return { ok: false, error: "insufficient_cost" };
    }

    return createActionPending(
        session,
        { discordId },
        { type: "ex", exDef }
    );
}

// What the current pending action expects — drives the roll button.
function expectedRoll(session) {
    return session.pending
        ? manualRolls.describeRoll(session.pending)
        : null;
}

// A player clicked a roll button. Server-side die, one per click,
// resolved exactly once through the same engine paths as before.
// `roll` is a test-only hook — the Discord path never passes it, so
// a client can never pick its own result.
function recordRoll(session, discordId, roll = null) {
    const pending = session.pending;

    if (!pending) {
        return { ok: false, error: "no_pending" };
    }

    const recorded = manualRolls.recordRoll(pending, discordId, roll);

    if (!recorded.ok) {
        return { ok: false, error: recorded.error, expected: recorded.expected };
    }

    if (!recorded.complete) {
        return {
            ok: true,
            rolled: recorded,
            pending: true,
            expected: recorded.expected
        };
    }

    return { ok: true, rolled: recorded, ...resolvePending(session) };
}

// The collected dice replay through the engine's existing injected-
// roll options — identical results to the old automatic path.
function resolvePending(session) {
    const pending = session.pending;
    const { battle } = session;

    session.pending = null;

    if (pending.type === "initiative") {
        const [playerOne, playerTwo] = session.players;
        const initiative = determineTurnOrder(
            playerOne.character,
            playerTwo.character,
            {
                firstRolls: pending.attackerRolls,
                secondRolls: pending.defenderRolls
            }
        );

        battle.initiative = initiative;
        battle.orderedCharacters = initiative.order.map(name =>
            battle.characters.find(c => c.name === name)
        );
        battle.turnIndex = 0;

        const firstTurn = startTurn(battle);

        return {
            resolved: true,
            type: "initiative",
            initiative,
            firstTurn,
            turnEvents: firstTurn.statusEvents ?? []
        };
    }

    const result = pending.type === "ex"
        ? performExAction(
            battle, pending.exDef, manualRolls.rollOptions(pending)
        )
        : performAction(
            battle,
            pending.type === "skill"
                ? {
                    type: "skill",
                    cost: pending.skill.cost,
                    // status rules resolve by action key
                    key: pending.skill.key
                }
                : { type: "normal" },
            manualRolls.rollOptions(pending)
        );

    if (!result.success) {
        const error =
            result.message === "COST ไม่เพียงพอ"
                ? "insufficient_cost"
                : "action_failed";

        return { resolved: true, failed: true, error, result };
    }

    if (pending.type === "skill") {
        result.skillKey = pending.skill.key;
        result.skillName = pending.skill.name;
    }

    if (pending.type === "ex") {
        result.exKey = pending.exDef.key;
        result.exName = pending.exDef.name;
    }

    if (battle.status === "finished") {
        battlesByChannel.delete(session.channelId);
        return {
            resolved: true,
            result,
            finished: true,
            winner: battle.winner
        };
    }

    endTurn(battle);

    // Cooldown arms only after the action resolved AND this turn
    // ended — the end-of-turn tick above must not consume the turn
    // the skill was used on.
    if (pending.type === "skill") {
        (pending.attacker.cooldowns ??= {})[pending.skill.key] =
            pending.skill.cooldown ?? 0;
    }

    const next = startTurn(battle);

    if (!next.success) {
        battlesByChannel.delete(session.channelId);
        return {
            resolved: true,
            result,
            finished: true,
            winner: battle.winner ?? null,
            // Status ticks at the next turn start can KO — the same
            // finalization path as combat damage.
            turnEvents: next.statusEvents ?? []
        };
    }

    return {
        resolved: true,
        result,
        finished: false,
        next,
        turnEvents: next.statusEvents ?? []
    };
}

function forfeit(session, discordId) {
    const loser = session.players.find(p => p.discordId === discordId);

    if (!loser) {
        return { ok: false, error: "not_participant" };
    }

    const winner = opponentOf(session, discordId);

    // A terminal path cancels any outstanding roll sequence — stale
    // roll buttons then hit the dead-session rejection.
    if (session.pending) {
        session.pending.status = "cancelled";
    }

    session.battle.status = "finished";
    session.battle.winner = winner.character.name;
    battlesByChannel.delete(session.channelId);

    return { ok: true, winner, loser };
}

module.exports = {
    CHALLENGE_TTL_MS,
    toBattleCharacter,
    isPlayerBusy,
    issueChallenge,
    acceptChallenge,
    expireChallenge,
    cancelChallenge,
    getPendingChallenge,
    getPendingChallengeForPlayer,
    startBattle,
    getSession,
    getSessionForPlayer,
    currentTurnPlayer,
    opponentOf,
    attack,
    useSkill,
    useEx,
    expectedRoll,
    recordRoll,
    forfeit
};
