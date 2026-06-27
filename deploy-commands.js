require('./src/env');
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('./src/config');

const commands = [];
const commandsPath = path.join(__dirname, 'src', 'commands');
for (const file of fs
  .readdirSync(commandsPath)
  .filter((f) => f.endsWith('.js'))) {
  const command = require(path.join(commandsPath, file));
  commands.push(command.data.toJSON());
}

const rest = new REST().setToken(config.TOKEN);
(async () => {
  try {
    console.log(`Déploiement de ${commands.length} commande(s)...`);
    await rest.put(
      Routes.applicationGuildCommands(
        config.CLIENT_ID,
        config.GUILD_ID,
      ),
      { body: commands },
    );
    console.log('✅ Commandes déployées avec succès sur le serveur.');
  } catch (err) {
    console.error(
      '❌ Erreur lors du déploiement des commandes :',
      err,
    );
  }
})();
