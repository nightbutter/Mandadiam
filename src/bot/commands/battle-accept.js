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
        const { sendBattlePanel } = require("../battlePanel");
        const { pushLog } = require("../battleFormat");

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

        // Defer before loading both characters — two sequential
        // database calls can exceed the ack window.
        await interaction.deferReply({ ephemeral: true });

        // Clear the buttons on the original challenge message, if any.
        if (accepted.challenge.messageId) {
            interaction.channel.messages
                .fetch(accepted.challenge.messageId)
                .then(msg => msg.edit({ components: [] }))
                .catch(() => {});
        }

        const { challengerId, opponentId } = accepted.challenge;

        const first = await characterService.getActiveBattleCharacter(
            challengerId
        );
        const second = await characterService.getActiveBattleCharacter(
            opponentId
        );

        if (!first.ok || !second.ok) {
            await interaction.editReply({
                content:
                    "Couldn't start — a player no longer has an active " +
                    "character. Issue a new challenge."
            });
            return;
        }

        const started = battleService.startBattle(
            interaction.channelId,
            { discordId: challengerId, character: first.character },
            { discordId: opponentId, character: second.character }
        );

        if (!started.ok) {
            await interaction.editReply({
                content: "Couldn't start — a battle is already running here."
            });
            return;
        }

        const { session, firstTurn } = started;
        const { initiative } = session.battle;
        const nextPlayer = session.players.find(
            p => p.character.name === firstTurn.character
        );

        pushLog(
            session,
            `Initiative d20: ${initiative.firstRoll} vs ` +
            `${initiative.secondRoll} — **${firstTurn.character}** ` +
            "moves first"
        );

        // The acceptance announce is public; the deferred reply is
        // the private receipt.
        await interaction.channel.send(
            `⚔️ <@${opponentId}> accepted — battle started!`
        );
        await interaction.editReply("Battle started!");

        await sendBattlePanel(
            interaction.channel, session,
            `🚩 **${firstTurn.character}** ` +
            `(<@${nextPlayer.discordId}>) to act — press Attack!`
        );
    }
};
