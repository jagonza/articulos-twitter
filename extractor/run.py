"""Extrae los artículos pendientes de Tweetshelf y los guarda vía la API del Worker.

Variables de entorno:
  TWEETSHELF_URL    p. ej. https://articulos-twitter.tu-usuario.workers.dev
  TWEETSHELF_TOKEN  el mismo valor que el secreto API_TOKEN del Worker
  MAX_MINUTES       tiempo máximo de ejecución (por defecto 20)
"""
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import httpx

from extract import extract

BASE = os.environ["TWEETSHELF_URL"].rstrip("/")
HEADERS = {"Authorization": f"Bearer {os.environ['TWEETSHELF_TOKEN']}"}
DEADLINE = time.time() + 60 * float(os.environ.get("MAX_MINUTES", 20))
MAX_BODY = 1_500_000  # bytes por envío (D1 admite parámetros de hasta 2 MB)


def safe_extract(item):
    try:
        data = extract(item["urls"])
    except Exception as e:  # una página rara no debe tumbar la tanda
        data = {"article_status": "failed", "article_error": str(e)[:300]}
    return {"id": item["id"], **data}


def save(client, results):
    """Envía los resultados en trozos que quepan en un parámetro de D1."""
    chunk, size = [], 0
    for r in results:
        n = len(json.dumps(r))
        if chunk and size + n > MAX_BODY:
            client.post(f"{BASE}/api/articles", json={"results": chunk}).raise_for_status()
            chunk, size = [], 0
        chunk.append(r)
        size += n
    if chunk:
        client.post(f"{BASE}/api/articles", json={"results": chunk}).raise_for_status()


def main():
    done = 0
    with httpx.Client(headers=HEADERS, timeout=60) as client, ThreadPoolExecutor(max_workers=8) as pool:
        while time.time() < DEADLINE:
            pending = client.get(f"{BASE}/api/pending", params={"limit": 40}).raise_for_status().json()
            if not pending:
                break
            results = list(pool.map(safe_extract, pending))
            save(client, results)
            done += len(results)
            ok = sum(r["article_status"] == "ok" for r in results)
            print(f"{done} procesados ({ok}/{len(results)} con artículo en esta tanda)", flush=True)
    print(f"Listo: {done} elementos procesados.")


if __name__ == "__main__":
    sys.exit(main())
