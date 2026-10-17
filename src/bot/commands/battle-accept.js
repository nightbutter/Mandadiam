const { SlashCommandBuilder } = require("discord.js");
const { ensureDatabase } = require("./helpers");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("battle-accept")
        .setDescription("Accept a battle challenge in this channel"),
    async execute(interaction) {
        if (!(await ensureDatabase(interaction))) {
            return;
        }

        const characterService = require("../../services/characterService");
        const battleService = require("../../game/services/battleService");
        const { statLine, mentionOwner } = require("../battleFormat");

        const accepted = battleService.acceptChallenge({
            channelId: interaction.channelId,
            userId: interaction.user.id
        });

        if (!accepted.ok) {
            const messages = {
                no_challenge: "There's no pending challenge in this channel.",
                expired: "That challenge has expired — ask for a new one.",
                not_opponent: "That challenge wasn't issued to you."
            };

            await interaction.reply({
                content: messages[accepted.error],
                ephemeral: true
            });
            return;
        }

        const { challengerId, opponentId } = accepted.challenge;

        const first = await characterService.getActiveBattleCharacter(
            challengerId
        );
        const second = await characterService.getActiveBattleCharacter(
            opponentId
        );

        if (!first.ok || !second.ok) {
            await interaction.reply({
                content:
                    "Couldn't start — a player no longer has an active " +
                    "character. Issue a new challenge.",
                ephemeral: true
            });
            return;
        }

        const started = battleService.startBattle(
            interaction.channelId,
            { discordId: challengerId, character: first.character },
            { discordId: opponentId, character: second.character }
        );

        if (!started.ok) {
            await interaction.reply({
                content: "Couldn't start — a battle is already running here.",
                ephemeral: true
            });
            return;
        }

        const { session, firstTurn } = started;
        const { initiative } = session.battle;
        const nextPlayer = session.players.find(
            p => p.character.name === firstTurn.character
        );

        await interaction.reply(
            [
                "⚔️ **Battle started!**",
                statLine(session, session.battle.characters[0]),
                statLine(session, session.battle.characters[1]),
                `Initiative d20: ${initiative.firstRoll} vs ` +
                    `${initiative.secondRoll}`,
                `${mentionOwner(session, nextPlayer.character)} — ` +
                    `**${nextPlayer.character.name}** moves first. ` +
                    "Use /battle-attack!"
            ].join("\n")
        );
    }
};
