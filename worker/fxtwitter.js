// Añadir por enlace: trae un tuit con su hilo, su cita y el texto entero de sus Artículos de X.
//
// Fuente principal: FxTwitter (proyecto abierto, sin clave): /2/thread/<id> trae el hilo completo y el texto de los
// Artículos. Si falla, la syndication de X sirve el tuit suelto, sin hilo ni cuerpo del Artículo.
// El texto de los Artículos se convierte a Markdown igual que en public/export_x.js (ver el comentario allí):
// aquí se duplica porque export_x.js se pega en la consola de X y no puede importar nada.

const UA = "Tweetshelf/1.0";

const STYLE_MD = { BOLD: "**", ITALIC: "*", STRIKETHROUGH: "~~" };
const BLOCK_MD = { "header-one": "# ", "header-two": "## ", "header-three": "### ", "header-four": "#### ",
  "unordered-list-item": "- ", "ordered-list-item": "1. ", blockquote: "> " };

function inlineMd(block, entity) {
  const text = block.text || "";
  const spans = [];
  const wrap = (offset, length, before, after) => {
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

// content: { blocks, entityMap } (Draft.js); media: la lista de imágenes del Artículo.
export function articleMarkdown(content, media = []) {
  const blocks = content?.blocks;
  if (!Array.isArray(blocks) || !blocks.length) return null;
  const map = content.entityMap || {};
  const entities = Array.isArray(map) ? Object.fromEntries(map.map((e) => [String(e.key), e.value])) : map;
  const entity = (k) => entities[String(k)] || null;
  // Si la forma de media no casa, la imagen se omite sin romper el resto.
  const mediaUrl = {};
  for (const m of Array.isArray(media) ? media : []) {
    const url = m?.media_info?.original_img_url || m?.media_info?.preview_image?.original_img_url || m?.media_url_https;
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
  // Si no sale nada con formato, al menos el texto de los bloques.
  return md || blocks.map((b) => b.text || "").filter((t) => t.trim()).join("\n\n").trim() || null;
}

// Tuit con forma de FxTwitter (o de la syndication, ya normalizado a esa forma) → elemento de Tweetshelf.
const linksIn = (text) => (String(text || "").match(/https?:\/\/[^\s<>"'”)]+/g) || [])
  .map((u) => u.replace(/[.,;:!?…]+$/, ""))
  // Los t.co de X no llevan nada útil fuera de X: se descartan.
  .filter((u) => !/^https?:\/\/(www\.|mobile\.)?(x|twitter)\.com(\/|$)|^https:\/\/t\.co\//.test(u));
const onlyX = (urls) => urls.filter((u) => /^https:\/\/pbs\.twimg\.com\//.test(u || ""));

function created(t) {
  const d = t.created_timestamp ? new Date(t.created_timestamp * 1000) : new Date(t.created_at);
  return isNaN(d) ? null : d.toISOString();
}

function articleOf(art) {
  if (!art?.id) return null;
  const text = articleMarkdown(art.content, art.media_entities);
  return {
    url: `https://x.com/i/article/${art.id}`,
    title: art.title || null,
    excerpt: art.preview_text || null,
    text,
    image: art.cover_media?.media_info?.original_img_url || art.cover_media?.media_url_https || null,
  };
}

function toElement(t, source) {
  const handle = t.author?.screen_name || null;
  const id = String(t.id);
  return {
    id, source,
    tweet_text: String(t.text || ""),
    author_handle: handle,
    author_name: t.author?.name || null,
    author_avatar: t.author?.avatar_url || null,
    tweet_created: created(t),
    tweet_url: handle ? `https://x.com/${handle}/status/${id}` : `https://x.com/i/web/status/${id}`,
    urls: linksIn(t.text),
    media: onlyX([...(t.media?.photos || []).map((p) => p.url),
      ...(t.media?.videos || []).map((v) => v.thumbnail_url)]),
    quoted_id: t.quote?.id ? String(t.quote.id) : null,
    x_article: articleOf(t.article),
    thread: null,
  };
}

// Respuesta de FxTwitter (/2/thread/<id>) → elementos: el tuit pedido (con su hilo, si lo hay) y su cita.
export function itemsFromFx(data) {
  if (data?.code !== 200 || !data.status || data.status.type === "tombstone") throw new Error("FxTwitter sin tuit");
  const main = data.status;
  const author = main.author?.screen_name;
  // El hilo son los tuits del mismo autor, en orden; el pedido va dentro. Con menos de dos no es hilo.
  const same = (data.thread || []).filter((t) => t?.id && t.author?.screen_name === author);
  const item = toElement(main, "link");
  if (same.length >= 2) {
    item.thread = same.map((t) => ({
      id: String(t.id), text: String(t.text || ""),
      media: onlyX([...(t.media?.photos || []).map((p) => p.url), ...(t.media?.videos || []).map((v) => v.thumbnail_url)]),
      links: linksIn(t.text),
    }));
  }
  const items = [item];
  if (main.quote?.id) items.push(toElement(main.quote, "quoted"));
  return items;
}

async function fromFxTwitter(id) {
  const r = await fetch(`https://api.fxtwitter.com/2/thread/${id}`, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!r.ok) throw new Error(`FxTwitter ${r.status}`);
  return itemsFromFx(await r.json());
}

// Syndication de X (respaldo): sólo el tuit, su cita y la portada del Artículo, sin hilo ni texto del Artículo.
const syndicationToken = (id) => ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");

async function fromSyndication(id) {
  const r = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${syndicationToken(id)}&lang=es`,
    { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!r.ok) throw new Error(`syndication ${r.status}`);
  const t = await r.json();
  if (!t?.id_str) throw new Error("syndication sin tuit");
  // La syndication tiene otra forma: se lleva a la de FxTwitter para usar el mismo conversor.
  const norm = (s) => ({
    id: s.id_str, text: s.text,
    author: { screen_name: s.user?.screen_name, name: s.user?.name, avatar_url: s.user?.profile_image_url_https },
    created_at: s.created_at,
    media: { photos: (s.mediaDetails || []).map((m) => ({ url: m.media_url_https })) },
    quote: s.quoted_tweet?.id_str ? { id: s.quoted_tweet.id_str } : null,
    article: s.article ? { id: s.article.id, title: s.article.title, preview_text: s.article.preview_text,
      cover_media: s.article.cover_media } : null,
  });
  const items = [toElement(norm(t), "link")];
  if (t.quoted_tweet?.id_str) items.push(toElement(norm(t.quoted_tweet), "quoted"));
  return items;
}

// Devuelve los elementos a guardar (el tuit primero) o lanza si ninguna fuente responde.
export async function fetchTweet(id) {
  try {
    return await fromFxTwitter(id);
  } catch {
    return fromSyndication(id);
  }
}
