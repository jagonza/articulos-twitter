// Carga una copia JSON de la estantería (la de «Exportar → JSON completo») en la D1 local.
// Uso: node scripts/seed-local.cjs <copia.json>
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const file = process.argv[2];
if (!file) { console.error("Uso: node scripts/seed-local.cjs <copia.json>"); process.exit(1); }
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const items = Array.isArray(data) ? data : data.items;

const q = (v) => {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "number") return String(v);
  if (typeof v === "object") v = JSON.stringify(v);
  return `'${String(v).replace(/'/g, "''")}'`;
};
// Las copias de antes de quitar la limpieza de X traen x_status, columna que ya no existe.
const cols = Object.keys(items[0]).filter((c) => c !== "x_status");
const sql = items.map((it) => `INSERT OR REPLACE INTO items (${cols.join(",")}) VALUES (${cols.map((c) => q(it[c])).join(",")});`).join("\n");

const root = path.join(__dirname, "..");
const out = path.join(root, ".wrangler", "seed.sql");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, sql);
const run = (f) => execFileSync("npx", ["wrangler", "d1", "execute", "tweetshelf", "--local", "--file", f], { cwd: root, stdio: "inherit" });
run("schema.sql");
run(out);
console.log(`${items.length} elementos cargados en la D1 local.`);
