const { createBattle, startTurn, performAction, endTurn } = require("../battle");

// Tracks active battles per Discord channel. HP and COST are transient
// battle state, so sessions live in memory only — nothing is persisted.
const battlesByChannel = new Map();

// Maps a characters-table row to the shape the combat engine expects:
// base stats only — hp starts full, cost starts empty. Transient
// battle state is never persisted back to the row.
function toBattleCharacter(character) {
    return {
        name: character.name,
        hp: character.max_hp,
        atk: character.atk,
        def: character.def,
        spe: character.spe,
        cost: 0
    };
}

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
    toBattleCharacter,
    startTurn,
    performAction,
    endTurn
};
