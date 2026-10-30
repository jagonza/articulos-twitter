// Capturas de la app en local para comprobar cambios de interfaz. Necesita `npm run dev` en marcha.
// Uso: node scripts/screenshots.cjs [carpeta]   (por defecto .wrangler/shots)
// Saca la portada y el lector (un artículo, un hilo y un tuit con vídeo) en escritorio oscuro y en móvil claro,
// la portada en vista de lista (escritorio-lista, movil-lista), el menú del móvil abierto (movil-menu)
// y la vista «Por leer» en escritorio (escritorio-por-leer).
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE = process.env.TWEETSHELF_LOCAL || "http://localhost:8787";
const outDir = process.argv[2] || path.join(__dirname, "..", ".wrangler", "shots");
const vars = fs.existsSync(".dev.vars") ? fs.readFileSync(".dev.vars", "utf8") : "";
const password = (vars.match(/^APP_PASSWORD=(.*)$/m) || [])[1] || "cambia-esto";

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  // Con proxy (p. ej. en la nube) las fuentes de Google cargan; sin él se usan las de reserva.
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } : undefined;
  const browser = await chromium.launch({ proxy });
  const errors = [];
  // La lista sólo se saca de la portada: el lector no cambia con la vista.
  const passes = [
    ["escritorio", { width: 1440, height: 1000 }, "dark", "cards"],
    ["movil", { width: 390, height: 844 }, "light", "cards"],
    ["escritorio-lista", { width: 1440, height: 1000 }, "dark", "list"],
    ["movil-lista", { width: 390, height: 844 }, "light", "list"],
  ];
  for (const [name, viewport, colorScheme, layout] of passes) {
    const context = await browser.newContext({ viewport, colorScheme });
    await context.addInitScript((l) => { try { localStorage.setItem("layout", l); } catch {} }, layout);
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    await page.request.post(`${BASE}/api/login`, { data: { password } });
    await page.goto(BASE);
    await page.waitForSelector(".card");
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(outDir, `${name}-portada.png`) });
    if (layout === "list") { await context.close(); continue; }
    for (const [kind, selector] of [["articulo", ".card:has(h2)"], ["hilo", ".card:has-text(\"Hilo de\")"], ["video", ".card:has(.vid-badge)"]]) {
      const card = page.locator(selector).first();
      if (!(await card.count())) continue;
      await card.click();
      await page.waitForSelector(".drawer.open");
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(outDir, `${name}-${kind}.png`) });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    }
    // Barra lateral: el panel del móvil abierto, y la vista «Por leer» en escritorio.
    if (name === "movil") {
      await page.click("#menuBtn");
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(outDir, `${name}-menu.png`) });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    }
    if (name === "escritorio") {
      await page.click("#unreadBtn");
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(outDir, `${name}-por-leer.png`) });
    }
  }
  await browser.close();
  console.log(`Capturas en ${outDir}`);
  if (errors.length) { console.error("Errores de JavaScript en la página:\n" + errors.join("\n")); process.exit(1); }
})();
