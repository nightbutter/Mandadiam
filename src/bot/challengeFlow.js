const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require("discord.js");
const battleService = require("../game/services/battleService");
const characterService = require("../services/characterService");

// Shared challenge validation + message flow used by /battle-challenge
// and the dashboard's opponent picker.

const BUSY_MESSAGES = {
    challenger_busy: "You already have a pending challenge or active battle.",
    opponent_busy: "That player is already in a battle or has a pending challenge.",
    channel_busy: "A battle or challenge is already active in this channel."
};

// Returns { ok:true, payload } or { ok:false, reason } — payload is the
// challenge message body the caller can send via reply or channel.send.
async function prepareChallenge(interaction, opponent) {
    if (opponent.bot) {
        return { ok: false, reason: "You can't challenge a bot." };
    }

    if (opponent.id === interaction.user.id) {
        return { ok: false, reason: "You can't challenge yourself." };
    }

    const me = await characterService.getActiveBattleCharacter(
        interaction.user.id
    );

    if (!me.ok) {
        return {
            ok: false,
            reason: me.error === "not_registered"
                ? "You are not registered yet — use /register first."
                : "Select an active character with /character-select first."
        };
    }

    const them = await characterService.getActiveBattleCharacter(
        opponent.id
    );

    if (!them.ok) {
        return {
            ok: false,
            reason: them.error === "not_registered"
                ? `<@${opponent.id}> isn't registered yet.`
                : `<@${opponent.id}> has no active character selected.`
        };
    }

    const issued = battleService.issueChallenge({
        channelId: interaction.channelId,
        challengerId: interaction.user.id,
        opponentId: opponent.id
    });

    if (!issued.ok) {
        return {
            ok: false,
            reason: BUSY_MESSAGES[issued.error] ??
                "Could not issue that challenge."
        };
    }

    const seconds = Math.round(battleService.CHALLENGE_TTL_MS / 1000);

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("challenge:accept")
            .setLabel("Accept")
            .setEmoji("⚔️")
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId("challenge:decline")
            .setLabel("Decline")
            .setEmoji("❌")
            .setStyle(ButtonStyle.Secondary)
    );

    return {
        ok: true,
        challenge: issued.challenge,
        payload: {
            content:
                `⚔️ <@${opponent.id}> — <@${interaction.user.id}> ` +
                `(${me.character.name}) challenges you to a battle with ` +
                `**${them.character.name}** on the line! ` +
                `Accept within ${seconds}s.`,
            components: [row]
        }
    };
}

// Schedules the TTL cleanup (strip buttons on expiry) and records the
// message id so slash-command accept/decline can clear the buttons.
function trackChallengeMessage(message, challenge, channelId) {
    challenge.messageId = message.id;

    setTimeout(() => {
        if (battleService.expireChallenge(channelId)) {
            message.edit({
                content: "⌛ Challenge expired.",
                components: []
            }).catch(() => {});
        }
    }, battleService.CHALLENGE_TTL_MS).unref();
}

module.exports = { prepareChallenge, trackChallengeMessage };
