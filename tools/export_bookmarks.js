// Exporta tus elementos guardados de X a un JSON que Tweetshelf sabe importar.
//
// Uso:
//   1. Abre https://x.com/i/bookmarks con tu sesión iniciada.
//   2. Abre la consola del navegador (Cmd+Opt+J en Chrome / Cmd+Opt+K en Firefox).
//   3. Pega este script entero y pulsa Enter. Irá bajando sola hasta el final.
//   4. Al terminar descargará `bookmarks-AAAA-MM-DD.json`. Súbelo en Tweetshelf → Importar.
//
// Puedes parar antes con `window.__stopExport = true` en la consola: descargará lo recogido.
(async () => {
  const seen = new Map();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const collect = () => {
    document.querySelectorAll('article[data-testid="tweet"]').forEach((a) => {
      const timeLink = a.querySelector('a[href*="/status/"] time')?.closest("a");
      const m = timeLink?.getAttribute("href")?.match(/^\/([^/]+)\/status\/(\d+)/);
      if (!m || seen.has(m[2])) return;
      const textEl = a.querySelector('[data-testid="tweetText"]');
      const userEl = a.querySelector('[data-testid="User-Name"]');
      const links = new Set();
      // Los enlaces del texto muestran la URL real; los t.co se resuelven después en el servidor.
      a.querySelectorAll('[data-testid="tweetText"] a[href], [data-testid="card.wrapper"] a[href]').forEach((l) => {
        const href = l.href;
        if (/^https?:\/\/(t\.co|[^/]*)/.test(href) && !/^https?:\/\/(x|twitter)\.com\//.test(href)) links.add(href);
      });
      seen.set(m[2], {
        id: m[2],
        author_handle: m[1],
        author_name: userEl?.querySelector("span")?.innerText || null,
        author_avatar: a.querySelector('[data-testid="Tweet-User-Avatar"] img')?.src || null,
        created: timeLink.querySelector("time")?.getAttribute("datetime"),
        url: `https://x.com/${m[1]}/status/${m[2]}`,
        text: textEl?.innerText || "",
        links: [...links],
        media: [...a.querySelectorAll('[data-testid="tweetPhoto"] img')].map((i) => i.src.replace(/name=\w+/, "name=large")),
      });
    });
  };

  let idle = 0;
  while (idle < 8 && !window.__stopExport) {
    const before = seen.size;
    collect();
    window.scrollBy(0, window.innerHeight * 0.9);
    await sleep(1200);
    idle = seen.size === before ? idle + 1 : 0;
    console.log(`Tweetshelf: ${seen.size} guardados recogidos…`);
  }
  collect();

  const blob = new Blob([JSON.stringify({ source: "bookmark", exported_at: new Date().toISOString(), items: [...seen.values()] }, null, 2)],
    { type: "application/json" });
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(blob), download: `bookmarks-${new Date().toISOString().slice(0, 10)}.json`,
  });
  document.body.appendChild(a);
  a.click();
  console.log(`Tweetshelf: listo, ${seen.size} guardados exportados.`);
})();
