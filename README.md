# 📚 Tweetshelf

Tu estantería de favoritos de X/Twitter: importa tus *me gusta* y tus elementos guardados, extrae los artículos que enlazan y léelos, búscalos, márcalos y anótalos desde una interfaz cómoda.

## Qué hace

- **Importa** desde el archivo de datos de X (`.zip` o `data/like.js`), desde el script de guardados incluido (`tools/export_bookmarks.js`) o desde el JSON/CSV de exportadores como *twitter-web-exporter*. Si un tuit aparece en varias fuentes se fusiona.
- **Extrae el artículo** de cada enlace (resuelve `t.co`, descarga la página y saca título, autor, sitio, fecha, imagen y texto limpio con [trafilatura](https://github.com/adbar/trafilatura)). Corre en segundo plano con barra de progreso.
- **Búsqueda de texto completo** (SQLite FTS5, sin distinguir acentos) en tuits, artículos, notas y etiquetas, con fragmentos resaltados.
- **Organiza**: favoritos ⭐, leído ✅, archivo, notas con autoguardado, etiquetas (manuales y automáticas según el sitio: vídeo, código, paper, newsletter, lectura larga…).
- **Filtra** por vista (por leer, favoritos, artículos, sólo tuits, con notas, archivados), etiqueta, sitio y autor. Ordena por fecha, relevancia, duración de lectura o al azar.
- **Modo lector** con el artículo completo, el tuit original y tus notas.
- **🎲 Sorpréndeme**: abre un artículo sin leer al azar.
- **Atajos**: `/` buscar · `j`/`k` moverse · `Enter` abrir · `f` favorito · `r` leído · `e` archivar · `Esc` cerrar.
- **Exporta** a JSON completo o a Markdown (para Obsidian/Notion).
- Tema claro/oscuro y diseño adaptado a móvil.

## Arrancar

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Abre <http://localhost:8000>, pulsa **Importar** y prueba con los ficheros de `sample/`.

La base de datos se guarda en `data/tweetshelf.db` (cámbiala con `TWEETSHELF_DB`).

## Cómo conseguir tus favoritos

| Qué | Cómo |
| --- | --- |
| **Me gusta** | X → Configuración → Tu cuenta → *Descargar un archivo de tus datos*. Llega en ~24 h. Sube el `.zip` o sólo `data/like.js`. Ojo: `like.js` no trae autor ni fecha; si luego importas los mismos tuits desde otra fuente, se completan. |
| **Guardados** | El archivo de X no los incluye. Abre `https://x.com/i/bookmarks`, pega `tools/export_bookmarks.js` en la consola del navegador y sube el JSON que descarga. |

La API oficial de X sirve para automatizarlo, pero es de pago; por eso el prototipo parte de las exportaciones.

## Estructura

```
app/
  main.py        API (FastAPI): importar, listar/buscar, editar, estadísticas, exportar
  importers.py   lectores de cada formato de exportación
  extract.py     resolución de enlaces y extracción de artículos
  db.py          esquema SQLite + índice FTS5
static/          interfaz (HTML/CSS/JS sin dependencias)
tools/           script de exportación de guardados
sample/          datos de ejemplo
```

## Ideas para siguientes pasos

- Resúmenes y etiquetas automáticas con IA.
- Sincronización periódica de guardados (extensión de navegador o API de X).
- Despliegue en la nube con acceso protegido para usarlo desde el móvil.
- Resaltados dentro del artículo y colecciones.
