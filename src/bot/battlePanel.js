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
// gone (deleted manually or after a restart) — only a genuine
// Unknown Message clears the stored id, so transient API errors
// never orphan the canonical panel or trigger a duplicate send.
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
    } catch (err) {
        if (err?.code === 10008) {
            // Message truly deleted — drop the reference so callers
            // can deliberately send a fresh canonical panel.
            session.panelMessageId = null;
        }
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

// True only when the click landed on the actual public panel message
// — an ephemeral "My Controls" reply or a DM panel lives in the same
// or a different channel but is a different message entirely.
function isPanelMessage(interaction, session) {
    return (
        interaction.channelId === session.channelId &&
        interaction.message?.id === session.panelMessageId
    );
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
            console.log(
                `[battle] DM panel sent to ${player.discordId} ` +
                `(msg ${message.id})`
            );
        } catch (err) {
            session.privatePanels.delete(player.discordId);
            session.dmFailed.add(player.discordId);
            console.warn(
                `[battle] DM panel send failed for ` +
                `${player.discordId}: ${err?.code ?? err?.message ?? err}`
            );
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
                session.dmFailed.delete(player.discordId);
                continue;
            } catch (err) {
                if (err?.code !== 10008) {
                    // Not a deleted message — likely transient or the
                    // DM became unreachable. Keep the stored panel
                    // (no duplicate send) and flag the fallback so
                    // public controls stay usable; the next update
                    // retries the edit.
                    session.dmFailed.add(player.discordId);
                    console.warn(
                        `[battle] DM panel edit failed for ` +
                        `${player.discordId}: ` +
                        `${err?.code ?? err?.message ?? err}`
                    );
                    continue;
                }
                // 10008 — the DM message was deleted; resend below.
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
            console.log(
                `[battle] DM panel resent to ${player.discordId} ` +
                `(msg ${message.id})`
            );
        } catch (err) {
            session.privatePanels.delete(player.discordId);
            session.dmFailed.add(player.discordId);
            console.warn(
                `[battle] DM panel update failed for ` +
                `${player.discordId}: ${err?.code ?? err?.message ?? err}`
            );
        }
    }
}

// Update every surface after a state change: the public panel (when
// the interaction happened on another message — a DM panel or an
// ephemeral reply) plus all private DM panels. When the click was on
// the public panel itself, that message was already updated via
// interaction.update — skip a duplicate edit.
async function refreshBattleViews(interaction, session, report = null) {
    // Private panels first: a DM that fails here flags dmFailed before
    // the public row renders, so the fallback shows usable controls.
    await updatePrivatePanels(interaction.client, session);

    if (!isPanelMessage(interaction, session)) {
        const channel = await resolvePublicChannel(interaction, session);

        if (channel) {
            const updated = await updateBattlePanel(
                channel, session, report
            );

            // Canonical panel was deleted mid-battle — deliberately
            // replace it once rather than leaving the channel blind.
            if (!updated && !session.panelMessageId) {
                const fresh = await sendBattlePanel(
                    channel, session, report
                );
                console.log(
                    `[battle] public panel recovered — ` +
                    `new message ${fresh.id}`
                );
            }
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
    resolvePublicChannel,
    isPanelMessage
};
