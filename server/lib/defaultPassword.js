/** Contraseña temporal al reiniciar. El login la detecta y pide actualizarla. */
const TEMPORARY_PASSWORD = '123456789';

function isTemporaryPassword(password) {
  return String(password || '') === TEMPORARY_PASSWORD;
}

function buildDefaultPassword() {
  return TEMPORARY_PASSWORD;
}

module.exports = { TEMPORARY_PASSWORD, isTemporaryPassword, buildDefaultPassword };
