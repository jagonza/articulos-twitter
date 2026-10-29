-- Ya no se quita nada de X desde Tweetshelf: la importación trae sólo lo nuevo y lo de X se queda allí.
-- Aplicar en remoto (con el OK de Javier):
--   npx wrangler d1 execute tweetshelf --remote --file migrations/0005_sin_limpieza.sql
ALTER TABLE items DROP COLUMN x_status;
