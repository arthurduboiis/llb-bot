const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const db = require('../database');
const config = require('../config');
const { formatAmount, parseAmount } = require('../utils/format');
const {
  payoutSessionEmbed,
  splitSummaryEmbed,
  payoutLogEmbed,
} = require('../utils/embeds');
const { isLeaderOrOfficer } = require('../utils/permissions');

// Map en mémoire : voiceChannelId -> Map(userId -> timestamp de join) pour le tracking de temps en direct
const liveVoiceJoins = new Map();

// ----------------------------------------------------------------------------
// 1. Clic sur "Lancer un Payout" -> menu de sélection du type
// ----------------------------------------------------------------------------
async function handleLaunchButton(interaction) {
  const select = new StringSelectMenuBuilder()
    .setCustomId('payout_select_type')
    .setPlaceholder('Choisis un type de payout')
    .addOptions(
      config.PAYOUT_TYPES.map((t) => ({
        label: t.label,
        value: t.value,
        emoji: t.emoji,
      })),
    );

  await interaction.reply({
    content: "Quel type d'activité ?",
    components: [new ActionRowBuilder().addComponents(select)],
    ephemeral: true,
  });
}

// ----------------------------------------------------------------------------
// 2. Sélection du type -> création des channels + session
// ----------------------------------------------------------------------------
async function handleTypeSelect(interaction) {
  await interaction.deferUpdate();

  const typeInfo = config.PAYOUT_TYPES.find(
    (t) => t.value === interaction.values[0],
  );
  const guild = interaction.guild;
  const leader = interaction.user;

  const category = await getOrCreatePayoutCategory(guild);
  const slug = typeInfo.value.replace(/_/g, '-');
  const shortId = Date.now().toString().slice(-5);

  const textChannel = await guild.channels.create({
    name: `payout-${slug}-${shortId}`,
    type: ChannelType.GuildText,
    parent: category.id,
  });

  const voiceChannel = await guild.channels.create({
    name: `🔊 ${typeInfo.label} ${shortId}`,
    type: ChannelType.GuildVoice,
    parent: category.id,
  });

  const sessionId = await db.createPayoutSession({
    typeLabel: typeInfo.label,
    leaderId: leader.id,
  });
  await db.setSessionChannels(
    sessionId,
    textChannel.id,
    voiceChannel.id,
  );
  await db.addParticipant(sessionId, leader.id); // le leader est inscrit par défaut

  await postSessionMessage(textChannel, sessionId);

  await interaction.editReply({
    content: `✅ Payout **${typeInfo.label}** créé : ${textChannel} / ${voiceChannel}`,
    components: [],
  });
}

async function getOrCreatePayoutCategory(guild) {
  if (config.PAYOUT_CATEGORY_ID) {
    const existing = guild.channels.cache.get(
      config.PAYOUT_CATEGORY_ID,
    );
    if (existing) return existing;
  }
  const found = guild.channels.cache.find(
    (c) =>
      c.type === ChannelType.GuildCategory &&
      c.name === config.PAYOUT_CATEGORY_NAME,
  );
  if (found) return found;
  return guild.channels.create({
    name: config.PAYOUT_CATEGORY_NAME,
    type: ChannelType.GuildCategory,
  });
}

// ----------------------------------------------------------------------------
// Message de session (S'inscrire / Clôturer inscriptions)
// ----------------------------------------------------------------------------
async function postSessionMessage(textChannel, sessionId) {
  const session = await db.getSession(sessionId);
  const participants = await db.getParticipants(sessionId);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`payout_signup_${sessionId}`)
      .setLabel("S'inscrire")
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`payout_unsignup_${sessionId}`)
      .setLabel('Se désinscrire')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`payout_close_${sessionId}`)
      .setLabel('Clôturer inscriptions')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger),
  );

  const msg = await textChannel.send({
    content: `<@${session.leader_id}> a lancé un payout ! Rejoignez <#${session.voice_channel_id}> et inscrivez-vous ci-dessous.`,
    embeds: [payoutSessionEmbed(session, participants)],
    components: [row],
  });

  // On stocke l'id du message racine pour pouvoir le mettre à jour ensuite
  textChannel.__sessionMessageId = msg.id; // (cache en mémoire, suffisant tant que le process ne redémarre pas)
}

async function refreshSessionMessage(channel, sessionId) {
  const session = await db.getSession(sessionId);
  const participants = await db.getParticipants(sessionId);
  if (!channel.__sessionMessageId) return;
  try {
    const msg = await channel.messages.fetch(
      channel.__sessionMessageId,
    );
    await msg.edit({
      embeds: [payoutSessionEmbed(session, participants)],
    });
  } catch {
    // message introuvable, on ignore
  }
}

// ----------------------------------------------------------------------------
// 3. S'inscrire / se désinscrire
// ----------------------------------------------------------------------------
async function handleSignupButton(interaction, sessionId) {
  const session = await db.getSession(sessionId);
  if (!session || session.status !== 'open') {
    return interaction.reply({
      content: '❌ Les inscriptions sont fermées pour ce payout.',
      ephemeral: true,
    });
  }
  await db.addParticipant(sessionId, interaction.user.id);
  await refreshSessionMessage(interaction.channel, sessionId);
  await interaction.reply({
    content:
      '✅ Tu es inscrit ! Rejoins le vocal pour faire tracker ton temps.',
    ephemeral: true,
  });
}

async function handleUnsignupButton(interaction, sessionId) {
  const session = await db.getSession(sessionId);
  if (!session || session.status !== 'open') {
    return interaction.reply({
      content: '❌ Les inscriptions sont fermées pour ce payout.',
      ephemeral: true,
    });
  }
  await db.removeParticipant(sessionId, interaction.user.id);
  await refreshSessionMessage(interaction.channel, sessionId);
  await interaction.reply({
    content: '☑️ Tu es désinscrit.',
    ephemeral: true,
  });
}

// ----------------------------------------------------------------------------
// 4. Clôturer les inscriptions (leader/officier uniquement)
// ----------------------------------------------------------------------------
async function handleCloseButton(interaction, sessionId) {
  const session = await db.getSession(sessionId);
  if (!session)
    return interaction.reply({
      content: '❌ Session introuvable.',
      ephemeral: true,
    });

  if (!isLeaderOrOfficer(interaction.member, session)) {
    return interaction.reply({
      content:
        '❌ Seul le leader ou un officier peut clôturer les inscriptions.',
      ephemeral: true,
    });
  }

  await db.setSessionStatus(sessionId, 'closed');

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`payout_enterloot_${sessionId}`)
      .setLabel('Entrer le loot')
      .setEmoji('💰')
      .setStyle(ButtonStyle.Success),
  );

  await interaction.update({ components: [] });
  await refreshSessionMessage(interaction.channel, sessionId);
  await interaction.channel.send({
    content: `🔒 Inscriptions clôturées par <@${interaction.user.id}>. <@${session.leader_id}>, tu peux maintenant entrer le loot.`,
    components: [row],
  });
}

// ----------------------------------------------------------------------------
// 5. Entrer le loot -> modal
// ----------------------------------------------------------------------------
async function handleEnterLootButton(interaction, sessionId) {
  const session = await db.getSession(sessionId);
  if (!isLeaderOrOfficer(interaction.member, session)) {
    return interaction.reply({
      content:
        '❌ Seul le leader ou un officier peut entrer le loot.',
      ephemeral: true,
    });
  }

  const modal = new ModalBuilder()
    .setCustomId(`payout_lootmodal_${sessionId}`)
    .setTitle('Entrer le montant du loot')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('loot_amount')
          .setLabel('Montant brut total (ex: 1200000 ou 1.2m)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true),
      ),
    );

  await interaction.showModal(modal);
}

async function handleLootModalSubmit(interaction, sessionId) {
  const raw = interaction.fields.getTextInputValue('loot_amount');
  const amount = parseAmount(raw);

  if (amount === null || amount <= 0) {
    return interaction.reply({
      content:
        '❌ Montant invalide. Exemple valide : 1200000 ou 1.2m',
      ephemeral: true,
    });
  }

  const guildTax = Math.round(amount * config.GUILD_TAX_RATE);
  const marketTax = Math.round(amount * config.MARKET_TAX_RATE);
  const net = amount - guildTax - marketTax;

  await db.setSessionLoot(sessionId, amount, net);
  await db.addToTreasury(guildTax);
  const session = await db.getSession(sessionId);
  await db.logTransaction({
    type: 'guild_tax',
    userId: session.leader_id,
    amount: guildTax,
    description: `Taxe guilde - ${session.type_label}`,
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId(`payout_splitmode_${sessionId}`)
    .setPlaceholder('Choisis le mode de répartition')
    .addOptions(
      {
        label: 'Part égale',
        value: 'equal',
        emoji: '⚖️',
        description: 'Tout le monde reçoit la même part',
      },
      {
        label: 'Pro-rata du temps en vocal',
        value: 'time',
        emoji: '⏱️',
        description: 'Selon le temps passé dans le vocal',
      },
      {
        label: 'Pourcentages custom',
        value: 'custom',
        emoji: '✍️',
        description: 'Tu définis le % de chacun',
      },
    );

  await interaction.reply({
    content:
      `💰 Loot brut : **${formatAmount(amount)}**\n` +
      `🏛️ Taxe guilde (10%) : **-${formatAmount(guildTax)}**\n` +
      `📉 Taxe marché (6.5%) : **-${formatAmount(marketTax)}**\n` +
      `✅ Net à répartir : **${formatAmount(net)}**\n\n` +
      `Choisis le mode de split :`,
    components: [new ActionRowBuilder().addComponents(select)],
  });
}

// ----------------------------------------------------------------------------
// 6. Choix du mode de split
// ----------------------------------------------------------------------------
async function handleSplitModeSelect(interaction, sessionId) {
  const mode = interaction.values[0];
  const session = await db.getSession(sessionId);
  const participants = await db.getParticipants(sessionId);

  if (!participants.length) {
    return interaction.update({
      content:
        '❌ Aucun participant inscrit, impossible de répartir.',
      components: [],
    });
  }

  await db.setSessionSplitMode(sessionId, mode);

  if (mode === 'custom') {
    const modal = new ModalBuilder()
      .setCustomId(`payout_customsplit_${sessionId}`)
      .setTitle('Répartition custom')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('custom_split')
            .setLabel('pseudo:pourcentage séparés par des espaces')
            .setPlaceholder(
              'Joueur1:40 Joueur2:30 Joueur3:30  (ou "egal")',
            )
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true),
        ),
      );
    return interaction.showModal(modal);
  }

  await interaction.update({
    content: '⏳ Calcul de la répartition...',
    components: [],
  });

  let shares;
  if (mode === 'equal') {
    shares = computeEqualSplit(session.net_amount, participants);
  } else {
    shares = computeTimeSplit(session.net_amount, participants);
  }

  await finalizeSplit(interaction, session, participants, shares);
}

function computeEqualSplit(netAmount, participants) {
  const share = Math.floor(netAmount / participants.length);
  const shares = {};
  participants.forEach((p) => (shares[p.user_id] = share));
  return shares;
}

function computeTimeSplit(netAmount, participants) {
  const totalSeconds = participants.reduce(
    (sum, p) => sum + p.voice_seconds,
    0,
  );
  const shares = {};

  if (totalSeconds <= 0) {
    // Personne n'a de temps tracké -> fallback équitable
    return computeEqualSplit(netAmount, participants);
  }

  participants.forEach((p) => {
    shares[p.user_id] = Math.floor(
      (p.voice_seconds / totalSeconds) * netAmount,
    );
  });
  return shares;
}

// ----------------------------------------------------------------------------
// 7. Soumission du modal de split custom
// ----------------------------------------------------------------------------
async function handleCustomSplitModalSubmit(interaction, sessionId) {
  const session = await db.getSession(sessionId);
  const participants = await db.getParticipants(sessionId);
  const raw = interaction.fields
    .getTextInputValue('custom_split')
    .trim();

  if (raw.toLowerCase() === 'egal') {
    const shares = computeEqualSplit(
      session.net_amount,
      participants,
    );
    await interaction.reply({
      content: '⏳ Calcul de la répartition...',
      ephemeral: false,
    });
    return finalizeSplit(interaction, session, participants, shares);
  }

  // Parse format "Pseudo1:40 Pseudo2:30 Pseudo3:30"
  const tokens = raw.split(/\s+/).filter(Boolean);
  const parsedEntries = [];
  for (const token of tokens) {
    const [name, pctStr] = token.split(':');
    const pct = parseFloat((pctStr || '').replace(',', '.'));
    if (!name || isNaN(pct)) {
      return interaction.reply({
        content: `❌ Format invalide pour "${token}". Utilise : Joueur1:40 Joueur2:60`,
        ephemeral: true,
      });
    }
    parsedEntries.push({ name: name.toLowerCase(), pct });
  }

  const totalPct = parsedEntries.reduce((s, e) => s + e.pct, 0);
  if (Math.abs(totalPct - 100) > 0.5) {
    return interaction.reply({
      content: `❌ Le total des pourcentages fait **${totalPct}%**, il doit faire 100%.`,
      ephemeral: true,
    });
  }

  // Associer chaque pseudo à un participant réel du serveur
  const guild = interaction.guild;
  const shares = {};
  for (const entry of parsedEntries) {
    const participant = participants.find((p) => {
      const member = guild.members.cache.get(p.user_id);
      if (!member) return false;
      return (
        member.user.username.toLowerCase() === entry.name ||
        (member.nickname &&
          member.nickname.toLowerCase() === entry.name) ||
        member.displayName.toLowerCase() === entry.name
      );
    });

    if (!participant) {
      const validNames = participants
        .map((p) => guild.members.cache.get(p.user_id)?.displayName)
        .filter(Boolean)
        .join(', ');
      return interaction.reply({
        content: `❌ Joueur "${entry.name}" introuvable parmi les inscrits.\nInscrits : ${validNames}`,
        ephemeral: true,
      });
    }

    shares[participant.user_id] = Math.floor(
      (entry.pct / 100) * session.net_amount,
    );
  }

  await interaction.reply({
    content: '⏳ Calcul de la répartition...',
  });
  await finalizeSplit(interaction, session, participants, shares);
}

// ----------------------------------------------------------------------------
// 8. Finalisation : crédite, DM, résume, planifie la suppression des channels
// ----------------------------------------------------------------------------
async function finalizeSplit(
  interaction,
  session,
  participants,
  shares,
) {
  for (const p of participants) {
    const amount = shares[p.user_id] || 0;
    await db.setParticipantShare(session.id, p.user_id, amount);
    await db.addToBalance(p.user_id, amount);
    await db.logTransaction({
      type: 'payout_credit',
      userId: p.user_id,
      amount,
      description: `${session.type_label} (session #${session.id})`,
    });

    try {
      const newBalance = await db.getBalance(p.user_id);
      const user = await interaction.client.users.fetch(p.user_id);
      await user.send(
        `💰 Tu as reçu **${formatAmount(amount)}** suite au payout **${session.type_label}**.\n` +
          `Ton nouveau solde : **${formatAmount(newBalance)}**`,
      );
    } catch {
      // DM fermés, on ignore silencieusement
    }
  }

  await db.logTransaction({
    type: 'payout_credit_summary',
    userId: session.leader_id,
    amount: session.net_amount,
    description: `${session.type_label} - ${formatAmount(session.net_amount)} net il y a 0 jour`,
  });

  await db.setSessionStatus(session.id, 'done');
  const updatedSession = await db.getSession(session.id);
  const updatedParticipants = await db.getParticipants(session.id);
  const summaryEmbed = splitSummaryEmbed(
    updatedSession,
    updatedParticipants,
  );

  const channel = interaction.channel;
  await channel.send({ embeds: [summaryEmbed] });
  if (config.BANK_LOGS_CHANNEL_ID) {
    const logChannel = interaction.guild.channels.cache.get(
      config.BANK_LOGS_CHANNEL_ID,
    );
    if (logChannel) {
      await logChannel.send({
        embeds: [
          payoutLogEmbed(
            await db.getSession(session.id),
            updatedParticipants,
          ),
        ],
      });
    }
  }

  const voiceChannel = interaction.guild.channels.cache.get(
    session.voice_channel_id,
  );
  const textChannel = interaction.guild.channels.cache.get(
    session.text_channel_id,
  );

  setTimeout(async () => {
    try {
      if (voiceChannel) await voiceChannel.delete();
    } catch {}
    try {
      if (textChannel) await textChannel.delete();
    } catch {}
  }, config.CHANNEL_DELETE_DELAY);
}

// ----------------------------------------------------------------------------
// Suivi du temps passé en vocal (appelé depuis events/voiceStateUpdate.js)
// ----------------------------------------------------------------------------
async function onVoiceJoin(sessionId, userId, voiceChannelId) {
  if (!(await db.isParticipant(sessionId, userId))) return;
  if (!liveVoiceJoins.has(voiceChannelId))
    liveVoiceJoins.set(voiceChannelId, new Map());
  liveVoiceJoins.get(voiceChannelId).set(userId, Date.now());
}

async function onVoiceLeave(sessionId, userId, voiceChannelId) {
  const channelMap = liveVoiceJoins.get(voiceChannelId);
  if (!channelMap || !channelMap.has(userId)) return;
  const joinedAt = channelMap.get(userId);
  channelMap.delete(userId);
  const elapsedSeconds = (Date.now() - joinedAt) / 1000;
  await db.flushParticipantVoiceTime(
    sessionId,
    userId,
    elapsedSeconds,
  );
}

module.exports = {
  handleLaunchButton,
  handleTypeSelect,
  handleSignupButton,
  handleUnsignupButton,
  handleCloseButton,
  handleEnterLootButton,
  handleLootModalSubmit,
  handleSplitModeSelect,
  handleCustomSplitModalSubmit,
  onVoiceJoin,
  onVoiceLeave,
};
