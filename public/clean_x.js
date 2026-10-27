// Quita de X los guardados / me gusta que ya tienes en Tweetshelf.
//
// Tweetshelf rellena la lista de abajo al pulsar «Copiar script de limpieza». Pégalo en la consola
// del navegador con x.com abierto y tu sesión iniciada. Antes de empezar te pide confirmación.
// Puedes parar con `window.__stopClean = true`.
(async () => {
  const DATA = __TWEETSHELF_DATA__;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = (...a) => console.log("%cTweetshelf", "color:#d9480f;font-weight:bold", ...a);
  const BEARER = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
  // Ids de las acciones internas de X; se buscan en su código y estos son el último recurso.
  const FALLBACK = { DeleteBookmark: "Wlmlj2-xzyS1GN3a6cj-mQ", UnfavoriteTweet: "ZYKSe-w7KEslx3JhSIk5LA" };

  if (!/(^|\.)x\.com$|(^|\.)twitter\.com$/.test(location.hostname)) return log("Abre x.com y pega el script allí.");

  async function findQueryIds() {
    const ids = { ...FALLBACK };
    const scripts = performance.getEntriesByType("resource").map((e) => e.name).filter((n) => /abs\.twimg\.com\/.+\/main\.[\w]+\.js/.test(n));
    for (const src of scripts) {
      try {
        const code = await (await fetch(src)).text();
        for (const op of Object.keys(ids)) {
          const m = code.match(new RegExp(`queryId:"([\\w-]+)",operationName:"${op}"`));
          if (m) ids[op] = m[1];
        }
      } catch { /* sin acceso al código: usamos los de respaldo */ }
    }
    return ids;
  }

  const total = DATA.bookmarks.length + DATA.likes.length;
  if (!total) return log("No hay nada que quitar.");
  const msg = [DATA.bookmarks.length && `${DATA.bookmarks.length} guardados`, DATA.likes.length && `${DATA.likes.length} me gusta`]
    .filter(Boolean).join(" y ");
  if (!confirm(`Tweetshelf va a quitar de X ${msg}. Esto no se puede deshacer desde la app. ¿Seguimos?`)) return log("Cancelado.");

  const qid = await findQueryIds();
  const csrf = document.cookie.match(/(?:^|;\s*)ct0=([^;]+)/)?.[1];
  const headers = {
    authorization: `Bearer ${BEARER}`, "x-csrf-token": csrf, "x-twitter-auth-type": "OAuth2Session",
    "x-twitter-active-user": "yes", "content-type": "application/json",
  };
  const jobs = [
    ...DATA.bookmarks.map((id) => ["DeleteBookmark", id]),
    ...DATA.likes.map((id) => ["UnfavoriteTweet", id]),
  ];
  let ok = 0, failed = 0;
  for (const [op, id] of jobs) {
    if (window.__stopClean) break;
    const r = await fetch(`/i/api/graphql/${qid[op]}/${op}`, {
      method: "POST", headers, credentials: "include",
      body: JSON.stringify({ variables: { tweet_id: id }, queryId: qid[op] }),
    });
    if (r.status === 429) {
      log("X pide esperar; sigo en 5 min…");
      await sleep(5 * 60000);
      jobs.push([op, id]);
      continue;
    }
    const body = await r.json().catch(() => ({}));
    // X responde 200 con errors cuando el tuit ya no estaba guardado: también vale como quitado.
    if (r.ok) ok++;
    else { failed++; log(`No he podido quitar ${id}:`, body.errors?.[0]?.message || r.status); }
    if ((ok + failed) % 10 === 0) log(`${ok + failed}/${total}…`);
    await sleep(1500);
  }
  log(`Listo: ${ok} quitados${failed ? `, ${failed} fallidos` : ""}. Vuelve a Tweetshelf y pulsa «Ya lo he ejecutado».`);
})();
