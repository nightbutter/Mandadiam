const { SlashCommandBuilder } = require("discord.js");
const { ensureDatabase } = require("./helpers");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("character-create")
        .setDescription("Create a new character")
        .addStringOption(option =>
            option.setName("name")
                .setDescription("Character name (unique to you)")
                .setRequired(true)
                .setMaxLength(50)
        )
        .addIntegerOption(option =>
            option.setName("max_hp")
                .setDescription("Maximum HP (1-9999)")
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(9999)
        )
        .addIntegerOption(option =>
            option.setName("atk")
                .setDescription("Attack (0-999)")
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(999)
        )
        .addIntegerOption(option =>
            option.setName("def")
                .setDescription("Defense (0-999)")
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(999)
        )
        .addIntegerOption(option =>
            option.setName("spe")
                .setDescription("Speed (0-999)")
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(999)
        ),
    async execute(interaction) {
        if (!(await ensureDatabase(interaction))) {
            return;
        }

        const { createCharacter } = require("../../services/characterService");
        const result = await createCharacter(interaction.user.id, {
            name: interaction.options.getString("name"),
            maxHp: interaction.options.getInteger("max_hp"),
            atk: interaction.options.getInteger("atk"),
            def: interaction.options.getInteger("def"),
            spe: interaction.options.getInteger("spe")
        });

        const replies = {
            not_registered:
                "You are not registered yet — use /register first.",
            duplicate_name:
                "You already have a character with that name.",
            invalid: `Invalid stats: ${result.details.join(", ")}`
        };

        if (!result.ok) {
            await interaction.reply({
                content: replies[result.error],
                ephemeral: true
            });
            return;
        }

        const c = result.character;

        await interaction.reply({
            content:
                `Created **${c.name}** — HP ${c.max_hp}, ATK ${c.atk}, ` +
                `DEF ${c.def}, SPE ${c.spe}. ` +
                "Select it with /character-select.",
            ephemeral: true
        });
    }
};
