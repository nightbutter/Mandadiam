const { SlashCommandBuilder } = require("discord.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("battle-attack")
        .setDescription("Make a normal attack on your turn"),
    async execute(interaction) {
        const battleService = require("../../game/services/battleService");
        const {
            formatAttackReport,
            mentionOwner,
            pushLog
        } = require("../battleFormat");
        const { updateBattlePanel } = require("../battlePanel");

        const session = battleService.getSessionForPlayer(
            interaction.user.id
        );

        if (!session) {
            await interaction.reply({
                content: "You're not in an active battle.",
                ephemeral: true
            });
            return;
        }

        const outcome = battleService.attack(
            session, interaction.user.id
        );

        if (!outcome.ok) {
            const messages = {
                finished: "That battle is already finished.",
                not_participant: "You're not a participant in this battle.",
                not_your_turn: "It's not your turn yet.",
                action_failed:
                    outcome.result?.message ?? "That action failed."
            };

            await interaction.reply({
                content: messages[outcome.error],
                ephemeral: true
            });
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
            const winnerChar = session.battle.characters.find(
                c => c.name === outcome.winner
            );

            pushLog(
                session,
                `🏆 **${outcome.winner ?? "Nobody"}** ` +
                `${winnerChar ? mentionOwner(session, winnerChar) : ""} ` +
                "wins!"
            );

            await interaction.reply(
                `${report}\n\n🏆 **${outcome.winner ?? "Nobody"}** ` +
                `${winnerChar ? mentionOwner(session, winnerChar) : ""} ` +
                "wins the battle!"
            );
        } else {
            const nextPlayer = session.players.find(
                p => p.character.name === outcome.next.character
            );

            await interaction.reply(
                `${report}\nNext: <@${nextPlayer.discordId}>'s turn — ` +
                "/battle-attack or the Attack button"
            );
        }

        // Keep the persistent panel in sync if one exists — the
        // battle may live in a different channel than this command.
        const panelChannel = session.channelId === interaction.channelId
            ? interaction.channel
            : await interaction.client.channels
                .fetch(session.channelId)
                .catch(() => null);

        if (panelChannel) {
            await updateBattlePanel(panelChannel, session, report);
        }
    }
};
