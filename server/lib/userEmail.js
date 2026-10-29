function normalizeUserEmail(email) {
  return String(email || '').toLowerCase().trim();
}

function isValidUserEmail(email) {
  const n = normalizeUserEmail(email);
  if (!n || n.length > 255) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(n);
}

module.exports = { normalizeUserEmail, isValidUserEmail };
