const { Client, GatewayIntentBits } = require("discord.js");
const ready = require("./events/ready");
const interactionCreate = require("./events/interactionCreate");

function createClient() {
    const client = new Client({
        intents: [GatewayIntentBits.Guilds]
    });

    const events = [ready, interactionCreate];

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
