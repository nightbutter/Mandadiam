const { SlashCommandBuilder } = require("discord.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("battle-status")
        .setDescription("Show the current battle state in this channel"),
    async execute(interaction) {
        const battleService = require("../../game/services/battleService");
        const { formatStatus } = require("../battleFormat");

        const session = battleService.getSession(interaction.channelId);

        if (session) {
            await interaction.reply(formatStatus(session));
            return;
        }

        const pending = battleService.getPendingChallenge(
            interaction.channelId
        );

        if (pending) {
            const seconds = Math.ceil(
                (pending.expiresAt - Date.now()) / 1000
            );

            await interaction.reply(
                `Pending challenge: <@${pending.challengerId}> vs ` +
                `<@${pending.opponentId}> — expires in ~${seconds}s.`
            );
            return;
        }

        await interaction.reply({
            content: "No battle or pending challenge in this channel.",
            ephemeral: true
        });
    }
};
