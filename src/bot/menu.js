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

// The dashboard is an ephemeral reply to /rpg — the component's
// message remembers the original interaction and its invoker.
function ownsDashboard(interaction) {
    return (
        interaction.message?.interaction?.user?.id ===
        interaction.user.id
    );
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
        const content = result.error === "not_registered"
            ? "You are not registered yet — use /register first."
            : result.error === "duplicate_name"
                ? "You already have a character with that name."
                : `Invalid stats:\n• ${result.details.join("\n• ")}`;

        await interaction.reply({
            content,
            ephemeral: true,
            components: [
                menuRow(
                    new ButtonBuilder()
                        .setCustomId("menu:create")
                        .setLabel("Open form again")
                        .setEmoji("✨")
                        .setStyle(ButtonStyle.Primary)
                )
            ]
        });
        return;
    }

    const character = result.character;

    await interaction.reply({
        content:
            `✨ Created **${character.name}** — HP ${character.max_hp}, ` +
            `ATK ${character.atk}, DEF ${character.def}, ` +
            `SPE ${character.spe}.`,
        ephemeral: true,
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

async function handleModalSubmit(interaction) {
    if (!env.databaseUrl) {
        await interaction.reply({ content: NO_DB, ephemeral: true });
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
