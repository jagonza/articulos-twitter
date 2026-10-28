// API de Tweetshelf en Cloudflare Workers + D1.
//
// Secretos (Settings → Variables and secrets en el panel de Cloudflare):
//   APP_PASSWORD  contraseña para entrar en la web
//   API_TOKEN     token que usa el extractor de GitHub Actions
// Opcionales, para el botón «Extraer ahora»:
//   GITHUB_TOKEN  token de GitHub con permiso Actions: write sobre el repo
//   GITHUB_REPO   p. ej. "jagonza/articulos-twitter"

const SESSION_DAYS = 60;
const COOKIE = "ts_session";

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } });
const err = (status, detail) => json({ detail }, status);

// ------------------------------------------------------------------ autenticación

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function makeSession(env) {
  const exp = Date.now() + SESSION_DAYS * 864e5;
  return `${exp}.${await hmac(env.APP_PASSWORD, `session:${exp}`)}`;
}

async function isAuthed(req, env) {
  const auth = req.headers.get("Authorization") || "";
  if (env.API_TOKEN && auth.startsWith("Bearer ") && safeEqual(auth.slice(7), env.API_TOKEN)) return true;
  const m = (req.headers.get("Cookie") || "").match(new RegExp(`${COOKIE}=([\\d]+)\\.([0-9a-f]+)`));
  if (!m || Number(m[1]) < Date.now()) return false;
  return safeEqual(m[2], await hmac(env.APP_PASSWORD, `session:${m[1]}`));
}

const cookieHeader = (value, maxAge) =>
  `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

// ------------------------------------------------------------------ búsqueda

// El índice items_fts se mantiene solo mediante triggers (ver schema.sql).

function ftsQuery(q) {
  return q.split(/\s+/).map((t) => t.replace(/"/g, "")).filter(Boolean).map((t) => `"${t}"*`).join(" ");
}

const SORTS = {
  recent: "CAST(i.id AS INTEGER) DESC",
  oldest: "CAST(i.id AS INTEGER) ASC",
  longest: "COALESCE(i.article_words, 0) DESC",
  shortest: "CASE WHEN i.article_words IS NULL THEN 1 ELSE 0 END, i.article_words ASC",
  random: "RANDOM()",
  updated: "i.updated_at DESC",
};
const VIEWS = {
  all: "i.archived = 0",
  favorites: "i.favorite = 1",
  unread: "i.is_read = 0 AND i.archived = 0 AND i.article_status = 'ok'",
  articles: "i.article_status = 'ok' AND i.archived = 0",
  tweets: "i.article_status IN ('none', 'failed') AND i.archived = 0",
  notes: "i.note != ''",
  archived: "i.archived = 1",
  // Guardados o me gusta que siguen en X: ni quitados ni marcados para quitar.
  x_keep: "i.x_status IS NULL AND (instr(i.sources, 'bookmark') > 0 OR instr(i.sources, 'like') > 0)",
  x_remove: "i.x_status = 'remove'",
};
// Columnas de la lista (sin el texto completo del artículo, que pesa).
const LIST_COLS = `i.id, i.sources, i.tweet_text, i.author_handle, i.author_name, i.author_avatar, i.tweet_created, i.tweet_url,
  i.urls, i.media, i.article_url, i.article_status, i.article_title, i.article_author, i.article_site, i.article_date,
  i.article_image, i.article_excerpt, i.article_words, i.article_error, i.domain, i.favorite, i.is_read, i.archived,
  i.note, i.tags, i.updated_at, i.quoted_id, i.x_status, json_array_length(i.thread) AS thread_count`;
// Datos mínimos del tuit citado para pintarlo dentro de la tarjeta.
const QUOTED_JOIN = "LEFT JOIN items q ON q.id = i.quoted_id";
const QUOTED_COL = `CASE WHEN q.id IS NULL THEN NULL ELSE json_object('id', q.id, 'tweet_text', q.tweet_text,
  'author_handle', q.author_handle, 'author_name', q.author_name, 'author_avatar', q.author_avatar,
  'article_title', q.article_title, 'article_image', q.article_image, 'article_status', q.article_status,
  'domain', q.domain, 'media', json(q.media)) END AS quoted`;

function toItem(r) {
  return {
    ...r,
    pk: undefined,
    urls: JSON.parse(r.urls || "[]"),
    media: JSON.parse(r.media || "[]"),
    tags: JSON.parse(r.tags || "[]").sort(),
    sources: (r.sources || "").split(",").filter(Boolean),
    favorite: !!r.favorite,
    is_read: !!r.is_read,
    archived: !!r.archived,
    quoted: r.quoted ? JSON.parse(r.quoted) : null,
    thread: r.thread ? JSON.parse(r.thread) : undefined,
    thread_text: undefined,
  };
}

async function listItems(db, p) {
  const q = (p.get("q") || "").trim();
  const where = [VIEWS[p.get("view")] || VIEWS.all];
  const params = [];
  let join = "", extra = "";
  if (q) {
    join = "JOIN items_fts f ON f.rowid = i.pk";
    where.push("items_fts MATCH ?");
    params.push(ftsQuery(q));
    extra = ", snippet(items_fts, -1, char(1), char(2), '…', 24) AS snippet";
  }
  if (p.get("tag")) { where.push("EXISTS (SELECT 1 FROM json_each(i.tags) WHERE value = ?)"); params.push(p.get("tag")); }
  if (p.get("domain")) { where.push("i.domain = ?"); params.push(p.get("domain")); }
  if (p.get("source")) { where.push("(',' || i.sources || ',') LIKE ?"); params.push(`%,${p.get("source")},%`); }
  if (p.get("author")) { where.push("i.author_handle = ?"); params.push(p.get("author")); }
  const sort = p.get("sort") || "recent";
  const order = q && sort === "relevance" ? "rank" : SORTS[sort] || SORTS.recent;
  const limit = Math.min(Number(p.get("limit")) || 60, 200);
  const offset = Number(p.get("offset")) || 0;
  const w = where.join(" AND ");
  const [count, rows] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS n FROM items i ${join} WHERE ${w}`).bind(...params),
    db.prepare(`SELECT ${LIST_COLS}, ${QUOTED_COL} ${extra} FROM items i ${join} ${QUOTED_JOIN} WHERE ${w} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .bind(...params, limit, offset),
  ]);
  return { total: count.results[0].n, items: rows.results.map(toItem) };
}

// ------------------------------------------------------------------ importación

// Los «Artículos» de X vienen ya en la exportación (título, texto, portada): se guardan como artículo.
// Si ya estaba guardado de X y llega un texto más largo o con formato (antes sólo se exportaba la entradilla o
// el texto plano), se sustituye.
const MAX_TEXT = 60000; // igual que el extractor, para no acercarse a los 500 MB de D1
const XA = { article_url: "xa_url", article_title: "xa_title", article_excerpt: "xa_excerpt", article_text: "xa_text",
  article_image: "xa_image", article_words: "xa_words" };
const XA_WINS = `excluded.article_site = 'X' AND (items.article_status != 'ok'
  OR (items.article_site = 'X' AND (length(coalesce(excluded.article_text, '')) > length(coalesce(items.article_text, ''))
      OR (instr(excluded.article_text, '](') > 0 AND instr(coalesce(items.article_text, ''), '](') = 0))))`;
const xaSet = (col, from) => `${col} = CASE WHEN ${XA_WINS} THEN coalesce(${from}, items.${col}) ELSE items.${col} END`;

const UPSERT = `INSERT INTO items (id, sources, tweet_text, author_handle, author_name, author_avatar, tweet_created, tweet_url, urls, media,
    quoted_id, thread, thread_text, article_status, article_url, article_title, article_excerpt, article_text, article_image, article_words,
    article_site, domain)
  SELECT json_extract(value, '$.id'), json_extract(value, '$.source'), coalesce(json_extract(value, '$.tweet_text'), ''),
         json_extract(value, '$.author_handle'), json_extract(value, '$.author_name'), json_extract(value, '$.author_avatar'),
         json_extract(value, '$.tweet_created'), json_extract(value, '$.tweet_url'),
         coalesce(json_extract(value, '$.urls'), '[]'), coalesce(json_extract(value, '$.media'), '[]'),
         json_extract(value, '$.quoted_id'), json_extract(value, '$.thread'), json_extract(value, '$.thread_text'),
         CASE WHEN json_extract(value, '$.xa_url') IS NOT NULL THEN 'ok'
              WHEN json_array_length(coalesce(json_extract(value, '$.urls'), '[]')) > 0 THEN 'pending' ELSE 'none' END,
         ${Object.values(XA).map((k) => `json_extract(value, '$.${k}')`).join(", ")},
         CASE WHEN json_extract(value, '$.xa_url') IS NOT NULL THEN 'X' END,
         CASE WHEN json_extract(value, '$.xa_url') IS NOT NULL THEN 'x.com' END
  FROM json_each(?1) WHERE true
  ON CONFLICT(id) DO UPDATE SET
    sources = CASE WHEN instr(',' || items.sources || ',', ',' || excluded.sources || ',') > 0 THEN items.sources
                   ELSE items.sources || ',' || excluded.sources END,
    -- el texto más largo gana: así una reimportación arregla los tuits largos que llegaron recortados
    -- (y el de los Artículos de X, que antes se guardaba como el enlace al artículo)
    tweet_text = CASE WHEN length(excluded.tweet_text) > length(items.tweet_text)
                        OR (excluded.article_site = 'X' AND items.tweet_text LIKE '%x.com/i/article/%') THEN excluded.tweet_text
                      ELSE items.tweet_text END,
    author_handle = coalesce(items.author_handle, excluded.author_handle),
    author_name = coalesce(items.author_name, excluded.author_name),
    author_avatar = coalesce(items.author_avatar, excluded.author_avatar),
    tweet_created = coalesce(items.tweet_created, excluded.tweet_created),
    tweet_url = CASE WHEN items.author_handle IS NULL THEN excluded.tweet_url ELSE items.tweet_url END,
    media = CASE WHEN items.media = '[]' THEN excluded.media ELSE items.media END,
    quoted_id = coalesce(items.quoted_id, excluded.quoted_id),
    thread = CASE WHEN length(coalesce(excluded.thread, '')) > length(coalesce(items.thread, '')) THEN excluded.thread ELSE items.thread END,
    thread_text = CASE WHEN length(coalesce(excluded.thread, '')) > length(coalesce(items.thread, '')) THEN excluded.thread_text ELSE items.thread_text END,
    ${Object.keys(XA).map((c) => xaSet(c, `excluded.${c}`)).join(",\n    ")},
    domain = CASE WHEN ${XA_WINS} THEN 'x.com' ELSE items.domain END,
    article_site = CASE WHEN ${XA_WINS} THEN 'X' ELSE items.article_site END,
    article_status = CASE WHEN excluded.article_site = 'X' THEN 'ok'
                          WHEN items.urls = '[]' AND excluded.urls != '[]' THEN 'pending' ELSE items.article_status END,
    urls = CASE WHEN items.urls = '[]' THEN excluded.urls ELSE items.urls END`;

const SOURCES = new Set(["like", "bookmark", "quoted"]);

function cleanThread(thread) {
  if (!Array.isArray(thread) || thread.length < 2) return { thread: null, thread_text: null };
  const list = thread.slice(0, 100).filter((t) => t && /^\d+$/.test(String(t.id))).map((t) => ({
    id: String(t.id), text: String(t.text || "").slice(0, 25000),
    media: (Array.isArray(t.media) ? t.media : []).filter((m) => typeof m === "string").slice(0, 8),
    links: (Array.isArray(t.links) ? t.links : []).filter((l) => typeof l === "string").slice(0, 10),
  }));
  return { thread: JSON.stringify(list), thread_text: list.map((t) => t.text).join("\n\n") };
}

// D1 admite parámetros de hasta 2 MB: con artículos y hilos largos, el lote se parte en trozos.
function bySize(rows, max = 900_000) {
  const groups = [];
  let cur = [], size = 0;
  for (const r of rows) {
    const n = JSON.stringify(r).length;
    if (cur.length && size + n > max) { groups.push(cur); cur = []; size = 0; }
    cur.push(r);
    size += n;
  }
  if (cur.length) groups.push(cur);
  return groups.map((g) => JSON.stringify(g));
}

async function importItems(db, items) {
  const clean = items
    .filter((it) => it && /^\d+$/.test(String(it.id)))
    .map((it) => {
      const xa = it.x_article && typeof it.x_article === "object" ? it.x_article : {};
      const xaText = String(xa.text || xa.excerpt || "").slice(0, MAX_TEXT) || null;
      return {
        ...it, id: String(it.id), source: SOURCES.has(it.source) ? it.source : "bookmark",
        quoted_id: /^\d+$/.test(String(it.quoted_id || "")) ? String(it.quoted_id) : null,
        // el enlace al propio Artículo de X no aporta nada como texto del tuit (exportaciones antiguas lo traían)
        tweet_text: xa.url ? String(it.tweet_text || "").replace(/\s*(https?:\/\/)?(x|twitter)\.com\/i\/article\/\d+\S*/g, "").trim() : it.tweet_text,
        urls: JSON.stringify(it.urls || []), media: JSON.stringify(it.media || []),
        ...cleanThread(it.thread),
        xa_url: xa.url || null, xa_title: xa.title || null, xa_excerpt: xa.excerpt || null, xa_image: xa.image || null,
        xa_text: xaText, xa_words: xaText ? xaText.split(/\s+/).filter(Boolean).length : null,
      };
    });
  if (!clean.length) return { found: items.length, added: 0, updated: 0 };
  const ids = JSON.stringify(clean.map((it) => it.id));
  const [existing] = await db.batch([
    db.prepare("SELECT COUNT(*) AS n FROM items WHERE id IN (SELECT value FROM json_each(?1))").bind(ids),
    ...bySize(clean).map((group) => db.prepare(UPSERT).bind(group)),
  ]);
  const updated = existing.results[0].n;
  return { found: items.length, added: clean.length - updated, updated };
}

// ------------------------------------------------------------------ extracción (la hace GitHub Actions)

const ARTICLE_FIELDS = ["article_url", "article_status", "article_title", "article_author", "article_site", "article_date",
  "article_image", "article_excerpt", "article_text", "article_words", "article_error", "domain"];

async function saveArticles(db, results) {
  const rows = results.filter((r) => r && r.id).map((r) => ({ ...r, id: String(r.id), tags: JSON.stringify(r.tags || []) }));
  if (!rows.length) return { saved: 0 };
  // Si al volver a extraer la web falla, se conserva el artículo que ya teníamos.
  const keep = `json_extract(j.value, '$.article_status') = 'failed' AND items.article_text IS NOT NULL AND items.article_text != ''`;
  const kept = { article_status: "'ok'" };
  const sets = ARTICLE_FIELDS.map((f) => `${f} = CASE WHEN ${keep} THEN ${kept[f] || `items.${f}`} ELSE json_extract(j.value, '$.${f}') END`).join(", ");
  const update = `UPDATE items SET ${sets},
        tags = (SELECT json_group_array(value) FROM (SELECT value FROM json_each(items.tags) UNION SELECT value FROM json_each(json_extract(j.value, '$.tags')))),
        updated_at = datetime('now')
      FROM json_each(?1) AS j WHERE items.id = json_extract(j.value, '$.id')`;
  await db.batch(bySize(rows).map((group) => db.prepare(update).bind(group)));
  return { saved: rows.length };
}

const GH_ERRORS = {
  401: "GitHub no acepta el token GITHUB_TOKEN (¿caducado o mal copiado?)",
  403: "El token GITHUB_TOKEN no tiene permiso «Actions: Read and write» sobre el repo",
  404: "GitHub no encuentra el repo o el workflow: revisa GITHUB_REPO y que el token tenga acceso al repo",
  422: "GitHub no encuentra la rama a ejecutar (GITHUB_REF)",
};

const github = (env, path, opts = {}) => fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/extract.yml${path}`, {
  ...opts,
  headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "tweetshelf" },
});

async function triggerExtraction(env) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) return { triggered: false, reason: "not_configured" };
  const r = await github(env, "/dispatches", { method: "POST", body: JSON.stringify({ ref: env.GITHUB_REF || "main" }) });
  if (r.ok) return { triggered: true };
  return { triggered: false, reason: "github_error", status: r.status, message: GH_ERRORS[r.status] || `GitHub respondió ${r.status}` };
}

// Última ejecución del extractor en GitHub Actions, para enseñar en qué va.
async function extractionStatus(env) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) return { configured: false };
  const r = await github(env, "/runs?per_page=1");
  if (!r.ok) return { configured: true, error: GH_ERRORS[r.status] || `GitHub respondió ${r.status}` };
  const run = (await r.json()).workflow_runs?.[0];
  return { configured: true, run: run && {
    status: run.status, conclusion: run.conclusion, event: run.event,
    created_at: run.created_at, updated_at: run.updated_at, url: run.html_url,
  } };
}

// ------------------------------------------------------------------ resto de la API

async function stats(db) {
  const [counts, tags, domains, authors] = await db.batch([
    db.prepare(`SELECT
        SUM(archived = 0) AS "all", SUM(favorite = 1) AS favorites,
        SUM(is_read = 0 AND archived = 0 AND article_status = 'ok') AS unread,
        SUM(article_status = 'ok' AND archived = 0) AS articles,
        SUM(article_status IN ('none', 'failed') AND archived = 0) AS tweets,
        SUM(note != '') AS notes, SUM(archived = 1) AS archived, SUM(x_status = 'remove') AS x_remove,
        SUM(x_status IS NULL AND (instr(sources, 'bookmark') > 0 OR instr(sources, 'like') > 0)) AS x_keep,
        SUM(instr(sources, 'bookmark') > 0 AND x_status IS NOT 'removed') AS x_bookmarks,
        SUM(instr(sources, 'like') > 0 AND x_status IS NOT 'removed') AS x_likes,
        SUM(CASE WHEN is_read = 0 AND article_status = 'ok' THEN coalesce(article_words, 0) ELSE 0 END) AS words_unread,
        SUM(article_status = 'pending') AS pending, SUM(article_status = 'failed') AS failed
      FROM items`),
    db.prepare("SELECT j.value AS tag, COUNT(*) AS n FROM items, json_each(items.tags) j GROUP BY j.value ORDER BY n DESC, tag LIMIT 60"),
    db.prepare("SELECT domain, COUNT(*) AS n FROM items WHERE domain IS NOT NULL GROUP BY domain ORDER BY n DESC LIMIT 25"),
    db.prepare(`SELECT author_handle AS handle, MAX(author_name) AS name, MAX(author_avatar) AS avatar, COUNT(*) AS n
      FROM items WHERE author_handle IS NOT NULL GROUP BY author_handle ORDER BY n DESC LIMIT 15`),
  ]);
  const c = counts.results[0];
  const { words_unread, pending, failed, x_bookmarks, x_likes, ...views } = c;
  for (const k in views) views[k] = views[k] || 0;
  return { counts: views, words_unread: words_unread || 0, pending: pending || 0, failed: failed || 0,
    x: { bookmarks: x_bookmarks || 0, likes: x_likes || 0, marked: views.x_remove },
    tags: tags.results, domains: domains.results, authors: authors.results };
}

async function patchItem(db, id, body) {
  const fields = {};
  for (const k of ["favorite", "is_read", "archived"]) if (typeof body[k] === "boolean") fields[k] = body[k] ? 1 : 0;
  if (typeof body.note === "string") fields.note = body.note.slice(0, 20000);
  if ("x_status" in body && [null, "remove", "removed"].includes(body.x_status)) fields.x_status = body.x_status;
  if (Array.isArray(body.tags)) {
    fields.tags = JSON.stringify([...new Set(body.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 30));
  }
  const stmts = [];
  if (Object.keys(fields).length) {
    stmts.push(db.prepare(`UPDATE items SET ${Object.keys(fields).map((k) => `${k} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`)
      .bind(...Object.values(fields), id));
  }
  stmts.push(db.prepare(`SELECT ${LIST_COLS}, ${QUOTED_COL} FROM items i ${QUOTED_JOIN} WHERE i.id = ?`).bind(id));
  const res = await db.batch(stmts);
  const row = res[res.length - 1].results[0];
  return row ? json(toItem(row)) : err(404, "No existe");
}

// «Quedarme sólo con el citado»: pasa favorito, notas y etiquetas al tuit citado y archiva el que cita
// (marcándolo para quitar de X si sigue allí), así deja de aparecer en la biblioteca.
async function keepQuoted(db, id) {
  const parent = await db.prepare("SELECT quoted_id, favorite, note, tags, tweet_url FROM items WHERE id = ?").bind(id).first();
  if (!parent?.quoted_id) return err(400, "Este tuit no cita a ningún otro guardado");
  const note = parent.note ? `${parent.note}\n\n(del tuit que lo citaba: ${parent.tweet_url})` : "";
  await db.batch([
    db.prepare(`UPDATE items SET favorite = max(favorite, ?1),
        note = CASE WHEN ?2 = '' THEN note WHEN note = '' THEN ?2 ELSE note || char(10) || char(10) || ?2 END,
        tags = (SELECT json_group_array(value) FROM (SELECT value FROM json_each(items.tags) UNION SELECT value FROM json_each(?3))),
        archived = 0, updated_at = datetime('now')
      WHERE id = ?4`).bind(parent.favorite, note, parent.tags, parent.quoted_id),
    db.prepare(`UPDATE items SET archived = 1,
        x_status = CASE WHEN x_status IS NULL AND (instr(sources, 'bookmark') > 0 OR instr(sources, 'like') > 0) THEN 'remove' ELSE x_status END,
        updated_at = datetime('now') WHERE id = ?`).bind(id),
  ]);
  return json({ ok: true, kept: parent.quoted_id });
}

// Qué quitar de X: lo marcado a mano, o todos los guardados / me gusta que ya están aquí.
async function xCleanup(db, scope) {
  const where = {
    marked: "x_status = 'remove'",
    bookmarks: "instr(sources, 'bookmark') > 0 AND x_status IS NOT 'removed'",
    likes: "instr(sources, 'like') > 0 AND x_status IS NOT 'removed'",
  }[scope] || "x_status = 'remove'";
  const { results } = await db.prepare(`SELECT id, sources FROM items WHERE ${where}`).all();
  const has = (r, s) => r.sources.split(",").includes(s);
  return {
    bookmarks: scope === "likes" ? [] : results.filter((r) => has(r, "bookmark")).map((r) => r.id),
    likes: scope === "bookmarks" ? [] : results.filter((r) => has(r, "like")).map((r) => r.id),
  };
}

function exportMarkdown(items) {
  return items.map((it) => {
    const lines = [`## ${it.article_title || it.tweet_text.slice(0, 80) + "…"}`, ""];
    if (it.article_url) lines.push(`- Artículo: ${it.article_url}`);
    lines.push(`- Tuit: ${it.tweet_url}${it.author_handle ? ` (@${it.author_handle})` : ""}`);
    if (it.tags.length) lines.push(`- Etiquetas: ${it.tags.map((t) => "#" + t.replace(/ /g, "-")).join(" ")}`);
    if (it.note) lines.push("", `> ${it.note}`);
    return lines.join("\n") + "\n";
  }).join("\n");
}

async function api(req, env, url) {
  const db = env.DB;
  const path = url.pathname;
  const method = req.method;
  const body = method === "POST" || method === "PATCH" ? await req.json().catch(() => ({})) : null;

  if (path === "/api/items" && method === "GET") return json(await listItems(db, url.searchParams));
  if (path === "/api/stats") return json(await stats(db));
  if (path === "/api/import" && method === "POST") {
    if (!Array.isArray(body.items) || body.items.length > 1000) return err(400, "Envía hasta 1000 elementos por petición");
    return json(await importItems(db, body.items));
  }
  if (path === "/api/progress") {
    const r = await db.prepare("SELECT SUM(article_status = 'pending') AS pending, SUM(article_status = 'failed') AS failed FROM items").first();
    return json({ pending: r.pending || 0, failed: r.failed || 0 });
  }
  if (path === "/api/extract-now" && method === "POST") return json(await triggerExtraction(env));
  if (path === "/api/extract-status") return json(await extractionStatus(env));
  if (path === "/api/retry-failed" && method === "POST") {
    const r = await db.prepare("UPDATE items SET article_status = 'pending' WHERE article_status = 'failed'").run();
    return json({ queued: r.meta.changes, ...(await triggerExtraction(env)) });
  }
  if (path === "/api/pending" && method === "GET") {
    const limit = Math.min(Number(url.searchParams.get("limit")) || 30, 100);
    const { results } = await db.prepare("SELECT id, urls FROM items WHERE article_status = 'pending' LIMIT ?").bind(limit).all();
    return json(results.map((r) => ({ id: r.id, urls: JSON.parse(r.urls) })));
  }
  if (path === "/api/x-cleanup" && method === "GET") return json(await xCleanup(db, url.searchParams.get("scope")));
  if (path === "/api/x-cleanup/done" && method === "POST") {
    const ids = (body.ids || []).filter((i) => /^\d+$/.test(String(i))).map(String);
    const r = await db.prepare("UPDATE items SET x_status = 'removed' WHERE id IN (SELECT value FROM json_each(?1))").bind(JSON.stringify(ids)).run();
    return json({ updated: r.meta.changes });
  }
  if (path === "/api/articles" && method === "POST") return json(await saveArticles(db, body.results || []));
  if (path === "/api/export.json") {
    const { results } = await db.prepare("SELECT * FROM items ORDER BY CAST(id AS INTEGER) DESC").all();
    return json(results.map(toItem), 200, { "Content-Disposition": 'attachment; filename="tweetshelf.json"' });
  }
  if (path === "/api/export.md") {
    const view = VIEWS[url.searchParams.get("view")] || VIEWS.favorites;
    const { results } = await db.prepare(`SELECT ${LIST_COLS} FROM items i WHERE ${view} ORDER BY CAST(id AS INTEGER) DESC`).all();
    return new Response(exportMarkdown(results.map(toItem)), { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
  }

  const m = path.match(/^\/api\/items\/(\d+)(\/refetch|\/keep-quoted)?$/);
  if (m) {
    const id = m[1];
    if (m[2] === "/keep-quoted" && method === "POST") return keepQuoted(db, id);
    if (m[2] && method === "POST") {
      await db.prepare("UPDATE items SET article_status = 'pending' WHERE id = ? AND urls != '[]'").bind(id).run();
      return json({ ok: true, ...(await triggerExtraction(env)) });
    }
    if (method === "GET") {
      const [row, by] = await db.batch([
        db.prepare(`SELECT i.*, ${QUOTED_COL} FROM items i ${QUOTED_JOIN} WHERE i.id = ?`).bind(id),
        db.prepare("SELECT id, tweet_text, author_handle, author_name, author_avatar FROM items WHERE quoted_id = ? LIMIT 20").bind(id),
      ]);
      if (!row.results[0]) return err(404, "No existe");
      return json({ ...toItem(row.results[0]), quoted_by: by.results });
    }
    if (method === "PATCH") return patchItem(db, id, body);
    if (method === "DELETE") {
      await db.prepare("DELETE FROM items WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }
  }
  return err(404, "Ruta desconocida");
}

// ------------------------------------------------------------------ entrada

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!env.APP_PASSWORD) {
      return new Response("Falta configurar el secreto APP_PASSWORD en Cloudflare (Settings → Variables and secrets).", { status: 503 });
    }

    if (url.pathname === "/api/login" && req.method === "POST") {
      const { password } = await req.json().catch(() => ({}));
      if (typeof password !== "string" || !safeEqual(password, env.APP_PASSWORD)) {
        await new Promise((r) => setTimeout(r, 800)); // frena los intentos a ciegas
        return err(401, "Contraseña incorrecta");
      }
      return json({ ok: true }, 200, { "Set-Cookie": cookieHeader(await makeSession(env), SESSION_DAYS * 86400) });
    }
    if (url.pathname === "/logout") {
      return new Response(null, { status: 302, headers: { Location: "/login", "Set-Cookie": cookieHeader("", 0) } });
    }
    // Los assets sirven login.html como /login.
    if (url.pathname === "/login" || url.pathname === "/login.html") return env.ASSETS.fetch(req);

    if (!(await isAuthed(req, env))) {
      if (url.pathname.startsWith("/api/")) return err(401, "Inicia sesión");
      return Response.redirect(`${url.origin}/login`, 302);
    }
    if (url.pathname.startsWith("/api/")) {
      try {
        return await api(req, env, url);
      } catch (e) {
        return err(500, String(e.message || e));
      }
    }
    return env.ASSETS.fetch(req);
  },
};
