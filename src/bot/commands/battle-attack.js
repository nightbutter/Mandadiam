const { SlashCommandBuilder } = require("discord.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("battle-attack")
        .setDescription("Make a normal attack on your turn"),
    async execute(interaction) {
        const battleService = require("../../game/services/battleService");
        const { updateBattlePanel } = require("../battlePanel");

        const session = battleService.getSessionForPlayer(
            interaction.user.id
        );

        if (!session) {
            await interaction.reply({
                content: "You're not in an active battle.",
                ephemeral: true
            });
            return;
        }

        const outcome = battleService.attack(
            session, interaction.user.id
        );

        if (!outcome.ok) {
            const messages = {
                finished: "That battle is already finished.",
                not_participant: "You're not a participant in this battle.",
                not_your_turn: "It's not your turn yet.",
                action_in_progress:
                    "A dice roll is already in progress — " +
                    "use the 🎲 button on the battle panel.",
                action_failed:
                    outcome.result?.message ?? "That action failed."
            };

            await interaction.reply({
                content: messages[outcome.error],
                ephemeral: true
            });
            return;
        }

        // Attack validated — the battle panel now waits for the
        // manual dice sequence.
        const report = `⚔️ Attack declared — ${outcome.expected.text}`;

        await interaction.reply(report);

        // Keep the persistent panel in sync if one exists — the
        // battle may live in a different channel than this command.
        const panelChannel = session.channelId === interaction.channelId
            ? interaction.channel
            : await interaction.client.channels
                .fetch(session.channelId)
                .catch(() => null);

        if (panelChannel) {
            await updateBattlePanel(panelChannel, session, report);
        }
    }
};
