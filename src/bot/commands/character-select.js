const { SlashCommandBuilder } = require("discord.js");
const { ensureDatabase } = require("./helpers");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("character-select")
        .setDescription("Select one of your characters as active")
        .addStringOption(option =>
            option.setName("name")
                .setDescription("Name of your character")
                .setRequired(true)
        ),
    async execute(interaction) {
        if (!(await ensureDatabase(interaction))) {
            return;
        }

        const { selectCharacter } = require("../../services/characterService");
        const result = await selectCharacter(
            interaction.user.id,
            interaction.options.getString("name")
        );

        const replies = {
            not_registered:
                "You are not registered yet — use /register first.",
            not_found:
                "No character with that name belongs to you — " +
                "check /characters."
        };

        if (!result.ok) {
            await interaction.reply({
                content: replies[result.error],
                ephemeral: true
            });
            return;
        }

        await interaction.reply({
            content: `**${result.character.name}** is now your active character.`,
            ephemeral: true
        });
    }
};
