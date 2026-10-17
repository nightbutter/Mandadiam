const { Client, GatewayIntentBits } = require("discord.js");
const ready = require("./events/ready");
const interactionCreate = require("./events/interactionCreate");
const messageCreate = require("./events/messageCreate");

function createClient() {
    const client = new Client({
        // GuildMessages + MessageContent are required for the portrait
        // upload flow — MessageContent is a privileged intent that must
        // be enabled in the Discord Developer Portal. Without it,
        // message.attachments arrives empty and uploads can't be read.
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent
        ]
    });

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
