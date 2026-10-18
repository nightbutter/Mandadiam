// Builders for the /rpg dashboard views — embeds, buttons, select
// menus and the character-creation modal. Handlers live in menu.js.
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    LabelBuilder,
    FileUploadBuilder
} = require("discord.js");
const { RULES } = require("../services/characterService");

const COLOR = 0x5865f2;

// Shown when a character has no image_url — Discord's own default
// avatar asset (stable public CDN URL, no upload required).
const DEFAULT_PORTRAIT = "https://cdn.discordapp.com/embed/avatars/0.png";

// Rows use image_url; battle-shaped characters use imageUrl.
function portraitOf(character) {
    return character?.image_url ?? character?.imageUrl ?? DEFAULT_PORTRAIT;
}

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

// `admin` adds the Admin entry for ADMIN_IDS members only — the
// button is cosmetic; every admin:* interaction re-checks
// authorization server-side in admin.js.
function mainMenuView(profile, admin = false) {
    const description = profile
        ? `Welcome back, **${profile.player.username}** — ` +
          `active character: **${profile.activeCharacter?.name ?? "none"}**`
        : "You are not registered yet — press **Register** to begin.";

    const embed = new EmbedBuilder()
        .setTitle("🎮 Mandadiam — Main Menu")
        .setColor(COLOR)
        .setDescription(description)
        .setThumbnail(
            profile?.activeCharacter
                ? portraitOf(profile.activeCharacter)
                : null
        );

    // Unregistered users get the explicit Register entry point the
    // embed text references — plus Help. The rest of the menu would
    // only bounce them to the not-registered view anyway.
    const rows = profile
        ? [
            new ActionRowBuilder().addComponents(
                menuButton("menu:profile", "Profile", "👤"),
                menuButton("menu:chars", "My Characters", "🛡️"),
                menuButton("menu:create", "Create Character", "✨")
            ),
            new ActionRowBuilder().addComponents(
                menuButton("menu:battle", "Battle", "⚔️",
                    ButtonStyle.Success),
                menuButton("menu:help", "Help / Rules", "📖",
                    ButtonStyle.Secondary),
                ...(admin
                    ? [menuButton("menu:admin", "Admin", "🛠️",
                        ButtonStyle.Danger)]
                    : [])
            )
        ]
        : [
            new ActionRowBuilder().addComponents(
                menuButton("menu:register", "Register", "✅",
                    ButtonStyle.Success),
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
        )
        .setThumbnail(
            activeCharacter ? portraitOf(activeCharacter) : null
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

    const components = [];

    if (characters.length) {
        components.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId("menu:viewchar")
                    .setPlaceholder("View a character's details & portrait")
                    .addOptions(
                        characters.slice(0, 25).map(character => ({
                            label: character.name,
                            value: String(character.id),
                            description:
                                `HP ${character.max_hp} · ATK ` +
                                `${character.atk} · DEF ${character.def}` +
                                ` · SPE ${character.spe}`
                        }))
                    )
            )
        );
    }

    components.push(
        new ActionRowBuilder().addComponents(
            menuButton("menu:create", "Create Character", "✨"),
            menuButton(
                "menu:select", "Select Active", "🎯",
                ButtonStyle.Success
            ).setDisabled(!characters.length),
            menuButton("menu:main", "Back to Menu", "⬅️",
                ButtonStyle.Secondary)
        )
    );

    return { embeds: [embed], components };
}

// Full detail view for one character — portrait, stats, and the
// portrait management buttons. `isActive` marks the current pick.
function characterDetailView(character, activeCharacterId) {
    const embed = new EmbedBuilder()
        .setTitle(
            `🛡️ ${character.name}` +
            (character.id === activeCharacterId ? "  *(active)*" : "")
        )
        .setColor(COLOR)
        .setImage(portraitOf(character))
        .addFields(
            { name: "HP", value: String(character.max_hp), inline: true },
            { name: "ATK", value: String(character.atk), inline: true },
            { name: "DEF", value: String(character.def), inline: true },
            { name: "SPE", value: String(character.spe), inline: true }
        );

    const hasImage = Boolean(character.image_url);

    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(
                menuButton(
                    `menu:img:${character.id}`,
                    hasImage ? "Change Image" : "Set Image", "🖼️"
                ),
                menuButton(
                    `menu:imgdel:${character.id}`,
                    "Remove Image", "🗑️", ButtonStyle.Danger
                ).setDisabled(!hasImage),
                menuButton(
                    `menu:setactive:${character.id}`,
                    "Select Active", "🎯", ButtonStyle.Success
                ).setDisabled(character.id === activeCharacterId)
            ),
            new ActionRowBuilder().addComponents(
                menuButton("menu:chars", "Back to Characters", "⬅️",
                    ButtonStyle.Secondary),
                menuButton("menu:main", "Main Menu", "🏠",
                    ButtonStyle.Secondary)
            )
        ]
    };
}

// Native file-upload modal — Label (type 18) wrapping a FileUpload
// component (type 19), submitted via fields.getUploadedFiles().
// The character id rides in the modal customId as a routing hint only;
// ownership is re-verified server-side on submit.
function uploadImageModal(character) {
    return new ModalBuilder()
        .setCustomId(`modal:image:${character.id}`)
        .setTitle(`Portrait — ${character.name.slice(0, 35)}`)
        .setLabelComponents(
            new LabelBuilder()
                .setLabel("Portrait image (PNG/JPEG/WebP, max 5 MB)")
                .setDescription(
                    "Choose a file — the image is hosted on Discord's " +
                    "CDN while the message exists."
                )
                .setFileUploadComponent(
                    new FileUploadBuilder()
                        .setCustomId("img")
                        .setMinValues(1)
                        .setMaxValues(1)
                        .setRequired(true)
                )
        );
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

// Opponent picker — a StringSelect fed by the eligibility query
// (registered + active character + not busy), NOT a UserSelect: the
// Discord-rendered user picker lists raw guild members, so freshly
// joined/registered accounts can be missing and ineligible members
// show up as trap options.
const MAX_OPPONENT_OPTIONS = 25; // Discord select-menu cap.

function battleView(opponents = [], { total = opponents.length } = {}) {
    const select = new StringSelectMenuBuilder()
        .setCustomId("menu:opponent")
        .setPlaceholder(
            opponents.length
                ? "Select a player to challenge"
                : "No eligible opponents right now"
        )
        .setDisabled(!opponents.length)
        .addOptions(
            opponents.length
                ? opponents.map(player => ({
                      label: String(player.username).slice(0, 100),
                      value: String(player.discord_id),
                      description:
                          `Active: ${player.character_name}`.slice(0, 100)
                  }))
                : [{
                      label: "Nobody to challenge",
                      value: "none",
                      description: "Ask a friend to /register"
                  }]
        );

    let description =
        "Pick an opponent below — they'll get a challenge " +
        "message with Accept/Decline buttons.\n\n" +
        "Only registered players with an active character " +
        "are listed.";

    if (total > opponents.length) {
        description +=
            `\n\nShowing ${opponents.length} of ${total} eligible ` +
            "players — use `/battle-challenge` to pick anyone else.";
    }

    if (!opponents.length) {
        description +=
            "\n\nTo become challengeable: `/register`, create a " +
            "character, and select it as active.";
    }

    return {
        embeds: [
            new EmbedBuilder()
                .setTitle("⚔️ Challenge a player")
                .setColor(COLOR)
                .setDescription(description)
        ],
        components: [
            new ActionRowBuilder().addComponents(select),
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
                    "Attacks use d20 contests — ties reroll. " +
                    "d20 = 20 doubles the attack; a defending 20 reflects " +
                    "the hit. Damage is d8 + ATK − DEF (min 0), crits " +
                    "double. COST grows each turn, on hit and when hurt."
            },
            {
                name: "Skills",
                value:
                    "Press ✨ **Skills** on your turn in the battle " +
                    "panel. Skills use d8 + ATK + SPE − DEF and go on " +
                    "cooldown for a few of YOUR turns after use.\n" +
                    "• **Power Strike** — 3 COST, no condition, 2-turn cd\n" +
                    "• **Piercing Strike** — 2 COST, target ≤50% HP, " +
                    "3-turn cd\n" +
                    "• **Desperation Burst** — 2 COST, you ≤40% HP, " +
                    "3-turn cd"
            },
            {
                name: "Slash commands (fallback)",
                value:
                    "`/rpg` `/register` `/profile` `/characters` " +
                    "`/character-create` `/character-select` " +
                    "`/character-image` " +
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
    DEFAULT_PORTRAIT,
    portraitOf,
    mainMenuView,
    notRegisteredView,
    profileView,
    charactersView,
    characterDetailView,
    uploadImageModal,
    selectCharacterView,
    MAX_OPPONENT_OPTIONS,
    battleView,
    helpView,
    createCharacterModal
};
