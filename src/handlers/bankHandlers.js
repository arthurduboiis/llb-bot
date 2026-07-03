const {
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const db = require('../database');
const config = require('../config');
const { formatAmount, parseAmount } = require('../utils/format');
const { bankDashboardEmbed } = require('../utils/embeds');
const { isOfficer } = require('../utils/permissions');

// ----------------------------------------------------------------------------
// Mon solde
// ----------------------------------------------------------------------------
async function handleMyBalance(interaction) {
  const balance = await db.getBalance(interaction.user.id);
  await interaction.reply({
    content: `💰 Ton solde actuel : **${formatAmount(balance)}**`,
    ephemeral: true,
  });
}

// ----------------------------------------------------------------------------
// Retrait perso -> modal montant -> crée une demande pending
// ----------------------------------------------------------------------------
async function handleWithdrawPersoButton(interaction) {
  const balance = await db.getBalance(interaction.user.id);
  if (balance <= 0) {
    return interaction.reply({
      content: "❌ Tu n'as aucun solde à retirer.",
      ephemeral: true,
    });
  }

  const modal = new ModalBuilder()
    .setCustomId('bank_withdraw_perso_modal')
    .setTitle('Demande de retrait')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('withdraw_amount')
          .setLabel(
            `Montant à retirer (solde dispo: ${formatAmount(balance)})`,
          )
          .setStyle(TextInputStyle.Short)
          .setRequired(true),
      ),
    );

  await interaction.showModal(modal);
}

async function handleWithdrawPersoModalSubmit(interaction) {
  const raw = interaction.fields.getTextInputValue('withdraw_amount');
  const amount = parseAmount(raw);
  const balance = await db.getBalance(interaction.user.id);

  if (amount === null || amount <= 0) {
    return interaction.reply({
      content: '❌ Montant invalide.',
      ephemeral: true,
    });
  }
  if (amount > balance) {
    return interaction.reply({
      content: `❌ Solde insuffisant (dispo : ${formatAmount(balance)}).`,
      ephemeral: true,
    });
  }

  const success = await db.deductBalance(interaction.user.id, amount);
  if (!success) {
    return interaction.reply({
      content: '❌ Solde insuffisant (déjà retiré ?)',
      ephemeral: true,
    });
  }
  const withdrawalId = await db.createWithdrawal(
    interaction.user.id,
    amount,
  );

  await interaction.reply({
    content: `✅ Demande de retrait de **${formatAmount(amount)}** envoyée. Un officier va te payer in-game.`,
    ephemeral: true,
  });

  await notifyBankChannel(
    interaction,
    withdrawalId,
    interaction.user.id,
    amount,
  );
  await refreshAllDashboards(interaction);
}

async function notifyBankChannel(
  interaction,
  withdrawalId,
  userId,
  amount,
) {
  if (!config.BANK_LOGS_CHANNEL_ID) return;
  const channel = interaction.guild.channels.cache.get(
    config.BANK_LOGS_CHANNEL_ID,
  );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`bank_paid_${withdrawalId}`)
      .setLabel('Marquer comme payé')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`bank_cancel_${withdrawalId}`)
      .setLabel('Annuler')
      .setStyle(ButtonStyle.Danger),
  );

  await channel.send({
    content: `📤 **Nouvelle demande de retrait #${withdrawalId}**\n<@${userId}> demande **${formatAmount(amount)}**.`,
    components: [row],
  });
}

// ----------------------------------------------------------------------------
// Officier : marquer un retrait comme payé / annulé
// ----------------------------------------------------------------------------
async function handleMarkPaid(interaction, withdrawalId) {
  if (!isOfficer(interaction.member)) {
    return interaction.reply({
      content: '❌ Réservé aux officiers.',
      ephemeral: true,
    });
  }
  const withdrawal = await db.getWithdrawal(withdrawalId);
  if (!withdrawal || withdrawal.status !== 'pending') {
    return interaction.reply({
      content: "❌ Cette demande n'est plus en attente.",
      ephemeral: true,
    });
  }

  await db.markWithdrawalPaid(withdrawalId);
  await db.logTransaction({
    type: 'withdrawal',
    userId: withdrawal.user_id,
    amount: -withdrawal.amount,
    description: `Retrait paye (solde joueur)`,
  });

  await interaction.update({
    content: `✅ Retrait #${withdrawalId} marqué comme **payé** par <@${interaction.user.id}>.`,
    components: [],
  });
  await refreshAllDashboards(interaction);
}

async function handleCancelWithdrawal(interaction, withdrawalId) {
  if (!isOfficer(interaction.member)) {
    return interaction.reply({
      content: '❌ Réservé aux officiers.',
      ephemeral: true,
    });
  }
  const withdrawal = await db.getWithdrawal(withdrawalId);
  if (!withdrawal || withdrawal.status !== 'pending') {
    return interaction.reply({
      content: "❌ Cette demande n'est plus en attente.",
      ephemeral: true,
    });
  }

  await db.markWithdrawalCancelled(withdrawalId);
  const success = await db.deductBalance(interaction.user.id, amount);
  if (!success) {
    return interaction.reply({
      content: '❌ Solde insuffisant (déjà retiré ?)',
      ephemeral: true,
    });
  }

  await interaction.update({
    content: `☑️ Retrait #${withdrawalId} annulé par <@${interaction.user.id}>, solde recrédité.`,
    components: [],
  });
  await refreshAllDashboards(interaction);
}

// ----------------------------------------------------------------------------
// Déposer (manuellement) de l'argent dans la trésorerie guilde
// ----------------------------------------------------------------------------
async function handleDepositButton(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('bank_deposit_modal')
    .setTitle('Déposer dans la trésorerie guilde')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('deposit_amount')
          .setLabel('Montant déposé')
          .setStyle(TextInputStyle.Short)
          .setRequired(true),
      ),
    );
  await interaction.showModal(modal);
}

async function handleDepositModalSubmit(interaction) {
  const amount = parseAmount(
    interaction.fields.getTextInputValue('deposit_amount'),
  );
  if (amount === null || amount <= 0) {
    return interaction.reply({
      content: '❌ Montant invalide.',
      ephemeral: true,
    });
  }

  await db.addToTreasury(amount);
  await db.logTransaction({
    type: 'deposit',
    userId: interaction.user.id,
    amount,
    description: 'Depot manuel',
  });

  await interaction.reply({
    content: `✅ **${formatAmount(amount)}** ajouté à la trésorerie guilde.`,
    ephemeral: true,
  });
  await refreshAllDashboards(interaction);
}

// ----------------------------------------------------------------------------
// Retrait guilde (officier) : sort de l'argent de la trésorerie
// ----------------------------------------------------------------------------
async function handleGuildWithdrawButton(interaction) {
  if (!isOfficer(interaction.member)) {
    return interaction.reply({
      content: '❌ Réservé aux officiers.',
      ephemeral: true,
    });
  }

  const modal = new ModalBuilder()
    .setCustomId('bank_guild_withdraw_modal')
    .setTitle('Retrait de la trésorerie guilde')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('guild_withdraw_amount')
          .setLabel(
            `Montant (trésorerie: ${formatAmount(await db.getTreasury())})`,
          )
          .setStyle(TextInputStyle.Short)
          .setRequired(true),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('guild_withdraw_reason')
          .setLabel('Raison')
          .setStyle(TextInputStyle.Short)
          .setRequired(false),
      ),
    );
  await interaction.showModal(modal);
}

async function handleGuildWithdrawModalSubmit(interaction) {
  const amount = parseAmount(
    interaction.fields.getTextInputValue('guild_withdraw_amount'),
  );
  const reason =
    interaction.fields.getTextInputValue('guild_withdraw_reason') ||
    'Non précisé';
  const treasury = await db.getTreasury();

  if (amount === null || amount <= 0) {
    return interaction.reply({
      content: '❌ Montant invalide.',
      ephemeral: true,
    });
  }
  if (amount > treasury) {
    return interaction.reply({
      content: `❌ Trésorerie insuffisante (dispo : ${formatAmount(treasury)}).`,
      ephemeral: true,
    });
  }

  await db.addToTreasury(-amount);
  await db.logTransaction({
    type: 'guild_withdrawal',
    userId: interaction.user.id,
    amount: -amount,
    description: reason,
  });

  await interaction.reply({
    content: `✅ **${formatAmount(amount)}** retiré de la trésorerie guilde. (${reason})`,
    ephemeral: true,
  });
  await refreshAllDashboards(interaction);
}

// ----------------------------------------------------------------------------
// Rafraîchir le dashboard
// ----------------------------------------------------------------------------
async function handleRefreshButton(interaction) {
  await interaction.update({ embeds: [await bankDashboardEmbed()] });
}

async function refreshAllDashboards(interaction) {
  // Si le message courant est le dashboard, on le met à jour directement.
  // Sinon (ex: depuis le salon banque après un retrait), on tente de retrouver et éditer
  // le dernier message dashboard du bot dans le salon banque configuré.
  if (!config.BANK_CHANNEL_ID) return;
  try {
    const channel = interaction.guild.channels.cache.get(
      config.BANK_CHANNEL_ID,
    );
    if (!channel) return;
    const messages = await channel.messages.fetch({ limit: 20 });
    const dashboardMsg = messages.find(
      (m) =>
        m.author.id === interaction.client.user.id &&
        m.embeds[0]?.title?.includes('BANQUE'),
    );
    if (dashboardMsg) {
      await dashboardMsg.edit({
        embeds: [await bankDashboardEmbed()],
      });
    }
  } catch {
    // pas grave si ça échoue, le bouton "Dashboard" permet toujours de rafraîchir manuellement
  }
}

module.exports = {
  handleMyBalance,
  handleWithdrawPersoButton,
  handleWithdrawPersoModalSubmit,
  handleMarkPaid,
  handleCancelWithdrawal,
  handleDepositButton,
  handleDepositModalSubmit,
  handleGuildWithdrawButton,
  handleGuildWithdrawModalSubmit,
  handleRefreshButton,
};
