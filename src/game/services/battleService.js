const { createBattle, startTurn, performAction, endTurn } = require("../battle");

// Tracks active battles per Discord channel. HP and COST are transient
// battle state, so sessions live in memory only — nothing is persisted.
const battlesByChannel = new Map();

function startBattle(channelId, first, second, options = {}) {
    if (battlesByChannel.has(channelId)) {
        throw new Error("A battle is already active in this channel.");
    }

    const battle = createBattle(first, second, options);
    battlesByChannel.set(channelId, battle);

    return battle;
}

function getBattle(channelId) {
    return battlesByChannel.get(channelId) ?? null;
}

function endBattle(channelId) {
    return battlesByChannel.delete(channelId);
}

module.exports = {
    startBattle,
    getBattle,
    endBattle,
    startTurn,
    performAction,
    endTurn
};
