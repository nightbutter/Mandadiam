const { SlashCommandBuilder } = require("discord.js");
const { ensureDatabase } = require("./helpers");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("profile")
        .setDescription("Show your player profile"),
    async execute(interaction) {
        if (!(await ensureDatabase(interaction))) {
            return;
        }

        await interaction.deferReply({ ephemeral: true });

        const { getProfile } = require("../../services/playerService");
        const profile = await getProfile(interaction.user.id);

        if (!profile) {
            await interaction.editReply({
                content: "You are not registered yet — use /register first."
            });
            return;
        }

        const { player, activeCharacter } = profile;
        const lines = [
            `**${player.username}**`,
            `Registered: ${player.created_at.toISOString().slice(0, 10)}`
        ];

        if (activeCharacter) {
            lines.push(
                `Active character: **${activeCharacter.name}** ` +
                `(HP ${activeCharacter.max_hp}, ATK ${activeCharacter.atk}, ` +
                `DEF ${activeCharacter.def}, SPE ${activeCharacter.spe})`
            );
        } else {
            lines.push("Active character: none — use /character-select");
        }

        await interaction.editReply({ content: lines.join("\n") });
    }
};
