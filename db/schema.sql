-- ============================================================
-- El Perdonómetro · esquema SQLite (para Turso)
-- ------------------------------------------------------------
-- Cargar con:
--   turso db create perdonometro
--   turso db shell perdonometro < db\schema.sql
--   turso db show perdonometro --url
--   turso db tokens create perdonometro
-- (o pegando este archivo completo en la consola SQL de Turso)
-- ============================================================

PRAGMA foreign_keys = ON;

-- Los dos usuarios de la app
CREATE TABLE IF NOT EXISTS usuarios (
  usuario TEXT PRIMARY KEY,          -- 'anyi', 'edu'
  clave   TEXT NOT NULL,             -- contraseña en texto plano (demo de 2 usuarios)
  nombre  TEXT NOT NULL
);

-- Cuánto le deben a cada uno + estado del frasco (una sola fila, id = 1)
CREATE TABLE IF NOT EXISTS estado (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  meta        INTEGER NOT NULL DEFAULT 300000,  -- a qué monto se ve lleno el frasco
  actualizado INTEGER NOT NULL DEFAULT 0,
  revision    INTEGER NOT NULL DEFAULT 0        -- "huella" para el sondeo barato:
                     -- sube en cada escritura; el sondeo lee solo esta fila
);

CREATE TABLE IF NOT EXISTS deudas (
  usuario    TEXT PRIMARY KEY,       -- a quién le deben
  debe       INTEGER NOT NULL DEFAULT 0,
  actualizado INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (usuario) REFERENCES usuarios(usuario)
);

-- Historial de cobros
CREATE TABLE IF NOT EXISTS movimientos (
  id     TEXT PRIMARY KEY,
  autor  TEXT NOT NULL,              -- quién apretó "Cobrar luca"
  deudor TEXT NOT NULL,              -- a quién se le cobró
  monto  INTEGER NOT NULL,
  ts     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_movimientos_ts ON movimientos (ts DESC);

-- Chat de la pareja (mensajes compactos, sin límite de historial)
CREATE TABLE IF NOT EXISTS mensajes (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,  -- creciente → paginar con WHERE id > ?
  autor TEXT NOT NULL,                      -- 'anyi' | 'edu'
  texto TEXT NOT NULL,
  ts    INTEGER NOT NULL
);

-- --------------------- datos iniciales ---------------------
INSERT INTO usuarios (usuario, clave, nombre) VALUES
  ('anyi', '2712', 'Anyi'),
  ('edu',  '0608', 'Edu')
ON CONFLICT(usuario) DO NOTHING;

INSERT INTO estado (id, meta, actualizado)
VALUES (1, 300000, 0)
ON CONFLICT(id) DO NOTHING;

INSERT INTO deudas (usuario, debe, actualizado) VALUES
  ('anyi', 0, 0),
  ('edu',  0, 0)
ON CONFLICT(usuario) DO NOTHING;
