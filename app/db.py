"""Almacenamiento en SQLite con búsqueda de texto completo (FTS5)."""
import json
import os
import sqlite3
from contextlib import contextmanager

DB_PATH = os.environ.get("TWEETSHELF_DB", os.path.join(os.path.dirname(__file__), "..", "data", "tweetshelf.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS items (
    id              TEXT PRIMARY KEY,          -- id del tuit
    sources         TEXT NOT NULL DEFAULT '',  -- 'like', 'bookmark' o ambos separados por coma
    tweet_text      TEXT NOT NULL DEFAULT '',
    author_handle   TEXT,
    author_name     TEXT,
    author_avatar   TEXT,
    tweet_created   TEXT,
    tweet_url       TEXT,
    urls            TEXT NOT NULL DEFAULT '[]',  -- enlaces externos del tuit (json)
    media           TEXT NOT NULL DEFAULT '[]',  -- imágenes del tuit (json)
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
    imported_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tags (
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    tag     TEXT NOT NULL,
    auto    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (item_id, tag)
);

CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
    id UNINDEXED, tweet_text, author, article_title, article_text, note, tags,
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE INDEX IF NOT EXISTS idx_items_status ON items(article_status);
CREATE INDEX IF NOT EXISTS idx_items_domain ON items(domain);
"""


def connect():
    os.makedirs(os.path.dirname(os.path.abspath(DB_PATH)), exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def init():
    with get() as conn:
        conn.executescript(SCHEMA)


@contextmanager
def get():
    conn = connect()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def reindex(conn, item_id):
    """Recalcula la fila de búsqueda de un elemento."""
    row = conn.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
    conn.execute("DELETE FROM items_fts WHERE id = ?", (item_id,))
    if not row:
        return
    tags = " ".join(r["tag"] for r in conn.execute("SELECT tag FROM tags WHERE item_id = ?", (item_id,)))
    author = " ".join(filter(None, [row["author_name"], row["author_handle"], row["article_author"], row["article_site"]]))
    conn.execute(
        "INSERT INTO items_fts (id, tweet_text, author, article_title, article_text, note, tags) VALUES (?,?,?,?,?,?,?)",
        (item_id, row["tweet_text"], author, row["article_title"] or "", row["article_text"] or "", row["note"], tags),
    )


def row_to_dict(row, conn, full=False):
    d = dict(row)
    d["urls"] = json.loads(d["urls"] or "[]")
    d["media"] = json.loads(d["media"] or "[]")
    d["sources"] = [s for s in d["sources"].split(",") if s]
    d["favorite"] = bool(d["favorite"])
    d["is_read"] = bool(d["is_read"])
    d["archived"] = bool(d["archived"])
    d["tags"] = [r["tag"] for r in conn.execute("SELECT tag FROM tags WHERE item_id = ? ORDER BY tag", (d["id"],))]
    if not full:
        d.pop("article_text", None)
    return d
