module.exports = {
  TOKEN: process.env.DISCORD_TOKEN,
  CLIENT_ID: process.env.CLIENT_ID,
  DB_FILE: process.env.DB_FILE || 'sovereign.db',
  GUILD_ID: process.env.GUILD_ID,
  OFFICER_ROLE_ID: process.env.OFFICER_ROLE_ID,
  BANK_CHANNEL_ID: process.env.BANK_CHANNEL_ID,
  PAYOUT_LAUNCH_CHANNEL_ID:
    process.env.PAYOUT_LAUNCH_CHANNEL_ID || null,
  DATABASE_URL: process.env.DATABASE_URL,
  BANK_LOGS_CHANNEL_ID: process.env.BANK_LOGS_CHANNEL_ID || null,
  PAYOUT_CATEGORY_ID: process.env.PAYOUT_CATEGORY_ID || null,
  PAYOUT_CATEGORY_NAME: '📦 Payouts en cours',

  // Taxes appliquées sur chaque loot rentré
  GUILD_TAX_RATE: 0.1, // 10% taxe guilde -> va dans la trésorerie
  MARKET_TAX_RATE: 0.065, // 6.5% taxe de marché (perdue, ne va nulle part)

  // Types de payout proposés dans le menu
  PAYOUT_TYPES: [
    { label: 'Raid Avalon', value: 'raid_avalon', emoji: '🏰' },
    { label: 'Donjon', value: 'donjon', emoji: '🗝️' },
    { label: 'ZvZ', value: 'zvz', emoji: '⚔️' },
    { label: 'Gank', value: 'gank', emoji: '🗡️' },
    { label: 'Transport', value: 'transport', emoji: '🚚' },
    { label: 'Faction', value: 'faction', emoji: '🏴' },
  ],

  // Délai (ms) avant suppression des channels temporaires après un split terminé
  CHANNEL_DELETE_DELAY: 60_000,

  // Devise affichée
  CURRENCY_SUFFIX: ' argent', // ex: "1.23M argent" -> tu peux mettre "" si tu préfères juste le nombre
};
