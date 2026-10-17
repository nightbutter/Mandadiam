const { SlashCommandBuilder } = require("discord.js");
const { ensureDatabase } = require("./helpers");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("rpg")
        .setDescription("Open the Mandadiam main menu"),
    async execute(interaction) {
        if (!(await ensureDatabase(interaction))) {
            return;
        }

        const { getProfile } = require("../../services/playerService");
        const { mainMenuView } = require("../menu");
        const uiSessions = require("../uiSessions");

        const profile = await getProfile(interaction.user.id);

        const message = await interaction.reply({
            ...mainMenuView(profile),
            ephemeral: true,
            fetchReply: true
        });

        // Bind the dashboard message to its invoker — button ownership
        // is validated server-side, not from unreliable metadata.
        uiSessions.bind(message, interaction.user.id);
    }
};
