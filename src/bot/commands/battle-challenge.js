const { SlashCommandBuilder } = require("discord.js");
const { ensureDatabase } = require("./helpers");
const {
    prepareChallenge,
    trackChallengeMessage
} = require("../challengeFlow");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("battle-challenge")
        .setDescription("Challenge another player to a PvP battle")
        .addUserOption(option =>
            option.setName("opponent")
                .setDescription("The player to challenge")
                .setRequired(true)
        ),
    async execute(interaction) {
        if (!(await ensureDatabase(interaction))) {
            return;
        }

        const opponent = interaction.options.getUser("opponent");
        const prepared = await prepareChallenge(interaction, opponent);

        if (!prepared.ok) {
            await interaction.reply({
                content: prepared.reason,
                ephemeral: true
            });
            return;
        }

        const message = await interaction.reply({
            ...prepared.payload,
            fetchReply: true
        });

        trackChallengeMessage(
            message, prepared.challenge, interaction.channelId
        );
    }
};
