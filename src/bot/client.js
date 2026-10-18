const {
    Client,
    GatewayIntentBits,
    Partials
} = require("discord.js");
const ready = require("./events/ready");
const interactionCreate = require("./events/interactionCreate");

function createClient() {
    const client = new Client({
        intents: [GatewayIntentBits.Guilds],
        // DM component interactions arrive on channels the bot has
        // never cached — without Partials.Channel, discord.js drops
        // those packets and private battle panels are dead controls.
        partials: [Partials.Channel]
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
