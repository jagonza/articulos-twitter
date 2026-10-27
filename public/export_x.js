// Exporta tus guardados o tus «me gusta» de X a un JSON que Tweetshelf sabe importar.
//
// Uso (en Tweetshelf → Importar tienes un botón «Copiar script»):
//   1. Con tu sesión iniciada, abre tus guardados (x.com/i/bookmarks, o Historia → Guardados)
//      o tus me gusta (Historia → Me gusta, o x.com/tu_usuario/likes).
//   2. Abre la consola del navegador (Cmd+Opt+J en Chrome / Cmd+Opt+K en Firefox).
//   3. Pega este script entero (no su nombre) y pulsa Enter.
//      La primera vez Chrome pide escribir `allow pasting` antes de dejarte pegar.
//   4. Al terminar descargará un JSON. Súbelo en Tweetshelf → Importar.
//
// Pide a X la misma lista que está mostrando la página, con todos los datos de cada tuit: texto
// completo, enlaces reales, imágenes, el tuit que cita y los «Artículos» de X. Los tuits citados
// se exportan también como elementos propios. Si X cambia algo y eso falla, recurre a leer la
// página mientras baja sola.
//
// Puedes parar antes con `window.__stopExport = true` en la consola: descargará lo recogido.
// Al final pide uno a uno los tuits largos y los Artículos de X, que en la lista llegan recortados.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = (...a) => console.log("%cTweetshelf", "color:#d9480f;font-weight:bold", ...a);
  // Token público del cliente web de X (el mismo que usa x.com para todas sus peticiones).
  const BEARER = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
  const TIMELINE_RE = /\/i\/api\/graphql\/[^/]+\/(Bookmarks|Likes)\?/;

  const items = new Map();
  let api = null; // cabeceras y «features» de la petición de la lista, para reutilizarlas
  let source = /\/likes/.test(location.pathname) ? "like" : "bookmark";

  // ---------------------------------------------------------------- lectura de tuits de la API

  const unwrap = (r) => (r && r.tweet && !r.legacy ? r.tweet : r);
  const ARTICLE_RE = /\s*https?:\/\/(?:x|twitter)\.com\/i\/article\/\d+\S*/g;

  // Texto entero de un Artículo de X: viene como texto plano o como bloques de contenido.
  function articleText(art) {
    if (!art) return null;
    if (typeof art.plain_text === "string" && art.plain_text.trim()) return art.plain_text.trim();
    const blocks = art.content_state?.blocks;
    if (Array.isArray(blocks)) {
      const t = blocks.map((b) => b?.text || "").filter((x) => x.trim()).join("\n\n").trim();
      if (t) return t;
    }
    return null;
  }

  function toItem(raw, src) {
    const r = unwrap(raw);
    if (!r || !r.legacy || !r.rest_id) return null;
    const u = r.core?.user_results?.result || {};
    const handle = u.core?.screen_name || u.legacy?.screen_name || null;
    const note = r.note_tweet?.note_tweet_results?.result;
    const ents = r.legacy.entities || {};
    const urlEnts = [...(ents.urls || []), ...(note?.entity_set?.urls || [])];
    const quoted = unwrap(r.quoted_status_result?.result);
    const art = r.article?.article_results?.result;
    const fullText = articleText(art);
    let text = note?.text || r.legacy.full_text || "";
    // El enlace al propio artículo es el último t.co del tuit: se quita antes de expandir los demás.
    if (art?.rest_id) text = text.replace(/\s*https:\/\/t\.co\/\w+\s*$/, "");
    // Sustituye los t.co por la URL real y quita los que apuntan a la propia imagen, al artículo o a la cita.
    for (const e of urlEnts) if (e.url && e.expanded_url) text = text.split(e.url).join(e.expanded_url);
    for (const m of ents.media || []) if (m.url) text = text.split(m.url).join("");
    text = text.replace(ARTICLE_RE, "");
    if (quoted?.rest_id) text = text.replace(new RegExp(`\\s*https?://(x|twitter)\\.com/\\S+/status/${quoted.rest_id}\\S*`, "g"), "");
    const links = urlEnts.map((e) => e.expanded_url).filter((l) => l && !/^https?:\/\/(x|twitter)\.com\/i\/article\//.test(l));
    return {
      id: r.rest_id,
      source: src,
      text: text.trim(),
      author_handle: handle,
      author_name: u.core?.name || u.legacy?.name || null,
      author_avatar: u.avatar?.image_url || u.legacy?.profile_image_url_https || null,
      created: r.legacy.created_at ? new Date(r.legacy.created_at).toISOString() : null,
      url: handle ? `https://x.com/${handle}/status/${r.rest_id}` : `https://x.com/i/web/status/${r.rest_id}`,
      links: [...new Set(links)],
      media: (r.legacy.extended_entities?.media || ents.media || []).map((m) => m.media_url_https).filter(Boolean),
      quoted_id: quoted?.rest_id || null,
      x_article: art?.rest_id ? {
        url: `https://x.com/i/article/${art.rest_id}`,
        title: art.title || null,
        excerpt: art.preview_text || null,
        text: fullText,
        image: art.cover_media?.media_info?.original_img_url || null,
      } : null,
      // En las listas X sólo manda el principio de los tuits largos y de los artículos: luego se pide el resto.
      _needsFull: Boolean((art?.rest_id && !fullText) || (r.note_tweet && !note?.text)
        || (!note?.text && (r.legacy.full_text || "").length >= 250)),
      _quoted: quoted,
    };
  }

  function addTweet(raw, src) {
    const it = toItem(raw, src);
    if (!it) return false;
    const quoted = it._quoted;
    delete it._quoted;
    if (!it._needsFull) delete it._needsFull;
    const isNew = !items.has(it.id);
    // Un tuit que ya teníamos como citado gana la fuente principal si además está en la lista.
    if (isNew || items.get(it.id).source === "quoted") items.set(it.id, it);
    if (quoted && !items.has(quoted.rest_id)) addTweet(quoted, "quoted");
    return isNew;
  }

  // Recorre la respuesta buscando las entradas de tuits y el cursor de la página siguiente.
  function parsePage(json) {
    let added = 0, cursor = null;
    (function walk(o) {
      if (!o || typeof o !== "object") return;
      if (Array.isArray(o)) return o.forEach(walk);
      if (typeof o.entryId === "string") {
        if (o.entryId.startsWith("cursor-bottom")) cursor = o.content?.value || o.content?.itemContent?.value || cursor;
        const tr = o.content?.itemContent?.tweet_results?.result;
        if (tr && addTweet(tr, source)) added++;
      }
      for (const k in o) if (k !== "tweet_results") walk(o[k]);
    })(json);
    return { added, cursor };
  }

  // ---------------------------------------------------------------- localizar la petición que usa la página

  function findInPerformance() {
    const urls = performance.getEntriesByType("resource").map((e) => e.name).filter((n) => TIMELINE_RE.test(n));
    return urls.pop() || null;
  }

  async function captureByScrolling() {
    let captured = null;
    const origFetch = window.fetch;
    const origOpen = XMLHttpRequest.prototype.open;
    window.fetch = function (input, init) {
      const u = typeof input === "string" ? input : input?.url;
      if (u && TIMELINE_RE.test(u)) captured = new URL(u, location.href).href;
      return origFetch.apply(this, arguments);
    };
    XMLHttpRequest.prototype.open = function (method, u) {
      if (u && TIMELINE_RE.test(u)) captured = new URL(u, location.href).href;
      return origOpen.apply(this, arguments);
    };
    try {
      for (let i = 0; i < 25 && !captured; i++) {
        window.scrollBy(0, window.innerHeight * 2);
        await sleep(800);
      }
    } finally {
      window.fetch = origFetch;
      XMLHttpRequest.prototype.open = origOpen;
      window.scrollTo(0, 0);
    }
    return captured;
  }

  async function exportViaApi() {
    const template = findInPerformance() || (await captureByScrolling());
    if (!template) throw new Error("no encuentro la petición de la lista");
    const url = new URL(template);
    source = /\/Likes\?/.test(url.pathname + "?") ? "like" : "bookmark";
    const variables = JSON.parse(url.searchParams.get("variables") || "{}");
    delete variables.cursor;
    variables.count = 100;
    const csrf = document.cookie.match(/(?:^|;\s*)ct0=([^;]+)/)?.[1];
    const headers = {
      authorization: `Bearer ${BEARER}`,
      "x-csrf-token": csrf,
      "x-twitter-auth-type": "OAuth2Session",
      "x-twitter-active-user": "yes",
      "content-type": "application/json",
    };
    api = { headers, features: JSON.parse(url.searchParams.get("features") || "{}") };
    log(`Exportando ${source === "like" ? "me gusta" : "guardados"} desde la API de X…`);
    let cursor = null, emptyPages = 0;
    while (!window.__stopExport) {
      if (cursor) variables.cursor = cursor;
      url.searchParams.set("variables", JSON.stringify(variables));
      const r = await fetch(url.href, { headers, credentials: "include" });
      if (r.status === 429) {
        const reset = Number(r.headers.get("x-rate-limit-reset")) * 1000;
        const wait = Math.min(Math.max(reset - Date.now(), 30000), 15 * 60000);
        log(`X pide esperar; sigo en ${Math.round(wait / 60000)} min…`);
        await sleep(wait);
        continue;
      }
      if (!r.ok) throw new Error(`X respondió ${r.status}`);
      const page = parsePage(await r.json());
      log(`${items.size} tuits recogidos…`);
      emptyPages = page.added ? 0 : emptyPages + 1;
      if (!page.cursor || page.cursor === cursor || emptyPages >= 2) break;
      cursor = page.cursor;
      await sleep(1200);
    }
  }

  // ---------------------------------------------------------------- texto completo de tuits largos y artículos

  // Las peticiones internas de X se identifican por un queryId que cambia con cada versión de x.com.
  // Se busca en el código ya cargado (módulos de webpack) y, si no, en los .js de la página.
  const OPS = ["TweetResultByRestId", "TweetDetail"];
  const opRe = (op) => new RegExp(`queryId:\\s*"([\\w-]+)"[^{}]{0,300}?operationName:\\s*"${op}"|operationName:\\s*"${op}"[^{}]{0,300}?queryId:\\s*"([\\w-]+)"`);

  function searchCode(code, found) {
    for (const op of OPS) {
      if (found[op] || !code.includes(op)) continue;
      const m = code.match(opRe(op));
      if (m) found[op] = m[1] || m[2];
    }
  }

  async function findTweetQuery() {
    const found = {};
    for (const key of Object.keys(window).filter((k) => k.startsWith("webpackChunk"))) {
      for (const chunk of window[key] || []) {
        for (const fn of Object.values(chunk?.[1] || {})) {
          try { searchCode(String(fn), found); } catch { /* módulo ilegible */ }
        }
      }
    }
    if (!found[OPS[0]]) {
      const urls = new Set([
        ...[...document.querySelectorAll("script[src], link[href$='.js']")].map((e) => e.src || e.href),
        ...performance.getEntriesByType("resource").map((e) => e.name),
      ].filter((n) => /abs\.twimg\.com\/.+\.js/.test(n)));
      for (const src of [...urls].sort((x, y) => /\/main\./.test(y) - /\/main\./.test(x))) {
        try { searchCode(await (await fetch(src)).text(), found); } catch { /* probamos el siguiente */ }
        if (found[OPS[0]]) break;
      }
    }
    const op = OPS.find((o) => found[o]);
    return op ? { op, qid: found[op] } : null;
  }

  // Busca en una respuesta el tuit con ese id (TweetDetail devuelve la conversación entera).
  function findTweet(json, id) {
    let hit = null;
    (function walk(o) {
      if (hit || !o || typeof o !== "object") return;
      const t = unwrap(o);
      if (t?.rest_id === id && t.legacy) { hit = t; return; }
      for (const k in o) walk(o[k]);
    })(json);
    return hit;
  }

  async function fetchFullTweet({ op, qid }, id) {
    const features = { ...api.features };
    const variables = op === "TweetDetail"
      ? { focalTweetId: id, with_rux_injections: false, rankingMode: "Relevance", includePromotedContent: false,
          withCommunity: true, withQuickPromoteEligibilityTweetFields: false, withBirdwatchNotes: false, withVoice: true }
      : { tweetId: id, withCommunity: false, includePromotedContent: false, withVoice: false };
    for (let attempt = 0; attempt < 4; attempt++) {
      const q = new URLSearchParams({
        variables: JSON.stringify(variables),
        features: JSON.stringify(features),
        fieldToggles: JSON.stringify({ withArticleRichContentState: true, withArticlePlainText: true }),
      });
      const r = await fetch(`/i/api/graphql/${qid}/${op}?${q}`, { headers: api.headers, credentials: "include" });
      if (r.status === 429) {
        const reset = Number(r.headers.get("x-rate-limit-reset")) * 1000;
        const wait = Math.min(Math.max(reset - Date.now(), 30000), 15 * 60000);
        log(`X pide esperar; sigo en ${Math.round(wait / 60000)} min…`);
        await sleep(wait);
        continue;
      }
      const body = await r.json().catch(() => null);
      // Si a la petición le falta algún «feature» X dice cuáles: se añaden y se repite.
      const missing = (body?.errors || []).flatMap((e) => (e.message || "").match(/features cannot be null: (.+)/)?.[1].split(/,\s*/) || []);
      if (!r.ok && missing.length) { missing.forEach((f) => (features[f.trim()] = true)); continue; }
      if (!r.ok) throw new Error(`X respondió ${r.status}`);
      return findTweet(body?.data, id);
    }
    return null;
  }

  async function completeTexts() {
    const pending = [...items.values()].filter((it) => it._needsFull);
    if (!pending.length || !api) return;
    const query = await findTweetQuery();
    if (!query) {
      log("No encuentro cómo pedir los tuits completos; algunos textos largos quedarán recortados.",
        "Prueba a abrir un tuit cualquiera, volver a esta lista y lanzar el script otra vez.");
      return;
    }
    log(`Pidiendo el texto completo de ${pending.length} tuits largos o con artículo…`);
    let done = 0, fixed = 0;
    for (const it of pending) {
      if (window.__stopExport) break;
      try {
        const full = toItem(await fetchFullTweet(query, it.id), it.source);
        if (full) {
          if (full.text && full.text !== it.text) { it.text = full.text; it.links = full.links; fixed++; }
          if (full.x_article?.text) {
            const fresh = Object.fromEntries(Object.entries(full.x_article).filter(([, v]) => v));
            it.x_article = { ...it.x_article, ...fresh };
            fixed++;
          }
        }
      } catch (e) { log(`No he podido completar ${it.id}: ${e.message}`); }
      if (++done % 10 === 0) log(`${done}/${pending.length} completados…`);
      await sleep(700);
    }
    log(`Textos completados: ${fixed}.`);
  }

  // ---------------------------------------------------------------- plan B: leer la página mientras baja

  async function exportViaPage() {
    log("Leyendo la página mientras baja…");
    let idle = 0;
    while (idle < 8 && !window.__stopExport) {
      const before = items.size;
      document.querySelectorAll('article[data-testid="tweet"]').forEach((a) => {
        const timeLink = a.querySelector('a[href*="/status/"] time')?.closest("a");
        const m = timeLink?.getAttribute("href")?.match(/^\/([^/]+)\/status\/(\d+)/);
        if (!m || items.has(m[2])) return;
        const links = new Set();
        a.querySelectorAll('[data-testid="tweetText"] a[href], [data-testid="card.wrapper"] a[href]').forEach((l) => {
          if (!/^https?:\/\/(x|twitter)\.com\//.test(l.href)) links.add(l.href);
        });
        const xArticle = a.querySelector('a[href*="/article/"]');
        const articleTitle = xArticle?.innerText.split("\n").map((t) => t.trim()).find((t) => t.length > 3 && t !== "Artículo" && t !== "Article");
        items.set(m[2], {
          id: m[2],
          source,
          author_handle: m[1],
          author_name: a.querySelector('[data-testid="User-Name"] span')?.innerText || null,
          author_avatar: a.querySelector('[data-testid="Tweet-User-Avatar"] img')?.src || null,
          created: timeLink.querySelector("time")?.getAttribute("datetime"),
          url: `https://x.com/${m[1]}/status/${m[2]}`,
          text: [a.querySelector('[data-testid="tweetText"]')?.innerText, articleTitle && `📰 ${articleTitle}`].filter(Boolean).join("\n\n"),
          links: [...links],
          media: [...a.querySelectorAll('[data-testid="tweetPhoto"] img')].map((i) => i.src.replace(/name=\w+/, "name=large")),
        });
      });
      window.scrollBy(0, window.innerHeight * 0.9);
      await sleep(1200);
      idle = items.size === before ? idle + 1 : 0;
      log(`${items.size} tuits recogidos…`);
    }
  }

  try {
    await exportViaApi();
  } catch (e) {
    log(`No he podido usar la API de X (${e.message}).`);
    if (!items.size) await exportViaPage();
  }
  window.__stopExport = false; // parar la lista no impide completar lo recogido
  try {
    await completeTexts();
  } catch (e) {
    log(`No he podido completar los textos largos (${e.message}).`);
  }

  const list = [...items.values()];
  list.forEach((it) => delete it._needsFull);
  const quotedCount = list.filter((i) => i.source === "quoted").length;
  const blob = new Blob([JSON.stringify({ source, exported_at: new Date().toISOString(), items: list }, null, 2)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(blob),
    download: `${source === "like" ? "megusta" : "guardados"}-${new Date().toISOString().slice(0, 10)}.json`,
  });
  document.body.appendChild(a);
  a.click();
  log(`Listo: ${list.length - quotedCount} ${source === "like" ? "me gusta" : "guardados"} y ${quotedCount} tuits citados exportados.`);
})();
