require("dotenv").config();

const { Client, GatewayIntentBits, Collection } = require("discord.js");

const client = new Client({
    intents: Object.values(GatewayIntentBits)
});

client.commands = new Collection();

client.once("ready", () => {
    console.log(`${client.user.tag} aktif!`);
});

client.login(process.env.TOKEN);