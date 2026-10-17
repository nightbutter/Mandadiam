const { SlashCommandBuilder } = require("discord.js");
const { ensureDatabase } = require("./helpers");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("register")
        .setDescription("Register yourself as a player"),
    async execute(interaction) {
        if (!(await ensureDatabase(interaction))) {
            return;
        }

        await interaction.deferReply({ ephemeral: true });

        const { registerPlayer } = require("../../services/playerService");
        const { registered } = await registerPlayer(
            interaction.user.id,
            interaction.user.username
        );

        await interaction.editReply({
            content: registered
                ? `Registered — welcome, ${interaction.user.username}!`
                : "You are already registered."
        });
    }
};
