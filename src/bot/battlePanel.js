const {
    buildBattleEmbed,
    buildBattleRow,
    buildPrivateView,
    buildBattleResultEmbed
} = require("./battleFormat");

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

// Posts the dedicated final-result card once a battle is over. The
// service deletes the session at finalization, so the terminal
// action's handler is the only place this can ever fire — duplicate
// announcements can't happen.
async function sendBattleResult(channel, session, reason) {
    return channel.send({
        embeds: [buildBattleResultEmbed(session, reason)]
    });
}

// The channel the public battle panel lives in — interactions from a
// player's DM carry a different channelId, so resolve it explicitly.
async function resolvePublicChannel(interaction, session) {
    if (interaction.channelId === session.channelId) {
        return interaction.channel;
    }

    return interaction.client.channels
        .fetch(session.channelId)
        .catch(() => null);
}

// DM one private panel to each participant. A failed send (closed
// DMs) flags dmFailed — the public panel then falls back to shared
// action controls so the battle stays playable.
async function sendPrivatePanels(client, session) {
    if (!client?.users || !session.privatePanels) {
        return;
    }

    for (const player of session.players) {
        try {
            const user = await client.users.fetch(player.discordId);
            const channel = await user.createDM();
            const message = await channel.send(
                buildPrivateView(session, player.discordId)
            );
            session.privatePanels.set(
                player.discordId, { channel, message }
            );
        } catch {
            session.privatePanels.delete(player.discordId);
            session.dmFailed.add(player.discordId);
        }
    }
}

// Edit every private panel to match the current battle state. A stale
// or deleted DM message is resent; a channel that stops accepting DMs
// mid-battle joins dmFailed and the public panel regains controls.
async function updatePrivatePanels(client, session) {
    if (!client || !session.privatePanels) {
        return;
    }

    for (const player of session.players) {
        const payload = buildPrivateView(session, player.discordId);
        const panel = session.privatePanels.get(player.discordId);

        if (panel) {
            try {
                await panel.message.edit(payload);
                continue;
            } catch {
                // Fall through — try resending below.
            }
        }

        try {
            const user = await client.users.fetch(player.discordId);
            const channel = panel?.channel ?? (await user.createDM());
            const message = await channel.send(payload);
            session.privatePanels.set(
                player.discordId, { channel, message }
            );
            session.dmFailed.delete(player.discordId);
        } catch {
            session.privatePanels.delete(player.discordId);
            session.dmFailed.add(player.discordId);
        }
    }
}

// Update every surface after a state change: the public panel (when
// the interaction happened elsewhere) plus all private DM panels.
// When the click was on the public panel itself, that message was
// already updated via interaction.update — skip a duplicate edit.
async function refreshBattleViews(interaction, session, report = null) {
    // Private panels first: a DM that fails here flags dmFailed before
    // the public row renders, so the fallback shows usable controls.
    await updatePrivatePanels(interaction.client, session);

    if (interaction.channelId !== session.channelId) {
        const channel = await resolvePublicChannel(interaction, session);

        if (channel) {
            await updateBattlePanel(channel, session, report);
        }
    }
}

module.exports = {
    sendBattlePanel,
    updateBattlePanel,
    sendBattleResult,
    sendPrivatePanels,
    updatePrivatePanels,
    refreshBattleViews,
    resolvePublicChannel
};
