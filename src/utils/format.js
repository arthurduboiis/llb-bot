/**
 * Formate un montant en notation courte façon Albion Online (K, M)
 * ex: 1234567 -> "1.23M" | 8590 -> "8.59K" | 950 -> "950"
 */
function formatAmount(amount) {
  const n = Number(amount) || 0;
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';

  if (abs >= 1_000_000) {
    return `${sign}${(abs / 1_000_000).toFixed(2)}M`;
  }
  if (abs >= 1_000) {
    return `${sign}${(abs / 1_000).toFixed(2)}K`;
  }
  return `${sign}${Math.round(abs)}`;
}

/**
 * Formate une durée en secondes -> "1h 23m" ou "45m" ou "30s"
 */
function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;

  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

/**
 * Parse un nombre saisi par un utilisateur (accepte espaces, virgules, k/m suffixes)
 * ex: "1 200 000" -> 1200000 | "1.2m" -> 1200000 | "850k" -> 850000
 * Retourne null si invalide.
 */
function parseAmount(input) {
  if (!input) return null;
  let str = String(input).trim().toLowerCase().replace(/\s/g, '').replace(/,/g, '.');

  let multiplier = 1;
  if (str.endsWith('m')) {
    multiplier = 1_000_000;
    str = str.slice(0, -1);
  } else if (str.endsWith('k')) {
    multiplier = 1_000;
    str = str.slice(0, -1);
  }

  const value = parseFloat(str);
  if (isNaN(value) || value < 0) return null;

  return Math.round(value * multiplier);
}

module.exports = { formatAmount, formatDuration, parseAmount };
