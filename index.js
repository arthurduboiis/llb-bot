require('./src/env');
const {
  Client,
  GatewayIntentBits,
  Collection,
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('./src/config');
const express = require('express');
const app = express();
const db = require('./src/database');
const PORT = process.env.PORT || 10000;

if (!config.TOKEN || !config.CLIENT_ID || !config.GUILD_ID) {
  console.error(
    '❌ DISCORD_TOKEN, CLIENT_ID et GUILD_ID doivent être définis dans le fichier .env (voir .env.example).',
  );
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ],
});

// Chargement des commandes
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'src', 'commands');
for (const file of fs
  .readdirSync(commandsPath)
  .filter((f) => f.endsWith('.js'))) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.data.name, command);
}

// Chargement des events
const eventsPath = path.join(__dirname, 'src', 'events');
for (const file of fs
  .readdirSync(eventsPath)
  .filter((f) => f.endsWith('.js'))) {
  const event = require(path.join(eventsPath, file));
  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args));
  } else {
    client.on(event.name, (...args) =>
      event.execute(...args, client),
    );
  }
}

(async () => {
  await db.initDatabase(); // crée les tables Postgres si elles n'existent pas encore
  await client.login(config.TOKEN);
})();

app.get('/', (req, res) => {
  res.send('Bot en ligne !');
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.listen(PORT, () => {
  console.log(`Faux serveur web démarré sur le port ${PORT}`);
});
