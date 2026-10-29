-- Los enlaces a otras webs ya no se extraen: un tuit con enlace es un tuit simple y el enlace va en su texto.
-- Sólo los Artículos de X (domain = 'x.com') conservan el artículo; el resto vuelve a ser tuit.
UPDATE items SET
    article_status = 'none', article_url = NULL, article_title = NULL, article_author = NULL, article_site = NULL,
    article_date = NULL, article_image = NULL, article_excerpt = NULL, article_text = NULL, article_words = NULL,
    article_error = NULL, domain = NULL,
    -- las importaciones antiguas sólo traían el t.co: se cambia por la dirección real que resolvió el extractor
    urls = CASE WHEN article_url IS NOT NULL AND NOT EXISTS (SELECT 1 FROM json_each(items.urls) WHERE value NOT LIKE 'https://t.co/%')
                THEN json_array(article_url) ELSE urls END,
    -- «lectura larga» la ponía el extractor según el texto de la web; «código», «vídeo»… siguen valiendo para el enlace
    tags = (SELECT json_group_array(value) FROM json_each(items.tags) WHERE value != 'lectura larga'),
    updated_at = datetime('now')
WHERE article_status != 'ok' OR domain IS NOT 'x.com';
