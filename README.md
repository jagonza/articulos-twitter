# 📚 Tweetshelf

Tu estantería de favoritos de X/Twitter: importa tus *me gusta* y tus elementos guardados (tuits, hilos, Artículos de X y citas) y léelos, búscalos, márcalos y anótalos desde una web privada que vive gratis en Cloudflare.

## Qué hace

- **Importa** desde el archivo de datos de X (el `.zip` entero o `data/like.js`), desde el script de exportación incluido (`public/export_x.js`, con botón «Copiar script» en la app), que trae guardados o me gusta con autor, enlaces reales, tuits citados y Artículos de X o desde el JSON/CSV de exportadores como *twitter-web-exporter*. El script trae sólo lo nuevo desde la última importación, y lo que tienes en X se queda allí. Los ficheros se leen en tu navegador, así que el `.zip` puede pesar gigas: sólo se suben los tuits. Si un tuit aparece en varias fuentes se fusiona.
- **Artículos de X**: llegan completos en la exportación y se leen con su formato. Los enlaces a otras webs no se descargan: se quedan como enlace en el texto del tuit.
- **Búsqueda de texto completo** (FTS5, sin distinguir acentos) en tuits, hilos, autores, Artículos de X, notas y etiquetas, con fragmentos resaltados.
- **Organiza**: favoritos ⭐, leído ✅, archivo, notas con autoguardado y etiquetas.
- **Filtra** por vista (por leer, favoritos, artículos, sólo tuits, con notas, archivados), etiqueta y autor. Ordena por fecha, relevancia, duración de lectura o al azar.
- **Hilos**: si guardas un tuit que es parte de un hilo de su autor, el script trae el hilo entero y se lee en orden (y entra en la búsqueda).
- **Modo lector** con el formato del original (títulos, listas, negritas, enlaces e imágenes; los artículos se guardan en Markdown), **🎲 Sorpréndeme** (un artículo sin leer al azar), atajos de teclado (`/` buscar · `j`/`k` moverse · `Enter` abrir · `f` favorito · `r` leído · `e` archivar · `Esc` cerrar), tema claro/oscuro y móvil.
- **Tuits citados** como elementos propios: se ven dentro del tuit que los cita y en el lector aparece «Citado por», con «Quedarme sólo con el citado» pasas favorito, notas y etiquetas al citado y el original se archiva.
- **Exporta** a JSON completo o a Markdown (para Obsidian/Notion).

## Cómo está montado (coste: 0 €)

```
navegador ──► Cloudflare Worker (web + API, con contraseña) ──► Cloudflare D1 (SQLite + búsqueda)
```

| Pieza | Plan gratuito |
| --- | --- |
| Cloudflare Workers | 100.000 peticiones/día |
| Cloudflare D1 | 500 MB por base de datos, 5 M filas leídas y 100.000 escritas al día |

Para no acercarse a los 500 MB, cada Artículo de X guarda como mucho 60.000 caracteres de texto.

## Puesta en marcha

La base de datos D1 `tweetshelf` ya está creada y con el esquema aplicado (`schema.sql`; los cambios posteriores están en `migrations/`).

1. **Despliega el Worker.** En el panel de Cloudflare: *Workers & Pages → Create → Import a repository*, elige `jagonza/articulos-twitter` y deja el nombre `articulos-twitter` (debe coincidir con `name` en `wrangler.toml`) y el comando de despliegue por defecto (`npx wrangler deploy`). A partir de ahí cada push a `main` se despliega solo.
2. **Pon la contraseña.** En el Worker: *Settings → Variables and secrets → Add*, de tipo *Secret*: `APP_PASSWORD`, la contraseña para entrar.

## Cómo conseguir tus favoritos

| Qué | Cómo |
| --- | --- |
| **Me gusta** | X → Configuración → Tu cuenta → *Descargar un archivo de tus datos*. Llega en ~24 h. Sube el `.zip` tal cual. `like.js` no trae autor ni fecha; si luego importas los mismos tuits desde otra fuente, se completan. |
| **Guardados** | El archivo de X no los incluye. En la app, *Importar → 📋 Copiar script*. Abre `https://x.com/i/bookmarks`, pega el script en la consola del navegador (la primera vez Chrome pide escribir `allow pasting`) y sube el JSON que descarga. La próxima vez sólo trae lo nuevo. |

## Desarrollo en local

```bash
npm install
cp .dev.vars.example .dev.vars          # contraseña local
npm run db:init:local
npm run dev                             # http://localhost:8787
```

## Estructura

```
worker/index.js        API (login, importar, buscar, editar, estadísticas, exportar)
schema.sql             tablas, índice de búsqueda y triggers de D1
public/                interfaz (HTML/CSS/JS sin dependencias; zip.js en public/vendor)
sample/                datos de ejemplo
```

## Ideas para siguientes pasos

- Resúmenes y etiquetas automáticas con IA.
- Sincronizar los guardados sin pasos manuales (extensión de navegador).
- Resaltados dentro del artículo y colecciones.
