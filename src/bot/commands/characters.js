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

        await interaction.deferReply({ ephemeral: true });

        const { listCharacters } = require("../../services/characterService");
        const result = await listCharacters(interaction.user.id);

        if (!result.ok) {
            await interaction.editReply({
                content: "You are not registered yet — use /register first."
            });
            return;
        }

        if (!result.characters.length) {
            await interaction.editReply({
                content:
                    "You have no characters yet — " +
                    "create one with /character-create."
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

        await interaction.editReply({
            content: `**Your characters**\n${lines.join("\n")}`
        });
    }
};
