const { Pool } = require('pg');
const config = require('./config');

if (!config.DATABASE_URL) {
  console.error(
    '❌ DATABASE_URL doit être défini dans le .env (copie-le depuis Supabase > ton projet > Connect > Session pooler).',
  );
  process.exit(1);
}

// On utilise le pooler de connexion Supabase ("Session pooler", port 5432) plutôt que
// la connexion directe : il fonctionne en IPv4 (Render n'a pas d'IPv6 sortant) et se
// comporte comme une connexion Postgres normale (compatible avec nos requêtes
// paramétrées classiques, contrairement au "Transaction pooler" qui est plus restrictif).
const pool = new Pool({
  connectionString: config.DATABASE_URL,
  // Supabase exige SSL sur toutes les connexions externes. En local (localhost) on le désactive.
  ssl: config.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
  // Le plan gratuit Supabase limite le nombre de connexions simultanées (~60 via le pooler,
  // partagées avec le reste du projet). On garde un pool volontairement petit : un bot Discord
  // mono-instance n'a jamais besoin de beaucoup de connexions en parallèle.
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => {
  // Évite de crasher tout le process si Supabase coupe une connexion idle
  // (ça arrive sur le plan gratuit, notamment après une mise en pause du projet).
  console.error(
    '⚠️  Erreur sur une connexion PostgreSQL (pool) :',
    err.message,
  );
});

// Petit helper : Postgres renvoie les BIGINT sous forme de string en JS (pour éviter
// les pertes de précision). On les reconvertit en Number partout où on les récupère,
// pour garder un comportement identique à l'ancienne version SQLite.
const n = (v) => (v === null || v === undefined ? v : Number(v));

// ----------------------------------------------------------------------------
// SCHEMA - à appeler une fois au démarrage du bot (voir index.js)
// ----------------------------------------------------------------------------
async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      user_id TEXT PRIMARY KEY,
      balance BIGINT NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS treasury (
      id INTEGER PRIMARY KEY,
      balance BIGINT NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      user_id TEXT,
      amount BIGINT NOT NULL,
      description TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS payout_sessions (
      id SERIAL PRIMARY KEY,
      type_label TEXT NOT NULL,
      leader_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      text_channel_id TEXT,
      voice_channel_id TEXT,
      message_id TEXT,
      loot_amount BIGINT,
      net_amount BIGINT,
      split_mode TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS payout_participants (
      session_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      voice_seconds INTEGER NOT NULL DEFAULT 0,
      joined_voice_at TIMESTAMPTZ,
      share_amount BIGINT,
      PRIMARY KEY (session_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS withdrawals (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      amount BIGINT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      paid_at TIMESTAMPTZ
    );
  `);

  await pool.query(
    `INSERT INTO treasury (id, balance) VALUES (1, 0) ON CONFLICT (id) DO NOTHING`,
  );

  await pool.query(
    `ALTER TABLE payout_sessions ADD COLUMN IF NOT EXISTS message_id TEXT`,
  );

  console.log('✅ Schéma PostgreSQL (Supabase) prêt.');
}

// ----------------------------------------------------------------------------
// PLAYERS
// ----------------------------------------------------------------------------
async function ensurePlayer(userId) {
  await pool.query(
    `INSERT INTO players (user_id, balance) VALUES ($1, 0) ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  );
}

async function getBalance(userId) {
  await ensurePlayer(userId);
  const res = await pool.query(
    `SELECT balance FROM players WHERE user_id = $1`,
    [userId],
  );
  return n(res.rows[0].balance);
}

async function deductBalance(userId, amount) {
  const res = await pool.query(
    `UPDATE players SET balance = balance - $1
     WHERE user_id = $2 AND balance >= $1
     RETURNING balance`,
    [amount, userId],
  );
  return res.rowCount > 0; // false si solde insuffisant au moment du UPDATE
}

async function getAllBalances() {
  const res = await pool.query(
    `SELECT user_id, balance FROM players WHERE balance != 0 ORDER BY balance DESC`,
  );
  return res.rows.map((r) => ({
    user_id: r.user_id,
    balance: n(r.balance),
  }));
}

async function countPlayersWithBalance() {
  const res = await pool.query(
    `SELECT COUNT(*) as c FROM players WHERE balance > 0`,
  );
  return n(res.rows[0].c);
}

// ----------------------------------------------------------------------------
// TREASURY
// ----------------------------------------------------------------------------
async function getTreasury() {
  const res = await pool.query(
    `SELECT balance FROM treasury WHERE id = 1`,
  );
  return n(res.rows[0].balance);
}

async function addToTreasury(amount) {
  await pool.query(
    `UPDATE treasury SET balance = balance + $1 WHERE id = 1`,
    [amount],
  );
}

async function addToBalance(userId, amount) {
  await ensurePlayer(userId);
  await pool.query(
    `UPDATE players SET balance = balance + $1 WHERE user_id = $2`,
    [amount, userId],
  );
}

// ----------------------------------------------------------------------------
// TRANSACTIONS (historique)
// ----------------------------------------------------------------------------
async function logTransaction({
  type,
  userId = null,
  amount,
  description = '',
}) {
  await pool.query(
    `INSERT INTO transactions (type, user_id, amount, description) VALUES ($1, $2, $3, $4)`,
    [type, userId, amount, description],
  );
}

async function getRecentTransactions(limit = 5, type = null) {
  const res = type
    ? await pool.query(
        `SELECT * FROM transactions WHERE type = $1 ORDER BY id DESC LIMIT $2`,
        [type, limit],
      )
    : await pool.query(
        `SELECT * FROM transactions ORDER BY id DESC LIMIT $1`,
        [limit],
      );
  return res.rows.map((r) => ({ ...r, amount: n(r.amount) }));
}

// ----------------------------------------------------------------------------
// PAYOUT SESSIONS
// ----------------------------------------------------------------------------
async function createPayoutSession({ typeLabel, leaderId }) {
  const res = await pool.query(
    `INSERT INTO payout_sessions (type_label, leader_id) VALUES ($1, $2) RETURNING id`,
    [typeLabel, leaderId],
  );
  return res.rows[0].id;
}

async function getSession(sessionId) {
  const res = await pool.query(
    `SELECT * FROM payout_sessions WHERE id = $1`,
    [sessionId],
  );
  const row = res.rows[0];
  if (!row) return undefined;
  return {
    ...row,
    loot_amount: n(row.loot_amount),
    net_amount: n(row.net_amount),
  };
}

async function getSessionByVoiceChannel(voiceChannelId) {
  const res = await pool.query(
    `SELECT * FROM payout_sessions WHERE voice_channel_id = $1 AND status != 'done'`,
    [voiceChannelId],
  );
  const row = res.rows[0];
  if (!row) return undefined;
  return {
    ...row,
    loot_amount: n(row.loot_amount),
    net_amount: n(row.net_amount),
  };
}

async function setSessionChannels(
  sessionId,
  textChannelId,
  voiceChannelId,
) {
  await pool.query(
    `UPDATE payout_sessions SET text_channel_id = $1, voice_channel_id = $2 WHERE id = $3`,
    [textChannelId, voiceChannelId, sessionId],
  );
}

async function setSessionStatus(sessionId, status) {
  await pool.query(
    `UPDATE payout_sessions SET status = $1 WHERE id = $2`,
    [status, sessionId],
  );
}

async function setSessionLoot(sessionId, lootAmount, netAmount) {
  await pool.query(
    `UPDATE payout_sessions SET loot_amount = $1, net_amount = $2, status = 'loot_entered' WHERE id = $3`,
    [lootAmount, netAmount, sessionId],
  );
}

async function setSessionSplitMode(sessionId, mode) {
  await pool.query(
    `UPDATE payout_sessions SET split_mode = $1 WHERE id = $2`,
    [mode, sessionId],
  );
}

async function setSessionMessageId(sessionId, messageId) {
  await pool.query(
    `UPDATE payout_sessions SET message_id = $1 WHERE id = $2`,
    [messageId, sessionId],
  );
}

// ----------------------------------------------------------------------------
// PARTICIPANTS
// ----------------------------------------------------------------------------
async function addParticipant(sessionId, userId) {
  await pool.query(
    `INSERT INTO payout_participants (session_id, user_id) VALUES ($1, $2) ON CONFLICT (session_id, user_id) DO NOTHING`,
    [sessionId, userId],
  );
}

async function removeParticipant(sessionId, userId) {
  await pool.query(
    `DELETE FROM payout_participants WHERE session_id = $1 AND user_id = $2`,
    [sessionId, userId],
  );
}

async function isParticipant(sessionId, userId) {
  const res = await pool.query(
    `SELECT 1 FROM payout_participants WHERE session_id = $1 AND user_id = $2`,
    [sessionId, userId],
  );
  return res.rows.length > 0;
}

async function getParticipants(sessionId) {
  const res = await pool.query(
    `SELECT * FROM payout_participants WHERE session_id = $1`,
    [sessionId],
  );
  return res.rows.map((r) => ({
    ...r,
    voice_seconds: n(r.voice_seconds),
    share_amount: n(r.share_amount),
  }));
}

async function setParticipantVoiceJoin(
  sessionId,
  userId,
  isoTimestamp,
) {
  await pool.query(
    `UPDATE payout_participants SET joined_voice_at = $1 WHERE session_id = $2 AND user_id = $3`,
    [isoTimestamp, sessionId, userId],
  );
}

async function flushParticipantVoiceTime(
  sessionId,
  userId,
  additionalSeconds,
) {
  await pool.query(
    `UPDATE payout_participants
     SET voice_seconds = voice_seconds + $1, joined_voice_at = NULL
     WHERE session_id = $2 AND user_id = $3`,
    [Math.max(0, Math.round(additionalSeconds)), sessionId, userId],
  );
}

async function setParticipantShare(sessionId, userId, shareAmount) {
  await pool.query(
    `UPDATE payout_participants SET share_amount = $1 WHERE session_id = $2 AND user_id = $3`,
    [shareAmount, sessionId, userId],
  );
}

// ----------------------------------------------------------------------------
// WITHDRAWALS
// ----------------------------------------------------------------------------
async function createWithdrawal(userId, amount) {
  const res = await pool.query(
    `INSERT INTO withdrawals (user_id, amount) VALUES ($1, $2) RETURNING id`,
    [userId, amount],
  );
  return res.rows[0].id;
}

async function getWithdrawal(id) {
  const res = await pool.query(
    `SELECT * FROM withdrawals WHERE id = $1`,
    [id],
  );
  const row = res.rows[0];
  if (!row) return undefined;
  return { ...row, amount: n(row.amount) };
}

async function getPendingWithdrawals() {
  const res = await pool.query(
    `SELECT * FROM withdrawals WHERE status = 'pending' ORDER BY id ASC`,
  );
  return res.rows.map((r) => ({ ...r, amount: n(r.amount) }));
}

async function countPendingWithdrawals() {
  const res = await pool.query(
    `SELECT COUNT(*) as c FROM withdrawals WHERE status = 'pending'`,
  );
  return n(res.rows[0].c);
}

async function markWithdrawalPaid(id) {
  await pool.query(
    `UPDATE withdrawals SET status = 'paid', paid_at = NOW() WHERE id = $1`,
    [id],
  );
}

async function markWithdrawalCancelled(id) {
  await pool.query(
    `UPDATE withdrawals SET status = 'cancelled' WHERE id = $1`,
    [id],
  );
}

module.exports = {
  pool,
  initDatabase,
  ensurePlayer,
  getBalance,
  deductBalance,
  getAllBalances,
  countPlayersWithBalance,
  getTreasury,
  addToTreasury,
  logTransaction,
  getRecentTransactions,
  createPayoutSession,
  getSession,
  getSessionByVoiceChannel,
  setSessionChannels,
  setSessionStatus,
  setSessionLoot,
  setSessionSplitMode,
  addParticipant,
  removeParticipant,
  isParticipant,
  getParticipants,
  setParticipantVoiceJoin,
  flushParticipantVoiceTime,
  setSessionMessageId,
  addToBalance,
  setParticipantShare,
  createWithdrawal,
  getWithdrawal,
  getPendingWithdrawals,
  countPendingWithdrawals,
  markWithdrawalPaid,
  markWithdrawalCancelled,
};
