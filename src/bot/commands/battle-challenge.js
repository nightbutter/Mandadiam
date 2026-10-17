const { SlashCommandBuilder } = require("discord.js");
const { ensureDatabase } = require("./helpers");

const BUSY_MESSAGES = {
    challenger_busy: "You already have a pending challenge or active battle.",
    opponent_busy: "That player is already in a battle or has a pending challenge.",
    channel_busy: "A battle or challenge is already active in this channel."
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName("battle-challenge")
        .setDescription("Challenge another player to a PvP battle")
        .addUserOption(option =>
            option.setName("opponent")
                .setDescription("The player to challenge")
                .setRequired(true)
        ),
    async execute(interaction) {
        if (!(await ensureDatabase(interaction))) {
            return;
        }

        const opponent = interaction.options.getUser("opponent");

        if (opponent.bot) {
            await interaction.reply({
                content: "You can't challenge a bot.",
                ephemeral: true
            });
            return;
        }

        if (opponent.id === interaction.user.id) {
            await interaction.reply({
                content: "You can't challenge yourself.",
                ephemeral: true
            });
            return;
        }

        const characterService = require("../../services/characterService");
        const battleService = require("../../game/services/battleService");

        const me = await characterService.getActiveBattleCharacter(
            interaction.user.id
        );

        if (!me.ok) {
            const reason = me.error === "not_registered"
                ? "You are not registered yet — use /register first."
                : "Select an active character with /character-select first.";

            await interaction.reply({ content: reason, ephemeral: true });
            return;
        }

        const them = await characterService.getActiveBattleCharacter(
            opponent.id
        );

        if (!them.ok) {
            const reason = them.error === "not_registered"
                ? `<@${opponent.id}> isn't registered yet.`
                : `<@${opponent.id}> has no active character selected.`;

            await interaction.reply({ content: reason, ephemeral: true });
            return;
        }

        const issued = battleService.issueChallenge({
            channelId: interaction.channelId,
            challengerId: interaction.user.id,
            opponentId: opponent.id
        });

        if (!issued.ok) {
            await interaction.reply({
                content: BUSY_MESSAGES[issued.error] ??
                    "Could not issue that challenge.",
                ephemeral: true
            });
            return;
        }

        const seconds = Math.round(battleService.CHALLENGE_TTL_MS / 1000);

        await interaction.reply(
            `⚔️ <@${opponent.id}> — <@${interaction.user.id}> ` +
            `(${me.character.name}) challenges you to a battle with ` +
            `**${them.character.name}** on the line! ` +
            `Accept with /battle-accept within ${seconds}s.`
        );
    }
};
