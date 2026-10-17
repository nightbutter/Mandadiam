const { Events } = require("discord.js");
const uploadSessions = require("../uploadSessions");
const characterService = require("../../services/characterService");

// Portrait upload listener. Only fires for users with a pending
// upload session — everyone else's messages are ignored immediately,
// so this stays cheap and scoped.
module.exports = {
    name: Events.MessageCreate,
    once: false,
    async execute(message) {
        if (message.author.bot) {
            return;
        }

        const session = uploadSessions.get(message.author.id);

        if (!session) {
            return;
        }

        const attachment = message.attachments.first();
        const validation =
            characterService.validateImageAttachment(attachment);

        if (!validation.ok) {
            // Keep the session open — let them retry until it expires.
            await message.reply(
                `❌ ${validation.reason} ` +
                "(or press Cancel on the upload prompt)"
            ).catch(() => {});
            return;
        }

        const result = await characterService.setCharacterImage(
            message.author.id, session.characterId, validation.url
        );

        uploadSessions.cancel(message.author.id);

        if (!result.ok) {
            await message.reply(
                "❌ Couldn't save the image — that character isn't " +
                "yours or no longer exists."
            ).catch(() => {});
            return;
        }

        await message.reply(
            `🖼️ Portrait updated for **${result.character.name}**! ` +
            "Open /rpg → My Characters to see it."
        ).catch(() => {});
    }
};
