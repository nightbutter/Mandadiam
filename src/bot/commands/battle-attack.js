const { SlashCommandBuilder } = require("discord.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("battle-attack")
        .setDescription("Make a normal attack on your turn"),
    async execute(interaction) {
        const battleService = require("../../game/services/battleService");
        const { formatAttackReport, mentionOwner } =
            require("../battleFormat");

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
                action_failed:
                    outcome.result?.message ?? "That action failed."
            };

            await interaction.reply({
                content: messages[outcome.error],
                ephemeral: true
            });
            return;
        }

        const report = formatAttackReport(session, outcome.result);

        if (outcome.finished) {
            const winnerChar = session.battle.characters.find(
                c => c.name === outcome.winner
            );

            await interaction.reply(
                `${report}\n\n🏆 **${outcome.winner ?? "Nobody"}** ` +
                `${winnerChar ? mentionOwner(session, winnerChar) : ""} ` +
                "wins the battle!"
            );
            return;
        }

        const nextPlayer = session.players.find(
            p => p.character.name === outcome.next.character
        );

        await interaction.reply(
            `${report}\nNext: <@${nextPlayer.discordId}>'s turn — ` +
            "/battle-attack"
        );
    }
};
