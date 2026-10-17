const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require("discord.js");
const { env } = require("../config/env");
const battleService = require("../game/services/battleService");
const {
    pushLog,
    buildBattleEmbed,
    buildBattleRow,
    formatAttackReport
} = require("./battleFormat");
const { sendBattlePanel, updateBattlePanel } = require("./battlePanel");

// Dispatches MessageComponent button interactions. Every handler
// re-validates state server-side — customIds are never trusted.

const STALE_MESSAGE =
    "This battle or challenge is no longer active.";

async function safeReply(interaction, content) {
    await interaction.reply({ content, ephemeral: true });
}

async function handleChallengeAccept(interaction) {
    const accepted = battleService.acceptChallenge({
        channelId: interaction.channelId,
        userId: interaction.user.id
    });

    if (!accepted.ok) {
        const messages = {
            no_challenge: STALE_MESSAGE,
            expired: "That challenge has expired.",
            not_opponent: "This challenge wasn't issued to you."
        };

        await safeReply(
            interaction, messages[accepted.error] ?? STALE_MESSAGE
        );
        return;
    }

    if (!env.databaseUrl) {
        await safeReply(interaction, "Database features are unavailable.");
        return;
    }

    const { getActiveBattleCharacter } =
        require("../services/characterService");
    const { challengerId, opponentId } = accepted.challenge;

    const first = await getActiveBattleCharacter(challengerId);
    const second = await getActiveBattleCharacter(opponentId);

    if (!first.ok || !second.ok) {
        await interaction.update({
            content:
                "Couldn't start — a player no longer has an active " +
                "character.",
            components: []
        });
        return;
    }

    const started = battleService.startBattle(
        interaction.channelId,
        { discordId: challengerId, character: first.character },
        { discordId: opponentId, character: second.character }
    );

    if (!started.ok) {
        await interaction.update({
            content: "Couldn't start — a battle is already running here.",
            components: []
        });
        return;
    }

    const { session, firstTurn } = started;
    const initiative = session.battle.initiative;

    await interaction.update({
        content:
            `⚔️ <@${opponentId}> accepted the challenge — ` +
            "battle started!",
        components: []
    });

    const nextPlayer = session.players.find(
        p => p.character.name === firstTurn.character
    );

    pushLog(
        session,
        `Initiative d20: ${initiative.firstRoll} vs ` +
        `${initiative.secondRoll} — **${firstTurn.character}** moves first`
    );

    await sendBattlePanel(
        interaction.channel, session,
        `🚩 **${firstTurn.character}** ` +
        `(<@${nextPlayer.discordId}>) to act — press Attack!`
    );
}

async function handleChallengeDecline(interaction) {
    // Validate the role BEFORE consuming — a challenger clicking
    // decline must not delete their own pending challenge.
    const pending = battleService.getPendingChallenge(
        interaction.channelId
    );

    if (!pending) {
        await safeReply(interaction, STALE_MESSAGE);
        return;
    }

    if (pending.opponentId !== interaction.user.id) {
        await safeReply(
            interaction,
            "Only the challenged player can decline — " +
            "use /battle-forfeit to withdraw your own challenge."
        );
        return;
    }

    battleService.cancelChallenge(
        interaction.channelId, interaction.user.id
    );

    await interaction.update({
        content: `❌ <@${interaction.user.id}> declined the challenge.`,
        components: []
    });
}

function battleCharacterByName(session, name) {
    return session.players.find(p => p.character.name === name) ?? null;
}

async function handleBattleAttack(interaction) {
    const session = battleService.getSession(interaction.channelId);

    if (!session) {
        await safeReply(interaction, STALE_MESSAGE);
        return;
    }

    const outcome = battleService.attack(session, interaction.user.id);

    if (!outcome.ok) {
        const messages = {
            finished: "That battle is already finished.",
            not_participant: "Only battle participants can attack.",
            not_your_turn: "It's not your turn yet.",
            action_failed:
                outcome.result?.message ?? "That action failed."
        };

        await safeReply(interaction, messages[outcome.error]);
        return;
    }

    const report = formatAttackReport(session, outcome.result);

    pushLog(
        session,
        `⚔️ **${outcome.result.attacker}** → ` +
        `**${outcome.result.defender}**: ` +
        `${outcome.result.damage} dmg` +
        (outcome.result.outcome === "reflected" ? " (reflected)" : "") +
        (outcome.result.outcome === "double_attack" ? " (double)" : "")
    );

    if (outcome.finished) {
        const winner = battleCharacterByName(session, outcome.winner);
        pushLog(
            session,
            `🏆 **${outcome.winner ?? "Nobody"}** ` +
            `${winner ? `(<@${winner.discordId}>)` : ""} wins!`
        );
    }

    await interaction.update({
        embeds: [buildBattleEmbed(session, report)],
        components: outcome.finished ? [] : [buildBattleRow(session)]
    });
}

async function handleBattleRefresh(interaction) {
    const session = battleService.getSession(interaction.channelId);

    if (!session) {
        await safeReply(interaction, STALE_MESSAGE);
        return;
    }

    await interaction.update({
        embeds: [buildBattleEmbed(session)],
        components: [buildBattleRow(session)]
    });
}

// Step 1 — confirm prompt (ephemeral) so a stray click can't end
// a battle. The actual forfeit runs only on battle:forfeit:confirm.
async function handleBattleForfeit(interaction) {
    const session = battleService.getSession(interaction.channelId);

    if (!session) {
        await safeReply(interaction, STALE_MESSAGE);
        return;
    }

    if (
        !session.players.some(
            p => p.discordId === interaction.user.id
        )
    ) {
        await safeReply(
            interaction, "Only battle participants can forfeit."
        );
        return;
    }

    await interaction.reply({
        content: "🏳️ Forfeit this battle? The opponent wins.",
        ephemeral: true,
        components: [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("battle:forfeit:confirm")
                    .setLabel("Confirm Forfeit")
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId("battle:forfeit:cancel")
                    .setLabel("Cancel")
                    .setStyle(ButtonStyle.Secondary)
            )
        ]
    });
}

async function handleForfeitConfirm(interaction) {
    const session = battleService.getSession(interaction.channelId);

    if (!session) {
        await interaction.update({
            content: STALE_MESSAGE,
            components: []
        });
        return;
    }

    const result = battleService.forfeit(session, interaction.user.id);

    if (!result.ok) {
        await interaction.update({
            content: "Only battle participants can forfeit.",
            components: []
        });
        return;
    }

    pushLog(
        session,
        `🏳️ **${result.loser.character.name}** ` +
        `(<@${result.loser.discordId}>) forfeits — ` +
        `**${result.winner.character.name}** wins!`
    );

    // The public panel is a different message — edit it via the
    // channel, since this click targets the ephemeral confirm prompt.
    await updateBattlePanel(interaction.channel, session);

    await interaction.update({
        content:
            `🏳️ You forfeited — **${result.winner.character.name}** ` +
            `(<@${result.winner.discordId}>) wins.`,
        components: []
    });
}

async function handleForfeitCancel(interaction) {
    await interaction.update({
        content: "Forfeit cancelled — battle continues.",
        components: []
    });
}

const handlers = {
    "challenge:accept": handleChallengeAccept,
    "challenge:decline": handleChallengeDecline,
    "battle:attack": handleBattleAttack,
    "battle:refresh": handleBattleRefresh,
    "battle:forfeit": handleBattleForfeit,
    "battle:forfeit:confirm": handleForfeitConfirm,
    "battle:forfeit:cancel": handleForfeitCancel
};

async function handleButton(interaction) {
    if (interaction.customId.startsWith("menu:")) {
        const { handleMenuButton } = require("./menu");
        await handleMenuButton(interaction);
        return;
    }

    const handler = handlers[interaction.customId];

    if (!handler) {
        await safeReply(interaction, "Unknown action.");
        return;
    }

    await handler(interaction);
}

module.exports = { handleButton };
