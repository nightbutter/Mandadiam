// Builders for the /rpg dashboard views — embeds, buttons, select
// menus and the character-creation modal. Handlers live in menu.js.
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    UserSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require("discord.js");
const { RULES } = require("../services/characterService");

const COLOR = 0x5865f2;

function menuButton(customId, label, emoji, style = ButtonStyle.Primary) {
    const button = new ButtonBuilder()
        .setCustomId(customId)
        .setLabel(label)
        .setStyle(style);

    if (emoji) {
        button.setEmoji(emoji);
    }

    return button;
}

const backRow = new ActionRowBuilder().addComponents(
    menuButton("menu:main", "Back to Menu", "⬅️", ButtonStyle.Secondary)
);

// --- views -----------------------------------------------------------------

function mainMenuView(profile) {
    const description = profile
        ? `Welcome back, **${profile.player.username}** — ` +
          `active character: **${profile.activeCharacter?.name ?? "none"}**`
        : "You are not registered yet — press **Register** to begin.";

    const embed = new EmbedBuilder()
        .setTitle("🎮 Mandadiam — Main Menu")
        .setColor(COLOR)
        .setDescription(description);

    const rows = [
        new ActionRowBuilder().addComponents(
            menuButton("menu:profile", "Profile", "👤"),
            menuButton("menu:chars", "My Characters", "🛡️"),
            menuButton("menu:create", "Create Character", "✨")
        ),
        new ActionRowBuilder().addComponents(
            menuButton("menu:battle", "Battle", "⚔️", ButtonStyle.Success),
            menuButton("menu:help", "Help / Rules", "📖",
                ButtonStyle.Secondary)
        )
    ];

    return { embeds: [embed], components: rows };
}

function notRegisteredView() {
    return {
        embeds: [
            new EmbedBuilder()
                .setTitle("Not registered")
                .setColor(0xe67e22)
                .setDescription(
                    "You need a player profile first — " +
                    "press **Register** or use `/register`."
                )
        ],
        components: [
            new ActionRowBuilder().addComponents(
                menuButton("menu:register", "Register", "✅",
                    ButtonStyle.Success),
                menuButton("menu:main", "Back to Menu", "⬅️",
                    ButtonStyle.Secondary)
            )
        ]
    };
}

function profileView(profile, characterCount) {
    const { player, activeCharacter } = profile;

    const embed = new EmbedBuilder()
        .setTitle(`👤 ${player.username}`)
        .setColor(COLOR)
        .addFields(
            {
                name: "Registered",
                value: player.created_at.toISOString().slice(0, 10),
                inline: true
            },
            {
                name: "Characters",
                value: String(characterCount),
                inline: true
            },
            {
                name: "Active character",
                value: activeCharacter
                    ? `**${activeCharacter.name}** — HP ` +
                      `${activeCharacter.max_hp}, ATK ${activeCharacter.atk}, ` +
                      `DEF ${activeCharacter.def}, SPE ${activeCharacter.spe}`
                    : "none",
                inline: false
            }
        );

    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(
                menuButton("menu:chars", "My Characters", "🛡️"),
                menuButton("menu:select", "Select Active", "🎯"),
                menuButton("menu:main", "Back to Menu", "⬅️",
                    ButtonStyle.Secondary)
            )
        ]
    };
}

function charactersView(player, characters) {
    const embed = new EmbedBuilder()
        .setTitle("🛡️ Your characters")
        .setColor(COLOR);

    if (!characters.length) {
        embed.setDescription(
            "No characters yet — press **Create Character** to make one."
        );
    } else {
        embed.setFields(
            characters.slice(0, 25).map(character => ({
                name:
                    character.name +
                    (character.id === player.active_character_id
                        ? "  *(active)*"
                        : ""),
                value:
                    `HP ${character.max_hp} · ATK ${character.atk} · ` +
                    `DEF ${character.def} · SPE ${character.spe}`,
                inline: true
            }))
        );
    }

    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(
                menuButton("menu:create", "Create Character", "✨"),
                menuButton(
                    "menu:select", "Select Active", "🎯",
                    ButtonStyle.Success
                ).setDisabled(!characters.length),
                menuButton("menu:main", "Back to Menu", "⬅️",
                    ButtonStyle.Secondary)
            )
        ]
    };
}

function selectCharacterView(characters) {
    const select = new StringSelectMenuBuilder()
        .setCustomId("menu:pickchar")
        .setPlaceholder("Choose the character to make active")
        .addOptions(
            characters.slice(0, 25).map(character => ({
                label: character.name,
                value: String(character.id),
                description:
                    `HP ${character.max_hp} · ATK ${character.atk} · ` +
                    `DEF ${character.def} · SPE ${character.spe}`
            }))
        );

    return {
        embeds: [
            new EmbedBuilder()
                .setTitle("🎯 Select active character")
                .setColor(COLOR)
                .setDescription("Pick a character from the menu below.")
        ],
        components: [
            new ActionRowBuilder().addComponents(select),
            backRow
        ]
    };
}

function battleView() {
    return {
        embeds: [
            new EmbedBuilder()
                .setTitle("⚔️ Challenge a player")
                .setColor(COLOR)
                .setDescription(
                    "Pick an opponent below — they'll get a challenge " +
                    "message with Accept/Decline buttons.\n\n" +
                    "They must be registered with an active character."
                )
        ],
        components: [
            new ActionRowBuilder().addComponents(
                new UserSelectMenuBuilder()
                    .setCustomId("menu:opponent")
                    .setPlaceholder("Select a player to challenge")
            ),
            backRow
        ]
    };
}

function helpView() {
    const embed = new EmbedBuilder()
        .setTitle("📖 Help & Rules")
        .setColor(COLOR)
        .addFields(
            {
                name: "Character creation",
                value:
                    `Distribute up to **${RULES.budget} points** across ` +
                    `max_hp + atk + def + spe.\n` +
                    `• name: ${RULES.name.min}-${RULES.name.max} characters\n` +
                    `• max_hp: ${RULES.maxHp.min}-${RULES.maxHp.max}\n` +
                    `• atk/def/spe: ${RULES.stat.min}-${RULES.stat.max} each`
            },
            {
                name: "Battle",
                value:
                    "Normal attacks use d20 contests — ties reroll. " +
                    "d20 = 20 doubles the attack; a defending 20 reflects " +
                    "the hit. Damage is d8 + ATK − DEF (min 0), crits " +
                    "double. COST grows each turn, on hit and when hurt."
            },
            {
                name: "Slash commands (fallback)",
                value:
                    "`/register` `/profile` `/characters` " +
                    "`/character-create` `/character-select` " +
                    "`/battle-challenge` `/battle-accept` `/battle-status` " +
                    "`/battle-attack` `/battle-forfeit`"
            }
        )
        .setFooter({
            text: "Battles are in-memory — they do not survive restarts."
        });

    return { embeds: [embed], components: [backRow] };
}

// --- character creation modal ----------------------------------------------

function createCharacterModal() {
    const input = (id, label, placeholder) =>
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId(id)
                .setLabel(label)
                .setStyle(TextInputStyle.Short)
                .setPlaceholder(placeholder)
                .setRequired(true)
        );

    return new ModalBuilder()
        .setCustomId("modal:create")
        .setTitle(`New character — ${RULES.budget} point budget`)
        .addComponents(
            input("name", `Name (${RULES.name.min}-${RULES.name.max} chars)`,
                "e.g. Noctis"),
            input("max_hp", `Max HP (${RULES.maxHp.min}-${RULES.maxHp.max})`,
                "e.g. 100"),
            input("atk", `ATK (${RULES.stat.min}-${RULES.stat.max})`,
                "e.g. 20"),
            input("def", `DEF (${RULES.stat.min}-${RULES.stat.max})`,
                "e.g. 5"),
            input("spe", `SPE (${RULES.stat.min}-${RULES.stat.max})`,
                "e.g. 4")
        );
}

module.exports = {
    mainMenuView,
    notRegisteredView,
    profileView,
    charactersView,
    selectCharacterView,
    battleView,
    helpView,
    createCharacterModal
};
