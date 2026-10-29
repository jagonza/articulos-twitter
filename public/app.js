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
  close: '<path d="M18 6l-12 12"/><path d="M6 6l12 12"/>',
  archive: '<path d="M3 4m0 2a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v0a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z"/><path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-10"/><path d="M10 12h4"/>',
  x: '<path d="M4 4l11.733 16h4.267l-11.733 -16z"/><path d="M4 20l6.768 -6.768m2.46 -2.46l6.772 -6.772"/>',
  link: '<path d="M9 15l6 -6"/><path d="M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464"/><path d="M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463"/>',
  external: '<path d="M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6"/><path d="M11 13l9 -9"/><path d="M15 4h5v5"/>',
  quote: '<path d="M10 11h-4a1 1 0 0 1 -1 -1v-3a1 1 0 0 1 1 -1h3a1 1 0 0 1 1 1v6c0 2.667 -1.333 4.333 -4 5"/><path d="M19 11h-4a1 1 0 0 1 -1 -1v-3a1 1 0 0 1 1 -1h3a1 1 0 0 1 1 1v6c0 2.667 -1.333 4.333 -4 5"/>',
  dots: '<path d="M5 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M19 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/>',
  trash: '<path d="M4 7l16 0"/><path d="M10 11l0 6"/><path d="M14 11l0 6"/><path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12"/><path d="M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3"/>',
  play: '<path d="M7 4v16l13 -8z"/>',
};
const icon = (name) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
const isXDomain = (d) => /^(www\.)?(x|twitter)\.com$/.test(d || "");
// X sirve las miniaturas de vídeo y de GIF desde rutas propias: la URL basta para saber qué es.
const mediaKind = (url) => /\/tweet_video_thumb\//.test(url) ? "gif"
  : /\/(amplify|ext_tw)_video_thumb\//.test(url) ? "video" : "photo";
// Las imágenes de X pasan por el Worker (/img): pedidas desde aquí a pbs.twimg.com, no se ven.
const pic = (url) => /^https:\/\/pbs\.twimg\.com\//.test(url || "") ? `/img?u=${encodeURIComponent(url)}` : url;
const statusUrl = (handle, id) => handle ? `https://x.com/${handle}/status/${id}` : `https://x.com/i/status/${id}`;
const hue = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
// Los ids de X llevan la fecha dentro (snowflake).
const tweetDate = (id) => {
  try { return new Date(Number((BigInt(id) >> 22n) + 1288834974657n)); } catch { return null; }
};
const fmtDate = (d) => d && !isNaN(d) ? d.toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" }) : "";

const VIEWS = [
  ["all", "📥", "Todo"], ["unread", "📖", "Por leer"], ["favorites", "⭐", "Favoritos"],
  ["articles", "📰", "Artículos"], ["tweets", "💬", "Sólo tuits"], ["notes", "📝", "Con notas"], ["archived", "🗄️", "Archivados"],
];
const SOURCE_LABEL = { like: "me gusta", bookmark: "guardado", quoted: "citado" };

// Tarjetas o lista: la última que eligió la persona (si el navegador deja guardarla).
const loadLayout = () => { try { return localStorage.getItem("layout") === "list" ? "list" : "cards"; } catch { return "cards"; } };
const state = { view: "all", q: "", tag: "", author: "", sort: "recent", layout: loadLayout(), items: [], total: 0, focus: -1, open: null };

// ------------------------------------------------------------------ carga

async function load(append = false) {
  const p = new URLSearchParams({ view: state.view, q: state.q, tag: state.tag,
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
  $("#authorList").innerHTML = s.authors.map((a) =>
    `<li data-author="${esc(a.handle)}" class="${state.author === a.handle ? "active" : ""}">${a.avatar ? `<img src="${esc(pic(a.avatar))}" alt="" style="border-radius:50%">` : ""}<span class="label">${esc(a.name || "@" + a.handle)}</span><span class="n">${a.n}</span></li>`).join("");
  $("#empty").classList.toggle("hidden", s.counts.all + s.counts.archived > 0);
  state.stats = s;
}

const refresh = () => Promise.all([load(), loadStats()]);

// ------------------------------------------------------------------ tarjetas

function avatar(it) {
  return it.author_avatar
    ? `<img class="avatar" src="${esc(pic(it.author_avatar))}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'avatar',textContent:'${esc((it.author_name || it.author_handle || "?")[0].toUpperCase())}'}))">`
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
      ${thumb ? `<img class="q-thumb" src="${esc(pic(thumb))}" alt="" loading="lazy" onerror="this.remove()">` : ""}
      <div class="who">Cita a ${q.author_handle ? `@${esc(q.author_handle)}` : "un tuit"}${kind}</div>${title}<div class="text">${esc(q.tweet_text)}</div></div>`;
  }
  const who = q.author_handle ? `${esc(q.author_name || "")} <span>@${esc(q.author_handle)}</span>` : "<span>Tuit citado</span>";
  const title = q.article_status === "ok" && q.article_title ? `<div class="q-title">📰 ${esc(q.article_title)}</div>` : "";
  const thumb = q.article_image || (q.media || [])[0];
  return `<div class="quote" data-open="${esc(q.id)}" title="Abrir el tuit citado">
    ${thumb ? `<img class="q-thumb" src="${esc(pic(thumb))}" alt="" loading="lazy" onerror="this.remove()">` : ""}
    <div class="who">${icon("quote")} ${who}</div>${title}<div class="text">${esc(q.tweet_text)}</div></div>`;
}

// X manda el texto de los tuits con &amp;, &lt; y &gt; ya escapados.
// Algunas exportaciones parten la dirección tras «https://» en otra línea: se vuelve a unir.
const unX = (s) => String(s ?? "").replace(/&(amp|lt|gt);/g, (_, e) => ({ amp: "&", lt: "<", gt: ">" }[e]))
  .replace(/(https?:\/\/)\s*\n\s*/g, "$1");

function linkify(text) {
  return esc(unX(text)).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${u.replace(/^https?:\/\//, "").slice(0, 40)}${u.length > 48 ? "…" : ""}</a>`);
}

// Enlaces del tuit que no se ven ya en su texto (en importaciones antiguas el texto no siempre los trae).
// No se descargan: son sólo enlaces a la web.
const bareUrl = (u) => u.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
function linkList(it) {
  const text = unX(it.tweet_text).toLowerCase().replace(/https?:\/\/(www\.)?/g, "");
  const links = [...new Set(it.urls || [])].filter((u) => safeUrl(u) && !isXDomain(bareUrl(u).split(/[/?#]/)[0].toLowerCase())
    && !text.includes(bareUrl(u).toLowerCase()));
  return links.length ? `<div class="links">${links.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener"
    onclick="event.stopPropagation()">${icon("link")}<span>${esc(bareUrl(u).slice(0, 60))}${bareUrl(u).length > 60 ? "…" : ""}</span></a>`).join("")}</div>` : "";
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
      out.push(u ? `<img src="${esc(pic(u))}" alt="${esc(m[1])}" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : "");
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
      ${t.media?.length ? `<div class="media-row">${t.media.map((m) => mediaItem(m, statusUrl(it.author_handle, t.id))).join("")}</div>` : ""}
    </li>`).join("")}</ol></div>`;
}

// Un medio del tuit. Los vídeos y GIF no se guardan: se ve su miniatura con un «play» que abre el tuit en X.
function mediaItem(url, href) {
  const kind = mediaKind(url);
  const img = `<img src="${esc(pic(url))}" alt="" loading="lazy" onerror="this.remove()">`;
  if (kind === "photo" || !href) return img;
  const label = kind === "gif" ? "GIF" : "Vídeo";
  return `<a class="vid" href="${esc(href)}" target="_blank" rel="noopener" onclick="event.stopPropagation()"
    title="Ver el ${label.toLowerCase()} en X" aria-label="Ver el ${label.toLowerCase()} en X">${img}
    <span class="vid-play">${icon("play")}</span><span class="vid-tag">${label} · ver en X</span></a>`;
}

const mediaBig = (media, href) => media?.length
  ? `<div class="media-row big">${media.map((m) => mediaItem(m, href)).join("")}</div>` : "";

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
  return `<div class="lead">${tweetProse(lead.text)}</div>${mediaBig(lead.media, statusUrl(it.author_handle, lead.id))}
    <ol class="thread-flow">${rest.map((t, i) => `<li><span class="num">${i + 2}/${n}</span>
      <div class="prose">${tweetProse(t.text, true)}${mediaBig(t.media, statusUrl(it.author_handle, t.id))}</div></li>`).join("")}</ol>`;
}

// Autor en la línea superior de la tarjeta: avatar pequeño y @usuario; al pulsarlo filtra por autor.
function byline(it) {
  if (!it.author_handle) return "";
  const av = it.author_avatar
    ? `<img class="av" src="${esc(pic(it.author_avatar))}" alt="" loading="lazy" onerror="this.remove()">`
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
function cover(it, src = it.article_image) {
  const img = src ? `<img src="${esc(pic(src))}" alt="" loading="lazy" onerror="this.remove()">` : "";
  return `<div class="cover" style="--h:${hue(it.domain || it.id)}">${img}<span>${esc((it.article_site || it.domain || it.author_name || it.author_handle || "?")[0].toUpperCase())}</span></div>`;
}

// Marca de vídeo/GIF sobre una miniatura que no es enlace (tarjetas y lista).
const mediaBadge = (url) => {
  const kind = mediaKind(url);
  return kind === "photo" ? "" : `<span class="vid-badge">${kind === "gif" ? "GIF" : icon("play")}</span>`;
};

const whenOf = (it) => {
  if (it.article_status !== "ok") return fmtDate(tweetDate(it.id));
  const mins = readMins(it.article_words);
  return mins ? `${mins} min` : "";
};

// Acciones de la tarjeta: flotan sobre la portada al pasar el ratón, y en el móvil van al pie.
function acts(it) {
  return `<div class="acts">
    <button class="act fav ${it.favorite ? "on" : ""}" data-act="favorite" title="Favorito (f)" aria-label="Favorito">${icon("star")}</button>
    <button class="act read ${it.is_read ? "on" : ""}" data-act="is_read" title="Leído (r)" aria-label="Leído">${icon("check")}</button>
  </div>`;
}

// Lista: un solo botón de tres puntos que despliega las acciones. El enlace a X ya va en el origen.
function rowMenu(it) {
  return `<div class="more-wrap">
    <button class="act menu-btn" data-menu title="Más acciones" aria-label="Más acciones" aria-haspopup="true">${icon("dots")}</button>
    <div class="menu" role="menu">
      <button role="menuitem" data-act="favorite">${icon("star")}${it.favorite ? "Quitar de favoritos" : "Añadir a favoritos"}</button>
      <button role="menuitem" data-act="is_read">${icon("check")}${it.is_read ? "Marcar como no leído" : "Marcar como leído"}</button>
    </div></div>`;
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
      ${linkList(it)}
      ${it.media[0] ? `<div class="tw-media ${mediaKind(it.media[0])}">
        <img loading="lazy" src="${esc(pic(it.media[0]))}" alt="" onerror="this.remove()">${mediaBadge(it.media[0])}</div>` : ""}`;
  return `<article class="card tile ${hasArticle ? "" : "tw"} ${it.is_read ? "read" : ""} ${i === state.focus ? "focused" : ""}" data-i="${i}">
    ${hasArticle ? cover(it) : ""}
    <div class="body">
      ${body}
      ${quoteBlock(it.quoted, true)}
      <div class="meta">
        ${it.tags.slice(0, 3).map((t) => `<span class="chip" data-tag="${esc(t)}">${esc(t)}</span>`).join("")}
        ${it.note ? `<span class="note" title="${esc(it.note)}">Nota: ${esc(it.note)}</span>` : ""}
        ${it.favorite ? icon("star") : ""}
      </div>
      ${acts(it)}
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
    : q ? `${icon("quote")} ${q.author_handle ? esc(`@${q.author_handle}: `) : ""}${esc(q.tweet_text)}` : "";
  return `<article class="card row ${hasArticle ? "" : "tw"} ${it.is_read ? "read" : ""} ${i === state.focus ? "focused" : ""}" data-i="${i}">
    <div class="thumb">${hasArticle ? cover(it) : cover(it, it.media[0] || it.author_avatar) + (it.media[0] ? mediaBadge(it.media[0]) : "")}</div>
    <div class="mid">
      <div class="site">${origin(it, fromX)}${when ? `<span class="dot">·</span>${when}` : ""}${byline(it)}</div>
      <div class="ttl">${esc(hasArticle ? title : unX(it.tweet_text))}</div>
      ${sub ? `<div class="sub">${sub}</div>` : ""}
    </div>
    ${rowMenu(it)}
  </article>`;
}

function card(it, i) {
  return state.layout === "list" ? cardRow(it, i) : cardTile(it, i);
}

// Las tarjetas se reparten en columnas con JS: cada una va a la más corta, así
// ninguna empieza a mitad de otra y no hay huecos. Las columnas CSS se cortaban en Safari.
const CARD_MIN = 300, GRID_GAP = 18;
let cardNodes = [];
let gridCols = 0;

function placeCards(force) {
  const grid = $("#grid");
  if (state.layout === "list") {
    gridCols = 0;
    grid.replaceChildren(...cardNodes);
    return;
  }
  // Como mucho tres columnas: en escritorio cuatro se ven demasiado estrechas.
  const cols = Math.min(3, Math.max(1, Math.floor((grid.clientWidth + GRID_GAP) / (CARD_MIN + GRID_GAP))));
  if (cols === gridCols && !force) return;
  gridCols = cols;
  const columns = Array.from({ length: cols }, () => Object.assign(document.createElement("div"), { className: "col" }));
  grid.replaceChildren(...columns);
  const heights = columns.map(() => 0);
  for (const node of cardNodes) {
    const i = heights.indexOf(Math.min(...heights));
    columns[i].append(node);
    heights[i] = columns[i].offsetHeight;
  }
}

window.addEventListener("resize", () => placeCards());

function renderGrid() {
  $("#grid").classList.toggle("list", state.layout === "list");
  document.querySelectorAll("[data-layout]").forEach((b) => {
    const on = b.dataset.layout === state.layout;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", on);
  });
  $("#grid").innerHTML = state.items.map(card).join("");
  cardNodes = [...$("#grid").children];
  placeCards(true);
  const filters = [
    state.q && ["q", `🔎 “${state.q}”`], state.tag && ["tag", `#${state.tag}`],
    state.author && ["author", `@${state.author}`],
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
  const verEnX = full.tweet_url ? `<a class="btn" href="${esc(full.tweet_url)}" target="_blank" rel="noopener" title="Abrir en X">${icon("external")}<span>Ver en X</span></a>` : "";
  const keepQuoted = full.quoted && !full.archived ? `<button class="btn wide" data-d="keep-quoted"
    title="Pasa favorito, notas y etiquetas al citado y archiva este tuit">${icon("quote")}<span>Quedarme sólo con el citado</span></button>` : "";
  const who = `<b>${esc(full.author_name || (full.author_handle ? "@" + full.author_handle : "Tuit"))}</b>`;
  const handle = full.author_handle ? `<button class="link" data-author="${esc(full.author_handle)}" title="Filtrar por @${esc(full.author_handle)}">@${esc(full.author_handle)}</button> · ` : "";
  const saved = full.imported_at ? fmtDate(new Date(full.imported_at.replace(" ", "T") + "Z")) : "";

  d.innerHTML = `
    <div class="content" tabindex="-1">
      <button class="tbtn icon m-close" data-d="close" title="Cerrar (Esc)" aria-label="Cerrar">${icon("close")}</button>
      ${isArticle && full.article_image ? `<img class="hero" src="${esc(pic(full.article_image))}" alt="" onerror="this.remove()">` : ""}
      <article class="page">
      ${isArticle ? `
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
        ${full.thread?.length ? threadFlow(full) : `<div class="lead ${full.tweet_text.length > 280 ? "long" : ""}">${tweetProse(full.tweet_text)}</div>${linkList(full)}${mediaBig(full.media, full.tweet_url)}`}
        ${quoteBlock(full.quoted)}`}
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
          ${verEnX}
          ${keepQuoted}
          <button class="btn wide danger" data-d="delete">${icon("trash")}<span>Eliminar de la estantería</span></button>
        </div>

        ${isArticle ? `<section>
          <h3>El tuit</h3>
          <div class="origin">
            <div class="o-who">${avatar(full)}<div class="o-name">${who}<span>${handle}${fmtDate(tweetDate(full.id))}</span></div></div>
            <div class="o-text">${linkify(full.tweet_text)}</div>
            ${full.media.length ? `<div class="media-row">${full.media.map((m) => mediaItem(m, full.tweet_url)).join("")}</div>` : ""}
            ${quoteBlock(full.quoted)}
            ${threadBlock(full)}
          </div>
        </section>` : ""}

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
}

// ------------------------------------------------------------------ eventos

const closeMenus = () => document.querySelectorAll(".menu.open").forEach((m) => m.classList.remove("open"));

document.addEventListener("click", async (e) => {
  const t = e.target;
  const menuBtn = t.closest("[data-menu]");
  if (!menuBtn && !t.closest(".menu")) closeMenus();
  if (menuBtn) {
    const menu = menuBtn.nextElementSibling;
    const open = !menu.classList.contains("open");
    closeMenus();
    menu.classList.toggle("open", open);
    return;
  }
  const v = t.closest("[data-view]");
  if (v) { state.view = v.dataset.view; $("#sidebar").classList.remove("open"); return refresh(); }
  const lay = t.closest("[data-layout]");
  if (lay) return setLayout(lay.dataset.layout);
  const clear = t.closest("[data-clear]");
  if (clear) { state[clear.dataset.clear] = ""; if (clear.dataset.clear === "q") $("#q").value = ""; return refresh(); }
  const tag = t.closest("[data-tag]");
  if (tag) { e.stopPropagation(); state.tag = state.tag === tag.dataset.tag ? "" : tag.dataset.tag; return refresh(); }
  const au = t.closest("[data-author]");
  if (au) { if (state.open) closeDrawer(); state.author = state.author === au.dataset.author ? "" : au.dataset.author; return refresh(); }

  const act = t.closest("[data-act]");
  if (act) {
    e.stopPropagation();
    const it = state.items[act.closest(".card").dataset.i];
    if (act.dataset.act === "tweet") return window.open(it.tweet_url, "_blank");
    await patch(it, { [act.dataset.act]: !it[act.dataset.act] });
    syncItem(it); loadStats();
    return;
  }
  const open = t.closest("[data-open]");
  if (open) { e.stopPropagation(); return openItem({ id: open.dataset.open }); }
  const c = t.closest(".card");
  if (c) return openItem(state.items[c.dataset.i]);

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
      toast("Te quedas con el citado; el original queda archivado");
      refresh();
      return openItem({ id: r.kept });
    }
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
  const [code, known] = await Promise.all([fetch("/export_x.js").then((r) => r.text()), api("/api/known-ids")]);
  const filled = code.replace("/*__TWEETSHELF_KNOWN__*/null", JSON.stringify(known));
  try {
    await navigator.clipboard.writeText(filled);
    e.target.textContent = "✅ Copiado, pégalo en la consola de X";
  } catch {
    // sin permiso de portapapeles: se abre el script ya relleno para copiarlo a mano
    window.open(URL.createObjectURL(new Blob([filled], { type: "text/plain" })), "_blank");
  }
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
  const field = { f: "favorite", r: "is_read", e: "archived" }[e.key];
  if (field) {
    await patch(it, { [field]: !it[field] }); syncItem(it); loadStats();
    if (state.open) openItem(it);
    toast({ favorite: it.favorite ? "⭐ Favorito" : "Quitado de favoritos", is_read: it.is_read ? "✅ Leído" : "Marcado sin leer", archived: it.archived ? "🗄️ Archivado" : "📤 Desarchivado" }[field]);
  }
});

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.add("hidden"), 1800);
}

refresh();
