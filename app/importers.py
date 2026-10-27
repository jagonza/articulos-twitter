"""Convierte los distintos formatos de exportación de X/Twitter en elementos normalizados.

Formatos soportados:
  * Archivo de datos de X (.zip completo o sólo data/like.js / data/bookmark.js)
  * JSON generado por tools/export_bookmarks.js (guardados desde el navegador)
  * JSON/CSV de exportadores populares (p. ej. twitter-web-exporter), por detección de campos
"""
import csv
import io
import json
import re
import zipfile

URL_RE = re.compile(r"https?://[^\s<>\"'”)]+")
TWITTER_HOSTS = ("twitter.com", "x.com", "mobile.twitter.com", "pic.twitter.com", "pic.x.com")


def is_twitter_url(url):
    host = re.sub(r"^https?://(www\.)?", "", url).split("/")[0].lower()
    return host in TWITTER_HOSTS


def links_in(text):
    return [u.rstrip(".,;:!?…") for u in URL_RE.findall(text or "")]


def _item(id, text, source, **kw):
    id = str(id)
    urls = kw.pop("urls", None)
    if urls is None:
        urls = links_in(text)
    urls = [u for u in dict.fromkeys(urls) if u and not is_twitter_url(u)]
    return {
        "id": id,
        "source": source,
        "tweet_text": text or "",
        "author_handle": (kw.get("author_handle") or "").lstrip("@") or None,
        "author_name": kw.get("author_name"),
        "author_avatar": kw.get("author_avatar"),
        "tweet_created": kw.get("tweet_created"),
        "tweet_url": kw.get("tweet_url") or (
            f"https://x.com/{kw['author_handle'].lstrip('@')}/status/{id}" if kw.get("author_handle")
            else f"https://x.com/i/web/status/{id}"),
        "urls": urls,
        "media": [m for m in (kw.get("media") or []) if m],
    }


def _parse_ytd(text):
    """Los .js del archivo de X son `window.YTD.like.part0 = [...]`."""
    return json.loads(text[text.index("=") + 1:].strip().rstrip(";"))


def parse_archive_js(text, source):
    out = []
    for entry in _parse_ytd(text):
        obj = entry.get("like") or entry.get("bookmark") or entry
        tid = obj.get("tweetId") or obj.get("id")
        if tid:
            out.append(_item(tid, obj.get("fullText", ""), source))
    return out


def parse_zip(data):
    out = []
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for name in z.namelist():
            base = name.rsplit("/", 1)[-1]
            if re.fullmatch(r"like(-part\d+)?\.js", base):
                out += parse_archive_js(z.read(name).decode("utf-8"), "like")
            elif re.fullmatch(r"bookmarks?(-part\d+)?\.js", base):
                out += parse_archive_js(z.read(name).decode("utf-8"), "bookmark")
    return out


def _pick(d, *keys):
    for k in keys:
        cur = d
        for part in k.split("."):
            cur = cur.get(part) if isinstance(cur, dict) else None
        if cur not in (None, ""):
            return cur
    return None


def normalize_generic(d, source):
    """Intenta entender un tuit con la forma que use cada exportador."""
    legacy = d.get("legacy") if isinstance(d.get("legacy"), dict) else {}
    if legacy:  # resultado crudo de la API GraphQL
        user = _pick(d, "core.user_results.result.legacy") or {}
        ents = legacy.get("entities", {})
        urls = [u.get("expanded_url") for u in ents.get("urls", [])]
        media = [m.get("media_url_https") for m in legacy.get("extended_entities", {}).get("media", [])]
        return _item(d.get("rest_id") or legacy.get("id_str"), legacy.get("full_text", ""), source,
                     author_handle=user.get("screen_name"), author_name=user.get("name"),
                     author_avatar=user.get("profile_image_url_https"), tweet_created=legacy.get("created_at"),
                     urls=urls, media=media)

    tid = _pick(d, "id", "id_str", "tweet_id", "tweetId", "rest_id")
    if not tid:
        return None
    text = _pick(d, "full_text", "text", "fullText", "content", "tweet_text") or ""
    urls = _pick(d, "links", "urls", "expanded_urls")
    if isinstance(urls, str):
        urls = [u.strip() for u in re.split(r"[\s,]+", urls) if u.strip()]
    if isinstance(urls, list):
        urls = [u.get("expanded_url") or u.get("url") if isinstance(u, dict) else u for u in urls]
        urls += links_in(text)
    media = _pick(d, "media", "images", "photos") or []
    if isinstance(media, str):
        media = [m for m in re.split(r"[\s,]+", media) if m]
    media = [m.get("media_url_https") or m.get("original") or m.get("url") if isinstance(m, dict) else m for m in media]
    return _item(
        tid, text, source,
        author_handle=_pick(d, "author_handle", "screen_name", "username", "user.screen_name", "author.screen_name", "user_handle"),
        author_name=_pick(d, "author_name", "name", "user.name", "author.name", "user_name"),
        author_avatar=_pick(d, "author_avatar", "profile_image_url", "user.profile_image_url_https", "author.profile_image_url"),
        tweet_created=_pick(d, "created_at", "created", "date", "tweet_created"),
        tweet_url=_pick(d, "url", "tweet_url", "link") if "status" in str(_pick(d, "url", "tweet_url", "link") or "") else None,
        urls=urls, media=media,
    )


def parse_file(filename, data, source=None):
    """Devuelve una lista de elementos normalizados a partir de un fichero subido."""
    name = (filename or "").lower()
    if name.endswith(".zip"):
        return parse_zip(data)
    text = data.decode("utf-8-sig")
    guessed = source or ("bookmark" if "bookmark" in name else "like" if "like" in name else None)
    if text.lstrip().startswith("window.YTD"):
        return parse_archive_js(text, guessed or ("bookmark" if "YTD.bookmark" in text[:80] else "like"))
    if name.endswith(".csv"):
        return [i for i in (normalize_generic(r, guessed or "bookmark") for r in csv.DictReader(io.StringIO(text))) if i]
    payload = json.loads(text)
    if isinstance(payload, dict):
        guessed = payload.get("source") or guessed
        payload = payload.get("items") or payload.get("tweets") or payload.get("data") or []
    return [i for i in (normalize_generic(d, guessed or "bookmark") for d in payload if isinstance(d, dict)) if i]
