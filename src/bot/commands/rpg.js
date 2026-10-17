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

        const profile = await getProfile(interaction.user.id);

        await interaction.reply({
            ...mainMenuView(profile),
            ephemeral: true
        });
    }
};
