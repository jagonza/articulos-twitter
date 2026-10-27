-- Hilos: los tuits del autor que siguen al guardado (JSON) y su texto, que entra en la búsqueda.
ALTER TABLE items ADD COLUMN thread TEXT;
ALTER TABLE items ADD COLUMN thread_text TEXT;

-- El índice de búsqueda se rehace con la columna nueva.
DROP TRIGGER IF EXISTS items_ai;
DROP TRIGGER IF EXISTS items_ad;
DROP TRIGGER IF EXISTS items_au;
DROP TABLE IF EXISTS items_fts;

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

INSERT INTO items_fts (items_fts) VALUES ('rebuild');
