// Dashboard interaction handlers — routes menu:* buttons, the select
// menus and the character-creation modal. Every entry point re-checks
// that the clicker owns the dashboard and that state is still valid;
// customIds are routing hints, never authorization.
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder
} = require("discord.js");
const { env } = require("../config/env");
const playerService = require("../services/playerService");
const characterService = require("../services/characterService");
const battleService = require("../game/services/battleService");
const views = require("./menuViews");
const uiSessions = require("./uiSessions");
const { prepareChallenge, trackChallengeMessage } =
    require("./challengeFlow");

const NOT_OWNER =
    "This menu belongs to someone else — open your own with /rpg.";
const NO_DB = "Database features are unavailable.";

function backRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("menu:main")
            .setLabel("Back to Menu")
            .setEmoji("⬅️")
            .setStyle(ButtonStyle.Secondary)
    );
}

// Ownership is verified against the server-side session registry
// first (works for any message we created and bound), falling back to
// Discord-provided interaction metadata. Message#interaction is the
// deprecated field — API no longer sends it on ephemeral or
// modal-response messages, which is why a metadata-only check broke.
// Fails closed: no session + no metadata = not the owner.
function ownsDashboard(interaction) {
    const message = interaction.message;

    if (!message) {
        return false;
    }

    if (uiSessions.ownerOf(message.id) === interaction.user.id) {
        return true;
    }

    const origin = message.interactionMetadata ?? message.interaction;
    return origin?.user?.id === interaction.user.id;
}

// Replies privately and binds the new message id to the clicker so its
// buttons can be validated even without interaction metadata.
async function replyOwned(interaction, payload) {
    const message = await interaction.reply({
        ...payload,
        ephemeral: true,
        fetchReply: true
    });

    uiSessions.bind(message, interaction.user.id);
    return message;
}

async function rejectUnlessOwner(interaction) {
    if (ownsDashboard(interaction)) {
        return false;
    }

    await interaction.reply({ content: NOT_OWNER, ephemeral: true });
    return true;
}

// --- views ------------------------------------------------------------------

async function showMain(interaction) {
    const profile = env.databaseUrl
        ? await playerService.getProfile(interaction.user.id)
        : null;

    await interaction.update(views.mainMenuView(profile));
}

async function showProfile(interaction) {
    const profile = await playerService.getProfile(interaction.user.id);

    if (!profile) {
        await interaction.update(views.notRegisteredView());
        return;
    }

    const { characters } = await characterService.listCharacters(
        interaction.user.id
    );

    await interaction.update(
        views.profileView(profile, characters.length)
    );
}

async function showCharacters(interaction) {
    const result = await characterService.listCharacters(
        interaction.user.id
    );

    await interaction.update(
        result.ok
            ? views.charactersView(result.player, result.characters)
            : views.notRegisteredView()
    );
}

async function showSelect(interaction) {
    const result = await characterService.listCharacters(
        interaction.user.id
    );

    if (!result.ok) {
        await interaction.update(views.notRegisteredView());
        return;
    }

    await interaction.update(
        result.characters.length
            ? views.selectCharacterView(result.characters)
            : views.charactersView(result.player, [])
    );
}

async function showBattle(interaction) {
    const session = battleService.getSessionForPlayer(
        interaction.user.id
    );

    if (session) {
        await interaction.update({
            embeds: [
                new EmbedBuilder()
                    .setTitle("⚔️ Battle in progress")
                    .setDescription(
                        "You're already in a battle — use the battle " +
                        "panel's Attack/Forfeit buttons in its channel."
                    )
            ],
            components: [backRow()]
        });
        return;
    }

    await interaction.update(views.battleView());
}

async function handleRegister(interaction) {
    await playerService.registerPlayer(
        interaction.user.id, interaction.user.username
    );

    const profile = await playerService.getProfile(interaction.user.id);
    const view = views.mainMenuView(profile);

    view.embeds[0].setDescription(
        "✅ Registered — welcome to Mandadiam!\n\n" +
        view.embeds[0].data.description
    );

    await interaction.update(view);
}

// Select-active buttons carry the character id (menu:setactive:<id>);
// the service re-verifies ownership against the player's own row.
async function handleSetActive(interaction, characterId) {
    const result = await characterService.selectCharacterById(
        interaction.user.id, Number(characterId)
    );

    if (!result.ok) {
        await interaction.reply({
            content: "Couldn't select that character.",
            ephemeral: true
        });
        return;
    }

    await interaction.update({
        embeds: [
            new EmbedBuilder()
                .setTitle("🎯 Active character updated")
                .setDescription(
                    `**${result.character.name}** — HP ` +
                    `${result.character.max_hp}, ATK ` +
                    `${result.character.atk}, DEF ` +
                    `${result.character.def}, SPE ${result.character.spe}`
                )
        ],
        components: [backRow()]
    });
}

// --- portraits ---------------------------------------------------------------

// Renders the detail view for a character the clicker owns.
async function showCharacterDetail(interaction, characterId) {
    const owned = await characterService.getOwnedCharacter(
        interaction.user.id, characterId
    );

    if (!owned.ok) {
        await interaction.reply({
            content: "Couldn't load that character.",
            ephemeral: true
        });
        return;
    }

    const profile = await playerService.getProfile(interaction.user.id);

    await interaction.update(
        views.characterDetailView(
            owned.character, profile?.player.active_character_id
        )
    );
}

// Opens the native file-upload modal — the user picks the image
// directly in Discord's UI; no channel message is needed. Ownership
// is checked before opening AND again on submit.
async function handleSetImage(interaction, characterId) {
    const owned = await characterService.getOwnedCharacter(
        interaction.user.id, characterId
    );

    if (!owned.ok) {
        await interaction.reply({
            content: "Couldn't load that character.",
            ephemeral: true
        });
        return;
    }

    await interaction.showModal(views.uploadImageModal(owned.character));
}

async function handleRemoveImage(interaction, characterId) {
    const result = await characterService.clearCharacterImage(
        interaction.user.id, characterId
    );

    if (!result.ok) {
        await interaction.reply({
            content: "Couldn't update that character.",
            ephemeral: true
        });
        return;
    }

    const profile = await playerService.getProfile(interaction.user.id);

    await interaction.update(
        views.characterDetailView(
            result.character, profile?.player.active_character_id
        )
    );
}

const buttonHandlers = {
    "menu:main": showMain,
    "menu:profile": showProfile,
    "menu:chars": showCharacters,
    "menu:select": showSelect,
    "menu:battle": showBattle,
    "menu:help": interaction =>
        interaction.update(views.helpView()),
    "menu:register": handleRegister,
    "menu:create": interaction =>
        interaction.showModal(views.createCharacterModal())
};

async function handleMenuButton(interaction) {
    if (await rejectUnlessOwner(interaction)) {
        return;
    }

    if (!env.databaseUrl) {
        await interaction.reply({ content: NO_DB, ephemeral: true });
        return;
    }

    const { customId } = interaction;

    if (customId.startsWith("menu:setactive:")) {
        await handleSetActive(interaction, customId.slice(15));
        return;
    }

    if (customId.startsWith("menu:img:")) {
        await handleSetImage(interaction, customId.slice(9));
        return;
    }

    if (customId.startsWith("menu:imgdel:")) {
        await handleRemoveImage(interaction, customId.slice(12));
        return;
    }

    const handler = buttonHandlers[customId];

    if (!handler) {
        await interaction.reply({
            content: "Unknown menu action.",
            ephemeral: true
        });
        return;
    }

    await handler(interaction);
}

// --- select menus -----------------------------------------------------------

async function handlePickCharacter(interaction) {
    const result = await characterService.selectCharacterById(
        interaction.user.id, Number(interaction.values[0])
    );

    if (!result.ok) {
        await interaction.update(views.notRegisteredView());
        return;
    }

    await interaction.update({
        embeds: [
            new EmbedBuilder()
                .setTitle("🎯 Active character updated")
                .setDescription(
                    `**${result.character.name}** — HP ` +
                    `${result.character.max_hp}, ATK ` +
                    `${result.character.atk}, DEF ` +
                    `${result.character.def}, SPE ${result.character.spe}`
                )
        ],
        components: [backRow()]
    });
}

async function handlePickOpponent(interaction) {
    const opponent = interaction.users.first();
    const prepared = await prepareChallenge(interaction, opponent);

    if (!prepared.ok) {
        await interaction.update({
            embeds: [
                new EmbedBuilder()
                    .setTitle("⚔️ Challenge failed")
                    .setDescription(prepared.reason)
            ],
            components: views.battleView().components
        });
        return;
    }

    const message = await interaction.channel.send(prepared.payload);
    trackChallengeMessage(
        message, prepared.challenge, interaction.channelId
    );

    await interaction.update({
        embeds: [
            new EmbedBuilder()
                .setTitle("⚔️ Challenge sent")
                .setDescription(
                    `Waiting for <@${opponent.id}> to respond — ` +
                    "the challenge expires in 60s."
                )
        ],
        components: [backRow()]
    });
}

async function handleSelectMenu(interaction) {
    if (await rejectUnlessOwner(interaction)) {
        return;
    }

    if (!env.databaseUrl) {
        await interaction.reply({ content: NO_DB, ephemeral: true });
        return;
    }

    if (interaction.customId === "menu:pickchar") {
        await handlePickCharacter(interaction);
        return;
    }

    if (interaction.customId === "menu:viewchar") {
        await showCharacterDetail(interaction, interaction.values[0]);
        return;
    }

    if (interaction.customId === "menu:opponent") {
        await handlePickOpponent(interaction);
        return;
    }

    await interaction.reply({
        content: "Unknown menu action.",
        ephemeral: true
    });
}

// --- character creation modal ------------------------------------------------

function parseIntField(interaction, id) {
    const raw = interaction.fields.getTextInputValue(id).trim();
    return /^-?\d+$/.test(raw) ? Number(raw) : NaN;
}

function menuRow(...buttons) {
    return new ActionRowBuilder().addComponents(...buttons);
}

// Edits the dashboard in place on modal submit — ModalSubmit.update()
// targets the message that opened the modal, so all resulting buttons
// stay on the session-bound dashboard message. Falls back to a bound
// private reply when the original message is gone.
async function updateDashboard(interaction, view) {
    try {
        await interaction.update(view);
    } catch {
        await replyOwned(interaction, view);
    }
}

async function handleCreateModal(interaction) {
    const result = await characterService.createCharacter(
        interaction.user.id,
        {
            name: interaction.fields.getTextInputValue("name"),
            maxHp: parseIntField(interaction, "max_hp"),
            atk: parseIntField(interaction, "atk"),
            def: parseIntField(interaction, "def"),
            spe: parseIntField(interaction, "spe")
        }
    );

    if (!result.ok) {
        const description = result.error === "not_registered"
            ? "You are not registered yet — use /register first."
            : result.error === "duplicate_name"
                ? "You already have a character with that name."
                : `Invalid stats:\n• ${result.details.join("\n• ")}`;

        await updateDashboard(interaction, {
            embeds: [
                new EmbedBuilder()
                    .setTitle("✨ Create character")
                    .setColor(0xe67e22)
                    .setDescription(description)
            ],
            components: [
                menuRow(
                    new ButtonBuilder()
                        .setCustomId("menu:create")
                        .setLabel("Open form again")
                        .setEmoji("✨")
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId("menu:main")
                        .setLabel("Back to Menu")
                        .setEmoji("⬅️")
                        .setStyle(ButtonStyle.Secondary)
                )
            ]
        });
        return;
    }

    const character = result.character;

    await updateDashboard(interaction, {
        embeds: [
            new EmbedBuilder()
                .setTitle("✨ Character created")
                .setDescription(
                    `**${character.name}** — HP ${character.max_hp}, ` +
                    `ATK ${character.atk}, DEF ${character.def}, ` +
                    `SPE ${character.spe}.`
                )
        ],
        components: [
            menuRow(
                new ButtonBuilder()
                    .setCustomId(`menu:setactive:${character.id}`)
                    .setLabel("Select as Active")
                    .setEmoji("🎯")
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId("menu:main")
                    .setLabel("Back to Menu")
                    .setEmoji("⬅️")
                    .setStyle(ButtonStyle.Secondary)
            )
        ]
    });
}

// Handles the portrait-upload modal — modal:image:<characterId>. The
// id is only a routing hint; setCharacterImage re-verifies that the
// submitter owns the character before writing.
async function handleImageModal(interaction, characterId) {
    const file = interaction.fields
        .getUploadedFiles("img")?.first() ?? null;

    const fail = async description => updateDashboard(interaction, {
        embeds: [
            new EmbedBuilder()
                .setTitle("🖼️ Portrait not saved")
                .setColor(0xe67e22)
                .setDescription(description)
        ],
        components: [
            menuRow(
                new ButtonBuilder()
                    .setCustomId(`menu:img:${characterId}`)
                    .setLabel("Try again")
                    .setEmoji("🖼️")
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId("menu:chars")
                    .setLabel("Back to Characters")
                    .setEmoji("⬅️")
                    .setStyle(ButtonStyle.Secondary)
            )
        ]
    });

    const validation = characterService.validateImageAttachment(file);

    if (!validation.ok) {
        await fail(validation.reason ?? "Attach a valid image file.");
        return;
    }

    const result = await characterService.setCharacterImage(
        interaction.user.id, Number(characterId), validation.url
    );

    if (!result.ok) {
        await fail(
            "Couldn't save the image — that character isn't yours " +
            "or no longer exists."
        );
        return;
    }

    const profile = await playerService.getProfile(interaction.user.id);

    await updateDashboard(
        interaction,
        views.characterDetailView(
            result.character, profile?.player.active_character_id
        )
    );
}

async function handleModalSubmit(interaction) {
    if (!env.databaseUrl) {
        await interaction.reply({ content: NO_DB, ephemeral: true });
        return;
    }

    if (interaction.customId.startsWith("modal:image:")) {
        await handleImageModal(interaction, interaction.customId.slice(12));
        return;
    }

    if (interaction.customId === "modal:create") {
        await handleCreateModal(interaction);
        return;
    }

    await interaction.reply({
        content: "Unknown form submission.",
        ephemeral: true
    });
}

module.exports = {
    mainMenuView: views.mainMenuView,
    ownsDashboard,
    handleMenuButton,
    handleSelectMenu,
    handleModalSubmit
};
