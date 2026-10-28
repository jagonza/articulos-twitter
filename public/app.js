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
// Los fragmentos de búsqueda vienen del texto en Markdown: se quitan las marcas para que se lean limpios.
const plainMd = (s) => String(s ?? "").replace(/!\[[^\]]*\]\([^)]*\)?/g, "").replace(/\[([^\]]*)\]\([^)]*\)?/g, "$1")
  .replace(/(\*\*|~~|`)/g, "").replace(/(^|\n)\s*(#{1,6}|>|[-*]|\d+[.)])\s+/g, "$1");
const marked = (s) => esc(plainMd(s)).replace(/\u0001/g, "<mark>").replace(/\u0002/g, "</mark>");
const favicon = (d) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=64`;
const readMins = (w) => (w ? Math.max(1, Math.round(w / 230)) : null);
// Iconos de Tabler (https://tabler.io/icons), en línea para no depender de nada externo.
const ICONS = {
  star: '<path d="M12 17.75l-6.172 3.245l1.179 -6.873l-5 -4.867l6.9 -1l3.086 -6.253l3.086 6.253l6.9 1l-5 4.867l1.179 6.873z"/>',
  check: '<path d="M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"/><path d="M9 12l2 2l4 -4"/>',
  bookmarkOff: '<path d="M3 3l18 18"/><path d="M17 17v3l-5 -3l-5 3v-13m1.178 -2.818c.252 -.113 .53 -.176 .822 -.176h6a2 2 0 0 1 2 2v7"/>',
  heartOff: '<path d="M3 3l18 18"/><path d="M19.5 12.572l-1.5 1.428m-2 2l-4 4l-7.5 -7.428a5 5 0 0 1 -1.288 -5.068a4.976 4.976 0 0 1 1.788 -2.504m3 -1c1.56 0 3.05 .727 4 2a5 5 0 0 1 7.5 6.572"/>',
  close: '<path d="M18 6l-12 12"/><path d="M6 6l12 12"/>',
  archive: '<path d="M3 4m0 2a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v0a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z"/><path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-10"/><path d="M10 12h4"/>',
  x: '<path d="M4 4l11.733 16h4.267l-11.733 -16z"/><path d="M4 20l6.768 -6.768m2.46 -2.46l6.772 -6.772"/>',
  external: '<path d="M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6"/><path d="M11 13l9 -9"/><path d="M15 4h5v5"/>',
  refresh: '<path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"/>',
  trash: '<path d="M4 7l16 0"/><path d="M10 11l0 6"/><path d="M14 11l0 6"/><path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12"/><path d="M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3"/>',
};
const icon = (name) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
const isXDomain = (d) => /^(www\.)?(x|twitter)\.com$/.test(d || "");
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
// Quitar de X es quitarlo de guardados o, si sólo llegó como me gusta, quitar el me gusta.
const xIcon = (it) => (it.sources.includes("bookmark") ? "bookmarkOff" : "heartOff");

// Tarjetas o lista: la última que eligió la persona (si el navegador deja guardarla).
const loadLayout = () => { try { return localStorage.getItem("layout") === "list" ? "list" : "cards"; } catch { return "cards"; } };
const state = { view: "all", q: "", tag: "", domain: "", author: "", sort: "recent", layout: loadLayout(), items: [], total: 0, focus: -1, open: null };

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
    ? `<img class="avatar" src="${esc(it.author_avatar)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'avatar',textContent:'${esc((it.author_name || it.author_handle || "?")[0].toUpperCase())}'}))">`
    : `<div class="avatar">${esc((it.author_name || it.author_handle || "?")[0].toUpperCase())}</div>`;
}

// Tuit citado, en pequeño; al pulsarlo se abre como elemento propio.
function quoteBlock(q, compact = false) {
  if (!q) return "";
  if (compact) {
    const kind = q.article_status === "ok" ? " · Artículo de X" : "";
    const title = q.article_status === "ok" && q.article_title ? `<div class="q-title">${esc(q.article_title)}</div>` : "";
    const thumb = q.article_image || (q.media || [])[0];
    return `<div class="quote card-quote" data-open="${esc(q.id)}" title="Abrir el tuit citado">
      ${thumb ? `<img class="q-thumb" src="${esc(thumb)}" alt="" loading="lazy" onerror="this.remove()">` : ""}
      <div class="who">Cita a ${q.author_handle ? `@${esc(q.author_handle)}` : "un tuit"}${kind}</div>${title}<div class="text">${esc(q.tweet_text)}</div></div>`;
  }
  const who = q.author_handle ? `${esc(q.author_name || "")} <span>@${esc(q.author_handle)}</span>` : "<span>Tuit citado</span>";
  const title = q.article_status === "ok" && q.article_title ? `<div class="q-title">📰 ${esc(q.article_title)}</div>` : "";
  const thumb = q.article_image || (q.media || [])[0];
  return `<div class="quote" data-open="${esc(q.id)}" title="Abrir el tuit citado">
    ${thumb ? `<img class="q-thumb" src="${esc(thumb)}" alt="" loading="lazy" onerror="this.remove()">` : ""}
    <div class="who">↪ ${who}</div>${title}<div class="text">${esc(q.tweet_text)}</div></div>`;
}

// X manda el texto de los tuits con &amp;, &lt; y &gt; ya escapados.
const unX = (s) => String(s ?? "").replace(/&(amp|lt|gt);/g, (_, e) => ({ amp: "&", lt: "<", gt: ">" }[e]));

function linkify(text) {
  return esc(unX(text)).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${u.replace(/^https?:\/\//, "").slice(0, 40)}${u.length > 48 ? "…" : ""}</a>`);
}

// ------------------------------------------------------------------ Markdown del lector
// Los artículos se guardan en Markdown (los antiguos, en texto plano: cada línea es un párrafo).
// Se escapa todo el HTML y sólo se generan las etiquetas de abajo, con enlaces e imágenes http(s).

const safeUrl = (u) => (/^https?:\/\//i.test(u) ? u : null);

function mdInline(text) {
  const out = [];
  let rest = text;
  // Imágenes y enlaces primero, para que sus URLs no pasen por las demás reglas.
  const re = /!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0, m;
  const fmt = (t) => esc(t)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/~~([^~]+?)~~/g, "<del>$1</del>")
    .replace(/\*([^*\s](?:[^*]*?[^*\s])?)\*/g, "<em>$1</em>")
    .replace(/(^|\s)(https?:\/\/[^\s<]+)/g, (_, sp, u) => `${sp}<a href="${u}" target="_blank" rel="noopener">${u.replace(/^https?:\/\//, "").slice(0, 60)}</a>`);
  while ((m = re.exec(rest))) {
    out.push(fmt(rest.slice(last, m.index)));
    if (m[2] !== undefined) {
      const u = safeUrl(m[2]);
      out.push(u ? `<img src="${esc(u)}" alt="${esc(m[1])}" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : "");
    } else {
      const u = safeUrl(m[4]);
      out.push(u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${fmt(m[3])}</a>` : fmt(m[3]));
    }
    last = re.lastIndex;
  }
  out.push(fmt(rest.slice(last)));
  return out.join("");
}

function renderMarkdown(src, title = "") {
  const lines = String(src || "").replace(/\r/g, "").split("\n");
  const html = [];
  let list = null, quote = [], table = [];
  const flush = () => {
    if (list) { html.push(`<${list.tag}>${list.items.map((i) => `<li>${mdInline(i)}</li>`).join("")}</${list.tag}>`); list = null; }
    if (quote.length) { html.push(`<blockquote>${quote.map((q) => `<p>${mdInline(q)}</p>`).join("")}</blockquote>`); quote = []; }
    if (table.length) {
      const rows = table.filter((r) => !/^\|?\s*:?-{2,}/.test(r)).map((r) => r.replace(/^\||\|$/g, "").split("|"));
      html.push(`<div class="table-wrap"><table>${rows.map((cells, i) => `<tr>${cells.map((c) => `<${i ? "td" : "th"}>${mdInline(c.trim())}</${i ? "td" : "th"}>`).join("")}</tr>`).join("")}</table></div>`);
      table = [];
    }
  };
  let first = true;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (!t) { flush(); continue; }
    if (t.startsWith("```")) {
      flush();
      const code = [];
      while (++i < lines.length && !lines[i].trim().startsWith("```")) code.push(lines[i]);
      html.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
      continue;
    }
    let m;
    if ((m = t.match(/^(#{1,6})\s+(.*)$/))) {
      flush();
      // El primer título suele repetir el del artículo, que ya está arriba.
      if (first && m[2].replace(/[*_]/g, "").trim() === title.trim()) { first = false; continue; }
      const level = Math.min(4, Math.max(2, m[1].length + 1));
      html.push(`<h${level}>${mdInline(m[2])}</h${level}>`);
    } else if ((m = t.match(/^[-*+]\s+(.*)$/)) || (m = t.match(/^\d+[.)]\s+(.*)$/))) {
      const tag = /^\d/.test(t) ? "ol" : "ul";
      if (quote.length || table.length || (list && list.tag !== tag)) flush();
      list = list || { tag, items: [] };
      list.items.push(m[1]);
    } else if (t.startsWith(">")) {
      if (list || table.length) flush();
      quote.push(t.replace(/^>\s?/, ""));
    } else if (t.startsWith("|") && t.endsWith("|")) {
      if (list || quote.length) flush();
      table.push(t);
    } else if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
      flush();
      html.push("<hr>");
    } else if (/^!\[[^\]]*\]\([^)\s]+\)$/.test(t)) {
      flush();
      html.push(`<figure>${mdInline(t)}${t.match(/^!\[([^\]]+)\]/) ? `<figcaption>${esc(t.match(/^!\[([^\]]+)\]/)[1])}</figcaption>` : ""}</figure>`);
    } else {
      flush();
      if (first && t === title.trim()) { first = false; continue; }
      // Párrafo que arranca en negrita («**Use the latest models.** Everything…»): la negrita hace de ladillo.
      html.push(`<p${t.startsWith("**") ? ' class="lede"' : ""}>${mdInline(t)}</p>`);
    }
    first = false;
  }
  flush();
  return html.join("");
}

function threadBlock(it) {
  if (!it.thread?.length) return "";
  return `<div class="o-thread"><h4>Hilo · ${it.thread.length} tuits</h4><ol class="thread">${it.thread.map((t) => `
    <li class="${t.id === it.id ? "current" : ""}">
      <div class="text">${linkify(t.text)}</div>
      ${t.media?.length ? `<div class="media-row">${t.media.map((m) => `<img src="${esc(m)}" alt="" loading="lazy" onerror="this.remove()">`).join("")}</div>` : ""}
    </li>`).join("")}</ol></div>`;
}

const mediaBig = (media) => media?.length
  ? `<div class="media-row big">${media.map((m) => `<img src="${esc(m)}" alt="" loading="lazy" onerror="this.remove()">`).join("")}</div>` : "";

// Texto de un tuit en párrafos. En los tuits de un hilo se quita la numeración («3/») y,
// si la primera línea es corta y va sola, pasa a subtítulo («Auto mode = no more permission prompts»).
function tweetProse(text, inThread = false) {
  let body = String(text || "").trim();
  if (inThread) body = body.replace(/^\d{1,2}\s*[/.)]\s*(?=\S)/, "");
  const [first, ...rest] = body.split(/\n\s*\n/);
  const head = inThread && rest.length && first.length <= 90 && !first.includes("\n") && !/https?:\/\//.test(first) ? first : null;
  return (head ? `<h3>${linkify(head)}</h3>` : "") +
    (head ? rest : [first, ...rest]).filter((p) => p.trim()).map((p) => `<p>${linkify(p.trim())}</p>`).join("");
}

// Hilo como texto continuo: el primer tuit de entradilla y el resto numerados en el margen.
function threadFlow(it) {
  const [lead, ...rest] = it.thread;
  const n = it.thread.length;
  return `<div class="lead">${tweetProse(lead.text)}</div>${mediaBig(lead.media)}
    <ol class="thread-flow">${rest.map((t, i) => `<li><span class="num">${i + 2}/${n}</span>
      <div class="prose">${tweetProse(t.text, true)}${mediaBig(t.media)}</div></li>`).join("")}</ol>`;
}

// Autor en la línea superior de la tarjeta: avatar pequeño y @usuario; al pulsarlo filtra por autor.
function byline(it) {
  if (!it.author_handle) return "";
  const av = it.author_avatar
    ? `<img class="av" src="${esc(it.author_avatar)}" alt="" loading="lazy" onerror="this.remove()">`
    : `<i class="av">${esc((it.author_name || it.author_handle)[0].toUpperCase())}</i>`;
  return `<span class="by" data-author="${esc(it.author_handle)}" title="Filtrar por @${esc(it.author_handle)}">${av}<span class="h">@${esc(it.author_handle)}</span></span>`;
}

// Título y extracto de la portada: los de GitHub («GitHub - autor/repo: descripción») quedan en autor/repo.
function cardTitle(it) {
  const title = cleanTitle(it.article_title, it.article_site);
  const gh = title.match(/^GitHub - ([^:]+?):\s*(.*)$/);
  if (!gh) return { title, excerpt: it.article_excerpt || "" };
  return { title: gh[1], excerpt: it.article_excerpt || gh[2] };
}

// Dónde sale el elemento: en X (icono y texto propios) o en otra web (favicon y nombre del sitio).
const fromXOf = (it) => it.article_status === "ok"
  ? isXDomain(it.domain) || /^(x|twitter)$/i.test(it.article_site || "")
  : !it.article_url;

function origin(it, fromX) {
  if (!fromX) return `<img src="${favicon(it.domain)}" alt=""><span class="site-name">${esc(it.article_site || it.domain)}</span>`;
  const label = it.article_status === "ok" ? "Artículo de X" : it.thread_count ? `Hilo de ${it.thread_count}` : "Tuit";
  return `<button class="src-x" data-act="tweet" title="Abrir en X" aria-label="Abrir en X">${icon("x")}</button><span class="site-name">${label}</span>`;
}

// Portada: la imagen del artículo, o un color de reserva con la inicial del sitio si no hay imagen o falla.
function cover(it) {
  const img = it.article_image ? `<img src="${esc(it.article_image)}" alt="" loading="lazy" onerror="this.remove()">` : "";
  return `<div class="cover" style="--h:${hue(it.domain || it.id)}">${img}<span>${esc((it.article_site || it.domain || "?")[0].toUpperCase())}</span></div>`;
}

const whenOf = (it) => {
  if (it.article_status !== "ok") return fmtDate(tweetDate(it.id));
  const mins = readMins(it.article_words);
  return mins ? `${mins} min` : "";
};

const statusOf = (it) => it.article_status === "pending" ? "⏳ extrayendo…"
  : it.article_status === "failed" ? `<span class="status-fail" title="${esc(it.article_error)}">⚠︎ no se pudo leer</span>` : "";

// Acciones: en la tarjeta flotan sobre la portada (o bajan al pie en el móvil); en la lista van siempre a la vista.
function acts(it, hasArticle, fromX) {
  return `<div class="acts">
    <button class="act fav ${it.favorite ? "on" : ""}" data-act="favorite" title="Favorito (f)" aria-label="Favorito">${icon("star")}</button>
    <button class="act read ${it.is_read ? "on" : ""}" data-act="is_read" title="Leído (r)" aria-label="Leído">${icon("check")}</button>
    ${inX(it) ? `<button class="act ${it.x_status === "remove" ? "on" : ""}" data-act="x_status" title="Quitar de X (x)" aria-label="Quitar de X">${icon(xIcon(it))}</button>` : ""}
    ${hasArticle && fromX ? "" : `<button class="act" data-act="tweet" title="Abrir en X" aria-label="Abrir en X">${icon("x")}</button>`}
  </div>`;
}

// Vista de tarjetas: artículos con portada; tuits con el texto y, si tienen, la primera imagen debajo.
function cardTile(it, i) {
  const hasArticle = it.article_status === "ok";
  const fromX = fromXOf(it);
  const { title, excerpt } = cardTitle(it);
  const when = whenOf(it);
  const body = hasArticle
    ? `<div class="site">${origin(it, fromX)}${when ? `<span class="dot">·</span>${when}` : ""}${byline(it)}</div>
      <h2>${esc(title)}</h2>
      ${it.snippet ? `<p class="snippet">${marked(it.snippet)}</p>` : excerpt ? `<p class="excerpt">${esc(excerpt)}</p>` : ""}`
    : `<div class="tweet-head">${avatar(it)}<div class="who" ${it.author_handle ? `data-author="${esc(it.author_handle)}"` : ""}>
        <b>${esc(it.author_name || it.author_handle || "")}</b>
        <span>${[it.author_handle && `@${esc(it.author_handle)}`, when, it.thread_count && `Hilo de ${it.thread_count}`].filter(Boolean).join(" · ")}</span></div></div>
      ${it.snippet ? `<p class="snippet">${marked(it.snippet)}</p>` : ""}
      <p class="tweet-text">${linkify(it.tweet_text)}</p>
      ${it.media[0] ? `<img class="tw-media" loading="lazy" src="${esc(it.media[0])}" alt="" onerror="this.remove()">` : ""}`;
  return `<article class="card tile ${hasArticle ? "" : "tw"} ${it.is_read ? "read" : ""} ${i === state.focus ? "focused" : ""}" data-i="${i}">
    ${hasArticle ? cover(it) : ""}
    <div class="body">
      ${body}
      ${quoteBlock(it.quoted, true)}
      <div class="meta">
        ${statusOf(it)}
        ${it.tags.slice(0, 3).map((t) => `<span class="chip" data-tag="${esc(t)}">${esc(t)}</span>`).join("")}
        ${it.note ? `<span class="note" title="${esc(it.note)}">Nota: ${esc(it.note)}</span>` : ""}
        ${it.favorite ? icon("star") : ""}
        ${it.is_read ? "" : `<span class="unread" title="Por leer"></span>`}
      </div>
      ${acts(it, hasArticle, fromX)}
    </div></article>`;
}

// Vista de lista: una fila por elemento, con miniatura, origen, título y una línea de apoyo.
function cardRow(it, i) {
  const hasArticle = it.article_status === "ok";
  const fromX = fromXOf(it);
  const { title, excerpt } = cardTitle(it);
  const when = whenOf(it);
  const q = it.quoted;
  const sub = it.snippet ? marked(it.snippet)
    : hasArticle ? esc(excerpt)
    : q ? `↪ ${q.author_handle ? esc(`@${q.author_handle}: `) : ""}${esc(q.tweet_text)}` : "";
  return `<article class="card row ${hasArticle ? "" : "tw"} ${it.is_read ? "read" : ""} ${i === state.focus ? "focused" : ""}" data-i="${i}">
    <div class="thumb">${hasArticle ? cover(it) : avatar(it)}</div>
    <div class="mid">
      <div class="site">${origin(it, fromX)}${when ? `<span class="dot">·</span>${when}` : ""}${byline(it)}</div>
      <div class="ttl">${esc(hasArticle ? title : unX(it.tweet_text))}</div>
      ${sub ? `<div class="sub">${sub}</div>` : ""}
    </div>
    ${acts(it, hasArticle, fromX)}
  </article>`;
}

function card(it, i) {
  return state.layout === "list" ? cardRow(it, i) : cardTile(it, i);
}

function renderGrid() {
  $("#grid").classList.toggle("list", state.layout === "list");
  document.querySelectorAll("[data-layout]").forEach((b) => {
    const on = b.dataset.layout === state.layout;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", on);
  });
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

// Los títulos de las webs suelen acabar en « / Nombre del sitio», que ya sale encima.
function cleanTitle(title, site) {
  const t = String(title || "");
  const sep = site && [" / ", " | ", " - ", " — ", " – "].find((x) => t.endsWith(x + site));
  return sep ? t.slice(0, -(sep.length + site.length)) : t;
}

// Quita del principio del texto lo que ya está arriba: la sección («Engineering»), el título y la entradilla.
function trimLead(md, ...seen) {
  const norm = (x) => plainMd(x).replace(/[*_#]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  const known = seen.filter(Boolean).map(norm);
  const lines = String(md || "").split("\n");
  let cut = 0;
  for (let i = 0, n = 0; i < lines.length && n < 4; i++) {
    const t = norm(lines[i]);
    if (!t) continue;
    n++;
    if (known.includes(t)) cut = i + 1;
    else if (t.length >= 40) break;
  }
  return lines.slice(cut).join("\n");
}

async function openItem(it) {
  const full = await api(`/api/items/${it.id}`);
  const d = $("#drawer");
  // Al volver a pintar el mismo elemento (favorito, etiqueta…) no se pierde por dónde ibas leyendo.
  const same = state.open?.id === full.id && d.classList.contains("open");
  const keep = same ? [$(".content", d).scrollTop, $(".side", d).scrollTop] : [0, 0];
  state.open = full;
  const mins = readMins(full.article_words);
  const title = cleanTitle(full.article_title, full.article_site);
  const paras = renderMarkdown(trimLead(full.article_text, full.article_title, title, full.article_excerpt), title);
  const isArticle = full.article_status === "ok";
  const fromX = isXDomain(full.domain) || /^(x|twitter)$/i.test(full.article_site || "");
  const threadMins = readMins((full.thread || []).reduce((n, t) => n + t.text.split(/\s+/).length, 0));
  const sources = full.sources.map((x) => SOURCE_LABEL[x] || x).join(" + ");
  const ext = (href, label) => `<a class="ext" href="${esc(href)}" target="_blank" rel="noopener">${label} ${icon("external")}</a>`;
  const abtn = (k, on, ic, label, onLabel, title) =>
    `<button class="btn act-${k} ${on ? "on" : ""}" data-d="${k}" title="${title}" aria-pressed="${!!on}">${icon(ic)}<span>${on ? onLabel : label}</span></button>`;
  // La entradilla sólo si no es el principio del propio texto (en los Artículos de X lo es).
  const flat = (s) => plainMd(s).replace(/\s+/g, " ").trim();
  const dek = full.article_excerpt && !flat(full.article_text).slice(0, 400).includes(flat(full.article_excerpt).slice(0, 50)) ? full.article_excerpt : "";
  const keepQuoted = full.quoted && !full.archived ? `<button class="btn small" data-d="keep-quoted"
    title="Pasa favorito, notas y etiquetas al citado y archiva este tuit">↪ Quedarme sólo con el citado</button>` : "";
  const who = `<b>${esc(full.author_name || (full.author_handle ? "@" + full.author_handle : "Tuit"))}</b>`;
  const handle = full.author_handle ? `<button class="link" data-author="${esc(full.author_handle)}" title="Filtrar por @${esc(full.author_handle)}">@${esc(full.author_handle)}</button> · ` : "";
  const saved = full.imported_at ? fmtDate(new Date(full.imported_at.replace(" ", "T") + "Z")) : "";

  d.innerHTML = `
    <div class="content" tabindex="-1">
      <button class="tbtn icon m-close" data-d="close" title="Cerrar (Esc)" aria-label="Cerrar">${icon("close")}</button>
      <article class="page">
      ${isArticle ? `
        ${full.article_image ? `<img class="hero" src="${esc(full.article_image)}" alt="" onerror="this.remove()">` : ""}
        <p class="kicker">${fromX ? icon("x") : `<img src="${favicon(full.domain)}" alt="" onerror="this.remove()">`}<b>${esc(fromX ? "Artículo de X" : full.article_site || full.domain)}</b>${mins ? `<span>·</span><span>${mins} min de lectura</span>` : ""}</p>
        <h1>${esc(title)}</h1>
        ${dek ? `<p class="dek">${esc(dek)}</p>` : ""}
        <div class="meta">${[full.article_author, full.article_date && fmtDate(new Date(full.article_date))]
          .filter(Boolean).map((s) => `<span>${esc(s)}</span>`).join(`<span class="dot">·</span>`)}
          ${full.article_url && !fromX ? ext(full.article_url, "Leer en la web") : ""}</div>` : `
        <p class="kicker">${icon("x")}<b>${full.thread?.length ? `Hilo · ${full.thread.length} tuits` : "Tuit"}</b>${threadMins ? `<span>·</span><span>${threadMins} min</span>` : ""}</p>
        <div class="author">
          ${avatar(full)}
          <div class="a-who">${who}<span>${handle}${esc(fmtDate(tweetDate(full.id)))}</span></div>
        </div>
        ${full.thread?.length ? threadFlow(full) : `<div class="lead ${full.tweet_text.length > 280 ? "long" : ""}">${tweetProse(full.tweet_text)}</div>${mediaBig(full.media)}`}
        ${quoteBlock(full.quoted)}`}
      ${full.article_status === "failed" ? `<p class="notice fail">No pude extraer el artículo: ${esc(full.article_error)}</p>` : ""}
      ${full.article_status === "pending" ? `<p class="notice">⏳ Extrayendo el artículo…</p>` : ""}
      ${paras ? `<div class="article">${paras}</div>` : ""}
      ${full.quoted_by?.length ? `<div class="cited"><h4>Citado por</h4>${full.quoted_by.map((q) => quoteBlock(q)).join("")}</div>` : ""}
      </article>
    </div>

    <aside class="side">
      <div class="side-head">
        <span>${saved ? `Guardado el ${esc(saved)}` : esc(sources)}</span>
        <button class="tbtn icon" data-d="close" title="Cerrar (Esc)" aria-label="Cerrar">${icon("close")}</button>
      </div>
      <div class="side-body">
        <div class="acts">
          ${abtn("favorite", full.favorite, "star", "Favorito", "En favoritos", "Favorito (f)")}
          ${abtn("is_read", full.is_read, "check", "Marcar leído", "Leído", full.is_read ? "Marcar como no leído (r)" : "Marcar leído (r)")}
          ${abtn("archived", full.archived, "archive", "Archivar", "Archivado", full.archived ? "Desarchivar (e)" : "Archivar (e)")}
          ${inX(full) ? abtn("x_status", full.x_status === "remove", xIcon(full), "Quitar de X", "Se quitará de X",
            full.x_status === "remove" ? "Se quitará de tus " + (xIcon(full) === "bookmarkOff" ? "guardados" : "me gusta") + " de X con el script de limpieza (x)" : "Marcar para quitar de X (x)") : ""}
        </div>

        <section>
          <h3>${isArticle ? "El tuit" : "En X"}</h3>
          <div class="origin">
            ${isArticle ? `<div class="o-who">${avatar(full)}<div class="o-name">${who}<span>${handle}${fmtDate(tweetDate(full.id))}</span></div></div>
            <div class="o-text">${linkify(full.tweet_text)}</div>
            ${full.media.length ? `<div class="media-row">${full.media.map((m) => `<img src="${esc(m)}" alt="" onerror="this.remove()">`).join("")}</div>` : ""}
            ${quoteBlock(full.quoted)}
            ${threadBlock(full)}` : `<div class="o-text">${esc(sources[0].toUpperCase() + sources.slice(1))}${full.x_status === "removed" ? " · ya quitado de X" : ""}</div>`}
            <p class="o-foot">${ext(full.tweet_url, "Ver en X")}${keepQuoted}</p>
          </div>
        </section>

        <section>
          <label for="note">Mis notas <span class="save-state" id="saveState"></span></label>
          <textarea id="note" placeholder="¿Por qué lo guardaste? ¿Qué te llevas?">${esc(full.note)}</textarea>
        </section>

        <section>
          <label for="tagInput">Etiquetas</label>
          ${full.tags.length ? `<div class="tags">${full.tags.map((t) => `<span class="tag">${esc(t)}<button data-rm="${esc(t)}" aria-label="Quitar la etiqueta ${esc(t)}">${icon("close")}</button></span>`).join("")}</div>` : ""}
          <input id="tagInput" placeholder="Añadir etiqueta…" list="tagSuggest">
          <datalist id="tagSuggest">${(state.stats?.tags || []).map((t) => `<option value="${esc(t.tag)}">`).join("")}</datalist>
        </section>

        <div class="foot">
          ${full.urls.length ? `<button class="btn" data-d="refetch">${icon("refresh")} Volver a extraer el artículo</button>` : ""}
          <button class="btn danger" data-d="delete">${icon("trash")} Eliminar de la estantería</button>
        </div>
      </div>
    </aside>`;
  const wasOpen = d.classList.contains("open");
  d.classList.add("open");
  d.setAttribute("aria-hidden", "false");
  document.documentElement.classList.add("reading");
  $("#scrim").classList.remove("hidden");
  const content = $(".content", d);
  [content.scrollTop, $(".side", d).scrollTop] = keep;
  if (!wasOpen || !same) content.focus({ preventScroll: true });

  let t;
  $("#note").addEventListener("input", (e) => {
    $("#saveState").textContent = "guardando…";
    clearTimeout(t);
    t = setTimeout(async () => { await patch(full, { note: e.target.value }); syncItem(full); $("#saveState").textContent = "guardado ✓"; }, 600);
  });
  $("#tagInput").addEventListener("keydown", async (e) => {
    if (e.key === "Enter" && e.target.value.trim()) {
      await patch(full, { tags: [...full.tags, e.target.value.trim()] });
      syncItem(full); await openItem(full); loadStats();
      $("#tagInput").focus();
    }
  });
}

function closeDrawer() {
  const d = $("#drawer");
  d.classList.remove("open");
  d.setAttribute("aria-hidden", "true");
  document.documentElement.classList.remove("reading");
  $("#scrim").classList.add("hidden");
  state.open = null;
}

function syncItem(full) {
  const i = state.items.findIndex((x) => x.id === full.id);
  if (i < 0) return;
  state.items[i] = { ...state.items[i], ...full, article_text: undefined, thread: undefined };
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
  trackExtraction(await api("/api/extract-now", { method: "POST" }).catch(() => ({})));
}

// La extracción de artículos la hace GitHub Actions cada 3 horas; «extraer ahora» lanza una pasada
// al momento y aquí seguimos su ejecución para que se vea en qué va.
const extraction = { since: 0, notice: "" };
const plural = (n, s) => `${n} ${s}${n === 1 ? "" : "s"}`;

async function extractNow() {
  extraction.notice = "⏳ Lanzando la extracción…";
  extraction.since = 0;
  pollProgress(false);
  const r = await api("/api/extract-now", { method: "POST" })
    .catch((e) => ({ triggered: false, reason: "github_error", message: e.message }));
  trackExtraction(r);
}
window.extractNow = extractNow;

// Recibe la respuesta de cualquier llamada que dispara el extractor y deja el aviso adecuado.
function trackExtraction(r) {
  if (r.triggered) {
    extraction.since = Date.now();
    extraction.notice = "";
  } else if (r.reason === "not_configured") {
    extraction.notice = `⚠️ «Extraer ahora» no está configurado: falta el secreto <code>GITHUB_TOKEN</code> (y <code>GITHUB_REPO</code>) en el Worker.
      Los artículos se extraerán solos en la próxima pasada automática (cada 3 h).`;
  } else if (r.reason === "github_error") {
    extraction.notice = `❌ No se pudo lanzar la extracción: ${esc(r.message)}.`;
  }
  pollProgress();
}

let pollTimer;
async function pollProgress(refreshStatus = true) {
  clearTimeout(pollTimer);
  const p = await api("/api/progress");
  const running = extraction.since > 0;
  const parts = [];
  let next = 30000;

  if (running && refreshStatus) {
    const s = await api("/api/extract-status").catch((e) => ({ error: e.message }));
    // La ejecución que lanzamos es la primera creada después del clic (con margen por relojes desfasados).
    const run = s.run && Date.parse(s.run.created_at) > extraction.since - 60000 ? s.run : null;
    const log = run ? ` · <a href="${esc(run.url)}" target="_blank" rel="noopener">ver en GitHub</a>` : "";
    next = 5000;
    if (s.error) {
      extraction.since = 0;
      extraction.notice = `❌ No se puede consultar la extracción: ${esc(s.error)}.`;
    } else if (!run) {
      if (Date.now() - extraction.since > 5 * 60000) {
        extraction.since = 0;
        extraction.notice = "⚠️ GitHub Actions no ha arrancado la extracción tras 5 minutos. Mira la pestaña Actions del repo.";
      } else parts.push("🚀 Extracción lanzada. Esperando a que GitHub Actions la arranque (suele tardar menos de un minuto)…");
    } else if (run.status !== "completed") {
      parts.push(run.status === "in_progress"
        ? `⚙️ Extrayendo artículos… quedan ${p.pending}${log}`
        : `⏳ En cola en GitHub Actions…${log}`);
    } else {
      extraction.since = 0;
      extraction.notice = run.conclusion === "success"
        ? `✅ Extracción terminada${p.failed ? ` · ${plural(p.failed, "enlace")} sin artículo` : ""}${log}`
        : `❌ La extracción falló en GitHub Actions${log}. Si es la primera vez, revisa que el repo tenga los secretos
           <code>TWEETSHELF_URL</code> y <code>TWEETSHELF_TOKEN</code>.`;
      refresh();
    }
  }

  if (extraction.notice) parts.push(extraction.notice);
  if (p.pending && !extraction.since) {
    parts.push(`⏳ ${plural(p.pending, "artículo")} pendiente${p.pending === 1 ? "" : "s"} de extraer
      · <a href="#" onclick="extractNow(); return false">extraer ahora</a>`);
  }
  $("#progress").classList.toggle("hidden", !parts.length);
  $("#progressText").innerHTML = parts.join("<br>");

  const before = state.stats?.pending;
  if (before !== undefined && before !== p.pending) refresh();
  if (state.stats) state.stats.pending = p.pending;
  if (p.pending || extraction.since) pollTimer = setTimeout(pollProgress, next);
}

// ------------------------------------------------------------------ eventos

document.addEventListener("click", async (e) => {
  const t = e.target;
  const v = t.closest("[data-view]");
  if (v) { state.view = v.dataset.view; $("#sidebar").classList.remove("open"); return refresh(); }
  const lay = t.closest("[data-layout]");
  if (lay) return setLayout(lay.dataset.layout);
  const clear = t.closest("[data-clear]");
  if (clear) { state[clear.dataset.clear] = ""; if (clear.dataset.clear === "q") $("#q").value = ""; return refresh(); }
  const tag = t.closest("[data-tag]");
  if (tag) { e.stopPropagation(); state.tag = state.tag === tag.dataset.tag ? "" : tag.dataset.tag; return refresh(); }
  const dom = t.closest("[data-domain]");
  if (dom) { state.domain = state.domain === dom.dataset.domain ? "" : dom.dataset.domain; return refresh(); }
  const au = t.closest("[data-author]");
  if (au) { if (state.open) closeDrawer(); state.author = state.author === au.dataset.author ? "" : au.dataset.author; return refresh(); }

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
    if (k === "keep-quoted") {
      const r = await api(`/api/items/${it.id}/keep-quoted`, { method: "POST" });
      toast("↪ Te quedas con el citado; el original queda archivado y marcado para quitar de X");
      refresh();
      return openItem({ id: r.kept });
    }
    if (k === "x_status") { await toggleXRemove(it); syncItem(it); return openItem(it); }
    if (k === "refetch") { trackExtraction(await api(`/api/items/${it.id}/refetch`, { method: "POST" })); toast("Reextrayendo…"); return openItem(it); }
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
  refresh(); trackExtraction(r);
};
$("#importBtn").onclick = openImport;
$("#moreBtn").onclick = () => load(true);
$("#menuBtn").onclick = () => $("#sidebar").classList.toggle("open");
// Tarjetas o lista: sólo se repinta, no se vuelve a pedir nada a la API.
function setLayout(layout) {
  state.layout = layout;
  try { localStorage.setItem("layout", layout); } catch {}
  renderGrid();
}
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
    return toast(it.x_status === "remove" ? "Se quitará de X" : "Ya no se quitará de X");
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
    ["marked", `Sólo los que he marcado para quitar de X (${x.marked})`, x.marked],
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
