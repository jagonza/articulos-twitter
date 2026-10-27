# 📚 Tweetshelf

Tu estantería de favoritos de X/Twitter: importa tus *me gusta* y tus elementos guardados, extrae los artículos que enlazan y léelos, búscalos, márcalos y anótalos desde una web privada que vive gratis en Cloudflare.

## Qué hace

- **Importa** desde el archivo de datos de X (el `.zip` entero o `data/like.js`), desde el script de exportación incluido (`public/export_x.js`, con botón «Copiar script» en la app), que trae guardados o me gusta con autor, enlaces reales, tuits citados y Artículos de X o desde el JSON/CSV de exportadores como *twitter-web-exporter*. Los ficheros se leen en tu navegador, así que el `.zip` puede pesar gigas: sólo se suben los tuits. Si un tuit aparece en varias fuentes se fusiona.
- **Extrae el artículo** de cada enlace (resuelve `t.co` y saca título, autor, sitio, fecha, imagen y texto limpio con [trafilatura](https://github.com/adbar/trafilatura)). Lo hace GitHub Actions cada 3 horas, o al momento con «extraer ahora».
- **Búsqueda de texto completo** (FTS5, sin distinguir acentos) en tuits, autores, artículos, notas y etiquetas, con fragmentos resaltados.
- **Organiza**: favoritos ⭐, leído ✅, archivo, notas con autoguardado y etiquetas (manuales y automáticas según el sitio: vídeo, código, paper, newsletter, lectura larga…).
- **Filtra** por vista (por leer, favoritos, artículos, sólo tuits, con notas, archivados), etiqueta, sitio y autor. Ordena por fecha, relevancia, duración de lectura o al azar.
- **Modo lector**, **🎲 Sorpréndeme** (un artículo sin leer al azar), atajos de teclado (`/` buscar · `j`/`k` moverse · `Enter` abrir · `f` favorito · `r` leído · `e` archivar · `Esc` cerrar), tema claro/oscuro y móvil.
- **Tuits citados** como elementos propios: se ven dentro del tuit que los cita y en el lector aparece «Citado por», con «Quedarme sólo con el citado» pasas favorito, notas y etiquetas al citado y el original se archiva (y se marca para quitar de X).
- **Limpia X**: marca con 🧹 (o la tecla `x`) lo que ya tienes aquí, o todo lo importado, y copia un script que lo quita de tus guardados / me gusta de X.
- **Exporta** a JSON completo o a Markdown (para Obsidian/Notion).

## Cómo está montado (coste: 0 €)

```
navegador ──► Cloudflare Worker (web + API, con contraseña) ──► Cloudflare D1 (SQLite + búsqueda)
                                     ▲
GitHub Actions cada 3 h ─────────────┘  descarga los artículos pendientes y los guarda vía la API
```

| Pieza | Plan gratuito |
| --- | --- |
| Cloudflare Workers | 100.000 peticiones/día |
| Cloudflare D1 | 500 MB por base de datos, 5 M filas leídas y 100.000 escritas al día |
| GitHub Actions (repo privado) | 2.000 minutos/mes (esto gasta unos 250) |

Para no acercarse a los 500 MB, cada artículo guarda como mucho 60.000 caracteres de texto.

## Puesta en marcha

La base de datos D1 `tweetshelf` ya está creada y con el esquema aplicado (`schema.sql`; los cambios posteriores están en `migrations/`).

1. **Despliega el Worker.** En el panel de Cloudflare: *Workers & Pages → Create → Import a repository*, elige `jagonza/articulos-twitter` y deja el nombre `articulos-twitter` (debe coincidir con `name` en `wrangler.toml`) y el comando de despliegue por defecto (`npx wrangler deploy`). A partir de ahí cada push a `main` se despliega solo.
2. **Pon la contraseña.** En el Worker: *Settings → Variables and secrets → Add*, de tipo *Secret*:
   - `APP_PASSWORD`: la contraseña para entrar.
   - `API_TOKEN`: una cadena larga aleatoria (la usa el extractor).
3. **Conecta el extractor.** En GitHub: *Settings → Secrets and variables → Actions → New repository secret*:
   - `TWEETSHELF_URL`: la dirección del Worker, p. ej. `https://articulos-twitter.tu-subdominio.workers.dev`.
   - `TWEETSHELF_TOKEN`: el mismo valor que `API_TOKEN`.
4. *(Opcional)* **Botón «extraer ahora».** Crea un [token de GitHub de grano fino](https://github.com/settings/personal-access-tokens/new) sólo para este repo con permiso *Actions: Read and write* y añádelo al Worker como secretos `GITHUB_TOKEN` (el token) y `GITHUB_REPO` (`jagonza/articulos-twitter`). Sin él, los artículos se extraen en la siguiente pasada de 3 horas.

## Cómo conseguir tus favoritos

| Qué | Cómo |
| --- | --- |
| **Me gusta** | X → Configuración → Tu cuenta → *Descargar un archivo de tus datos*. Llega en ~24 h. Sube el `.zip` tal cual. `like.js` no trae autor ni fecha; si luego importas los mismos tuits desde otra fuente, se completan. |
| **Guardados** | El archivo de X no los incluye. En la app, *Importar → 📋 Copiar script*. Abre `https://x.com/i/bookmarks`, pega el script en la consola del navegador (la primera vez Chrome pide escribir `allow pasting`) y sube el JSON que descarga. |

## Desarrollo en local

```bash
npm install
cp .dev.vars.example .dev.vars          # contraseña y token locales
npm run db:init:local
npm run dev                             # http://localhost:8787

# en otra terminal, para extraer artículos contra el Worker local
pip install -r extractor/requirements.txt
cd extractor && TWEETSHELF_URL=http://localhost:8787 TWEETSHELF_TOKEN=token-local-para-el-extractor python run.py
```

## Estructura

```
worker/index.js        API (login, importar, buscar, editar, estadísticas, exportar, extracción)
schema.sql             tablas, índice de búsqueda y triggers de D1
public/                interfaz (HTML/CSS/JS sin dependencias; zip.js en public/vendor)
extractor/             extracción de artículos en Python (la ejecuta GitHub Actions)
.github/workflows/     extract.yml, cada 3 horas o bajo demanda
sample/                datos de ejemplo
```

## Ideas para siguientes pasos

- Resúmenes y etiquetas automáticas con IA.
- Sincronizar los guardados sin pasos manuales (extensión de navegador).
- Resaltados dentro del artículo y colecciones.
