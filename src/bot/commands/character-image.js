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

        // Acknowledge within Discord's 3s window before any database
        // or validation work — every later response uses editReply.
        await interaction.deferReply({ ephemeral: true });

        const fail = content => interaction.editReply(`❌ ${content}`);

        try {
            const characterService =
                require("../../services/characterService");
            const { getProfile } =
                require("../../services/playerService");

            const attachment = interaction.options.getAttachment("image");
            const validation =
                characterService.validateImageAttachment(attachment);

            if (!validation.ok) {
                await fail(validation.reason);
                return;
            }

            // Resolve the target character: the named one, else the
            // active character — one round trip either way.
            const name = interaction.options.getString("character");
            let characterId = null;

            if (name) {
                const found = await characterService.listCharacters(
                    interaction.user.id
                );

                if (!found.ok) {
                    await fail(
                        "You are not registered yet — " +
                        "use /register first."
                    );
                    return;
                }

                const match = found.characters.find(
                    c => c.name === name.trim()
                );

                if (!match) {
                    await fail(
                        `You have no character named ` +
                        `**${name.trim()}**.`
                    );
                    return;
                }

                characterId = match.id;
            } else {
                const profile = await getProfile(interaction.user.id);

                if (!profile) {
                    await fail(
                        "You are not registered yet — " +
                        "use /register first."
                    );
                    return;
                }

                if (!profile.activeCharacter) {
                    await fail(
                        "No active character — select one with " +
                        "/character-select or pass the character option."
                    );
                    return;
                }

                characterId = profile.activeCharacter.id;
            }

            const result = await characterService.setCharacterImage(
                interaction.user.id, characterId, validation.url
            );

            if (!result.ok) {
                await fail(
                    result.error === "invalid_url"
                        ? "That attachment URL isn't a supported " +
                          "Discord image link."
                        : "Couldn't update that character's image — " +
                          "it may not be yours."
                );
                return;
            }

            await interaction.editReply(
                `🖼️ Portrait updated for ` +
                `**${result.character.name}**!`
            );
        } catch (err) {
            // Log safely — command name + error only, never env/secrets.
            console.error(
                "/character-image failed:", err.stack ?? err
            );

            try {
                await interaction.editReply(
                    "Something went wrong updating the portrait. " +
                    "Please try again."
                );
            } catch {
                // Interaction already gone — nothing else to do.
            }
        }
    }
};
