const { EmbedBuilder } = require('discord.js');
const { formatAmount, formatDuration } = require('./format');
const db = require('../database');
const config = require('../config');

const COLOR_GOLD = 0xf0b232;
const COLOR_BLUE = 0x5865f2;
const COLOR_GREEN = 0x57f287;

function payoutLogEmbed(session, participants) {
  const guildTax = Math.round(
    session.loot_amount * config.GUILD_TAX_RATE,
  );
  const marketTax = Math.round(
    session.loot_amount * config.MARKET_TAX_RATE,
  );

  const lines = participants
    .filter((p) => p.share_amount != null)
    .sort((a, b) => b.share_amount - a.share_amount)
    .map((p) => {
      const pct = session.net_amount
        ? ((p.share_amount / session.net_amount) * 100).toFixed(1)
        : '0';
      return `<@${p.user_id}> : **${formatAmount(p.share_amount)}** (${formatDuration(p.voice_seconds)}, ${pct}%)`;
    })
    .join('\n');

  return new EmbedBuilder()
    .setColor(COLOR_GOLD)
    .setTitle('💰 PAYOUT CLÔTURÉ')
    .setDescription(
      `**${session.type_label}** cloturé par <@${session.leader_id}>\n\n` +
        `Loot : **${formatAmount(session.loot_amount)}**\n` +
        `Taxe guilde : **${formatAmount(guildTax)}** (${(config.GUILD_TAX_RATE * 100).toFixed(0)}%)\n` +
        `Taxe marché : **${formatAmount(marketTax)}** (${(config.MARKET_TAX_RATE * 100).toFixed(1)}%)\n` +
        `Net distribué : **${formatAmount(session.net_amount)}**\n\n` +
        `${lines}`,
    )
    .setTimestamp();
}

function payoutLauncherEmbed() {
  return new EmbedBuilder()
    .setColor(COLOR_GOLD)
    .setTitle('💰 SYSTEME DE PAYOUT')
    .setDescription(
      '**Comment ça marche ?**\n\n' +
        '1. Clique sur **Lancer un Payout** ci-dessous\n' +
        '2. Choisis un type (Raid Avalon / Donjon / ZvZ / Gank / Transport / Faction)\n' +
        '3. Un channel texte et un channel vocal sont créés automatiquement\n' +
        "4. Les joueurs cliquent **S'inscrire** et rejoignent le vocal (leur temps est tracké)\n" +
        '5. Le leader clique **Clôturer inscriptions** quand tout le monde est là\n' +
        '6. À la fin, le leader clique **Entrer le loot** et entre le montant total\n' +
        '7. Le bot calcule : Loot - Taxe guilde (10%) - Taxe marché (6.5%) = Net\n' +
        '8. Le leader choisit le mode de split : **part égale**, **time** (pro-rata du temps en vocal) ou **pourcentages custom**\n' +
        '9. Les parts sont créditées, les joueurs reçoivent un DM, les channels sont supprimés',
    )
    .setFooter({ text: 'LLB - Payout System' });
}

function payoutSessionEmbed(session, participants) {
  const list = participants.length
    ? participants.map((p) => `• <@${p.user_id}>`).join('\n')
    : "_Personne pour l'instant_";

  const embed = new EmbedBuilder()
    .setColor(COLOR_BLUE)
    .setTitle(`${session.type_label}`)
    .addFields(
      {
        name: 'Leader',
        value: `<@${session.leader_id}>`,
        inline: true,
      },
      {
        name: 'Statut',
        value: statusLabel(session.status),
        inline: true,
      },
      { name: `Inscrits (${participants.length})`, value: list },
    )
    .setFooter({ text: `Session #${session.id} • LLB` });

  if (session.loot_amount != null) {
    embed.addFields({
      name: 'Loot',
      value:
        `Brut : **${formatAmount(session.loot_amount)}**\n` +
        `Net (après taxes) : **${formatAmount(session.net_amount)}**`,
    });
  }

  return embed;
}

function statusLabel(status) {
  return (
    {
      open: '🟢 Inscriptions ouvertes',
      closed: '🟠 Inscriptions fermées',
      loot_entered: '🟡 Loot entré, split en cours',
      done: '✅ Terminé',
    }[status] || status
  );
}

function splitSummaryEmbed(session, participants) {
  const lines = participants
    .filter((p) => p.share_amount != null)
    .sort((a, b) => b.share_amount - a.share_amount)
    .map(
      (p) =>
        `• <@${p.user_id}> — **${formatAmount(p.share_amount)}**` +
        (session.split_mode === 'time'
          ? ` _(${formatDuration(p.voice_seconds)} en vocal)_`
          : ''),
    )
    .join('\n');

  return new EmbedBuilder()
    .setColor(COLOR_GREEN)
    .setTitle(`✅ Split terminé - ${session.type_label}`)
    .setDescription(
      `Loot brut : **${formatAmount(session.loot_amount)}**\n` +
        `Net distribué : **${formatAmount(session.net_amount)}**\n` +
        `Mode : **${splitModeLabel(session.split_mode)}**\n\n` +
        `${lines}`,
    )
    .setFooter({
      text: 'Les soldes ont été crédités, vous avez reçu un DM. Ce channel sera supprimé dans 60s.',
    });
}

function splitModeLabel(mode) {
  return (
    {
      equal: 'Part égale',
      time: 'Pro-rata du temps en vocal',
      custom: 'Pourcentages custom',
    }[mode] || mode
  );
}

async function bankDashboardEmbed() {
  const treasury = await db.getTreasury();
  const balances = await db.getAllBalances();
  const totalOwed = balances.reduce((sum, b) => sum + b.balance, 0);
  const pendingWithdrawals = await db.countPendingWithdrawals();
  const playerCount = await db.countPlayersWithBalance();

  const guildWithdrawals = await db.getRecentTransactions(
    5,
    'guild_withdrawal',
  );
  const deposits = await db.getRecentTransactions(5, 'deposit');
  const treasuryHistory = guildWithdrawals
    .concat(deposits)
    .sort((a, b) => b.id - a.id)
    .slice(0, 5);

  const historyLines = treasuryHistory.length
    ? treasuryHistory
        .map((t) => {
          const icon = t.amount < 0 ? '🏦' : '💵';
          return `${icon} ${formatAmount(t.amount)} - <@${t.user_id}> _(${t.description})_`;
        })
        .join('\n')
    : '_Aucune opération récente_';

  const balanceLines = balances.length
    ? balances
        .slice(0, 25)
        .map(
          (b) => `<@${b.user_id}> - **${formatAmount(b.balance)}**`,
        )
        .join('\n')
    : '_Aucun solde joueur_';

  const recentPayouts = await db.getRecentTransactions(
    4,
    'payout_credit_summary',
  );

  const embed = new EmbedBuilder()
    .setColor(COLOR_GOLD)
    .setTitle('🏛️ BANQUE LLB')
    .addFields(
      {
        name: 'Trésorerie guilde',
        value: `**${formatAmount(treasury)}**`,
        inline: true,
      },
      {
        name: 'Soldes joueurs à distribuer',
        value: `**${formatAmount(totalOwed)}**`,
        inline: true,
      },
      { name: '🏛️ Trésorerie - Historique', value: historyLines },
      { name: '💰 Soldes joueurs', value: balanceLines },
    )
    .setFooter({
      text: `LLB - Mis à jour automatiquement • ${new Date().toLocaleString('fr-FR')}`,
    });

  if (recentPayouts.length) {
    embed.addFields({
      name: '📋 Payouts récents',
      value: recentPayouts.map((p) => `${p.description}`).join('\n'),
    });
  }

  embed.addFields(
    {
      name: '📤 Retraits en attente',
      value: `${pendingWithdrawals}`,
      inline: true,
    },
    {
      name: '👤 Joueurs avec solde',
      value: `${playerCount}`,
      inline: true,
    },
  );

  return embed;
}

module.exports = {
  payoutLauncherEmbed,
  payoutLogEmbed,
  payoutSessionEmbed,
  splitSummaryEmbed,
  bankDashboardEmbed,
  statusLabel,
  splitModeLabel,
};
