// Tweetshelf: interfaz en JS sin dependencias.
import { parseFile } from "./importers.js";

const $ = (s, el = document) => el.querySelector(s);
const api = async (path, opts = {}) => {
  const r = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts });
  if (r.status === 401) { location.href = "/login"; throw new Error("Sesión caducada"); }
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText);
  return r.json();
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const marked = (s) => esc(s).replace(/\u0001/g, "<mark>").replace(/\u0002/g, "</mark>");
const favicon = (d) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=64`;
const readMins = (w) => (w ? Math.max(1, Math.round(w / 230)) : null);
const hue = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
// Los ids de X llevan la fecha dentro (snowflake).
const tweetDate = (id) => {
  try { return new Date(Number((BigInt(id) >> 22n) + 1288834974657n)); } catch { return null; }
};
const fmtDate = (d) => d && !isNaN(d) ? d.toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" }) : "";

const VIEWS = [
  ["all", "📥", "Todo"], ["unread", "📖", "Por leer"], ["favorites", "⭐", "Favoritos"],
  ["articles", "📰", "Artículos"], ["tweets", "💬", "Sólo tuits"], ["notes", "📝", "Con notas"], ["archived", "🗄️", "Archivados"],
  ["x_remove", "🧹", "Para quitar de X"],
];
const SOURCE_LABEL = { like: "me gusta", bookmark: "guardado", quoted: "citado" };
// Se puede quitar de X lo que llegó como guardado o me gusta y no se ha quitado ya.
const inX = (it) => it.x_status !== "removed" && it.sources.some((s) => s === "like" || s === "bookmark");

const state = { view: "all", q: "", tag: "", domain: "", author: "", sort: "recent", items: [], total: 0, focus: -1, open: null };

// ------------------------------------------------------------------ carga

async function load(append = false) {
  const p = new URLSearchParams({ view: state.view, q: state.q, tag: state.tag, domain: state.domain,
    author: state.author, sort: state.sort, offset: append ? state.items.length : 0, limit: 60 });
  const data = await api(`/api/items?${p}`);
  state.items = append ? state.items.concat(data.items) : data.items;
  state.total = data.total;
  if (!append) state.focus = -1;
  renderGrid();
}

async function loadStats() {
  const s = await api("/api/stats");
  $("#views").innerHTML = VIEWS.map(([k, icon, label]) =>
    `<button data-view="${k}" class="${state.view === k ? "active" : ""}"><span>${icon}&nbsp; ${label}</span><span class="count">${s.counts[k]}</span></button>`).join("");
  $("#tagList").innerHTML = s.tags.length ? s.tags.map((t) =>
    `<button class="chip ${state.tag === t.tag ? "active" : ""}" data-tag="${esc(t.tag)}">#${esc(t.tag)} <span class="muted">${t.n}</span></button>`).join("")
    : `<span class="muted small">Añade etiquetas desde el lector</span>`;
  $("#domainList").innerHTML = s.domains.map((d) =>
    `<li data-domain="${esc(d.domain)}" class="${state.domain === d.domain ? "active" : ""}"><img src="${favicon(d.domain)}" alt=""><span class="label">${esc(d.domain)}</span><span class="n">${d.n}</span></li>`).join("");
  $("#authorList").innerHTML = s.authors.map((a) =>
    `<li data-author="${esc(a.handle)}" class="${state.author === a.handle ? "active" : ""}">${a.avatar ? `<img src="${esc(a.avatar)}" alt="" style="border-radius:50%">` : ""}<span class="label">${esc(a.name || "@" + a.handle)}</span><span class="n">${a.n}</span></li>`).join("");
  $("#empty").classList.toggle("hidden", s.counts.all + s.counts.archived > 0);
  $("#retryBtn").classList.toggle("hidden", !s.failed);
  $("#retryBtn").textContent = `↻ Reintentar ${s.failed} fallido${s.failed === 1 ? "" : "s"} · `;
  state.stats = s;
}

const refresh = () => Promise.all([load(), loadStats()]);

// ------------------------------------------------------------------ tarjetas

function avatar(it) {
  return it.author_avatar
    ? `<img class="avatar" src="${esc(it.author_avatar)}" alt="">`
    : `<div class="avatar">${esc((it.author_name || it.author_handle || "?")[0].toUpperCase())}</div>`;
}

function tweetBlock(it, small = true) {
  const who = it.author_handle
    ? `${esc(it.author_name || "")} <span>@${esc(it.author_handle)}</span>`
    : `<span>Tuit · ${fmtDate(tweetDate(it.id))}</span>`;
  return `<div class="tweet ${small ? "small" : ""}">${avatar(it)}<div><div class="who">${who}</div><div class="text">${linkify(it.tweet_text)}</div></div></div>`;
}

// Tuit citado, en pequeño; al pulsarlo se abre como elemento propio.
function quoteBlock(q) {
  if (!q) return "";
  const who = q.author_handle ? `${esc(q.author_name || "")} <span>@${esc(q.author_handle)}</span>` : "<span>Tuit citado</span>";
  const title = q.article_status === "ok" && q.article_title ? `<div class="q-title">📰 ${esc(q.article_title)}</div>` : "";
  return `<div class="quote" data-open="${esc(q.id)}" title="Abrir el tuit citado">
    <div class="who">↪ ${who}</div>${title}<div class="text">${esc(q.tweet_text)}</div></div>`;
}

function linkify(text) {
  return esc(text).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${u.replace(/^https?:\/\//, "").slice(0, 40)}${u.length > 48 ? "…" : ""}</a>`);
}

function card(it, i) {
  const hasArticle = it.article_status === "ok";
  const img = it.article_image || it.media[0];
  const cover = hasArticle || img
    ? img && !hasArticle ? `<img class="cover" loading="lazy" src="${esc(img)}" alt="" onerror="this.remove()">`
    : img ? `<img class="cover" loading="lazy" src="${esc(img)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'cover fallback',style:'background:hsl(${hue(it.domain || it.id)} 45% 55%)',textContent:'${esc((it.domain || "?")[0].toUpperCase())}'}))">`
      : `<div class="cover fallback" style="background:linear-gradient(135deg,hsl(${hue(it.domain || it.id)} 50% 55%),hsl(${(hue(it.domain || it.id) + 40) % 360} 55% 45%))">${esc((it.article_site || it.domain || "?")[0].toUpperCase())}</div>`
    : "";
  const mins = readMins(it.article_words);
  const status = it.article_status === "pending" ? "⏳ extrayendo…" : it.article_status === "failed" ? `<span class="status-fail" title="${esc(it.article_error)}">⚠︎ no se pudo leer</span>` : "";
  return `<article class="card ${it.is_read ? "read" : ""} ${i === state.focus ? "focused" : ""}" data-i="${i}">
    ${it.note ? `<span class="badge-note" title="${esc(it.note)}">📝</span>` : ""}
    ${cover}
    <div class="body">
      ${hasArticle ? `<div class="site"><img src="${favicon(it.domain)}" alt="">${esc(it.article_site || it.domain)}${mins ? ` · ${mins} min` : ""}</div>
        <h2>${esc(it.article_title)}</h2>
        ${it.snippet ? `<p class="snippet">${marked(it.snippet)}</p>` : it.article_excerpt ? `<p class="excerpt">${esc(it.article_excerpt)}</p>` : ""}`
        : `${it.article_url ? `<div class="site"><img src="${favicon(it.domain)}" alt=""><a href="${esc(it.article_url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${esc(it.domain)} ↗</a></div>` : ""}${it.snippet ? `<p class="snippet">${marked(it.snippet)}</p>` : ""}`}
      ${tweetBlock(it, true)}
      ${quoteBlock(it.quoted)}
      <div class="meta">
        ${status}
        ${it.tags.slice(0, 4).map((t) => `<span class="chip" data-tag="${esc(t)}">#${esc(t)}</span>`).join("")}
        <span class="actions">
          <button class="act ${it.favorite ? "on" : ""}" data-act="favorite" title="Favorito (f)">⭐</button>
          <button class="act ${it.is_read ? "on" : ""}" data-act="is_read" title="Leído (r)">✅</button>
          ${inX(it) ? `<button class="act ${it.x_status === "remove" ? "on" : ""}" data-act="x_status" title="Quitar de X (x)">🧹</button>` : ""}
          <button class="act" data-act="tweet" title="Abrir en X">𝕏</button>
        </span>
      </div>
    </div></article>`;
}

function renderGrid() {
  $("#grid").innerHTML = state.items.map(card).join("");
  const filters = [
    state.q && ["q", `🔎 “${state.q}”`], state.tag && ["tag", `#${state.tag}`],
    state.domain && ["domain", state.domain], state.author && ["author", `@${state.author}`],
  ].filter(Boolean);
  $("#activeFilters").innerHTML = filters.map(([k, l]) => `<button class="chip active" data-clear="${k}">${esc(l)}<span class="x">✕</span></button>`).join("");
  const words = state.stats?.words_unread;
  $("#summary").textContent = `${state.total} elemento${state.total === 1 ? "" : "s"}` +
    (state.view === "unread" && words ? ` · unas ${Math.round(words / 230 / 60)} h de lectura pendiente` : "");
  $("#moreBtn").classList.toggle("hidden", state.items.length >= state.total);
}

async function patch(it, data) {
  const updated = await api(`/api/items/${it.id}`, { method: "PATCH", body: JSON.stringify(data) });
  Object.assign(it, updated);
  return updated;
}

// ------------------------------------------------------------------ lector

async function openItem(it) {
  const full = await api(`/api/items/${it.id}`);
  state.open = full;
  const d = $("#drawer");
  const mins = readMins(full.article_words);
  const paras = (full.article_text || "").split(/\n+/).filter((p, i) => p.trim() && !(i === 0 && p.trim() === (full.article_title || "").trim())).map((p) => `<p>${esc(p)}</p>`).join("");
  d.innerHTML = `
    <div class="head">
      <button class="icon-btn" data-d="close" title="Cerrar (Esc)">✕</button>
      <button class="btn ghost" data-d="favorite">${full.favorite ? "⭐ Favorito" : "☆ Favorito"}</button>
      <button class="btn ghost" data-d="is_read">${full.is_read ? "✅ Leído" : "○ Marcar leído"}</button>
      <button class="btn ghost" data-d="archived">${full.archived ? "📤 Desarchivar" : "🗄️ Archivar"}</button>
      ${inX(full) ? `<button class="btn ghost" data-d="x_status" title="Lo quitará el script de limpieza (x)">${full.x_status === "remove" ? "🧹 Se quitará de X" : "🧹 Quitar de X"}</button>`
        : full.x_status === "removed" ? `<span class="muted small">✓ Quitado de X</span>` : ""}
      <span class="spacer"></span>
      ${full.article_url ? `<a class="btn ghost" href="${esc(full.article_url)}" target="_blank" rel="noopener">Original ↗</a>` : ""}
      <a class="btn ghost" href="${esc(full.tweet_url)}" target="_blank" rel="noopener">𝕏 ↗</a>
    </div>
    <div class="content">
      ${full.article_image ? `<img class="hero" src="${esc(full.article_image)}" alt="" onerror="this.remove()">` : ""}
      ${full.article_status === "ok" ? `
        <div class="site muted small"><img src="${favicon(full.domain)}" width="14" alt=""> ${esc(full.article_site || full.domain)}</div>
        <h1>${esc(full.article_title)}</h1>
        <div class="byline">${[full.article_author, full.article_date && fmtDate(new Date(full.article_date)), mins && `${mins} min de lectura`].filter(Boolean).map(esc).join(" · ")}</div>` : `<h1>Tuit</h1>`}

      <div class="side-box"><h4>El tuit · ${fmtDate(tweetDate(full.id))} · ${full.sources.map((s) => SOURCE_LABEL[s] || s).join(" + ")}</h4>
        ${tweetBlock(full, false)}
        ${full.media.length ? `<div class="media-row">${full.media.map((m) => `<img src="${esc(m)}" alt="">`).join("")}</div>` : ""}
        ${quoteBlock(full.quoted)}
      </div>
      ${full.quoted_by?.length ? `<div class="side-box"><h4>Citado por</h4>${full.quoted_by.map((q) => quoteBlock(q)).join("")}</div>` : ""}

      <div class="side-box"><h4>Mis notas <span class="save-state" id="saveState"></span></h4>
        <textarea id="note" placeholder="¿Por qué lo guardaste? ¿Qué te llevas?">${esc(full.note)}</textarea>
      </div>

      <div class="side-box"><h4>Etiquetas</h4>
        <div class="tag-editor" id="tagEditor">${full.tags.map((t) => `<span class="chip">#${esc(t)}<span class="x" data-rm="${esc(t)}">✕</span></span>`).join("")}
          <input id="tagInput" placeholder="añadir etiqueta y Enter" list="tagSuggest"></div>
        <datalist id="tagSuggest">${(state.stats?.tags || []).map((t) => `<option value="${esc(t.tag)}">`).join("")}</datalist>
      </div>

      ${full.article_status === "failed" ? `<p class="status-fail small">No pude extraer el artículo: ${esc(full.article_error)}</p>` : ""}
      ${full.article_status === "pending" ? `<p class="muted">⏳ Extrayendo el artículo…</p>` : ""}
      ${paras ? `<div class="article">${paras}</div>` : ""}

      <p class="small" style="margin-top:30px">
        ${full.urls.length ? `<button class="btn ghost" data-d="refetch">↻ Volver a extraer</button>` : ""}
        <button class="btn ghost danger" data-d="delete">Eliminar</button>
      </p>
    </div>`;
  d.classList.add("open");
  d.scrollTop = 0;
  $("#scrim").classList.remove("hidden");

  let t;
  $("#note").addEventListener("input", (e) => {
    $("#saveState").textContent = "guardando…";
    clearTimeout(t);
    t = setTimeout(async () => { await patch(full, { note: e.target.value }); syncItem(full); $("#saveState").textContent = "guardado ✓"; }, 600);
  });
  $("#tagInput").addEventListener("keydown", async (e) => {
    if (e.key === "Enter" && e.target.value.trim()) {
      await patch(full, { tags: [...full.tags, e.target.value.trim()] });
      syncItem(full); openItem(full); loadStats();
    }
  });
}

function closeDrawer() {
  $("#drawer").classList.remove("open");
  $("#scrim").classList.add("hidden");
  state.open = null;
}

function syncItem(full) {
  const i = state.items.findIndex((x) => x.id === full.id);
  if (i < 0) return;
  state.items[i] = { ...state.items[i], ...full, article_text: undefined };
  const el = $(`.card[data-i="${i}"]`);
  if (el) el.outerHTML = card(state.items[i], i);
}

// ------------------------------------------------------------------ importación

function openImport() { $("#importResult").textContent = ""; $("#importDlg").showModal(); }
window.openImport = openImport;

const CHUNK = 500;

async function uploadFiles(files) {
  const out = [];
  const show = (extra = "") => { $("#importResult").innerHTML = out.join("<br>") + (extra ? `<br>${extra}` : ""); };
  for (const f of files) {
    try {
      show(`⏳ Leyendo <b>${esc(f.name)}</b>…`);
      const items = await parseFile(f, (msg) => show(`⏳ ${esc(msg)}`));
      const total = { found: items.length, added: 0, updated: 0 };
      for (let i = 0; i < items.length; i += CHUNK) {
        show(`⏳ Subiendo <b>${esc(f.name)}</b>: ${Math.min(i + CHUNK, items.length)}/${items.length}`);
        const r = await api("/api/import", { method: "POST", body: JSON.stringify({ items: items.slice(i, i + CHUNK) }) });
        total.added += r.added; total.updated += r.updated;
      }
      out.push(`✅ <b>${esc(f.name)}</b>: ${total.found} encontrados, ${total.added} nuevos, ${total.updated} actualizados`);
    } catch (e) {
      out.push(`❌ <b>${esc(f.name)}</b>: ${esc(e.message)}`);
    }
    show();
  }
  await refresh();
  extractNow(true);
}

// La extracción de artículos la hace GitHub Actions cada pocas horas; aquí sólo mostramos lo pendiente.
async function extractNow(quiet = false) {
  const r = await api("/api/extract-now", { method: "POST" }).catch(() => ({}));
  if (!quiet) toast(r.triggered ? "Extracción lanzada, tardará unos minutos" : "Se extraerán en la próxima pasada automática");
  pollProgress();
}
window.extractNow = extractNow;

let pollTimer;
async function pollProgress() {
  clearTimeout(pollTimer);
  const p = await api("/api/progress");
  $("#progress").classList.toggle("hidden", !p.pending);
  if (!p.pending) return;
  $("#progressText").innerHTML = `⏳ ${p.pending} artículo${p.pending === 1 ? "" : "s"} pendiente${p.pending === 1 ? "" : "s"} de extraer
    · <a href="#" onclick="extractNow(); return false">extraer ahora</a>`;
  const before = state.stats?.pending;
  if (before !== undefined && before !== p.pending) refresh();
  if (state.stats) state.stats.pending = p.pending;
  pollTimer = setTimeout(pollProgress, 30000);
}

// ------------------------------------------------------------------ eventos

document.addEventListener("click", async (e) => {
  const t = e.target;
  const v = t.closest("[data-view]");
  if (v) { state.view = v.dataset.view; $("#sidebar").classList.remove("open"); return refresh(); }
  const clear = t.closest("[data-clear]");
  if (clear) { state[clear.dataset.clear] = ""; if (clear.dataset.clear === "q") $("#q").value = ""; return refresh(); }
  const tag = t.closest("[data-tag]");
  if (tag) { e.stopPropagation(); state.tag = state.tag === tag.dataset.tag ? "" : tag.dataset.tag; return refresh(); }
  const dom = t.closest("[data-domain]");
  if (dom) { state.domain = state.domain === dom.dataset.domain ? "" : dom.dataset.domain; return refresh(); }
  const au = t.closest("[data-author]");
  if (au) { state.author = state.author === au.dataset.author ? "" : au.dataset.author; return refresh(); }

  const act = t.closest("[data-act]");
  if (act) {
    e.stopPropagation();
    const it = state.items[act.closest(".card").dataset.i];
    if (act.dataset.act === "tweet") return window.open(it.tweet_url, "_blank");
    if (act.dataset.act === "x_status") { await toggleXRemove(it); syncItem(it); return; }
    await patch(it, { [act.dataset.act]: !it[act.dataset.act] });
    syncItem(it); loadStats();
    return;
  }
  const open = t.closest("[data-open]");
  if (open) { e.stopPropagation(); return openItem({ id: open.dataset.open }); }
  const c = t.closest(".card");
  if (c) { state.focus = +c.dataset.i; return openItem(state.items[c.dataset.i]); }

  const d = t.closest("[data-d]");
  if (d && state.open) {
    const it = state.open, k = d.dataset.d;
    if (k === "close") return closeDrawer();
    if (k === "delete") {
      if (!confirm("¿Eliminar este elemento de tu estantería?")) return;
      await api(`/api/items/${it.id}`, { method: "DELETE" }); closeDrawer(); return refresh();
    }
    if (k === "x_status") { await toggleXRemove(it); syncItem(it); return openItem(it); }
    if (k === "refetch") { await api(`/api/items/${it.id}/refetch`, { method: "POST" }); toast("Reextrayendo…"); pollProgress(); return openItem(it); }
    await patch(it, { [k]: !it[k] }); syncItem(it); loadStats(); return openItem(it);
  }
  const rm = t.closest("[data-rm]");
  if (rm && state.open) {
    await patch(state.open, { tags: state.open.tags.filter((x) => x !== rm.dataset.rm) });
    syncItem(state.open); openItem(state.open); loadStats();
  }
});

$("#scrim").onclick = closeDrawer;
$("#copyScriptBtn").onclick = async (e) => {
  const code = await fetch("/export_x.js").then((r) => r.text());
  try {
    await navigator.clipboard.writeText(code);
    e.target.textContent = "✅ Copiado, pégalo en la consola de X";
  } catch {
    window.open("/export_x.js", "_blank"); // sin permiso de portapapeles: que lo copie a mano
  }
};
$("#retryBtn").onclick = async (e) => {
  e.preventDefault();
  const r = await api("/api/retry-failed", { method: "POST" });
  toast(`${r.queued} en cola para reintentar`);
  refresh(); pollProgress();
};
$("#importBtn").onclick = openImport;
$("#moreBtn").onclick = () => load(true);
$("#menuBtn").onclick = () => $("#sidebar").classList.toggle("open");
$("#sort").onchange = (e) => { state.sort = e.target.value; load(); };
$("#themeBtn").onclick = () => {
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  const cur = document.documentElement.dataset.theme || (dark ? "dark" : "light");
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("theme", next); } catch {}
};
try { const th = localStorage.getItem("theme"); if (th) document.documentElement.dataset.theme = th; } catch {}

let qt;
$("#q").addEventListener("input", (e) => {
  clearTimeout(qt);
  qt = setTimeout(() => { state.q = e.target.value.trim(); if (state.q && state.sort === "recent") { state.sort = "relevance"; $("#sort").value = "relevance"; } load(); }, 250);
});

$("#surpriseBtn").onclick = async () => {
  const { items } = await api("/api/items?view=unread&sort=random&limit=1");
  if (!items.length) return toast("No te queda nada por leer 🎉");
  openItem(items[0]);
};

const drop = $("#drop");
$("#fileInput").onchange = (e) => uploadFiles(e.target.files);
["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => uploadFiles(e.dataTransfer.files));

// Atajos: / buscar · j/k moverse · Enter abrir · f favorito · r leído · e archivar · Esc cerrar
document.addEventListener("keydown", async (e) => {
  if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
    if (e.key === "Escape") document.activeElement.blur();
    return;
  }
  if (e.key === "/") { e.preventDefault(); return $("#q").focus(); }
  if (e.key === "Escape") return closeDrawer();
  const move = { j: 1, k: -1 }[e.key];
  if (move) {
    state.focus = Math.max(0, Math.min(state.items.length - 1, state.focus + move));
    document.querySelectorAll(".card.focused").forEach((c) => c.classList.remove("focused"));
    const el = $(`.card[data-i="${state.focus}"]`);
    el?.classList.add("focused"); el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    if (state.open) openItem(state.items[state.focus]);
    return;
  }
  const it = state.open || state.items[state.focus];
  if (!it) return;
  if (e.key === "Enter" && !state.open) return openItem(it);
  if (e.key === "x" && inX(it)) {
    await toggleXRemove(it); syncItem(it);
    if (state.open) openItem(it);
    return toast(it.x_status === "remove" ? "🧹 Se quitará de X" : "Ya no se quitará de X");
  }
  const field = { f: "favorite", r: "is_read", e: "archived" }[e.key];
  if (field) {
    await patch(it, { [field]: !it[field] }); syncItem(it); loadStats();
    if (state.open) openItem(it);
    toast({ favorite: it.favorite ? "⭐ Favorito" : "Quitado de favoritos", is_read: it.is_read ? "✅ Leído" : "Marcado sin leer", archived: it.archived ? "🗄️ Archivado" : "📤 Desarchivado" }[field]);
  }
});

async function toggleXRemove(it) {
  await patch(it, { x_status: it.x_status === "remove" ? null : "remove" });
  loadStats();
}

// ------------------------------------------------------------------ limpiar X

let cleanIds = [];
function openClean() {
  const x = state.stats?.x || { marked: 0, bookmarks: 0, likes: 0 };
  $("#cleanCounts").innerHTML = [
    ["marked", `Sólo los que he marcado con 🧹 (${x.marked})`, x.marked],
    ["bookmarks", `Todos los guardados que ya están aquí (${x.bookmarks})`, x.bookmarks],
    ["likes", `Todos los me gusta que ya están aquí (${x.likes})`, x.likes],
  ].map(([k, label, n], i) => `<label class="radio"><input type="radio" name="cleanScope" value="${k}" ${i === 0 ? "checked" : ""} ${n ? "" : "disabled"}> ${label}</label>`).join("");
  $("#cleanDone").classList.add("hidden");
  $("#cleanCopy").textContent = "📋 Copiar script de limpieza";
  $("#cleanDlg").showModal();
}
window.openClean = openClean;

$("#cleanCopy").onclick = async () => {
  const scope = document.querySelector('input[name="cleanScope"]:checked')?.value || "marked";
  const data = await api(`/api/x-cleanup?scope=${scope}`);
  cleanIds = [...new Set([...data.bookmarks, ...data.likes])];
  if (!cleanIds.length) return toast("No hay nada que quitar");
  const code = (await fetch("/clean_x.js").then((r) => r.text())).replace("__TWEETSHELF_DATA__", JSON.stringify(data));
  try {
    await navigator.clipboard.writeText(code);
    $("#cleanCopy").textContent = `✅ Copiado (${cleanIds.length}). Pégalo en la consola de X`;
  } catch {
    toast("No he podido copiar al portapapeles");
    return;
  }
  $("#cleanDone").classList.remove("hidden");
};

$("#cleanDone").onclick = async () => {
  const r = await api("/api/x-cleanup/done", { method: "POST", body: JSON.stringify({ ids: cleanIds }) });
  $("#cleanDlg").close();
  toast(`✓ ${r.updated} marcados como quitados de X`);
  refresh();
};

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.add("hidden"), 1800);
}

refresh().then(pollProgress);
