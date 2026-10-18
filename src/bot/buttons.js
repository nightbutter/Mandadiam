const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require("discord.js");
const { env } = require("../config/env");
const battleService = require("../game/services/battleService");
const {
    pushLog,
    buildBattleEmbed,
    buildBattleRow,
    buildSkillSelectMenu,
    buildExPrompt,
    formatAttackReport
} = require("./battleFormat");
const {
    sendBattlePanel,
    updateBattlePanel,
    sendBattleResult
} = require("./battlePanel");

// Dispatches MessageComponent button interactions. Every handler
// re-validates state server-side — customIds are never trusted.

const STALE_MESSAGE =
    "This battle or challenge is no longer active.";

async function safeReply(interaction, content) {
    await interaction.reply({ content, ephemeral: true });
}

async function handleChallengeAccept(interaction) {
    const accepted = battleService.acceptChallenge({
        channelId: interaction.channelId,
        userId: interaction.user.id
    });

    if (!accepted.ok) {
        const messages = {
            no_challenge: STALE_MESSAGE,
            expired: "That challenge has expired.",
            not_opponent: "This challenge wasn't issued to you."
        };

        await safeReply(
            interaction, messages[accepted.error] ?? STALE_MESSAGE
        );
        return;
    }

    if (!env.databaseUrl) {
        await safeReply(interaction, "Database features are unavailable.");
        return;
    }

    // Acknowledge the button before loading both characters — two
    // sequential database calls can exceed the ack window, which is
    // how a clicked Accept used to die silently with 10062.
    await interaction.deferUpdate();

    const { getActiveBattleCharacter } =
        require("../services/characterService");
    const { challengerId, opponentId } = accepted.challenge;

    const first = await getActiveBattleCharacter(challengerId);
    const second = await getActiveBattleCharacter(opponentId);

    if (!first.ok || !second.ok) {
        await interaction.editReply({
            content:
                "Couldn't start — a player no longer has an active " +
                "character.",
            components: []
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
            content: "Couldn't start — a battle is already running here.",
            components: []
        });
        return;
    }

    const { session } = started;

    await interaction.editReply({
        content:
            `⚔️ <@${opponentId}> accepted the challenge — ` +
            "battle started!",
        components: []
    });

    // Initiative is manual now — both players roll their own d20 on
    // the panel before the first turn begins.
    await sendBattlePanel(
        interaction.channel, session,
        "🎲 Roll for initiative — both players roll d20!"
    );
}

async function handleChallengeDecline(interaction) {
    // Validate the role BEFORE consuming — a challenger clicking
    // decline must not delete their own pending challenge.
    const pending = battleService.getPendingChallenge(
        interaction.channelId
    );

    if (!pending) {
        await safeReply(interaction, STALE_MESSAGE);
        return;
    }

    if (pending.opponentId !== interaction.user.id) {
        await safeReply(
            interaction,
            "Only the challenged player can decline — " +
            "use /battle-forfeit to withdraw your own challenge."
        );
        return;
    }

    battleService.cancelChallenge(
        interaction.channelId, interaction.user.id
    );

    await interaction.update({
        content: `❌ <@${interaction.user.id}> declined the challenge.`,
        components: []
    });
}

function battleCharacterByName(session, name) {
    return session.players.find(p => p.character.name === name) ?? null;
}

const GATE_MESSAGES = {
    finished: "That battle is already finished.",
    not_participant: "Only battle participants can act.",
    not_your_turn: "It's not your turn yet.",
    action_in_progress: "A dice roll is already in progress."
};

// Action selected → validation passed → the panel now waits for the
// manual roll sequence (first die: the attacker's contest d20).
async function handleBattleAttack(interaction) {
    const session = battleService.getSession(interaction.channelId);

    if (!session) {
        await safeReply(interaction, STALE_MESSAGE);
        return;
    }

    const outcome = battleService.attack(session, interaction.user.id);

    if (!outcome.ok) {
        await safeReply(
            interaction,
            GATE_MESSAGES[outcome.error] ?? "That action failed."
        );
        return;
    }

    await interaction.update({
        embeds: [buildBattleEmbed(session, "⚔️ Attack declared!")],
        components: [buildBattleRow(session)]
    });
}

// Shared tail once a pending action resolves — same reporting and
// finalization as the old immediate path.
async function announceResolved(interaction, session, outcome) {
    if (outcome.type === "initiative") {
        const { initiative, firstTurn } = outcome;
        const first = session.players.find(
            p => p.character.name === firstTurn.character
        );

        pushLog(
            session,
            `Initiative d20: ${initiative.firstRoll} vs ` +
            `${initiative.secondRoll} — **${firstTurn.character}** ` +
            "moves first"
        );

        return (
            `🚩 **${firstTurn.character}** ` +
            `(<@${first.discordId}>) to act — press Attack!`
        );
    }

    const { result } = outcome;
    const icon = result.exName ? "💥" : result.skillName ? "✨" : "⚔️";
    const verb = result.exName
        ? `unleashed **${result.exName}**`
        : result.skillName
            ? `used **${result.skillName}**`
            : "attacked";

    pushLog(
        session,
        `${icon} **${result.attacker}** ${verb} → ` +
        `**${result.defender}**: ${result.damage} dmg` +
        (result.outcome === "reflected" ? " (reflected)" : "") +
        (result.outcome === "double_attack" ? " (double)" : "")
    );

    // Status application events — only state changes are logged;
    // missed/ignored/disabled rules stay silent to avoid spam.
    const statusText = {
        applied: "applied",
        refreshed: "refreshed",
        stacked: "grows",
        replaced: "replaced"
    };

    for (const ev of result.statusEvents ?? []) {
        if (statusText[ev.type]) {
            pushLog(
                session,
                `✦ **${ev.name}** ${statusText[ev.type]} ` +
                `on **${result.defender}**`
            );
        }
    }

    for (const ev of outcome.turnEvents ?? []) {
        if (ev.type === "tick") {
            pushLog(
                session,
                `✦ ${ev.name}: ${ev.damage} damage to ` +
                `**${ev.target}**`
            );
        } else if (ev.type === "skipped") {
            pushLog(
                session,
                `💤 **${ev.target}** is ${ev.name} — turn skipped!`
            );
        } else if (ev.type === "expired") {
            pushLog(session, `✦ ${ev.name} on **${ev.target}** expires`);
        }
    }

    if (outcome.finished) {
        const winner = battleCharacterByName(session, outcome.winner);
        pushLog(
            session,
            `🏆 **${outcome.winner ?? "Nobody"}** ` +
            `${winner ? `(<@${winner.discordId}>)` : ""} wins!`
        );
    }

    return formatAttackReport(session, result);
}

// A player clicked a roll button — server-side die, exactly one per
// authorized click, action resolves once all dice are collected.
async function handleRoll(interaction) {
    const session = battleService.getSession(interaction.channelId);

    if (!session) {
        await safeReply(interaction, STALE_MESSAGE);
        return;
    }

    const actionId = interaction.customId.slice("battle:roll:".length);

    if (!session.pending || session.pending.id !== actionId) {
        await safeReply(
            interaction,
            "That roll is no longer needed."
        );
        return;
    }

    const outcome = battleService.recordRoll(
        session, interaction.user.id
    );

    if (!outcome.ok) {
        const messages = {
            no_pending: "That roll is no longer needed.",
            no_roll_expected: "That roll is no longer needed.",
            wrong_roller:
                outcome.expected
                    ? `Waiting for <@${outcome.expected.discordId}>'s ` +
                      "roll — not yours."
                    : "It's not your roll.",
            invalid_die: "Invalid die."
        };

        await safeReply(
            interaction,
            messages[outcome.error] ?? "That roll failed."
        );
        return;
    }

    const rolled = outcome.rolled;

    pushLog(
        session,
        `🎲 <@${interaction.user.id}> rolled ` +
        `d${rolled.die}: **${rolled.value}**`
    );

    if (outcome.pending) {
        await interaction.update({
            embeds: [
                buildBattleEmbed(
                    session,
                    `🎲 <@${interaction.user.id}> rolled ` +
                    `**${rolled.value}** — ` +
                    `next: ${outcome.expected.text}`
                )
            ],
            components: [buildBattleRow(session)]
        });
        return;
    }

    // Sequence complete — resolve once.
    if (outcome.failed) {
        const message = outcome.error === "insufficient_cost"
            ? "Not enough COST."
            : outcome.result?.message ?? "That action failed.";

        await interaction.update({
            embeds: [buildBattleEmbed(session, `❌ ${message}`)],
            components: [buildBattleRow(session)]
        });
        return;
    }

    const report = await announceResolved(interaction, session, outcome);

    await interaction.update({
        embeds: [buildBattleEmbed(session, report)],
        components: outcome.finished ? [] : [buildBattleRow(session)]
    });

    if (outcome.finished) {
        await sendBattleResult(
            interaction.channel, session, "knockout"
        );
    }
}

async function handleBattleRefresh(interaction) {
    const session = battleService.getSession(interaction.channelId);

    if (!session) {
        await safeReply(interaction, STALE_MESSAGE);
        return;
    }

    await interaction.update({
        embeds: [buildBattleEmbed(session)],
        components: [buildBattleRow(session)]
    });
}

// Opens an ephemeral skill picker for the current turn owner.
async function handleBattleSkills(interaction) {
    const session = battleService.getSession(interaction.channelId);

    if (!session) {
        await safeReply(interaction, STALE_MESSAGE);
        return;
    }

    if (
        battleService.currentTurnPlayer(session)?.discordId !==
        interaction.user.id
    ) {
        await safeReply(
            interaction,
            session.players.some(
                p => p.discordId === interaction.user.id
            )
                ? "It's not your turn yet."
                : "Only battle participants can use skills."
        );
        return;
    }

    await interaction.reply({
        content: "✨ Choose a skill:",
        ephemeral: true,
        components: [buildSkillSelectMenu(session)]
    });
}

// The picked skill is validated exactly as before — then becomes a
// pending manual-roll action instead of resolving immediately.
async function handleSkillSelect(interaction) {
    const session = battleService.getSession(interaction.channelId);

    if (!session) {
        await interaction.update({
            content: STALE_MESSAGE,
            components: []
        });
        return;
    }

    const skillKey = interaction.values[0];
    const outcome = battleService.useSkill(
        session, interaction.user.id, skillKey
    );

    if (!outcome.ok) {
        const messages = {
            ...GATE_MESSAGES,
            not_participant: "Only battle participants can use skills.",
            unknown_skill: "Unknown skill.",
            skill_not_owned: "That skill isn't equipped.",
            condition_failed: outcome.reason,
            on_cooldown:
                `On cooldown — ${outcome.remaining} of your turns left.`,
            insufficient_cost: "Not enough COST.",
            invalid_target: "No valid target.",
            action_failed: outcome.result?.message ?? "That action failed."
        };

        await interaction.update({
            content: `❌ ${messages[outcome.error] ?? "Skill failed."}`,
            components: []
        });
        return;
    }

    // Acknowledge the ephemeral picker; the roll happens on the panel.
    await interaction.update({
        content:
            `✨ **${outcome.expected ? "Skill armed" : "Skill"}** — ` +
            "roll your dice on the battle panel!",
        components: []
    });

    await updateBattlePanel(
        interaction.channel, session,
        `✨ Skill declared — ${outcome.expected.text}`
    );
}

// Opens an ephemeral Ultimate detail/confirm prompt for the current
// turn owner — shows name, effect, COST, gauge and a reason if it
// can't fire. The confirm click re-validates everything via useEx.
async function handleBattleUltimate(interaction) {
    const session = battleService.getSession(interaction.channelId);

    if (!session) {
        await safeReply(interaction, STALE_MESSAGE);
        return;
    }

    if (
        battleService.currentTurnPlayer(session)?.discordId !==
        interaction.user.id
    ) {
        await safeReply(
            interaction,
            session.players.some(
                p => p.discordId === interaction.user.id
            )
                ? "It's not your turn yet."
                : "Only battle participants can use an Ultimate."
        );
        return;
    }

    const character = session.battle.currentTurn?.character;
    const { content, ready } = buildExPrompt(character);

    await interaction.reply({
        content,
        ephemeral: true,
        components: [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("battle:ultimate:confirm")
                    .setLabel("Unleash!")
                    .setStyle(ButtonStyle.Danger)
                    .setDisabled(!ready),
                new ButtonBuilder()
                    .setCustomId("battle:ultimate:cancel")
                    .setLabel("Cancel")
                    .setStyle(ButtonStyle.Secondary)
            )
        ]
    });
}

async function handleUltimateConfirm(interaction) {
    const session = battleService.getSession(interaction.channelId);

    if (!session) {
        await interaction.update({
            content: STALE_MESSAGE,
            components: []
        });
        return;
    }

    const outcome = battleService.useEx(
        session, interaction.user.id
    );

    if (!outcome.ok) {
        const messages = {
            ...GATE_MESSAGES,
            not_participant:
                "Only battle participants can use an Ultimate.",
            invalid_actor: "Your character can't act.",
            no_ex_assigned: "This character has no Ultimate assigned.",
            unknown_ex: "Unknown Ultimate.",
            ex_not_ready: "EX gauge isn't full yet.",
            insufficient_cost: "Not enough COST.",
            invalid_target: "No valid target.",
            action_failed: outcome.result?.message ?? "That action failed."
        };

        await interaction.update({
            content:
                `❌ ${messages[outcome.error] ?? "Ultimate failed."}`,
            components: []
        });
        return;
    }

    // The public panel is a different message — edit it via the
    // channel, same as the forfeit flow.
    await updateBattlePanel(
        interaction.channel, session,
        `💥 Ultimate declared — ${outcome.expected.text}`
    );

    await interaction.update({
        content: "💥 Ultimate unleashed — roll your dice on the panel!",
        components: []
    });
}

async function handleUltimateCancel(interaction) {
    await interaction.update({
        content: "Ultimate held — battle continues.",
        components: []
    });
}

// Step 1 — confirm prompt (ephemeral) so a stray click can't end
// a battle. The actual forfeit runs only on battle:forfeit:confirm.
async function handleBattleForfeit(interaction) {
    const session = battleService.getSession(interaction.channelId);

    if (!session) {
        await safeReply(interaction, STALE_MESSAGE);
        return;
    }

    if (
        !session.players.some(
            p => p.discordId === interaction.user.id
        )
    ) {
        await safeReply(
            interaction, "Only battle participants can forfeit."
        );
        return;
    }

    await interaction.reply({
        content: "🏳️ Forfeit this battle? The opponent wins.",
        ephemeral: true,
        components: [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("battle:forfeit:confirm")
                    .setLabel("Confirm Forfeit")
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId("battle:forfeit:cancel")
                    .setLabel("Cancel")
                    .setStyle(ButtonStyle.Secondary)
            )
        ]
    });
}

async function handleForfeitConfirm(interaction) {
    const session = battleService.getSession(interaction.channelId);

    if (!session) {
        await interaction.update({
            content: STALE_MESSAGE,
            components: []
        });
        return;
    }

    const result = battleService.forfeit(session, interaction.user.id);

    if (!result.ok) {
        await interaction.update({
            content: "Only battle participants can forfeit.",
            components: []
        });
        return;
    }

    pushLog(
        session,
        `🏳️ **${result.loser.character.name}** ` +
        `(<@${result.loser.discordId}>) forfeits — ` +
        `**${result.winner.character.name}** wins!`
    );

    // The public panel is a different message — edit it via the
    // channel, since this click targets the ephemeral confirm prompt.
    await updateBattlePanel(interaction.channel, session);

    await sendBattleResult(interaction.channel, session, "forfeit");

    await interaction.update({
        content:
            `🏳️ You forfeited — **${result.winner.character.name}** ` +
            `(<@${result.winner.discordId}>) wins.`,
        components: []
    });
}

async function handleForfeitCancel(interaction) {
    await interaction.update({
        content: "Forfeit cancelled — battle continues.",
        components: []
    });
}

const handlers = {
    "challenge:accept": handleChallengeAccept,
    "challenge:decline": handleChallengeDecline,
    "battle:attack": handleBattleAttack,
    "battle:skills": handleBattleSkills,
    "battle:ultimate": handleBattleUltimate,
    "battle:ultimate:confirm": handleUltimateConfirm,
    "battle:ultimate:cancel": handleUltimateCancel,
    "battle:refresh": handleBattleRefresh,
    "battle:forfeit": handleBattleForfeit,
    "battle:forfeit:confirm": handleForfeitConfirm,
    "battle:forfeit:cancel": handleForfeitCancel
};

async function handleButton(interaction) {
    if (interaction.customId.startsWith("admin:")) {
        const { handleAdminButton } = require("./admin");
        await handleAdminButton(interaction);
        return;
    }

    if (interaction.customId.startsWith("menu:")) {
        const { handleMenuButton } = require("./menu");
        await handleMenuButton(interaction);
        return;
    }

    // Roll buttons carry a per-action id — prefix match.
    if (interaction.customId.startsWith("battle:roll:")) {
        await handleRoll(interaction);
        return;
    }

    const handler = handlers[interaction.customId];

    if (!handler) {
        await safeReply(interaction, "Unknown action.");
        return;
    }

    await handler(interaction);
}

// Select menus under the battle: prefix (skill picker).
async function handleBattleSelect(interaction) {
    if (interaction.customId === "battle:skill") {
        await handleSkillSelect(interaction);
        return;
    }

    await safeReply(interaction, "Unknown action.");
}

module.exports = { handleButton, handleBattleSelect };
