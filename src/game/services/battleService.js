const { createBattle, startTurn, performAction, endTurn } = require("../battle");

// In-memory PvP battle sessions and challenges, keyed by Discord channel.
// HP and COST are transient battle state, so sessions live in memory
// only — nothing is persisted. All state is lost on process restart.
const battlesByChannel = new Map();
const pendingChallenges = new Map();

const CHALLENGE_TTL_MS = 60_000;

// Maps a characters-table row to the shape the combat engine expects:
// base stats only — hp starts full, cost starts empty. Transient
// battle state is never persisted back to the row.
function toBattleCharacter(character) {
    return {
        name: character.name,
        hp: character.max_hp,
        maxHp: character.max_hp,
        atk: character.atk,
        def: character.def,
        spe: character.spe,
        cost: 0,
        imageUrl: character.image_url ?? null
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
function startBattle(channelId, playerOne, playerTwo, options = {}) {
    if (battlesByChannel.has(channelId)) {
        return { ok: false, error: "channel_busy" };
    }

    const battle = createBattle(
        playerOne.character,
        playerTwo.character,
        options
    );

    const session = {
        channelId,
        battle,
        players: [playerOne, playerTwo],
        // Discord layer attaches panelMessageId and appends short lines
        // to log for the battle panel; the engine ignores both.
        log: []
    };

    battlesByChannel.set(channelId, session);

    const firstTurn = startTurn(battle);

    return { ok: true, session, firstTurn };
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

// Normal attack only. performAction is synchronous, so the turn check
// and the action can never interleave — a duplicate call sees
// actionTaken already set or a different current turn.
function attack(session, discordId, options = {}) {
    const { battle } = session;

    if (battle.status !== "active") {
        return { ok: false, error: "finished" };
    }

    if (!session.players.some(p => p.discordId === discordId)) {
        return { ok: false, error: "not_participant" };
    }

    if (currentTurnPlayer(session)?.discordId !== discordId) {
        return { ok: false, error: "not_your_turn" };
    }

    const result = performAction(battle, { type: "normal" }, options);

    if (!result.success) {
        return { ok: false, error: "action_failed", result };
    }

    if (battle.status === "finished") {
        battlesByChannel.delete(session.channelId);
        return { ok: true, result, finished: true, winner: battle.winner };
    }

    endTurn(battle);

    const next = startTurn(battle);

    if (!next.success) {
        battlesByChannel.delete(session.channelId);
        return {
            ok: true,
            result,
            finished: true,
            winner: battle.winner ?? null
        };
    }

    return { ok: true, result, finished: false, next };
}

function forfeit(session, discordId) {
    const loser = session.players.find(p => p.discordId === discordId);

    if (!loser) {
        return { ok: false, error: "not_participant" };
    }

    const winner = opponentOf(session, discordId);

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
    forfeit
};
