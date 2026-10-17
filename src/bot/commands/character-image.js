const { SlashCommandBuilder } = require("discord.js");
const { ensureDatabase } = require("./helpers");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("character-image")
        .setDescription("Set a character's portrait image")
        .addAttachmentOption(option =>
            option.setName("image")
                .setDescription("PNG, JPEG, or WebP file (max 5 MB)")
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName("character")
                .setDescription(
                    "Character name (defaults to your active character)"
                )
                .setRequired(false)
        ),
    async execute(interaction) {
        if (!(await ensureDatabase(interaction))) {
            return;
        }

        const characterService = require("../../services/characterService");
        const attachment = interaction.options.getAttachment("image");

        const validation =
            characterService.validateImageAttachment(attachment);

        if (!validation.ok) {
            await interaction.reply({
                content: `❌ ${validation.reason}`,
                ephemeral: true
            });
            return;
        }

        // Resolve the target character: named one, else the active one.
        const name = interaction.options.getString("character");
        let characterId = null;

        if (name) {
            const found = await characterService.listCharacters(
                interaction.user.id
            );

            if (!found.ok) {
                await interaction.reply({
                    content:
                        "You are not registered yet — " +
                        "use /register first.",
                    ephemeral: true
                });
                return;
            }

            const match = found.characters.find(
                c => c.name === name.trim()
            );

            if (!match) {
                await interaction.reply({
                    content:
                        `You have no character named ` +
                        `**${name.trim()}**.`,
                    ephemeral: true
                });
                return;
            }

            characterId = match.id;
        } else {
            const active =
                await characterService.getActiveBattleCharacter(
                    interaction.user.id
                );

            if (!active.ok) {
                await interaction.reply({
                    content:
                        "No active character — select one first or " +
                        "pass the character option.",
                    ephemeral: true
                });
                return;
            }

            // getActiveBattleCharacter strips ids — reload the row.
            const { getProfile } = require("../../services/playerService");
            const profile = await getProfile(interaction.user.id);
            characterId = profile.activeCharacter.id;
        }

        const result = await characterService.setCharacterImage(
            interaction.user.id, characterId, validation.url
        );

        if (!result.ok) {
            await interaction.reply({
                content: "Couldn't update that character's image.",
                ephemeral: true
            });
            return;
        }

        await interaction.reply({
            content:
                `🖼️ Portrait updated for ` +
                `**${result.character.name}**!`,
            ephemeral: true
        });
    }
};
