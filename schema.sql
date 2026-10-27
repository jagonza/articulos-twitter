-- Esquema de la base de datos D1 de Tweetshelf.
-- Aplicar con: npx wrangler d1 execute tweetshelf --remote --file schema.sql
CREATE TABLE IF NOT EXISTS items (
    pk              INTEGER PRIMARY KEY,
    id              TEXT NOT NULL UNIQUE,      -- id del tuit
    sources         TEXT NOT NULL DEFAULT '',  -- 'like', 'bookmark' o ambos separados por coma
    tweet_text      TEXT NOT NULL DEFAULT '',
    author_handle   TEXT,
    author_name     TEXT,
    author_avatar   TEXT,
    tweet_created   TEXT,
    tweet_url       TEXT,
    urls            TEXT NOT NULL DEFAULT '[]',
    media           TEXT NOT NULL DEFAULT '[]',
    article_url     TEXT,
    article_status  TEXT NOT NULL DEFAULT 'none',  -- none | pending | ok | failed
    article_title   TEXT,
    article_author  TEXT,
    article_site    TEXT,
    article_date    TEXT,
    article_image   TEXT,
    article_excerpt TEXT,
    article_text    TEXT,
    article_words   INTEGER,
    article_error   TEXT,
    domain          TEXT,
    favorite        INTEGER NOT NULL DEFAULT 0,
    is_read         INTEGER NOT NULL DEFAULT 0,
    archived        INTEGER NOT NULL DEFAULT 0,
    note            TEXT NOT NULL DEFAULT '',
    tags            TEXT NOT NULL DEFAULT '[]',  -- etiquetas (json)
    quoted_id       TEXT,                      -- id del tuit que cita (también guardado como elemento)
    x_status        TEXT,                      -- NULL | 'remove' (quitar de X) | 'removed' (ya quitado)
    thread          TEXT,                      -- JSON: hilo del autor en orden [{id, text, media, links}]
    thread_text     TEXT,                      -- texto del hilo, para la búsqueda
    imported_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_items_status ON items(article_status);
CREATE INDEX IF NOT EXISTS idx_items_domain ON items(domain);
CREATE INDEX IF NOT EXISTS idx_items_author ON items(author_handle);
CREATE INDEX IF NOT EXISTS idx_items_quoted ON items(quoted_id);

-- Índice de búsqueda: lee el contenido de items (no lo duplica) y se mantiene con triggers.
CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
    tweet_text, author_name, author_handle, article_author, article_site, article_title, article_text, note, tags, thread_text,
    content = 'items', content_rowid = 'pk',
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS items_ai AFTER INSERT ON items BEGIN
    INSERT INTO items_fts (rowid, tweet_text, author_name, author_handle, article_author, article_site, article_title, article_text, note, tags, thread_text) VALUES (new.pk, new.tweet_text, new.author_name, new.author_handle, new.article_author, new.article_site, new.article_title, new.article_text, new.note, new.tags, new.thread_text);
END;

CREATE TRIGGER IF NOT EXISTS items_ad AFTER DELETE ON items BEGIN
    INSERT INTO items_fts (items_fts, rowid, tweet_text, author_name, author_handle, article_author, article_site, article_title, article_text, note, tags, thread_text) VALUES ('delete', old.pk, old.tweet_text, old.author_name, old.author_handle, old.article_author, old.article_site, old.article_title, old.article_text, old.note, old.tags, old.thread_text);
END;

CREATE TRIGGER IF NOT EXISTS items_au AFTER UPDATE OF tweet_text, author_name, author_handle, article_author, article_site, article_title, article_text, note, tags, thread_text ON items BEGIN
    INSERT INTO items_fts (items_fts, rowid, tweet_text, author_name, author_handle, article_author, article_site, article_title, article_text, note, tags, thread_text) VALUES ('delete', old.pk, old.tweet_text, old.author_name, old.author_handle, old.article_author, old.article_site, old.article_title, old.article_text, old.note, old.tags, old.thread_text);
    INSERT INTO items_fts (rowid, tweet_text, author_name, author_handle, article_author, article_site, article_title, article_text, note, tags, thread_text) VALUES (new.pk, new.tweet_text, new.author_name, new.author_handle, new.article_author, new.article_site, new.article_title, new.article_text, new.note, new.tags, new.thread_text);
END;
