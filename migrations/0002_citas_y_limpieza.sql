-- Tuits citados como elementos propios y marca para quitar de X.
-- Aplicar sobre una base creada antes de este cambio:
--   npx wrangler d1 execute tweetshelf --remote --file migrations/0002_citas_y_limpieza.sql
ALTER TABLE items ADD COLUMN quoted_id TEXT;
ALTER TABLE items ADD COLUMN x_status TEXT;
CREATE INDEX IF NOT EXISTS idx_items_quoted ON items(quoted_id);
