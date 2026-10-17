// Shared rendering for battle commands — plain markdown, consistent
// with the project's existing command replies.

function ownerOf(session, character) {
    return session.players.find(p => p.character === character) ?? null;
}

function mentionOwner(session, character) {
    const owner = ownerOf(session, character);
    return owner ? `<@${owner.discordId}>` : character.name;
}

function statLine(session, character) {
    return (
        `**${character.name}** ${mentionOwner(session, character)} — ` +
        `HP ${character.hp}/${character.maxHp} · COST ${character.cost} · ` +
        `ATK ${character.atk} DEF ${character.def} SPE ${character.spe}`
    );
}

function formatStatus(session) {
    const { battle } = session;
    const lines = ["**Battle status**\n"];

    for (const character of battle.characters) {
        lines.push(statLine(session, character));
    }

    const turnPlayer = session.players.find(
        p => p.character === battle.currentTurn?.character
    );

    lines.push(
        turnPlayer
            ? `Turn ${battle.turnNumber}: <@${turnPlayer.discordId}> to act`
            : `Battle is ${battle.status}`
    );

    return lines.join("\n");
}

function formatHits(result) {
    return result.hits
        .map(hit =>
            `🎲 d8 ${hit.roll}` +
            (hit.critical ? " **CRIT**" : "") +
            ` → ${hit.damage} damage`
        )
        .join("\n");
}

// Human-readable report for one resolved attack.
function formatAttackReport(session, result) {
    const attacker = session.players.find(
        p => p.character.name === result.attacker
    );
    const defender = session.players.find(
        p => p.character.name === result.defender
    );

    const lines = [];

    if (result.outcome === "reflected") {
        lines.push(
            `⚔️ <@${attacker.discordId}> attacks — but ` +
            `${result.defender} rolls d20 **20** and reflects it!`,
            `🎲 d8 ${result.reflectRoll} → ${result.damage} damage back`,
            `${result.attacker}: HP ${result.remainingHp}/${attacker.character.maxHp}`
        );
    } else {
        const title = result.outcome === "double_attack"
            ? `⚔️ <@${attacker.discordId}> attacks — d20 **20**, double attack!`
            : `⚔️ <@${attacker.discordId}> attacks`;

        lines.push(
            title,
            `d20: ${result.attackerRoll} vs ${result.defenderRoll}` +
                (result.rerolls ? ` (ties rerolled x${result.rerolls})` : ""),
            formatHits(result),
            `${result.defender}: HP ${result.remainingHp}/` +
                `${defender.character.maxHp}`
        );
    }

    lines.push(
        `COST — ${result.attacker}: ${result.attackerCost} · ` +
        `${result.defender}: ${result.defenderCost}`
    );

    return lines.join("\n");
}

module.exports = {
    mentionOwner,
    statLine,
    formatStatus,
    formatAttackReport
};
