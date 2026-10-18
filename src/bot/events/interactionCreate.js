const { Events, MessageFlags } = require("discord.js");
const { commands } = require("../commands");

// Logs the real failure, then tries to inform the user using the
// response method that matches the interaction's actual ack state:
//   not acked          → reply (ephemeral)
//   deferred, not sent → editReply
//   already replied    → followUp
// The recovery send is itself wrapped — if the token has expired
// (10062) or the interaction was already acknowledged (40060) the
// failure is logged and swallowed so error handling can never turn
// a handler error into an unhandled rejection that crashes the bot.
// err objects logged here are discord.js/app errors only — no
// interaction tokens or secrets are included.
async function reportError(interaction, context, err) {
    console.error(`${context} failed:`, err);

    const payload = {
        content: "Something went wrong with that action.",
        ephemeral: true
    };

    try {
        if (interaction.replied) {
            await interaction.followUp(payload);
        } else if (interaction.deferred) {
            await interaction.editReply(payload);
        } else {
            await interaction.reply(payload);
        }
    } catch (ackError) {
        console.error(
            `${context} — could not report error to user ` +
            `(code ${ackError.code ?? "unknown"})`
        );
    }
}

module.exports = {
    name: Events.InteractionCreate,
    once: false,
    async execute(interaction) {
        if (interaction.isButton()) {
            try {
                const { handleButton } = require("../buttons");
                await handleButton(interaction);
            } catch (err) {
                await reportError(
                    interaction,
                    `Button ${interaction.customId}`, err
                );
            }
            return;
        }

        if (interaction.isAnySelectMenu()) {
            try {
                if (interaction.customId.startsWith("admin:")) {
                    const { handleAdminSelect } = require("../admin");
                    await handleAdminSelect(interaction);
                } else if (interaction.customId.startsWith("battle:")) {
                    const { handleBattleSelect } = require("../buttons");
                    await handleBattleSelect(interaction);
                } else {
                    const { handleSelectMenu } = require("../menu");
                    await handleSelectMenu(interaction);
                }
            } catch (err) {
                await reportError(
                    interaction,
                    `Select menu ${interaction.customId}`, err
                );
            }
            return;
        }

        if (interaction.isModalSubmit()) {
            try {
                if (interaction.customId.startsWith("adminmodal:")) {
                    const { handleAdminModal } = require("../admin");
                    await handleAdminModal(interaction);
                } else {
                    const { handleModalSubmit } = require("../menu");
                    await handleModalSubmit(interaction);
                }
            } catch (err) {
                await reportError(
                    interaction,
                    `Modal ${interaction.customId}`, err
                );
            }
            return;
        }

        if (!interaction.isChatInputCommand()) {
            return;
        }

        const command = commands.get(interaction.commandName);

        if (!command) {
            return;
        }

        try {
            await command.execute(interaction);
        } catch (err) {
            await reportError(
                interaction,
                `Command /${interaction.commandName}`, err
            );
        }
    }
};
