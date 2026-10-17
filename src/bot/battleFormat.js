// Shared rendering for battle commands — plain markdown, consistent
// with the project's existing command replies.
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require("discord.js");

const MAX_LOG_LINES = 6;

function pushLog(session, line) {
    session.log.push(line);

    if (session.log.length > MAX_LOG_LINES) {
        session.log.shift();
    }
}

function hpBar(current, max) {
    const width = 10;
    const filled = Math.round(
        (Math.max(0, current) / Math.max(1, max)) * width
    );
    return "▰".repeat(filled) + "▱".repeat(width - filled);
}

function costPips(cost) {
    return "●".repeat(cost) + "○".repeat(Math.max(0, 6 - cost));
}

function characterField(session, character) {
    return {
        name:
            `${character.name} — ` +
            mentionOwner(session, character),
        value:
            `${hpBar(character.hp, character.maxHp)} ` +
            `**${character.hp}/${character.maxHp}**\n` +
            `COST ${costPips(character.cost)} ${character.cost}/6\n` +
            `ATK ${character.atk} · DEF ${character.def} · ` +
            `SPE ${character.spe}`,
        inline: true
    };
}

// The persistent battle panel embed. `report` is the latest action's
// formatted text; the rolling log is always appended.
function buildBattleEmbed(session, report = null) {
    const { battle } = session;
    const [a, b] = battle.characters;

    const embed = new EmbedBuilder()
        .setTitle(`⚔️ ${a.name} vs ${b.name}`)
        .setColor(
            battle.status === "finished" ? 0x95a5a6 : 0xe74c3c
        )
        .addFields(
            characterField(session, a),
            characterField(session, b)
        );

    const turnPlayer = session.players.find(
        p => p.character === battle.currentTurn?.character
    );

    embed.addFields({
        name: "Turn",
        value: battle.status === "finished"
            ? `Finished — winner: **${battle.winner ?? "none"}**`
            : `#${battle.turnNumber} — <@${turnPlayer.discordId}> ` +
                "to act",
        inline: true
    });

    const description = [
        report,
        session.log.length ? session.log.join("\n") : null
    ].filter(Boolean).join("\n\n");

    if (description) {
        embed.setDescription(description.slice(0, 4000));
    }

    embed.setFooter({
        text: "In-memory battle — state is lost on bot restart"
    });

    return embed;
}

function buildBattleRow(session) {
    const finished = session.battle.status === "finished";

    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("battle:attack")
            .setLabel("Attack")
            .setEmoji("⚔️")
            .setStyle(ButtonStyle.Primary)
            .setDisabled(finished),
        new ButtonBuilder()
            .setCustomId("battle:refresh")
            .setLabel("Refresh")
            .setEmoji("🔄")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(finished),
        new ButtonBuilder()
            .setCustomId("battle:forfeit")
            .setLabel("Forfeit")
            .setEmoji("🏳️")
            .setStyle(ButtonStyle.Danger)
            .setDisabled(finished)
    );
}

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
    formatAttackReport,
    pushLog,
    buildBattleEmbed,
    buildBattleRow
};
