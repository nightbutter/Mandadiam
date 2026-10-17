// Pending portrait-upload sessions, keyed by Discord user id.
//
// When a player clicks "Set Character Image" we bind the session to
// THEIR user id and a SPECIFIC character id — the messageCreate
// handler only accepts an image message from that same user, so
// another user can never submit into someone else's session.
// In-memory; sessions expire quickly and are lost on restart, which
// only means the user must click the button again.
const pending = new Map(); // userId -> { characterId, expiresAt, timer }

const TTL_MS = 90 * 1000;

function start(userId, characterId, onExpire, ttlMs = TTL_MS) {
    cancel(userId);

    const session = { characterId, expiresAt: Date.now() + ttlMs };

    if (typeof onExpire === "function") {
        session.timer = setTimeout(() => {
            if (pending.get(userId) === session) {
                pending.delete(userId);
                onExpire();
            }
        }, Math.max(0, ttlMs));
        session.timer.unref?.();
    }

    pending.set(userId, session);
    return session;
}

// Returns the live session or null (absent/expired).
function get(userId) {
    const session = pending.get(userId);

    if (!session) {
        return null;
    }

    if (Date.now() >= session.expiresAt) {
        cancel(userId);
        return null;
    }

    return session;
}

function cancel(userId) {
    const session = pending.get(userId);

    if (session?.timer) {
        clearTimeout(session.timer);
    }

    return pending.delete(userId);
}

module.exports = { start, get, cancel, TTL_MS };
