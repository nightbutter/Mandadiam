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

        // Defer before the character lookups in prepareChallenge —
        // two sequential database calls can exceed the ack window.
        await interaction.deferReply({ ephemeral: true });

        const opponent = interaction.options.getUser("opponent");
        const prepared = await prepareChallenge(interaction, opponent);

        if (!prepared.ok) {
            await interaction.editReply({ content: prepared.reason });
            return;
        }

        // The challenge must be public — send it as a channel
        // message; the deferred reply becomes the private receipt.
        const message = await interaction.channel.send(
            prepared.payload
        );

        trackChallengeMessage(
            message, prepared.challenge, interaction.channelId
        );

        await interaction.editReply(
            `⚔️ Challenge sent to <@${opponent.id}>.`
        );
    }
};
