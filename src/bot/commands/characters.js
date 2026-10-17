const { SlashCommandBuilder } = require("discord.js");
const { ensureDatabase } = require("./helpers");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("characters")
        .setDescription("List your characters"),
    async execute(interaction) {
        if (!(await ensureDatabase(interaction))) {
            return;
        }

        const { listCharacters } = require("../../services/characterService");
        const result = await listCharacters(interaction.user.id);

        if (!result.ok) {
            await interaction.reply({
                content: "You are not registered yet — use /register first.",
                ephemeral: true
            });
            return;
        }

        if (!result.characters.length) {
            await interaction.reply({
                content:
                    "You have no characters yet — " +
                    "create one with /character-create.",
                ephemeral: true
            });
            return;
        }

        const lines = result.characters.map(character => {
            const marker =
                character.id === result.player.active_character_id
                    ? " *(active)*"
                    : "";

            return (
                `• **${character.name}**${marker} — ` +
                `HP ${character.max_hp}, ATK ${character.atk}, ` +
                `DEF ${character.def}, SPE ${character.spe}`
            );
        });

        await interaction.reply({
            content: `**Your characters**\n${lines.join("\n")}`,
            ephemeral: true
        });
    }
};
