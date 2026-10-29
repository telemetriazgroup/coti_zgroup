-- Tras reiniciar la clave a 123456789, el usuario debe actualizarla al ingresar.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN users.must_change_password IS
  'True si la clave es la temporal (123456789). El usuario debe cambiarla al ingresar.';
