const { Events, MessageFlags } = require("discord.js");
const { commands } = require("../commands");

// Shared failure reply for component/modal interactions.
async function safeFail(interaction) {
    const reply = {
        content: "Something went wrong with that action.",
        ephemeral: true
    };

    if (interaction.replied || interaction.deferred) {
        await interaction.followUp(reply);
    } else {
        await interaction.reply(reply);
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
                console.error(
                    `Button ${interaction.customId} failed:`, err
                );

                await safeFail(interaction);
            }
            return;
        }

        if (interaction.isAnySelectMenu()) {
            try {
                if (interaction.customId.startsWith("battle:")) {
                    const { handleBattleSelect } = require("../buttons");
                    await handleBattleSelect(interaction);
                } else {
                    const { handleSelectMenu } = require("../menu");
                    await handleSelectMenu(interaction);
                }
            } catch (err) {
                console.error(
                    `Select menu ${interaction.customId} failed:`, err
                );
                await safeFail(interaction);
            }
            return;
        }

        if (interaction.isModalSubmit()) {
            try {
                const { handleModalSubmit } = require("../menu");
                await handleModalSubmit(interaction);
            } catch (err) {
                console.error(
                    `Modal ${interaction.customId} failed:`, err
                );
                await safeFail(interaction);
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
            console.error(`Command /${interaction.commandName} failed:`, err);

            const reply = {
                content: "Something went wrong running that command.",
                flags: MessageFlags.Ephemeral
            };

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(reply);
            } else {
                await interaction.reply(reply);
            }
        }
    }
};
