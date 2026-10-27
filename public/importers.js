// Lee las exportaciones de X/Twitter en el navegador y las convierte en elementos normalizados.
//
// Formatos:
//   * Archivo de datos de X: el .zip completo (sólo se leen like.js / bookmark.js, aunque pese gigas) o el .js suelto
//   * JSON de public/export_x.js (guardados o me gusta, con tuits citados y Artículos de X)
//   * JSON/CSV de exportadores populares (twitter-web-exporter, respuestas GraphQL…)

// zip.js 2.22.1 (BSD-3) servido desde /vendor para no depender de un CDN.
const ZIPJS = "/vendor/zip.min.js";
const URL_RE = /https?:\/\/[^\s<>"'”)]+/g;
const TWITTER_HOSTS = new Set(["twitter.com", "x.com", "mobile.twitter.com", "pic.twitter.com", "pic.x.com"]);

export const isTwitterUrl = (u) => {
  try { return TWITTER_HOSTS.has(new URL(u).hostname.replace(/^www\./, "")); } catch { return false; }
};
const linksIn = (text) => (String(text || "").match(URL_RE) || []).map((u) => u.replace(/[.,;:!?…]+$/, ""));

function item(id, text, source, kw = {}) {
  id = String(id);
  const urls = [...new Set(kw.urls ?? linksIn(text))].filter((u) => u && typeof u === "string" && !isTwitterUrl(u));
  const handle = (kw.author_handle || "").replace(/^@/, "") || null;
  return {
    id, source, tweet_text: text || "",
    author_handle: handle, author_name: kw.author_name || null, author_avatar: kw.author_avatar || null,
    tweet_created: kw.tweet_created || null,
    tweet_url: kw.tweet_url || (handle ? `https://x.com/${handle}/status/${id}` : `https://x.com/i/web/status/${id}`),
    urls, media: (kw.media || []).filter((m) => typeof m === "string" && m),
    quoted_id: kw.quoted_id ? String(kw.quoted_id) : null,
    x_article: kw.x_article || null,
    thread: Array.isArray(kw.thread) ? kw.thread : null,
  };
}

// Los .js del archivo de X son `window.YTD.like.part0 = [...]`.
function parseArchiveJs(text, source) {
  const data = JSON.parse(text.slice(text.indexOf("=") + 1).trim().replace(/;$/, ""));
  return data.map((e) => e.like || e.bookmark || e).filter((o) => o.tweetId || o.id)
    .map((o) => item(o.tweetId || o.id, o.fullText || "", source));
}

async function parseZip(file, onStatus) {
  if (!window.zip) {
    await new Promise((ok, fail) => document.head.append(Object.assign(document.createElement("script"), { src: ZIPJS, onload: ok, onerror: fail })));
    window.zip.configure({ useWebWorkers: false });
  }
  const { ZipReader, BlobReader, TextWriter } = window.zip;
  const reader = new ZipReader(new BlobReader(file));
  const out = [];
  try {
    for (const entry of await reader.getEntries()) {
      const base = entry.filename.split("/").pop();
      const source = /^like(-part\d+)?\.js$/.test(base) ? "like" : /^bookmarks?(-part\d+)?\.js$/.test(base) ? "bookmark" : null;
      if (!source) continue;
      onStatus?.(`Leyendo ${entry.filename}…`);
      out.push(...parseArchiveJs(await entry.getData(new TextWriter()), source));
    }
  } finally {
    await reader.close();
  }
  if (!out.length) throw new Error("No encuentro like.js en el .zip");
  return out;
}

const pick = (d, ...keys) => {
  for (const k of keys) {
    const v = k.split(".").reduce((o, p) => (o && typeof o === "object" ? o[p] : undefined), d);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
};

function normalizeGeneric(d, source) {
  const legacy = d.legacy && typeof d.legacy === "object" ? d.legacy : null;
  if (legacy) { // respuesta cruda de la API GraphQL
    const user = pick(d, "core.user_results.result.legacy") || {};
    return item(d.rest_id || legacy.id_str, legacy.full_text || "", source, {
      author_handle: user.screen_name, author_name: user.name, author_avatar: user.profile_image_url_https,
      tweet_created: legacy.created_at,
      urls: (legacy.entities?.urls || []).map((u) => u.expanded_url),
      media: (legacy.extended_entities?.media || []).map((m) => m.media_url_https),
    });
  }
  const id = pick(d, "id", "id_str", "tweet_id", "tweetId", "rest_id");
  if (!id || !/^\d+$/.test(String(id))) return null;
  const text = pick(d, "full_text", "text", "fullText", "content", "tweet_text") || "";
  let urls = pick(d, "links", "urls", "expanded_urls");
  if (typeof urls === "string") urls = urls.split(/[\s,]+/).filter(Boolean);
  urls = Array.isArray(urls) ? urls.map((u) => (typeof u === "object" ? u.expanded_url || u.url : u)) : [];
  urls.push(...linksIn(text));
  let media = pick(d, "media", "images", "photos") || [];
  if (typeof media === "string") media = media.split(/[\s,]+/).filter(Boolean);
  media = media.map((m) => (typeof m === "object" ? m.media_url_https || m.original || m.url : m));
  const url = pick(d, "url", "tweet_url", "link");
  const ownSource = ["like", "bookmark", "quoted"].includes(d.source) ? d.source : source;
  return item(id, text, ownSource, {
    author_handle: pick(d, "author_handle", "screen_name", "username", "user.screen_name", "author.screen_name", "user_handle"),
    author_name: pick(d, "author_name", "name", "user.name", "author.name", "user_name"),
    author_avatar: pick(d, "author_avatar", "profile_image_url", "user.profile_image_url_https", "author.profile_image_url"),
    tweet_created: pick(d, "created_at", "created", "date", "tweet_created"),
    tweet_url: String(url || "").includes("/status/") ? url : null,
    urls, media,
    quoted_id: pick(d, "quoted_id", "quoted_status_id_str", "quoted_tweet_id"),
    x_article: d.x_article && typeof d.x_article === "object" ? d.x_article : null,
    thread: d.thread,
  });
}

function parseCsv(text) {
  const rows = [];
  let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); rows.push(row); row = []; cur = "";
    } else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((x) => x));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i]])));
}

/** Devuelve los elementos normalizados de un fichero subido. */
export async function parseFile(file, onStatus) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".zip")) return parseZip(file, onStatus);
  const text = (await file.text()).replace(/^﻿/, "");
  let guessed = name.includes("bookmark") ? "bookmark" : name.includes("like") ? "like" : null;
  if (text.trimStart().startsWith("window.YTD")) {
    return parseArchiveJs(text, guessed || (text.slice(0, 80).includes("YTD.bookmark") ? "bookmark" : "like"));
  }
  if (name.endsWith(".csv")) return parseCsv(text).map((r) => normalizeGeneric(r, guessed || "bookmark")).filter(Boolean);
  let payload = JSON.parse(text);
  if (!Array.isArray(payload)) {
    guessed = payload.source || guessed;
    payload = payload.items || payload.tweets || payload.data || [];
  }
  return payload.filter((d) => d && typeof d === "object").map((d) => normalizeGeneric(d, guessed || "bookmark")).filter(Boolean);
}
