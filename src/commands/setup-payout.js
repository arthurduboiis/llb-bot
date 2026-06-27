const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const { payoutLauncherEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup-payout')
    .setDescription('Poste le message permettant de lancer un payout dans ce salon')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('payout_launch')
        .setLabel('Lancer un Payout')
        .setEmoji('💰')
        .setStyle(ButtonStyle.Success)
    );

    await interaction.channel.send({ embeds: [payoutLauncherEmbed()], components: [row] });
    await interaction.reply({ content: '✅ Message de payout posté.', ephemeral: true });
  }
};
