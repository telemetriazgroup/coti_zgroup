/** Contraseña por defecto al reiniciar: local@email + año + ! (ej. ejemplo@a.com → ejemplo2026!) */

function buildDefaultPassword(email, year = new Date().getFullYear()) {
  const local = String(email || '')
    .toLowerCase()
    .trim()
    .split('@')[0]
    .replace(/[^a-z0-9._-]/g, '') || 'user';
  return `${local}${year}!`;
}

module.exports = { buildDefaultPassword };
