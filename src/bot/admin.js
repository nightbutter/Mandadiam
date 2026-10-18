// Admin dashboard — status definition/rule configuration behind
// ADMIN_IDS. Every handler re-checks isAdmin() server-side before
// reading or mutating; customIds are routing hints, never auth.
//
// Views render over the caller's own /rpg dashboard message via
// interaction.update (ephemeral, session-bound upstream).
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require("discord.js");
const { isAdmin } = require("../config/env");
const statusService = require("../services/statusService");
const characterRepository =
    require("../database/repositories/characterRepository");
const skillRepository =
    require("../database/repositories/skillRepository");
const exRepository = require("../database/repositories/exRepository");
const { rulesForAction } = require("../game/statuses");

const COLOR = 0x9b59b6;
const PAGE_SIZE = 25;

const DENIED = "You don't have access to admin tools.";

async function rejectUnlessAdmin(interaction) {
    if (isAdmin(interaction.user.id)) {
        return false;
    }

    const payload = { content: DENIED, ephemeral: true };

    if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload).catch(() => {});
    } else {
        await interaction.reply(payload).catch(() => {});
    }

    return true;
}

function row(...components) {
    return new ActionRowBuilder().addComponents(...components);
}

function btn(customId, label, emoji, style = ButtonStyle.Primary) {
    const button = new ButtonBuilder()
        .setCustomId(customId)
        .setLabel(label)
        .setStyle(style);

    if (emoji) button.setEmoji(emoji);
    return button;
}

// Scope+key travel in ONE customId segment: "attack", "character",
// "skill|power_strike", "ex|fang_barrage" (keys never contain |).
function encodeScope(scope, key) {
    return key ? `${scope}|${key}` : scope;
}

function decodeScope(encoded) {
    const [scope, key = ""] = encoded.split("|");
    return { scope, key };
}

// --- views ------------------------------------------------------------------

function homeView() {
    return {
        embeds: [
            new EmbedBuilder()
                .setTitle("🛠️ Admin — Status System")
                .setColor(COLOR)
                .setDescription(
                    "Configure status definitions (the catalog) and " +
                    "per-character application rules.\n\n" +
                    "• **Definitions** — what each status does\n" +
                    "• **Rules** — which actions apply it, chance, " +
                    "duration, timing\n" +
                    "• Changes affect new battles only — live status " +
                    "instances are snapshots."
                )
        ],
        components: [
            row(
                btn("admin:defs", "Status Definitions", "📒"),
                btn("admin:chars:0", "Character Rules", "🧬"),
                btn("menu:main", "Back to Menu", "⬅️",
                    ButtonStyle.Secondary)
            )
        ]
    };
}

function defsView(defs) {
    const embed = new EmbedBuilder()
        .setTitle("📒 Status definitions")
        .setColor(COLOR);

    embed.setDescription(
        defs.length
            ? defs.map(d =>
                  `${d.enabled ? "🟢" : "⚪"} **${d.name}** \`${d.key}\`\n` +
                  `└ ${d.behavior} · power ${d.power}` +
                  `${d.is_percent ? "%" : ""} · ${d.default_duration}t · ` +
                  `${d.reapply_policy}`
              ).join("\n")
            : "No status definitions yet."
    );

    const components = [];

    if (defs.length) {
        components.push(
            row(
                new StringSelectMenuBuilder()
                    .setCustomId("admin:defsel")
                    .setPlaceholder("Select a definition to edit")
                    .addOptions(
                        defs.slice(0, 25).map(d => ({
                            label: d.name.slice(0, 100),
                            value: String(d.id),
                            description: d.key
                        }))
                    )
            )
        );
    }

    components.push(
        row(
            btn("admin:defnew", "New Definition", "➕",
                ButtonStyle.Success),
            btn("admin:home", "Back", "⬅️", ButtonStyle.Secondary)
        )
    );

    return { embeds: [embed], components };
}

function defView(def) {
    const embed = new EmbedBuilder()
        .setTitle(`${def.enabled ? "🟢" : "⚪"} ${def.name}`)
        .setColor(COLOR)
        .setDescription(def.description || "—")
        .addFields(
            { name: "Key", value: `\`${def.key}\``, inline: true },
            { name: "Behavior", value: def.behavior, inline: true },
            {
                name: "Power",
                value: `${def.power}${def.is_percent ? "%" : ""}`,
                inline: true
            },
            { name: "Max stacks", value: String(def.max_stacks), inline: true },
            { name: "Duration", value: `${def.default_duration}t`, inline: true },
            { name: "Policy", value: def.reapply_policy, inline: true }
        );

    const options = list => list.map(value => ({
        label: value,
        value,
        default: def.behavior === value || def.reapply_policy === value
    }));

    return {
        embeds: [embed],
        components: [
            row(
                new StringSelectMenuBuilder()
                    .setCustomId(`admin:defbeh:${def.id}`)
                    .setPlaceholder(`Behavior — ${def.behavior}`)
                    .addOptions(options([
                        "periodic_damage", "skip_turn",
                        "modify_atk", "modify_def"
                    ]))
            ),
            row(
                new StringSelectMenuBuilder()
                    .setCustomId(`admin:defpol:${def.id}`)
                    .setPlaceholder(`Reapply policy — ${def.reapply_policy}`)
                    .addOptions(options([
                        "refresh_duration", "stack_intensity",
                        "replace_if_stronger", "ignore_if_active",
                        "replace_duration"
                    ]))
            ),
            row(
                btn(`admin:defedit:${def.id}`, "Edit fields", "✏️"),
                btn(
                    `admin:deftoggle:${def.id}`,
                    def.enabled ? "Disable" : "Enable", "🔘",
                    ButtonStyle.Secondary
                ),
                btn(`admin:defdel:${def.id}`, "Delete", "🗑️",
                    ButtonStyle.Danger),
                btn("admin:defs", "Back", "⬅️", ButtonStyle.Secondary)
            )
        ]
    };
}

function input(id, label, opts = {}) {
    return row(
        new TextInputBuilder()
            .setCustomId(id)
            .setLabel(label)
            .setStyle(opts.long ? TextInputStyle.Paragraph
                               : TextInputStyle.Short)
            .setRequired(opts.required !== false)
            .setPlaceholder(opts.placeholder ?? "")
            .setValue(opts.value ?? "")
    );
}

function defNewModal() {
    return new ModalBuilder()
        .setCustomId("adminmodal:defnew")
        .setTitle("New status definition")
        .addComponents(
            input("key", "key (snake_case, unique)", {
                placeholder: "burn"
            }),
            input("name", "Display name", { placeholder: "Burn" }),
            input("behavior", "behavior", {
                placeholder:
                    "periodic_damage | skip_turn | modify_atk | modify_def"
            }),
            input("power", "power (int; skip_turn = 0)", {
                placeholder: "4"
            }),
            input("policy", "reapply policy", {
                placeholder:
                    "refresh_duration | stack_intensity | " +
                    "replace_if_stronger | ignore_if_active | " +
                    "replace_duration"
            })
        );
}

function defEditModal(def) {
    return new ModalBuilder()
        .setCustomId(`adminmodal:defedit:${def.id}`)
        .setTitle(`Edit ${def.name}`.slice(0, 45))
        .addComponents(
            input("name", "Display name", { value: def.name }),
            input("power", "power (int)", { value: String(def.power) }),
            input("max_stacks", "max stacks (1-10)",
                { value: String(def.max_stacks) }),
            input("default_duration", "default duration (turns)",
                { value: String(def.default_duration) }),
            input("description", "description",
                { value: def.description || "", required: false })
        );
}

function charsView(characters, page) {
    const embed = new EmbedBuilder()
        .setTitle(`🧬 Character rules — page ${page + 1}`)
        .setColor(COLOR)
        .setDescription(
            characters.length
                ? "Pick a character to configure its status rules."
                : "No characters on this page."
        );

    const components = [];

    if (characters.length) {
        components.push(
            row(
                new StringSelectMenuBuilder()
                    .setCustomId(`admin:charsel:${page}`)
                    .setPlaceholder("Select a character")
                    .addOptions(characters.map(c => ({
                        label: c.name.slice(0, 100),
                        value: String(c.id),
                        description: `#${c.id}`.slice(0, 100)
                    })))
            )
        );
    }

    components.push(
        row(
            btn(`admin:chars:${page - 1}`, "◀", null,
                ButtonStyle.Secondary).setDisabled(page === 0),
            btn(`admin:chars:${page + 1}`, "▶", null,
                ButtonStyle.Secondary)
                .setDisabled(characters.length < PAGE_SIZE),
            btn("admin:home", "Back", "⬅️", ButtonStyle.Secondary)
        )
    );

    return { embeds: [embed], components };
}

// Scope picker for one character — fallback, normal attack, each
// equipped skill, the assigned EX.
function scopesView(character, skillKeys, exKey) {
    const options = [
        { label: "Character default (fallback)", value: "character",
          description: "Applies to every action of this character" },
        { label: "Normal Attack", value: "attack",
          description: "Overrides the fallback for normal attacks" },
        ...skillKeys.map(k => ({
            label: `Skill: ${k}`, value: `skill|${k}`,
            description: `Overrides for ${k}`
        })),
        ...(exKey ? [{
            label: `EX: ${exKey}`, value: `ex|${exKey}`,
            description: `Overrides for ${exKey}`
        }] : [])
    ];

    return {
        embeds: [
            new EmbedBuilder()
                .setTitle(`🧬 ${character.name} — rule scopes`)
                .setColor(COLOR)
                .setDescription(
                    "Action rules override the character fallback for " +
                    "the same status. A disabled rule blocks the " +
                    "inherited one.\n\nPick a scope to edit its rules."
                )
        ],
        components: [
            row(
                new StringSelectMenuBuilder()
                    .setCustomId(`admin:scopesel:${character.id}`)
                    .setPlaceholder("Select a scope")
                    .addOptions(options)
            ),
            row(
                btn(`admin:preview:${character.id}`,
                    "Precedence preview", "🔎", ButtonStyle.Secondary),
                btn("admin:chars:0", "Back", "⬅️", ButtonStyle.Secondary)
            )
        ]
    };
}

// Rules list for one scope — every definition, configured or not.
function rulesView(character, scopeEnc, defs, rules) {
    const { scope, key } = decodeScope(scopeEnc);
    const scoped = rules.filter(r =>
        r.scope === scope && (r.action_key || "") === key);

    const byStatus = new Map(scoped.map(r => [r.status_id, r]));

    const embed = new EmbedBuilder()
        .setTitle(`Rules — ${character.name} · ${scopeEnc}`)
        .setColor(COLOR)
        .setDescription(
            defs.length
                ? defs.map(d => {
                      const r = byStatus.get(d.id);
                      return r
                          ? `${r.enabled ? "🟢" : "⚪"} **${d.name}** — ` +
                            `${r.chance}% · ` +
                            `${r.duration ?? d.default_duration}t · ` +
                            `${r.timing}` +
                            (Object.keys(r.conditions ?? {}).length
                                ? " · conditioned" : "")
                          : `▫️ **${d.name}** — not configured`;
                  }).join("\n")
                : "No definitions yet — create one under Definitions."
        );

    const components = [];

    if (defs.length) {
        components.push(
            row(
                new StringSelectMenuBuilder()
                    .setCustomId(`admin:rulesel:${character.id}:${scopeEnc}`)
                    .setPlaceholder("Select a status to configure")
                    .addOptions(defs.slice(0, 25).map(d => ({
                        label: d.name.slice(0, 100),
                        value: String(d.id),
                        description: byStatus.get(d.id)
                            ? "configured"
                            : "not configured"
                    })))
            )
        );
    }

    components.push(
        row(
            btn(`admin:char:${character.id}`, "Back", "⬅️",
                ButtonStyle.Secondary)
        )
    );

    return { embeds: [embed], components };
}

// Detail view for one (scope, status) — edit modal, toggle, delete.
function ruleView(character, scopeEnc, def, rule) {
    const embed = new EmbedBuilder()
        .setTitle(
            `${rule?.enabled === false ? "⚪" : "🟢"} ${def.name} — ` +
            `${character.name} · ${scopeEnc}`
        )
        .setColor(COLOR)
        .addFields(
            {
                name: "State",
                value: rule
                    ? rule.enabled ? "enabled" : "disabled (override)"
                    : "not configured — inherits fallback if any",
                inline: false
            },
            {
                name: "Chance",
                value: rule ? `${rule.chance}%` : "—",
                inline: true
            },
            {
                name: "Duration",
                value: `${rule?.duration ?? def.default_duration}t`,
                inline: true
            },
            {
                name: "Stacks",
                value: String(rule?.stacks ?? 1),
                inline: true
            },
            {
                name: "Timing",
                value: rule?.timing ?? "per_action",
                inline: true
            },
            {
                name: "Conditions",
                value: rule && Object.keys(rule.conditions ?? {}).length
                    ? `\`${JSON.stringify(rule.conditions)}\``
                    : "—",
                inline: true
            }
        );

    return {
        embeds: [embed],
        components: [
            row(
                btn(
                    `admin:ruleedit:${character.id}:${def.id}:${scopeEnc}`,
                    rule ? "Edit rule" : "Create rule", "✏️"
                ),
                btn(
                    `admin:ruletog:${character.id}:${def.id}:${scopeEnc}`,
                    rule?.enabled === false ? "Enable" : "Disable", "🔘",
                    ButtonStyle.Secondary
                ).setDisabled(!rule),
                btn(
                    `admin:ruledel:${character.id}:${def.id}:${scopeEnc}`,
                    "Delete rule", "🗑️", ButtonStyle.Danger
                ).setDisabled(!rule),
                btn(`admin:char:${character.id}`, "Back", "⬅️",
                    ButtonStyle.Secondary)
            )
        ]
    };
}

function ruleModal(cid, statusId, scopeEnc, rule, def) {
    return new ModalBuilder()
        .setCustomId(`adminmodal:rule:${cid}:${statusId}:${scopeEnc}`)
        .setTitle(`${def.name} rule`.slice(0, 45))
        .addComponents(
            input("chance", "chance % (0-100)",
                { value: String(rule?.chance ?? 100) }),
            input("duration", "duration turns (blank = default)",
                {
                    value: rule?.duration != null
                        ? String(rule.duration) : "",
                    required: false
                }),
            input("stacks", "stacks per application (1-10)",
                { value: String(rule?.stacks ?? 1) }),
            input("timing", "timing (per_action / per_hit)",
                { value: rule?.timing ?? "per_action" }),
            input("conditions",
                "conditions JSON (blank = none)",
                {
                    placeholder:
                        '{"target_hp_at_or_below_pct":50}',
                    value: rule && Object.keys(rule.conditions ?? {}).length
                        ? JSON.stringify(rule.conditions) : "",
                    required: false
                })
        );
}

// Precedence preview — per action, which rules govern (after scope
// resolution), marked inherited vs override.
function previewView(character, rules, skillKeys, exKey) {
    const actions = [
        { type: "normal", key: null, label: "Normal Attack" },
        ...skillKeys.map(k => ({
            type: "skill", key: k, label: `Skill: ${k}`
        })),
        ...(exKey ? [{ type: "ex", key: exKey, label: `EX: ${exKey}` }]
                 : [])
    ];

    const fields = actions.map(action => {
        const governing = rulesForAction(rules, {
            type: action.type === "normal" ? "normal" : action.type,
            key: action.key
        });

        const lines = governing.length
            ? governing.map(r =>
                  `${r.enabled === false ? "⚪ blocked:" : "🟢"} ` +
                  `**${r.name}** ${r.chance}% ` +
                  `${r.duration ?? r.default_duration}t ${r.timing} ` +
                  `(${r.scope === "character" ? "inherited" : r.scope})`
              )
            : ["— no rules"];

        return {
            name: action.label.slice(0, 256),
            value: lines.join("\n").slice(0, 1024),
            inline: false
        };
    });

    return {
        embeds: [
            new EmbedBuilder()
                .setTitle(`🔎 ${character.name} — effective rules`)
                .setColor(COLOR)
                .setDescription(
                    "What actually applies per action after precedence " +
                    "(action scope > normal attack > character fallback; " +
                    "disabled overrides block the fallback)."
                )
                .setFields(fields.slice(0, 25))
        ],
        components: [
            row(
                btn(`admin:char:${character.id}`, "Back", "⬅️",
                    ButtonStyle.Secondary)
            )
        ]
    };
}

// --- helpers ----------------------------------------------------------------

function parseIntOrNull(raw) {
    const trimmed = String(raw ?? "").trim();
    if (!trimmed) return null;
    return /^-?\d+$/.test(trimmed) ? Number(trimmed) : NaN;
}

// resolveRuleParts parses "admin:x:<cid>:<statusId>:<scopeEnc>".
function ruleParts(customId, prefix) {
    const rest = customId.slice(prefix.length);
    const [cid, statusId, ...encParts] = rest.split(":");
    return {
        characterId: Number(cid),
        statusId: Number(statusId),
        scopeEnc: encParts.join(":")
    };
}

async function loadRuleContext({ characterId, statusId, scopeEnc }) {
    const [character, def, rules] = await Promise.all([
        characterRepository.findById(characterId),
        statusService.findDefinition(statusId),
        statusService.listRulesForCharacter(characterId)
    ]);

    const { scope, key } = decodeScope(scopeEnc);
    const rule = rules.find(
        r => r.status_id === statusId && r.scope === scope &&
             (r.action_key || "") === key
    ) ?? null;

    return { character, def, rule };
}

// --- button handlers --------------------------------------------------------

async function showHome(interaction) {
    await interaction.update(homeView());
}

async function showDefs(interaction) {
    const defs = await statusService.listDefinitions();
    await interaction.update(defsView(defs));
}

async function showDef(interaction, id) {
    const def = await statusService.findDefinition(Number(id));

    if (!def) {
        await interaction.update(defsView(
            await statusService.listDefinitions()
        ));
        return;
    }

    await interaction.update(defView(def));
}

async function showChars(interaction, page) {
    const characters = await characterRepository.listAll(
        PAGE_SIZE, Math.max(0, page) * PAGE_SIZE
    );
    await interaction.update(charsView(characters, Math.max(0, page)));
}

async function showCharScopes(interaction, characterId) {
    const character = await characterRepository.findById(characterId);

    if (!character) {
        await showChars(interaction, 0);
        return;
    }

    const [skillKeys, exKey] = await Promise.all([
        skillRepository.listKeys(characterId),
        exRepository.getExKey(characterId)
    ]);

    await interaction.update(scopesView(character, skillKeys, exKey));
}

async function showRules(interaction, characterId, scopeEnc) {
    const [character, defs, rules] = await Promise.all([
        characterRepository.findById(characterId),
        statusService.listDefinitions(),
        statusService.listRulesForCharacter(characterId)
    ]);

    if (!character) {
        await showChars(interaction, 0);
        return;
    }

    await interaction.update(rulesView(character, scopeEnc, defs, rules));
}

async function showRule(interaction, parts) {
    const { character, def, rule } = await loadRuleContext(parts);

    if (!character || !def) {
        await showDefs(interaction);
        return;
    }

    await interaction.update(ruleView(character, parts.scopeEnc, def, rule));
}

async function showPreview(interaction, characterId) {
    const character = await characterRepository.findById(characterId);

    if (!character) {
        await showChars(interaction, 0);
        return;
    }

    const [rules, skillKeys, exKey] = await Promise.all([
        statusService.listRulesForCharacter(characterId),
        skillRepository.listKeys(characterId),
        exRepository.getExKey(characterId)
    ]);

    await interaction.update(
        previewView(character, rules, skillKeys, exKey)
    );
}

async function handleAdminButton(interaction) {
    if (await rejectUnlessAdmin(interaction)) {
        return;
    }

    const { customId } = interaction;

    if (customId === "admin:home") {
        await showHome(interaction);
        return;
    }

    if (customId === "admin:defs") {
        await showDefs(interaction);
        return;
    }

    if (customId === "admin:defnew") {
        await interaction.showModal(defNewModal());
        return;
    }

    if (customId.startsWith("admin:chars:")) {
        await showChars(
            interaction, Number(customId.slice("admin:chars:".length))
        );
        return;
    }

    if (customId.startsWith("admin:char:")) {
        await showCharScopes(
            interaction, Number(customId.slice("admin:char:".length))
        );
        return;
    }

    if (customId.startsWith("admin:preview:")) {
        await showPreview(
            interaction, Number(customId.slice("admin:preview:".length))
        );
        return;
    }

    if (customId.startsWith("admin:defedit:")) {
        const def = await statusService.findDefinition(
            Number(customId.slice("admin:defedit:".length))
        );

        if (!def) {
            await showDefs(interaction);
            return;
        }

        await interaction.showModal(defEditModal(def));
        return;
    }

    if (customId.startsWith("admin:deftoggle:")) {
        const def = await statusService.findDefinition(
            Number(customId.slice("admin:deftoggle:".length))
        );

        if (def) {
            await statusService.updateDefinition(
                def.id, { enabled: !def.enabled }
            );
        }

        await showDef(interaction, customId.slice("admin:deftoggle:".length));
        return;
    }

    if (customId.startsWith("admin:defdel:")) {
        const id = Number(customId.slice("admin:defdel:".length));
        await statusService.deleteDefinition(id);
        await showDefs(interaction);
        return;
    }

    if (customId.startsWith("admin:ruleedit:")) {
        const parts = ruleParts(customId, "admin:ruleedit:");
        const { character, def, rule } = await loadRuleContext(parts);

        if (!character || !def) {
            await showDefs(interaction);
            return;
        }

        await interaction.showModal(
            ruleModal(
                parts.characterId, parts.statusId, parts.scopeEnc,
                rule, def
            )
        );
        return;
    }

    if (customId.startsWith("admin:ruletog:")) {
        const parts = ruleParts(customId, "admin:ruletog:");
        const { character, def, rule } = await loadRuleContext(parts);

        if (character && def && rule) {
            await statusService.upsertRule({
                ...rule,
                character_id: parts.characterId,
                status_id: parts.statusId,
                enabled: !rule.enabled
            });
        }

        await showRule(interaction, parts);
        return;
    }

    if (customId.startsWith("admin:ruledel:")) {
        const parts = ruleParts(customId, "admin:ruledel:");
        const { rule } = await loadRuleContext(parts);

        if (rule) {
            await statusService.deleteRule(rule.id);
        }

        await showRules(
            interaction, parts.characterId, parts.scopeEnc
        );
        return;
    }

    await interaction.reply({
        content: "Unknown admin action.", ephemeral: true
    });
}

// --- select handlers ---------------------------------------------------------

async function handleAdminSelect(interaction) {
    if (await rejectUnlessAdmin(interaction)) {
        return;
    }

    const { customId } = interaction;

    if (customId === "admin:defsel") {
        await showDef(interaction, interaction.values[0]);
        return;
    }

    if (customId.startsWith("admin:charsel:")) {
        await showCharScopes(interaction, Number(interaction.values[0]));
        return;
    }

    if (customId.startsWith("admin:scopesel:")) {
        const cid = Number(customId.slice("admin:scopesel:".length));
        await showRules(interaction, cid, interaction.values[0]);
        return;
    }

    if (customId.startsWith("admin:rulesel:")) {
        // admin:rulesel:<cid>:<scopeEnc>, value = statusId
        const rest = customId.slice("admin:rulesel:".length);
        const [cid, ...enc] = rest.split(":");
        await showRule(interaction, {
            characterId: Number(cid),
            statusId: Number(interaction.values[0]),
            scopeEnc: enc.join(":")
        });
        return;
    }

    if (customId.startsWith("admin:defbeh:") ||
        customId.startsWith("admin:defpol:")) {
        const isBehavior = customId.startsWith("admin:defbeh:");
        const id = Number(
            customId.slice(customId.lastIndexOf(":") + 1)
        );
        const field = isBehavior ? "behavior" : "reapply_policy";

        const result = await statusService.updateDefinition(id, {
            [field]: interaction.values[0]
        });

        if (!result.ok) {
            await interaction.reply({
                content:
                    "Invalid value:\n• " +
                    (result.details ?? [result.error]).join("\n• "),
                ephemeral: true
            });
            return;
        }

        await showDef(interaction, id);
        return;
    }

    await interaction.reply({
        content: "Unknown admin action.", ephemeral: true
    });
}

// --- modal handlers ----------------------------------------------------------

function modalInt(interaction, id) {
    return parseIntOrNull(
        interaction.fields.getTextInputValue(id)
    );
}

async function handleDefNew(interaction) {
    const result = await statusService.createDefinition({
        key: interaction.fields.getTextInputValue("key"),
        name: interaction.fields.getTextInputValue("name"),
        behavior: interaction.fields.getTextInputValue("behavior"),
        power: modalInt(interaction, "power") ?? NaN,
        is_percent: false,
        max_stacks: 1,
        default_duration: 1,
        reapply_policy:
            interaction.fields.getTextInputValue("policy")
    });

    if (!result.ok) {
        await interaction.reply({
            content:
                "Couldn't create:\n• " +
                (result.details ?? [result.error]).join("\n• "),
            ephemeral: true
        });
        return;
    }

    await interaction.update(defView(result.definition));
}

async function handleDefEdit(interaction, id) {
    const def = await statusService.findDefinition(Number(id));

    if (!def) {
        await showDefs(interaction);
        return;
    }

    const result = await statusService.updateDefinition(id, {
        name: interaction.fields.getTextInputValue("name"),
        power: modalInt(interaction, "power"),
        max_stacks: modalInt(interaction, "max_stacks"),
        default_duration: modalInt(interaction, "default_duration"),
        description:
            interaction.fields.getTextInputValue("description")
    });

    if (!result.ok) {
        await interaction.reply({
            content:
                "Couldn't save:\n• " +
                (result.details ?? [result.error]).join("\n• "),
            ephemeral: true
        });
        return;
    }

    await interaction.update(defView(result.definition));
}

async function handleRuleModal(interaction, rest) {
    const [cid, statusId, ...enc] = rest.split(":");
    const scopeEnc = enc.join(":");
    const { scope, key } = decodeScope(scopeEnc);

    let conditions = {};
    const rawConditions =
        interaction.fields.getTextInputValue("conditions").trim();

    if (rawConditions) {
        try {
            conditions = JSON.parse(rawConditions);
        } catch {
            await interaction.reply({
                content: "Conditions must be valid JSON.",
                ephemeral: true
            });
            return;
        }
    }

    const durationRaw =
        interaction.fields.getTextInputValue("duration").trim();

    const result = await statusService.upsertRule({
        character_id: Number(cid),
        status_id: Number(statusId),
        scope,
        action_key: key,
        enabled: true,
        chance: modalInt(interaction, "chance") ?? NaN,
        duration: durationRaw === "" ? null
                                    : parseIntOrNull(durationRaw),
        stacks: modalInt(interaction, "stacks") ?? NaN,
        timing:
            interaction.fields.getTextInputValue("timing").trim(),
        conditions
    });

    if (!result.ok) {
        await interaction.reply({
            content:
                "Invalid rule:\n• " +
                (result.details ?? [result.error]).join("\n• "),
            ephemeral: true
        });
        return;
    }

    const parts = {
        characterId: Number(cid),
        statusId: Number(statusId),
        scopeEnc
    };
    const { character, def, rule } = await loadRuleContext(parts);

    await interaction.update(
        ruleView(character, scopeEnc, def, rule)
    );
}

async function handleAdminModal(interaction) {
    if (await rejectUnlessAdmin(interaction)) {
        return;
    }

    const { customId } = interaction;

    if (customId === "adminmodal:defnew") {
        await handleDefNew(interaction);
        return;
    }

    if (customId.startsWith("adminmodal:defedit:")) {
        await handleDefEdit(
            interaction,
            customId.slice("adminmodal:defedit:".length)
        );
        return;
    }

    if (customId.startsWith("adminmodal:rule:")) {
        await handleRuleModal(
            interaction, customId.slice("adminmodal:rule:".length)
        );
        return;
    }

    await interaction.reply({
        content: "Unknown admin form.", ephemeral: true
    });
}

module.exports = {
    homeView,
    handleAdminButton,
    handleAdminSelect,
    handleAdminModal
};
