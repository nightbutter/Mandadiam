// Shared rendering for battle commands — plain markdown, consistent
// with the project's existing command replies.
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder
} = require("discord.js");
const { getSkill } = require("../game/skills");
const { getExSkill } = require("../game/exSkills");
const { EX_MAX } = require("../game/exGauge");
const { describeRoll } = require("../game/manualRolls");

const MAX_LOG_LINES = 6;

const DEFAULT_PORTRAIT = "https://cdn.discordapp.com/embed/avatars/0.png";

function portraitOf(character) {
    return character?.imageUrl ?? DEFAULT_PORTRAIT;
}

function pushLog(session, line) {
    session.log.push(line);

    if (session.log.length > MAX_LOG_LINES) {
        session.log.shift();
    }
}

function hpBar(current, max) {
    const width = 10;
    const filled = Math.round(
        (Math.max(0, current) / Math.max(1, max)) * width
    );
    return "▰".repeat(filled) + "▱".repeat(width - filled);
}

function costPips(cost) {
    return "●".repeat(cost) + "○".repeat(Math.max(0, 6 - cost));
}

// Compact status summary for one fighter: "Burn ×1 (2t)".
function statusLine(character) {
    if (!character.statuses?.length) {
        return null;
    }

    return character.statuses
        .map(s =>
            `${s.name}` +
            (s.maxStacks > 1 ? ` ×${s.stacks}` : "") +
            ` (${s.remainingTurns}t)`
        )
        .join(", ");
}

function characterField(session, character) {
    const statuses = statusLine(character);

    return {
        name:
            `${character.name} — ` +
            mentionOwner(session, character),
        value:
            `${hpBar(character.hp, character.maxHp)} ` +
            `**${character.hp}/${character.maxHp}**\n` +
            `COST ${costPips(character.cost)} ${character.cost}/6\n` +
            `ATK ${character.atk} · DEF ${character.def} · ` +
            `SPE ${character.spe}` +
            (statuses ? `\n*${statuses}*` : ""),
        inline: true
    };
}

// One-line battle state for the embed title — public panels can't be
// personalised, so this stays viewer-neutral.
function stateBadge(session) {
    const { battle } = session;
    if (battle.status === "finished") {
        return "🏆 FINISHED";
    }
    if (session.pending?.type === "initiative") {
        return "🎲 INITIATIVE";
    }
    if (session.pending) {
        return "🎲 ROLLING";
    }
    return `⚔️ TURN ${battle.turnNumber}`;
}

// The single "who acts / who rolls next" line — initiative pending,
// manual-roll pending, and active turns all collapse into this field
// so a rendered panel can never mix a resolved initiative result
// with a stale "Rolling for initiative…" label.
function currentLine(session) {
    const { battle } = session;

    if (battle.status === "finished") {
        return `Finished — winner: **${battle.winner ?? "none"}**`;
    }

    if (session.pending) {
        const expected = describeRoll(session.pending);
        return expected
            ? `Waiting — ${expected.text}`
            : "Resolving dice…";
    }

    const turnPlayer = session.players.find(
        p => p.character === battle.currentTurn?.character
    );

    return turnPlayer
        ? `<@${turnPlayer.discordId}> to act`
        : "Rolling for initiative…";
}

// The persistent battle panel embed. `report` is the latest action's
// formatted text; a bounded tail of the rolling log is appended.
function buildBattleEmbed(session, report = null) {
    const { battle } = session;
    const [a, b] = battle.characters;

    const embed = new EmbedBuilder()
        .setTitle(`${stateBadge(session)} — ${a.name} vs ${b.name}`)
        .setColor(
            battle.status === "finished" ? 0x95a5a6 : 0xe74c3c
        )
        .addFields(
            characterField(session, a),
            characterField(session, b)
        );

    // One embed can only carry one thumbnail + one author icon:
    // the active fighter gets the thumbnail, the other goes top-left.
    // Before initiative resolves there is no current turn — default
    // to both fighters so portraits still show.
    const active = battle.currentTurn?.character ?? a;
    const other = battle.characters.find(c => c !== active) ?? b;

    embed.setThumbnail(portraitOf(active));
    embed.setAuthor({
        name: other.name,
        iconURL: portraitOf(other)
    });

    embed.addFields({
        name: "⚡ Current",
        value: currentLine(session),
        inline: false
    });

    const description = [
        report,
        // Bounded tail — the embed would reject an unbounded log.
        session.log.length ? session.log.slice(-8).join("\n") : null
    ].filter(Boolean).join("\n\n");

    if (description) {
        embed.setDescription(description.slice(0, 4000));
    }

    embed.setFooter({
        text:
            "📋 My Controls — your private actions · " +
            "🔄 Refresh — resync panels"
    });

    return embed;
}

// Button label for the currently expected die, e.g.
// "Roll d20 — Tie reroll" or "Roll d8 — Hit 2/3".
function rollButtonLabel(expected) {
    switch (expected.kind) {
        case "tie_reroll":
            return "Roll d20 — Tie reroll";
        case "contest":
            return "Roll d20";
        case "reflect":
            return "Roll d8 — Reflection";
        case "damage":
            return `Roll d8 — Hit ${expected.hitIndex + 1}/${expected.hitCount}`;
        default:
            return `Roll d${expected.die}`;
    }
}

// Controls equally available to both participants — the only buttons
// shown on the public panel while per-player DM panels are live.
// "My Controls" replies ephemerally with the clicker's private view,
// so a player whose DM never surfaced can still act.
function sharedRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("battle:mypanel")
            .setLabel("My Controls")
            .setEmoji("📋")
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId("battle:refresh")
            .setLabel("Refresh")
            .setEmoji("🔄")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("battle:forfeit")
            .setLabel("Forfeit")
            .setEmoji("🏳️")
            .setStyle(ButtonStyle.Danger)
    );
}

function rollButton(pending) {
    return new ButtonBuilder()
        .setCustomId(`battle:roll:${pending.id}`)
        .setLabel(rollButtonLabel(describeRoll(pending)))
        .setEmoji("🎲")
        .setStyle(ButtonStyle.Success);
}

function forfeitButton() {
    return new ButtonBuilder()
        .setCustomId("battle:forfeit")
        .setLabel("Forfeit")
        .setEmoji("🏳️")
        .setStyle(ButtonStyle.Danger);
}

// One player's private (DM) battle panel: the same status embed as
// the public view, but only the controls THIS player can currently
// use — a real per-user hide, not just a permission check.
function buildPrivateView(session, discordId) {
    const { battle } = session;
    const embeds = [buildBattleEmbed(session)];

    if (battle.status === "finished") {
        return {
            content: "🏆 Battle finished — see the channel for results.",
            embeds,
            components: []
        };
    }

    if (session.pending) {
        const expected = describeRoll(session.pending);

        if (expected && expected.discordId === discordId) {
            return {
                content: `🎲 Your roll — ${expected.text}`,
                embeds,
                components: [
                    new ActionRowBuilder().addComponents(
                        rollButton(session.pending),
                        forfeitButton()
                    )
                ]
            };
        }

        return {
            content: expected
                ? `⏳ Waiting for ${expected.text}`
                : "⏳ Waiting for the other player…",
            embeds,
            components: [
                new ActionRowBuilder().addComponents(forfeitButton())
            ]
        };
    }

    const actor = battle.currentTurn?.character;
    const mine = session.players.find(
        p => p.discordId === discordId
    );

    if (mine && mine.character === actor) {
        return {
            content: "⚔️ Your turn — choose an action.",
            embeds,
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId("battle:attack")
                        .setLabel("Attack")
                        .setEmoji("⚔️")
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId("battle:skills")
                        .setLabel("Skills")
                        .setEmoji("✨")
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId("battle:ultimate")
                        .setLabel("Ultimate")
                        .setEmoji("💥")
                        .setStyle(ButtonStyle.Danger),
                    forfeitButton()
                )
            ]
        };
    }

    return {
        content: "⏳ Waiting for the other player's turn…",
        embeds,
        components: [
            new ActionRowBuilder().addComponents(forfeitButton())
        ]
    };
}

function buildBattleRow(session) {
    const finished = session.battle.status === "finished";

    // Per-player DM panels carry the action controls; the public
    // panel keeps only shared controls unless a player's DM is
    // unavailable (dmFailed) — then fall back to the full public row.
    if (!session.dmFailed?.size && !finished) {
        return sharedRow();
    }

    // While dice are being collected the panel shows ONE roll button
    // keyed to the pending action id — stale clicks can't replay it.
    if (session.pending && !finished) {
        return new ActionRowBuilder().addComponents(
            rollButton(session.pending),
            new ButtonBuilder()
                .setCustomId("battle:refresh")
                .setLabel("Refresh")
                .setEmoji("🔄")
                .setStyle(ButtonStyle.Secondary),
            forfeitButton()
        );
    }

    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("battle:attack")
            .setLabel("Attack")
            .setEmoji("⚔️")
            .setStyle(ButtonStyle.Primary)
            .setDisabled(finished),
        new ButtonBuilder()
            .setCustomId("battle:skills")
            .setLabel("Skills")
            .setEmoji("✨")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(finished),
        new ButtonBuilder()
            .setCustomId("battle:ultimate")
            .setLabel("Ultimate")
            .setEmoji("💥")
            .setStyle(ButtonStyle.Danger)
            .setDisabled(finished),
        new ButtonBuilder()
            .setCustomId("battle:refresh")
            .setLabel("Refresh")
            .setEmoji("🔄")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(finished),
        forfeitButton().setDisabled(finished)
    );
}

// Select menu listing the acting character's equipped skills. Each
// option shows COST and whether the condition is currently met — the
// service re-validates everything server-side on use.
function buildSkillSelectMenu(session) {
    const actor = session.battle.currentTurn?.character;
    const defender = session.battle.characters.find(c => c !== actor);

    const options = (actor?.skills ?? []).map(key => {
        const skill = getSkill(key);

        if (!skill) {
            return null;
        }

        const affordable = actor.cost >= skill.cost;
        const condition = skill.canUse(actor, defender);
        const cooling = actor.cooldowns?.[key] ?? 0;

        const status = cooling > 0
            ? `⏳ Cooldown: ${cooling} of your turns`
            : !affordable
                ? `✗ needs ${skill.cost} COST`
                : condition.ok
                    ? "✓ ready"
                    : `✗ ${condition.reason}`;

        return {
            label: `${skill.name} — ${skill.cost} COST`,
            value: skill.key,
            description:
                `${status} · cd ${skill.cooldown} · ` +
                `${skill.description}`.slice(0, 100)
        };
    }).filter(Boolean);

    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId("battle:skill")
            .setPlaceholder("Choose a skill")
            .addOptions(options.length ? options : [{
                label: "No skills available",
                value: "none"
            }])
    );
}

// Ephemeral Ultimate detail/confirmation content. Returns the text
// plus whether activation is currently legal — the service still
// re-validates everything at confirm time.
function buildExPrompt(character) {
    const exDef = character.exKey ? getExSkill(character.exKey) : null;

    if (!exDef) {
        return {
            content: "💥 This character has no Ultimate assigned.",
            ready: false
        };
    }

    const lines = [
        `💥 **${exDef.name}**`,
        exDef.description,
        `COST: ${exDef.cost} · EX: ${character.ex ?? 0}/${EX_MAX}`
    ];

    let ready = true;

    if (character.ex !== EX_MAX) {
        lines.push("❌ EX gauge not full");
        ready = false;
    } else if (character.cost < exDef.cost) {
        lines.push("❌ Not enough COST");
        ready = false;
    } else {
        lines.push("✅ Ready to unleash!");
    }

    return { content: lines.join("\n"), ready };
}

function ownerOf(session, character) {
    return session.players.find(p => p.character === character) ?? null;
}

function mentionOwner(session, character) {
    const owner = ownerOf(session, character);
    return owner ? `<@${owner.discordId}>` : character.name;
}

// 10-cell text gauge, e.g. [██████░░░░].
function exBar(ex) {
    const filled = Math.round(((ex ?? 0) / EX_MAX) * 10);
    return "█".repeat(filled) + "░".repeat(10 - filled);
}

function statLine(session, character) {
    const exDef = character.exKey ? getExSkill(character.exKey) : null;
    const exText = exDef
        ? `EX [${exBar(character.ex)}] ${character.ex ?? 0}/${EX_MAX} ` +
          `· 💥${exDef.name} (${exDef.cost})`
        : "EX —";

    return (
        `**${character.name}** ${mentionOwner(session, character)} — ` +
        `HP ${character.hp}/${character.maxHp} · COST ${character.cost} · ` +
        `ATK ${character.atk} DEF ${character.def} SPE ${character.spe}\n` +
        `${exText}`
    );
}

function formatStatus(session) {
    const { battle } = session;
    const lines = ["**Battle status**\n"];

    for (const character of battle.characters) {
        lines.push(statLine(session, character));
    }

    const turnPlayer = session.players.find(
        p => p.character === battle.currentTurn?.character
    );

    lines.push(
        turnPlayer
            ? `Turn ${battle.turnNumber}: <@${turnPlayer.discordId}> to act`
            : `Battle is ${battle.status}`
    );

    return lines.join("\n");
}

function formatHits(result) {
    return result.hits
        .map(hit =>
            `🎲 d8 ${hit.roll}` +
            (hit.critical ? " **CRIT**" : "") +
            ` → ${hit.damage} damage`
        )
        .join("\n");
}

// Human-readable report for one resolved attack.
function formatAttackReport(session, result) {
    const attacker = session.players.find(
        p => p.character.name === result.attacker
    );
    const defender = session.players.find(
        p => p.character.name === result.defender
    );

    const lines = [];

    const verb = result.exName
        ? `unleashes **${result.exName}**`
        : result.skillName
            ? `uses **${result.skillName}**`
            : "attacks";

    if (result.outcome === "reflected") {
        lines.push(
            `⚔️ <@${attacker.discordId}> ${verb} — but ` +
            `${result.defender} rolls d20 **20** and reflects it!`,
            `🎲 d8 ${result.reflectRoll} → ${result.damage} damage back`,
            `${result.attacker}: HP ${result.remainingHp}/${attacker.character.maxHp}`
        );
    } else {
        const title = result.outcome === "double_attack"
            ? `⚔️ <@${attacker.discordId}> ${verb} — d20 **20**, double attack!`
            : `⚔️ <@${attacker.discordId}> ${verb}`;

        lines.push(
            title,
            `d20: ${result.attackerRoll} vs ${result.defenderRoll}` +
                (result.rerolls ? ` (ties rerolled x${result.rerolls})` : ""),
            formatHits(result),
            `${result.defender}: HP ${result.remainingHp}/` +
                `${defender.character.maxHp}`
        );
    }

    lines.push(
        `COST — ${result.attacker}: ${result.attackerCost}` +
        (result.exCost ? ` (−${result.exCost} ultimate)` : "") +
        (result.skillCost ? ` (−${result.skillCost} skill)` : "") +
        ` · ${result.defender}: ${result.defenderCost}`
    );

    return lines.join("\n");
}

// Dedicated final-result card — a standalone channel message sent
// once when a battle ends, separate from the rolling panel log.
// reason: "knockout" | "forfeit".
function buildBattleResultEmbed(session, reason = "knockout") {
    const { battle } = session;
    const winnerPlayer = session.players.find(
        p => p.character.name === battle.winner
    );
    const loserPlayer = session.players.find(
        p => p !== winnerPlayer
    );
    const wc = winnerPlayer?.character;
    const lc = loserPlayer?.character;

    const outcome = reason === "forfeit"
        ? `${lc?.name ?? "The loser"} forfeits — ` +
          `**${wc?.name ?? battle.winner ?? "Nobody"}** wins!`
        : `**${wc?.name ?? battle.winner ?? "Nobody"}** wins ` +
          "by knockout!";

    const embed = new EmbedBuilder()
        .setTitle("🏆 Battle Finished")
        .setColor(0xf1c40f)
        .setDescription(
            (wc ? `${mentionOwner(session, wc)} ` : "") +
            `${wc?.name ?? ""}\n\n` +
            outcome
        );

    if (wc) {
        embed.addFields({
            name: `🥇 ${wc.name}`,
            value:
                `HP ${wc.hp}/${wc.maxHp} · COST ${wc.cost}`,
            inline: true
        });
    }

    if (lc) {
        embed.addFields({
            name: `🥈 ${lc.name}`,
            value:
                `HP ${Math.max(0, lc.hp)}/${lc.maxHp} · ` +
                `COST ${lc.cost}`,
            inline: true
        });
    }

    embed.addFields({
        name: "Result",
        value:
            (reason === "forfeit" ? "Forfeit" : "Knockout") +
            ` after ${battle.turnNumber} turn(s)`,
        inline: true
    });

    return embed;
}

module.exports = {
    mentionOwner,
    statLine,
    buildBattleResultEmbed,
    formatStatus,
    formatAttackReport,
    pushLog,
    buildBattleEmbed,
    buildBattleRow,
    buildPrivateView,
    rollButtonLabel,
    buildSkillSelectMenu,
    buildExPrompt,
    exBar
};
