const { buildBattleEmbed, buildBattleRow } = require("./battleFormat");

// Sends the persistent battle panel and remembers its message id on
// the session so later actions edit it in place.
async function sendBattlePanel(channel, session, report = null) {
    const message = await channel.send({
        embeds: [buildBattleEmbed(session, report)],
        components: [buildBattleRow(session)]
    });

    session.panelMessageId = message.id;

    return message;
}

// Edits the existing panel message. Returns null if the message is
// gone (deleted manually or after a restart) — callers may send a
// fresh panel as a fallback.
async function updateBattlePanel(channel, session, report = null) {
    if (!session.panelMessageId) {
        return null;
    }

    try {
        const message = await channel.messages.fetch(
            session.panelMessageId
        );

        await message.edit({
            embeds: [buildBattleEmbed(session, report)],
            components: session.battle.status === "finished"
                ? []
                : [buildBattleRow(session)]
        });

        return message;
    } catch {
        session.panelMessageId = null;
        return null;
    }
}

module.exports = {
    sendBattlePanel,
    updateBattlePanel
};
