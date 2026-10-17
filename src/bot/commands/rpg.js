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

        // Acknowledge within Discord's window BEFORE any database
        // work — a cold connection can exceed it, which previously
        // produced 10062 and a crashing double-ack.
        await interaction.deferReply({ ephemeral: true });

        const { getProfile } = require("../../services/playerService");
        const { mainMenuView } = require("../menu");
        const uiSessions = require("../uiSessions");

        const profile = await getProfile(interaction.user.id);

        // editReply resolves to the dashboard message itself.
        const message = await interaction.editReply(
            mainMenuView(profile)
        );

        // Bind the dashboard message to its invoker — button ownership
        // is validated server-side, not from unreliable metadata.
        uiSessions.bind(message, interaction.user.id);
    }
};
