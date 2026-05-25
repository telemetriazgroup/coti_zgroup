const bcrypt = require('bcrypt');
const { pool } = require('../config/db');

/** Verifica la contraseña del usuario autenticado (operaciones sensibles). */
async function verifyUserPassword(userId, password) {
  if (!userId || !password || typeof password !== 'string') return false;
  const { rows } = await pool.query(`SELECT password_hash FROM users WHERE id = $1 AND active = true`, [userId]);
  if (!rows[0]?.password_hash) return false;
  return bcrypt.compare(password, rows[0].password_hash);
}

module.exports = { verifyUserPassword };
