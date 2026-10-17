// Server-side ownership registry for ephemeral UI messages.
//
// Discord does not reliably attach originating-interaction metadata to
// every message a component can live on (replies to modal submits,
// follow-ups, restarts). Instead of trusting message.interaction,
// each dashboard-owned message id is bound here to the Discord user
// who opened it. In-memory only — entries are lost on restart, which
// turns the buttons into graceful "session expired" failures.
const sessions = new Map(); // messageId -> { ownerId, expiresAt }

const TTL_MS = 60 * 60 * 1000; // 1 hour

function prune() {
    const now = Date.now();

    for (const [id, session] of sessions) {
        if (session.expiresAt <= now) {
            sessions.delete(id);
        }
    }
}

// Records that `message` belongs to `userId`. Accepts a Message or an
// id string; ignores calls without an id (defensive).
function bind(message, ownerId) {
    const id = typeof message === "string" ? message : message?.id;

    if (!id || !ownerId) {
        return;
    }

    sessions.set(String(id), {
        ownerId,
        expiresAt: Date.now() + TTL_MS
    });
}

// Returns the registered owner id for a message, or null when the
// message has no live session (unknown, expired, or post-restart).
function ownerOf(messageId) {
    const session = sessions.get(String(messageId));

    if (!session) {
        return null;
    }

    if (session.expiresAt <= Date.now()) {
        sessions.delete(String(messageId));
        return null;
    }

    return session.ownerId;
}

// Test/maintenance helpers.
function release(messageId) {
    sessions.delete(String(messageId));
}

module.exports = { bind, ownerOf, release, TTL_MS, prune };
