const { SlashCommandBuilder } = require("discord.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("battle-forfeit")
        .setDescription("Forfeit your active battle or withdraw a challenge"),
    async execute(interaction) {
        const battleService = require("../../game/services/battleService");

        const session = battleService.getSessionForPlayer(
            interaction.user.id
        );

        if (session) {
            const { winner, loser } = battleService.forfeit(
                session, interaction.user.id
            );

            await interaction.reply(
                `🏳️ **${loser.character.name}** ` +
                `(<@${loser.discordId}>) forfeits — ` +
                `**${winner.character.name}** ` +
                `(<@${winner.discordId}>) wins!`
            );
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
