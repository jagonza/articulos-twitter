"""Resuelve los enlaces de cada tuit y extrae el artículo (título, autor, texto, imagen)."""
import re
from urllib.parse import urlparse

import httpx
import trafilatura

TWITTER_HOSTS = ("twitter.com", "x.com", "mobile.twitter.com", "pic.twitter.com", "pic.x.com")
MAX_TEXT = 60_000  # caracteres; mantiene la base de datos gratuita holgada


def is_twitter_url(url):
    return domain_of(url) in TWITTER_HOSTS


UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
CHALLENGE_RE = re.compile(r"just a moment|client challenge|attention required|access denied|are you a robot|verify you are human", re.I)
SKIP_EXT = (".jpg", ".jpeg", ".png", ".gif", ".webp", ".mp4", ".zip")

# Etiquetas automáticas según el dominio del enlace.
DOMAIN_TAGS = {
    "youtube.com": "vídeo", "youtu.be": "vídeo", "vimeo.com": "vídeo",
    "github.com": "código", "gitlab.com": "código", "huggingface.co": "código",
    "arxiv.org": "paper", "biorxiv.org": "paper", "doi.org": "paper", "nature.com": "paper",
    "substack.com": "newsletter", "medium.com": "blog", "dev.to": "blog",
    "open.spotify.com": "podcast", "podcasts.apple.com": "podcast",
    "news.ycombinator.com": "hacker news", "reddit.com": "reddit",
}


def domain_of(url):
    host = urlparse(url).netloc.lower()
    return host[4:] if host.startswith("www.") else host


def auto_tags(url, words):
    dom = domain_of(url)
    tags = {tag for d, tag in DOMAIN_TAGS.items() if dom == d or dom.endswith("." + d)}
    if url.lower().endswith(".pdf"):
        tags.add("pdf")
    if words and words > 2500:
        tags.add("lectura larga")
    return tags


SHORTENER_HOSTS = ("t.co",)
# t.co contesta a los navegadores con una página que redirige por HTML/JS en vez de con un 301.
REFRESH_RE = re.compile(r'http-equiv=["\']?refresh["\']?[^>]*url=([^"\'>]+)', re.I)
REPLACE_RE = re.compile(r'location\.replace\(["\']([^"\']+)["\']\)', re.I)


def _html_redirect(html):
    m = REFRESH_RE.search(html) or REPLACE_RE.search(html)
    return m.group(1).replace("\\/", "/").strip() if m else None


def resolve(client, url):
    """Sigue redirecciones (t.co, bit.ly...) y devuelve la URL final."""
    try:
        for _ in range(5):
            # Sin aspecto de navegador, t.co devuelve un 301 normal.
            headers = {"User-Agent": "curl/8.5"} if domain_of(url) in SHORTENER_HOSTS else None
            r = client.head(url, follow_redirects=True, headers=headers)
            if r.status_code >= 400 or domain_of(str(r.url)) in SHORTENER_HOSTS:
                r = client.get(url, follow_redirects=True, headers=headers)
            url = str(r.url)
            if domain_of(url) not in SHORTENER_HOSTS:
                return url
            nxt = _html_redirect(r.text)
            if not nxt or nxt == url:
                return url
            url = nxt
        return url
    except httpx.HTTPError:
        return url


def extract(urls, timeout=20):
    """Devuelve un dict con los campos article_* o el motivo del fallo."""
    with httpx.Client(headers={"User-Agent": UA, "Accept-Language": "es,en;q=0.8"}, timeout=timeout) as client:
        final, unresolved = None, False
        for u in urls:
            target = resolve(client, u)
            if domain_of(target) in SHORTENER_HOSTS:
                unresolved = True  # mejor fallar que guardar «t.co» como si fuera el artículo
                continue
            if not is_twitter_url(target) and not target.lower().endswith(SKIP_EXT):
                final = target
                break
        if not final:
            if unresolved:
                return {"article_status": "failed", "article_error": "No se pudo seguir el enlace acortado"}
            return {"article_status": "none"}

        result = {"article_url": final, "domain": domain_of(final)}
        try:
            r = client.get(final, follow_redirects=True)
            r.raise_for_status()
        except httpx.HTTPError as e:
            return {**result, "article_status": "failed", "article_error": str(e)[:300]}

        ctype = r.headers.get("content-type", "")
        if "html" not in ctype:
            return {**result, "article_status": "ok", "article_title": final.rsplit("/", 1)[-1] or final,
                    "article_site": result["domain"], "tags": sorted(auto_tags(final, 0))}

        html = r.text
        doc = trafilatura.bare_extraction(html, url=final, with_metadata=True, include_comments=False,
                                          favor_recall=True, as_dict=True) or {}
        text = (doc.get("text") or "").strip()
        words = len(text.split())
        # El texto se guarda en Markdown para conservar títulos, listas, negritas, enlaces e imágenes.
        md = trafilatura.extract(html, url=final, output_format="markdown", include_images=True, include_formatting=True,
                                 include_links=True, include_tables=True, include_comments=False, favor_recall=True)
        md = (md or "").strip()
        title = doc.get("title") or _meta(html, "og:title") or result["domain"]
        if words < 120 and CHALLENGE_RE.search(title):
            return {**result, "article_status": "failed", "article_error": "La web pide verificación anti-bots"}
        excerpt = doc.get("description") or _meta(html, "og:description") or text[:280]
        return {
            **result,
            "article_status": "ok",
            "article_title": title,
            "article_author": doc.get("author"),
            "article_site": doc.get("sitename") or _meta(html, "og:site_name") or result["domain"],
            "article_date": doc.get("date"),
            "article_image": doc.get("image") or _meta(html, "og:image"),
            "article_excerpt": (excerpt or "")[:500],
            "article_text": (md if len(md) >= len(text) * 0.8 else text)[:MAX_TEXT],
            "article_words": words,
            "article_error": None,
            "tags": sorted(auto_tags(final, words)),
        }


def _meta(html, prop):
    m = re.search(rf'<meta[^>]+(?:property|name)=["\']{re.escape(prop)}["\'][^>]+content=["\']([^"\']+)', html, re.I) \
        or re.search(rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']{re.escape(prop)}["\']', html, re.I)
    return m.group(1) if m else None
