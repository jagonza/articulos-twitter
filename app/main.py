"""API de Tweetshelf: importar, extraer, buscar y organizar tus favoritos de X/Twitter."""
import json
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import db
from .extract import extract
from .importers import parse_file

STATIC = os.path.join(os.path.dirname(__file__), "..", "static")
app = FastAPI(title="Tweetshelf")
db.init()

# ---------------------------------------------------------------- importación


@app.post("/api/import")
async def import_file(file: UploadFile = File(...), source: Optional[str] = Form(None)):
    try:
        items = parse_file(file.filename, await file.read(), source)
    except Exception as e:  # formato no reconocido
        raise HTTPException(400, f"No he podido leer el fichero: {e}")
    added = updated = 0
    with db.get() as conn:
        for it in items:
            row = conn.execute("SELECT sources, author_handle, urls FROM items WHERE id = ?", (it["id"],)).fetchone()
            if row:
                sources = sorted(set(filter(None, row["sources"].split(","))) | {it["source"]})
                # Completa datos que falten (p. ej. like.js no trae autor, la exportación de guardados sí).
                conn.execute(
                    """UPDATE items SET sources = ?, author_handle = COALESCE(author_handle, ?),
                       author_name = COALESCE(author_name, ?), author_avatar = COALESCE(author_avatar, ?),
                       tweet_created = COALESCE(tweet_created, ?), media = CASE WHEN media = '[]' THEN ? ELSE media END,
                       tweet_url = CASE WHEN author_handle IS NULL THEN ? ELSE tweet_url END
                       WHERE id = ?""",
                    (",".join(sources), it["author_handle"], it["author_name"], it["author_avatar"],
                     it["tweet_created"], json.dumps(it["media"]), it["tweet_url"], it["id"]))
                updated += 1
            else:
                conn.execute(
                    """INSERT INTO items (id, sources, tweet_text, author_handle, author_name, author_avatar,
                       tweet_created, tweet_url, urls, media, article_status)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                    (it["id"], it["source"], it["tweet_text"], it["author_handle"], it["author_name"],
                     it["author_avatar"], it["tweet_created"], it["tweet_url"], json.dumps(it["urls"]),
                     json.dumps(it["media"]), "pending" if it["urls"] else "none"))
                added += 1
            db.reindex(conn, it["id"])
    start_extraction()
    return {"found": len(items), "added": added, "updated": updated}


# ---------------------------------------------------------------- extracción en segundo plano

_lock = threading.Lock()
_progress = {"running": False, "done": 0, "total": 0}


def _extract_one(item_id):
    with db.get() as conn:
        row = conn.execute("SELECT urls FROM items WHERE id = ?", (item_id,)).fetchone()
    try:
        data = extract(json.loads(row["urls"]))
    except Exception as e:
        data = {"article_status": "failed", "article_error": str(e)[:300]}
    tags = data.pop("_tags", set())
    with db.get() as conn:
        cols = ", ".join(f"{k} = ?" for k in data)
        conn.execute(f"UPDATE items SET {cols}, updated_at = datetime('now') WHERE id = ?", (*data.values(), item_id))
        for t in tags:
            conn.execute("INSERT OR IGNORE INTO tags (item_id, tag, auto) VALUES (?,?,1)", (item_id, t))
        db.reindex(conn, item_id)
    with _lock:
        _progress["done"] += 1


def _run_extraction():
    while True:
        with db.get() as conn:
            ids = [r["id"] for r in conn.execute("SELECT id FROM items WHERE article_status = 'pending'")]
        if not ids:
            break
        with _lock:
            _progress["total"] += len(ids)
        with ThreadPoolExecutor(max_workers=int(os.environ.get("TWEETSHELF_WORKERS", 6))) as pool:
            list(pool.map(_extract_one, ids))
    with _lock:
        _progress["running"] = False


def start_extraction():
    with _lock:
        if _progress["running"]:
            return
        _progress.update(running=True, done=0, total=0)
    threading.Thread(target=_run_extraction, daemon=True).start()


@app.get("/api/progress")
def progress():
    with db.get() as conn:
        pending = conn.execute("SELECT COUNT(*) FROM items WHERE article_status = 'pending'").fetchone()[0]
    return {**_progress, "pending": pending}


@app.post("/api/items/{item_id}/refetch")
def refetch(item_id: str):
    with db.get() as conn:
        conn.execute("UPDATE items SET article_status = 'pending' WHERE id = ? AND urls != '[]'", (item_id,))
    start_extraction()
    return {"ok": True}


@app.post("/api/retry-failed")
def retry_failed():
    with db.get() as conn:
        n = conn.execute("UPDATE items SET article_status = 'pending' WHERE article_status = 'failed'").rowcount
    start_extraction()
    return {"queued": n}


# ---------------------------------------------------------------- consulta

SORTS = {
    "recent": "CAST(i.id AS INTEGER) DESC",
    "oldest": "CAST(i.id AS INTEGER) ASC",
    "longest": "COALESCE(i.article_words, 0) DESC",
    "shortest": "CASE WHEN i.article_words IS NULL THEN 1 ELSE 0 END, i.article_words ASC",
    "random": "RANDOM()",
    "updated": "i.updated_at DESC",
}
VIEWS = {
    "all": "i.archived = 0",
    "favorites": "i.favorite = 1",
    "unread": "i.is_read = 0 AND i.archived = 0 AND i.article_status = 'ok'",
    "articles": "i.article_status = 'ok' AND i.archived = 0",
    "tweets": "i.article_status IN ('none', 'failed') AND i.archived = 0",
    "notes": "i.note != ''",
    "archived": "i.archived = 1",
}


def fts_query(q):
    terms = [t.replace('"', "") for t in q.split() if t.replace('"', "")]
    return " ".join(f'"{t}"*' for t in terms)


@app.get("/api/items")
def list_items(q: str = "", view: str = "all", tag: str = "", domain: str = "", source: str = "",
               author: str = "", sort: str = "recent", limit: int = 60, offset: int = 0):
    where, params, select_extra, join = [VIEWS.get(view, VIEWS["all"])], [], "", ""
    if q.strip():
        join = "JOIN items_fts f ON f.id = i.id"
        where.append("items_fts MATCH ?")
        params.append(fts_query(q))
        select_extra = ", snippet(items_fts, -1, char(1), char(2), '…', 24) AS snippet"
    if tag:
        where.append("EXISTS (SELECT 1 FROM tags t WHERE t.item_id = i.id AND t.tag = ?)")
        params.append(tag)
    if domain:
        where.append("i.domain = ?")
        params.append(domain)
    if source:
        where.append("(',' || i.sources || ',') LIKE ?")
        params.append(f"%,{source},%")
    if author:
        where.append("i.author_handle = ?")
        params.append(author)
    order = "rank" if q.strip() and sort == "relevance" else SORTS.get(sort, SORTS["recent"])
    sql_where = " AND ".join(where)
    with db.get() as conn:
        total = conn.execute(f"SELECT COUNT(*) FROM items i {join} WHERE {sql_where}", params).fetchone()[0]
        rows = conn.execute(
            f"SELECT i.* {select_extra} FROM items i {join} WHERE {sql_where} ORDER BY {order} LIMIT ? OFFSET ?",
            (*params, limit, offset)).fetchall()
        items = [db.row_to_dict(r, conn) for r in rows]
    return {"total": total, "items": items}


@app.get("/api/items/{item_id}")
def get_item(item_id: str):
    with db.get() as conn:
        row = conn.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
        if not row:
            raise HTTPException(404)
        return db.row_to_dict(row, conn, full=True)


class Patch(BaseModel):
    favorite: Optional[bool] = None
    is_read: Optional[bool] = None
    archived: Optional[bool] = None
    note: Optional[str] = None
    tags: Optional[list[str]] = None


@app.patch("/api/items/{item_id}")
def patch_item(item_id: str, p: Patch):
    with db.get() as conn:
        if not conn.execute("SELECT 1 FROM items WHERE id = ?", (item_id,)).fetchone():
            raise HTTPException(404)
        fields = {k: (int(v) if isinstance(v, bool) else v)
                  for k, v in p.model_dump(exclude={"tags"}).items() if v is not None}
        if fields:
            cols = ", ".join(f"{k} = ?" for k in fields)
            conn.execute(f"UPDATE items SET {cols}, updated_at = datetime('now') WHERE id = ?", (*fields.values(), item_id))
        if p.tags is not None:
            conn.execute("DELETE FROM tags WHERE item_id = ?", (item_id,))
            for t in {t.strip().lower() for t in p.tags if t.strip()}:
                conn.execute("INSERT INTO tags (item_id, tag) VALUES (?, ?)", (item_id, t))
        db.reindex(conn, item_id)
        return db.row_to_dict(conn.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone(), conn)


@app.delete("/api/items/{item_id}")
def delete_item(item_id: str):
    with db.get() as conn:
        conn.execute("DELETE FROM items WHERE id = ?", (item_id,))
        db.reindex(conn, item_id)
    return {"ok": True}


@app.get("/api/stats")
def stats():
    with db.get() as conn:
        one = lambda sql: conn.execute(sql).fetchone()[0]
        return {
            "counts": {v: one(f"SELECT COUNT(*) FROM items i WHERE {w}") for v, w in VIEWS.items()},
            "words_unread": one("SELECT COALESCE(SUM(article_words),0) FROM items WHERE is_read = 0 AND article_status='ok'"),
            "tags": [dict(r) for r in conn.execute(
                "SELECT tag, COUNT(*) AS n FROM tags GROUP BY tag ORDER BY n DESC, tag LIMIT 60")],
            "domains": [dict(r) for r in conn.execute(
                "SELECT domain, COUNT(*) AS n FROM items WHERE domain IS NOT NULL GROUP BY domain ORDER BY n DESC LIMIT 25")],
            "authors": [dict(r) for r in conn.execute(
                """SELECT author_handle AS handle, MAX(author_name) AS name, MAX(author_avatar) AS avatar, COUNT(*) AS n
                   FROM items WHERE author_handle IS NOT NULL GROUP BY author_handle ORDER BY n DESC LIMIT 15""")],
            "sources": {s: one(f"SELECT COUNT(*) FROM items WHERE (',' || sources || ',') LIKE '%,{s},%'")
                        for s in ("like", "bookmark")},
        }


# ---------------------------------------------------------------- exportación


@app.get("/api/export.json")
def export_json():
    with db.get() as conn:
        items = [db.row_to_dict(r, conn, full=True) for r in conn.execute("SELECT * FROM items ORDER BY CAST(id AS INTEGER) DESC")]
    return items


@app.get("/api/export.md", response_class=PlainTextResponse)
def export_md(view: str = "favorites"):
    """Exporta a Markdown (útil para Obsidian/Notion)."""
    with db.get() as conn:
        rows = conn.execute(f"SELECT * FROM items i WHERE {VIEWS.get(view, VIEWS['favorites'])} ORDER BY CAST(id AS INTEGER) DESC").fetchall()
        items = [db.row_to_dict(r, conn) for r in rows]
    out = []
    for it in items:
        title = it["article_title"] or (it["tweet_text"][:80] + "…")
        out.append(f"## {title}\n")
        if it["article_url"]:
            out.append(f"- Artículo: {it['article_url']}")
        out.append(f"- Tuit: {it['tweet_url']}" + (f" (@{it['author_handle']})" if it["author_handle"] else ""))
        if it["tags"]:
            out.append("- Etiquetas: " + " ".join(f"#{t.replace(' ', '-')}" for t in it["tags"]))
        if it["note"]:
            out.append(f"\n> {it['note']}")
        out.append("")
    return "\n".join(out)


# ---------------------------------------------------------------- estáticos

app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/")
def index():
    return FileResponse(os.path.join(STATIC, "index.html"))
