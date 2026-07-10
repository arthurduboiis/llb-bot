const {
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const db = require('../database');
const { formatAmount, parseAmount } = require('../utils/format');
const { isOfficer } = require('../utils/permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription(
      "Gérer le solde d'un joueur (officiers uniquement)",
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription("Ajouter de l'argent au solde d'un joueur")
        .addUserOption((opt) =>
          opt
            .setName('joueur')
            .setDescription('Le joueur ciblé')
            .setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName('montant')
            .setDescription('Montant à ajouter (ex: 1.5m, 500k)')
            .setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName('raison')
            .setDescription('Raison (optionnel)')
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription("Retirer de l'argent du solde d'un joueur")
        .addUserOption((opt) =>
          opt
            .setName('joueur')
            .setDescription('Le joueur ciblé')
            .setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName('montant')
            .setDescription('Montant à retirer (ex: 1.5m, 500k)')
            .setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName('raison')
            .setDescription('Raison (optionnel)')
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('check')
        .setDescription("Voir le solde d'un joueur")
        .addUserOption((opt) =>
          opt
            .setName('joueur')
            .setDescription('Le joueur ciblé')
            .setRequired(true),
        ),
    ),

  async execute(interaction) {
    if (!isOfficer(interaction.member)) {
      return interaction.reply({
        content: '❌ Réservé aux officiers.',
        ephemeral: true,
      });
    }

    const sub = interaction.options.getSubcommand();
    const target = interaction.options.getUser('joueur');

    if (sub === 'check') {
      const balance = await db.getBalance(target.id);
      return interaction.reply({
        content: `💰 Solde de <@${target.id}> : **${formatAmount(balance)}**`,
        ephemeral: true,
      });
    }

    const rawAmount = interaction.options.getString('montant');
    const amount = parseAmount(rawAmount);
    const raison =
      interaction.options.getString('raison') || 'Ajustement manuel';

    if (!amount || amount <= 0) {
      return interaction.reply({
        content: '❌ Montant invalide.',
        ephemeral: true,
      });
    }

    if (sub === 'add') {
      await db.addToBalance(target.id, amount);
      await db.logTransaction({
        type: 'manual_adjustment',
        userId: target.id,
        amount: amount,
        description: `[+] par <@${interaction.user.id}> - ${raison}`,
      });
      const newBalance = await db.getBalance(target.id);
      return interaction.reply({
        content: `✅ **+${formatAmount(amount)}** ajouté au solde de <@${target.id}>.\nNouveau solde : **${formatAmount(newBalance)}**\nRaison : ${raison}`,
        ephemeral: false,
      });
    }

    if (sub === 'remove') {
      const currentBalance = await db.getBalance(target.id);
      if (amount > currentBalance) {
        return interaction.reply({
          content: `❌ Solde insuffisant — <@${target.id}> n'a que **${formatAmount(currentBalance)}**.`,
          ephemeral: true,
        });
      }
      await db.addToBalance(target.id, -amount);
      await db.logTransaction({
        type: 'manual_adjustment',
        userId: target.id,
        amount: -amount,
        description: `[-] par <@${interaction.user.id}> - ${raison}`,
      });
      const newBalance = await db.getBalance(target.id);
      return interaction.reply({
        content: `✅ **-${formatAmount(amount)}** retiré du solde de <@${target.id}>.\nNouveau solde : **${formatAmount(newBalance)}**\nRaison : ${raison}`,
        ephemeral: false,
      });
    }
  },
};
