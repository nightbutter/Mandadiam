const { SlashCommandBuilder } = require("discord.js");
const { ensureDatabase } = require("./helpers");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("character-create")
        .setDescription(
            "Create a character — HP + ATK + DEF + SPE must total 150 or less"
        )
        .addStringOption(option =>
            option.setName("name")
                .setDescription("Character name (unique to you, max 30 chars)")
                .setRequired(true)
                .setMaxLength(30)
        )
        .addIntegerOption(option =>
            option.setName("max_hp")
                .setDescription("Maximum HP (50-150, costs 1 point each)")
                .setRequired(true)
                .setMinValue(50)
                .setMaxValue(150)
        )
        .addIntegerOption(option =>
            option.setName("atk")
                .setDescription("Attack (0-30)")
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(30)
        )
        .addIntegerOption(option =>
            option.setName("def")
                .setDescription("Defense (0-30)")
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(30)
        )
        .addIntegerOption(option =>
            option.setName("spe")
                .setDescription("Speed (0-30)")
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(30)
        ),
    async execute(interaction) {
        if (!(await ensureDatabase(interaction))) {
            return;
        }

        await interaction.deferReply({ ephemeral: true });

        const { createCharacter } = require("../../services/characterService");
        const result = await createCharacter(interaction.user.id, {
            name: interaction.options.getString("name"),
            maxHp: interaction.options.getInteger("max_hp"),
            atk: interaction.options.getInteger("atk"),
            def: interaction.options.getInteger("def"),
            spe: interaction.options.getInteger("spe")
        });

        if (!result.ok) {
            const replies = {
                not_registered:
                    "You are not registered yet — use /register first.",
                duplicate_name:
                    "You already have a character with that name."
            };

            const content = result.error === "invalid"
                ? `Invalid stats: ${result.details.join(", ")}`
                : replies[result.error] ??
                    "Something went wrong creating that character.";

            await interaction.editReply({ content });
            return;
        }

        const c = result.character;

        await interaction.editReply({
            content:
                `Created **${c.name}** — HP ${c.max_hp}, ATK ${c.atk}, ` +
                `DEF ${c.def}, SPE ${c.spe}. ` +
                "Select it with /character-select."
        });
    }
};
