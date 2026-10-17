const { SlashCommandBuilder } = require("discord.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("battle-forfeit")
        .setDescription("Forfeit your active battle or withdraw a challenge"),
    async execute(interaction) {
        const battleService = require("../../game/services/battleService");
        const { pushLog } = require("../battleFormat");
        const { updateBattlePanel } = require("../battlePanel");

        const session = battleService.getSessionForPlayer(
            interaction.user.id
        );

        if (session) {
            const { winner, loser } = battleService.forfeit(
                session, interaction.user.id
            );

            pushLog(
                session,
                `🏳️ **${loser.character.name}** ` +
                `(<@${loser.discordId}>) forfeits — ` +
                `**${winner.character.name}** wins!`
            );

            await interaction.reply(
                `🏳️ **${loser.character.name}** ` +
                `(<@${loser.discordId}>) forfeits — ` +
                `**${winner.character.name}** ` +
                `(<@${winner.discordId}>) wins!`
            );

            const panelChannel = session.channelId === interaction.channelId
                ? interaction.channel
                : await interaction.client.channels
                    .fetch(session.channelId)
                    .catch(() => null);

            if (panelChannel) {
                await updateBattlePanel(panelChannel, session);
            }
            return;
        }

        const pending = battleService.getPendingChallengeForPlayer(
            interaction.user.id
        );

        if (pending) {
            const cancelled = battleService.cancelChallenge(
                pending.channelId, interaction.user.id
            );

            if (cancelled.ok) {
                // Clear buttons on the original challenge message.
                if (pending.messageId &&
                    pending.channelId === interaction.channelId) {
                    interaction.channel.messages
                        .fetch(pending.messageId)
                        .then(msg => msg.edit({ components: [] }))
                        .catch(() => {});
                }

                await interaction.reply(
                    cancelled.role === "challenger"
                        ? `<@${interaction.user.id}> withdrew their challenge.`
                        : `<@${interaction.user.id}> declined the challenge.`
                );
                return;
            }
        }

        await interaction.reply({
            content: "You're not in a battle or pending challenge.",
            ephemeral: true
        });
    }
};
