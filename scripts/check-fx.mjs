// Comprueba el conversor de «Añadir por enlace» con una respuesta de ejemplo (scripts/fx-sample.json),
// porque en la nube no hay salida a FxTwitter ni a X. Uso: node scripts/check-fx.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { articleMarkdown, itemsFromFx } from "../worker/fxtwitter.js";

const sample = JSON.parse(readFileSync(new URL("./fx-sample.json", import.meta.url), "utf8"));
const fails = [];
const check = (name, ok) => { console.log(`${ok ? "ok  " : "FALLO"} ${name}`); if (!ok) fails.push(name); };

const [item] = itemsFromFx(sample);
check("el tuit pedido es el primero y guarda su origen", item.id === sample.status.id && item.source === "link");
check("el hilo sólo tiene tuits del mismo autor (3 de 4)", item.thread?.length === 3 && item.thread.every((t) => t.id !== "1000000000000000003"));
check("la foto sale como URL de pbs.twimg.com", item.media[0] === "https://pbs.twimg.com/media/FOTO1.jpg");
check("el vídeo se guarda como miniatura", item.thread[1].media[0].includes("amplify_video_thumb"));
check("la web externa queda en urls, no en el texto", item.thread[1].links[0] === "https://example.org/nota");
check("la fecha sale en ISO", item.tweet_created === new Date(1761000000 * 1000).toISOString());

const md = articleMarkdown(sample.status.article.content, sample.status.article.media_entities);
check("el Artículo del tuit pedido llega con título y portada", item.x_article?.title === "Un Artículo de prueba" && item.x_article.image.endsWith("PORTADA.jpg") && item.x_article.url === "https://x.com/i/article/2000000000000000009");
console.log("\n--- Markdown del Artículo ---\n" + md + "\n-----------------------------\n");
check("el título sale como encabezado", md.startsWith("# Título de sección"));
check("la negrita sale con **", md.includes("**negrita**"));
check("el enlace sale en Markdown", md.includes("[enlace](https://example.org/articulo)"));
check("las viñetas van seguidas", md.includes("- Primer punto\n- Segundo punto"));
check("la imagen usa su URL real", md.includes("![Foto](https://pbs.twimg.com/media/DENTRO.jpg)"));
check("sin formato, usa el texto de los bloques", articleMarkdown({ blocks: [{ type: "unstyled", text: "Hola", inlineStyleRanges: [], entityRanges: [] }] }) === "Hola");
check("sin bloques no hay texto", articleMarkdown(null) === null);

if (fails.length) { console.error(`\n${fails.length} comprobaciones fallan`); process.exit(1); }
console.log("\nTodo bien.");
