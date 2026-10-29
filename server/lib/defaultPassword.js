/** Contraseña temporal al reiniciar. El login la detecta y pide actualizarla. */
const TEMPORARY_PASSWORD = '123456789';
const MIN_PASSWORD_LENGTH = 6;

function isTemporaryPassword(password) {
  return String(password || '') === TEMPORARY_PASSWORD;
}

function buildDefaultPassword() {
  return TEMPORARY_PASSWORD;
}

function isValidPasswordLength(password) {
  return String(password || '').length >= MIN_PASSWORD_LENGTH;
}

module.exports = {
  TEMPORARY_PASSWORD,
  MIN_PASSWORD_LENGTH,
  isTemporaryPassword,
  isValidPasswordLength,
  buildDefaultPassword,
};
