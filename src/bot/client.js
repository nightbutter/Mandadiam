const { Client, GatewayIntentBits } = require("discord.js");
const ready = require("./events/ready");
const interactionCreate = require("./events/interactionCreate");
const messageCreate = require("./events/messageCreate");

function createClient({ messageContent = true } = {}) {
    const intents = [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages
    ];

    // MessageContent is a privileged intent — required for the
    // in-channel portrait upload flow (message.attachments arrives
    // empty without it). It must be enabled in the Developer Portal;
    // callers may disable it as a fallback when the portal flag is
    // missing.
    if (messageContent) {
        intents.push(GatewayIntentBits.MessageContent);
    }

    const client = new Client({ intents });

    const events = [ready, interactionCreate, messageCreate];

    for (const event of events) {
        if (event.once) {
            client.once(event.name, event.execute);
        } else {
            client.on(event.name, event.execute);
        }
    }

    return client;
}

module.exports = { createClient };
