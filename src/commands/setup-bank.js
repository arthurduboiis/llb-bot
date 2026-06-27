const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} = require('discord.js');
const { bankDashboardEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup-bank')
    .setDescription(
      'Poste le dashboard de la banque de guilde dans ce salon',
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('bank_mybalance')
        .setLabel('Mon solde')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('bank_withdraw_perso')
        .setLabel('Retrait perso')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('bank_deposit')
        .setLabel('Déposer')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('bank_withdraw_guild')
        .setLabel('Retrait guilde')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('bank_refresh')
        .setLabel('Dashboard')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🔄'),
    );

    const msg = await interaction.channel.send({
      embeds: [await bankDashboardEmbed()],
      components: [row],
    });
    await interaction.reply({
      content: `✅ Dashboard posté. (id message: ${msg.id})`,
      ephemeral: true,
    });
  },
};
