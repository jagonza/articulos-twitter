// Exporta tus guardados o tus «me gusta» de X a un JSON que Tweetshelf sabe importar.
//
// Uso (en Tweetshelf → Importar tienes un botón «Copiar script»):
//   1. Con tu sesión iniciada, abre tus guardados (x.com/i/bookmarks, o Historia → Guardados)
//      o tus me gusta (Historia → Me gusta, o x.com/tu_usuario/likes).
//   2. Abre la consola del navegador (Cmd+Opt+J en Chrome / Cmd+Opt+K en Firefox).
//   3. Pega este script entero (no su nombre) y pulsa Enter.
//      La primera vez Chrome pide escribir `allow pasting` antes de dejarte pegar.
//   4. Te pregunta cuántos exportar (los más recientes primero; vacío = todos). Así puedes ir por
//      tandas: importas, los quitas de X con «Limpiar X» y repites.
//   5. Al terminar descargará un JSON. Súbelo en Tweetshelf → Importar.
//
// Pide a X la misma lista que está mostrando la página, con todos los datos de cada tuit: texto
// completo, enlaces reales, imágenes, el tuit que cita y los «Artículos» de X. Los tuits citados
// se exportan también como elementos propios. Si X cambia algo y eso falla, recurre a leer la
// página mientras baja sola.
//
// Puedes parar antes con `window.__stopExport = true` en la consola: descargará lo recogido.
// Al final abre la conversación de cada tuit con respuestas para ver si el autor sigue un hilo, y pide los
// tuits largos y los Artículos de X, que en la lista llegan recortados.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = (...a) => console.log("%cTweetshelf", "color:#d9480f;font-weight:bold", ...a);
  // Token público del cliente web de X (el mismo que usa x.com para todas sus peticiones).
  const BEARER = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
  const TIMELINE_RE = /\/i\/api\/graphql\/[^/]+\/(Bookmarks|Likes)\?/;

  const items = new Map();
  let api = null; // cabeceras y «features» de la petición de la lista, para reutilizarlas
  let source = /\/likes/.test(location.pathname) ? "like" : "bookmark";
  // Se puede exportar por tandas: los N más recientes (los que salen primero en la lista).
  const answer = prompt("Tweetshelf: ¿cuántos exporto? Los más recientes primero. Déjalo vacío para exportarlos todos.", "30");
  if (answer === null) return log("Cancelado.");
  const LIMIT = Math.max(0, parseInt(answer, 10) || 0);
  const isFull = () => LIMIT > 0 && [...items.values()].filter((i) => i.source !== "quoted").length >= LIMIT;

  // ---------------------------------------------------------------- lectura de tuits de la API

  const unwrap = (r) => (r && r.tweet && !r.legacy ? r.tweet : r);
  const ARTICLE_RE = /\s*https?:\/\/(?:x|twitter)\.com\/i\/article\/\d+\S*/g;

  // Texto entero de un Artículo de X en Markdown (títulos, listas, negritas, enlaces e imágenes). Viene como
  // bloques de contenido al estilo Draft.js; si no, como texto plano.
  const STYLE_MD = { BOLD: "**", ITALIC: "*", STRIKETHROUGH: "~~" };
  const BLOCK_MD = { "header-one": "# ", "header-two": "## ", "header-three": "### ", "header-four": "#### ",
    "unordered-list-item": "- ", "ordered-list-item": "1. ", blockquote: "> " };

  function inlineMd(block, entity) {
    const text = block.text || "";
    const spans = [];
    const wrap = (offset, length, before, after) => {
      // Sin espacios dentro de las marcas, que Markdown no las entiende así.
      let start = offset, end = offset + length;
      while (start < end && /\s/.test(text[start])) start++;
      while (end > start && /\s/.test(text[end - 1])) end--;
      if (end > start) spans.push({ start, end, before, after });
    };
    for (const r of block.entityRanges || []) {
      const e = entity(r.key);
      const url = e?.data?.url || e?.data?.href;
      if (/^LINK$/i.test(e?.type || "") && /^https?:/.test(url || "")) wrap(r.offset, r.length, "[", `](${url})`);
    }
    for (const r of block.inlineStyleRanges || []) {
      const md = STYLE_MD[String(r.style).toUpperCase()];
      if (md) wrap(r.offset, r.length, md, md);
    }
    // Las marcas se anidan: la que abre antes (o es más larga) cierra después. Las que se solapan se recortan.
    spans.sort((x, y) => x.start - y.start || y.end - x.end);
    const stack = [];
    for (const sp of spans) {
      while (stack.length && stack[stack.length - 1].end <= sp.start) stack.pop();
      if (stack.length && sp.end > stack[stack.length - 1].end) sp.end = stack[stack.length - 1].end;
      stack.push(sp);
    }
    const open = Array.from({ length: text.length + 1 }, () => "");
    const close = Array.from({ length: text.length + 1 }, () => "");
    for (const sp of spans) {
      open[sp.start] += sp.before;
      close[sp.end] = sp.after + close[sp.end];
    }
    let out = "";
    for (let i = 0; i <= text.length; i++) out += close[i] + open[i] + (text[i] ?? "");
    return out;
  }

  function articleText(art) {
    if (!art) return null;
    const blocks = art.content_state?.blocks;
    if (Array.isArray(blocks) && blocks.length) {
      const map = art.content_state.entityMap || {};
      const entities = Array.isArray(map) ? Object.fromEntries(map.map((e) => [String(e.key), e.value])) : map;
      const entity = (k) => entities[String(k)] || null;
      const mediaUrl = {};
      for (const m of art.media_entities || []) {
        const url = m.media_info?.original_img_url || m.media_info?.preview_image?.original_img_url || m.media_url_https;
        if (url) for (const k of [m.media_id, m.media_key, m.id]) if (k) mediaUrl[String(k)] = url;
      }
      const out = [];
      let prevList = null;
      for (const b of blocks) {
        if (b.type === "atomic") {
          for (const r of b.entityRanges || []) {
            const e = entity(r.key);
            const type = String(e?.type || "").toUpperCase();
            if (type === "MEDIA" || type === "IMAGE") {
              for (const it of e.data?.mediaItems || [{ mediaId: e.data?.mediaId }]) {
                const url = mediaUrl[String(it.mediaId)] || mediaUrl[String(it.localMediaId)] || e.data?.url || e.data?.src;
                if (url) out.push(`![${(e.data?.caption || "").replace(/[\[\]]/g, "")}](${url})`);
              }
            } else if (type === "DIVIDER") out.push("---");
            else if (type === "TWEET" && e.data?.tweetId) out.push(`https://x.com/i/status/${e.data.tweetId}`);
          }
          prevList = null;
          continue;
        }
        if (!(b.text || "").trim()) { prevList = null; continue; }
        const isList = /list-item$/.test(b.type);
        const line = (BLOCK_MD[b.type] || "") + inlineMd(b, entity);
        if (b.type === "code-block") out.push("```\n" + b.text + "\n```");
        // Los elementos de una lista van seguidos; el resto, en párrafos.
        else if (isList && prevList === b.type) out[out.length - 1] += "\n" + line;
        else out.push(line);
        prevList = isList ? b.type : null;
      }
      const md = out.join("\n\n").trim();
      if (md) return md;
    }
    if (typeof art.plain_text === "string" && art.plain_text.trim()) return art.plain_text.trim();
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
      _threadRoot: src === "quoted" ? null : threadRoot(r),
      _quoted: quoted,
    };
  }

  // ¿Es parte de un hilo del propio autor? Devuelve el id del primer tuit del hilo.
  function threadRoot(r) {
    const L = r.legacy;
    const authorId = L.user_id_str || r.core?.user_results?.result?.rest_id;
    if (L.self_thread?.id_str) return L.self_thread.id_str;
    if (L.in_reply_to_user_id_str && L.in_reply_to_user_id_str === authorId) return L.conversation_id_str || null;
    // La lista no trae las respuestas: cualquier tuit con respuestas puede tener continuación del autor, y sólo
    // abriendo su conversación se sabe.
    return L.reply_count === 0 ? null : r.rest_id;
  }

  function addTweet(raw, src) {
    const it = toItem(raw, src);
    if (!it) return false;
    const quoted = it._quoted;
    delete it._quoted;
    if (!it._needsFull) delete it._needsFull;
    if (!it._threadRoot) delete it._threadRoot;
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
        if (tr && !isFull() && addTweet(tr, source)) added++;
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
      if (isFull() || !page.cursor || page.cursor === cursor || emptyPages >= 2) break;
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
    if (!OPS.every((o) => found[o])) {
      const urls = new Set([
        ...[...document.querySelectorAll("script[src], link[href$='.js']")].map((e) => e.src || e.href),
        ...performance.getEntriesByType("resource").map((e) => e.name),
      ].filter((n) => /abs\.twimg\.com\/.+\.js/.test(n)));
      for (const src of [...urls].sort((x, y) => /\/main\./.test(y) - /\/main\./.test(x))) {
        try { searchCode(await (await fetch(src)).text(), found); } catch { /* probamos el siguiente */ }
        if (OPS.every((o) => found[o])) break;
      }
    }
    return found;
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

  async function gql(op, qid, variables) {
    const features = { ...api.features };
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
      return body?.data || null;
    }
    return null;
  }

  const detailVars = (id) => ({ focalTweetId: id, with_rux_injections: false, rankingMode: "Relevance", includePromotedContent: false,
    withCommunity: true, withQuickPromoteEligibilityTweetFields: false, withBirdwatchNotes: false, withVoice: true });

  async function fetchFullTweet(found, id) {
    if (found.TweetResultByRestId) {
      return findTweet(await gql("TweetResultByRestId", found.TweetResultByRestId,
        { tweetId: id, withCommunity: false, includePromotedContent: false, withVoice: false }), id);
    }
    return findTweet(await gql("TweetDetail", found.TweetDetail, detailVars(id)), id);
  }

  // Pasa a un elemento lo que trae la versión completa de su tuit (texto entero y cuerpo del artículo).
  function applyFull(it, full) {
    if (!full) return false;
    let fixed = false;
    if (full.text && full.text !== it.text) { it.text = full.text; it.links = full.links; fixed = true; }
    if (full.x_article?.text) {
      const fresh = Object.fromEntries(Object.entries(full.x_article).filter(([, v]) => v));
      it.x_article = { ...it.x_article, ...fresh };
      fixed = true;
    }
    return fixed;
  }

  // Hilos: pide la conversación y sigue la cadena de respuestas del autor a sí mismo desde el primer tuit.
  async function fetchThreads(found) {
    const pending = [...items.values()].filter((it) => it._threadRoot);
    if (!pending.length) return;
    if (!found.TweetDetail) {
      log(`Hay ${pending.length} posibles hilos, pero no encuentro cómo pedirlos.`,
        "Abre un tuit cualquiera, vuelve a esta lista y lanza el script otra vez.");
      return;
    }
    log(`Revisando si ${pending.length} tuits con respuestas son hilos…`);
    let threads = 0, done = 0;
    for (const it of pending) {
      if (window.__stopExport) break;
      try {
        const data = await gql("TweetDetail", found.TweetDetail, detailVars(it._threadRoot));
        const byId = {};
        (function walk(o) {
          if (!o || typeof o !== "object") return;
          const t = unwrap(o);
          if (t?.rest_id && t.legacy && !byId[t.rest_id]) byId[t.rest_id] = t;
          for (const k in o) walk(o[k]);
        })(data);
        const authorOf = (t) => t.legacy.user_id_str || t.core?.user_results?.result?.rest_id;
        const chain = [];
        let cur = byId[it._threadRoot];
        while (cur && chain.length < 100) {
          chain.push(cur);
          const prev = cur;
          cur = Object.values(byId).find((t) => t.legacy.in_reply_to_status_id_str === prev.rest_id && authorOf(t) === authorOf(prev));
        }
        if (chain.length > 1 && chain.some((t) => t.rest_id === it.id)) {
          it.thread = chain.map((t) => toItem(t, it.source)).map((t) => ({ id: t.id, text: t.text, media: t.media, links: t.links }));
          threads++;
        }
        if (it._needsFull && byId[it.id] && applyFull(it, toItem(byId[it.id], it.source))) delete it._needsFull;
      } catch (e) { log(`No he podido traer el hilo de ${it.id}: ${e.message}`); }
      if (++done % 10 === 0) log(`${done}/${pending.length} revisados…`);
      await sleep(700);
    }
    log(`Hilos encontrados: ${threads}.`);
  }

  async function completeTexts(found) {
    const pending = [...items.values()].filter((it) => it._needsFull);
    if (!pending.length) return;
    if (!found.TweetResultByRestId && !found.TweetDetail) {
      log("No encuentro cómo pedir los tuits completos; algunos textos largos quedarán recortados.",
        "Abre un tuit cualquiera, vuelve a esta lista y lanza el script otra vez.");
      return;
    }
    log(`Pidiendo el texto completo de ${pending.length} tuits largos o con artículo…`);
    let done = 0, fixed = 0;
    for (const it of pending) {
      if (window.__stopExport) break;
      try {
        if (applyFull(it, toItem(await fetchFullTweet(found, it.id), it.source))) fixed++;
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
    while (idle < 8 && !window.__stopExport && !isFull()) {
      const before = items.size;
      document.querySelectorAll('article[data-testid="tweet"]').forEach((a) => {
        const timeLink = a.querySelector('a[href*="/status/"] time')?.closest("a");
        const m = timeLink?.getAttribute("href")?.match(/^\/([^/]+)\/status\/(\d+)/);
        if (!m || items.has(m[2]) || isFull()) return;
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
          // Los vídeos van en videoPlayer; su póster es la miniatura *_video_thumb, que la app reconoce.
          media: [
            ...[...a.querySelectorAll('[data-testid="tweetPhoto"] img')].map((i) => i.src.replace(/name=\w+/, "name=large")),
            ...[...a.querySelectorAll('[data-testid="videoPlayer"] video[poster]')].map((v) => v.poster),
          ].filter((u, i, all) => u && all.indexOf(u) === i),
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
  if (api) {
    try {
      const found = await findTweetQuery();
      await fetchThreads(found);
      await completeTexts(found);
    } catch (e) {
      log(`No he podido completar los textos largos o los hilos (${e.message}).`);
    }
  }

  const list = [...items.values()];
  list.forEach((it) => { delete it._needsFull; delete it._threadRoot; });
  const quotedCount = list.filter((i) => i.source === "quoted").length;
  const blob = new Blob([JSON.stringify({ source, exported_at: new Date().toISOString(), items: list }, null, 2)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(blob),
    download: `${source === "like" ? "megusta" : "guardados"}-${new Date().toISOString().slice(0, 10)}.json`,
  });
  document.body.appendChild(a);
  a.click();
  const threadCount = list.filter((i) => i.thread).length;
  log(`Listo: ${list.length - quotedCount} ${source === "like" ? "me gusta" : "guardados"} y ${quotedCount} tuits citados exportados${threadCount ? `, con ${threadCount} hilos` : ""}.`);
})();
