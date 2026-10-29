# Tweetshelf: instrucciones para trabajar en el repo

Tweetshelf es la estantería de favoritos de X de Javier: importa guardados y me gusta y los deja leer, buscar,
marcar y anotar. Todo vive gratis en Cloudflare (Worker + D1). El README explica el despliegue; aquí van las
reglas para cambiar código.

## Tipos de contenido

- **Tuit**: se guarda tal cual. Si lleva un enlace a otra web, el enlace se queda en el texto y no se extrae nada.
- **Hilo**: los tuits del mismo autor que siguen al guardado; se lee como una lista de tuits.
- **Artículo de X**: el texto del Artículo viene en la exportación y se lee en el lector como artículo.
- **Cita** (de un tuit o de un Artículo): el citado es un elemento propio (`quoted_id`); se ven los dos y
  «Quedarme sólo con el citado» archiva el original.

## Reglas

- **Idioma**: la interfaz, los comentarios, los commits y los PRs van en español.
- **Coste cero**: nada que necesite un plan de pago ni una tarjeta. Sin servicios nuevos.
- **Sin dependencias en el navegador**: `public/` es HTML, CSS y JS a mano (módulos ES, sin build).
  No añadas librerías ni frameworks. Los iconos son de [Tabler](https://tabler.io/icons) en línea, en
  el objeto `ICONS` de `public/app.js`; añade ahí los que falten copiando sus `<path>`.
- **Base de datos**: los cambios de esquema van en `migrations/NNNN_nombre.sql` y también en `schema.sql`.
  Aplicar una migración a la D1 remota necesita el OK explícito de Javier.
- **Estilo del código**: imita lo que hay. Comentarios cortos que expliquen el porqué, plantillas con
  template strings, `esc()` para todo texto que venga de datos y `linkify()` para el texto de los tuits.
- **Rama y PR**: trabaja en la rama que te asignen, un PR por tarea, con capturas descritas en el cuerpo.

## Mapa

```
public/index.html      estructura de la página y diálogos (importar)
public/app.js          toda la interfaz: carga, tarjetas (card), lector (openItem), atajos, importación
public/style.css       estilos; los tokens de color y tipografía están arriba, en :root
worker/index.js        API: /api/items, /api/items/:id (GET/PATCH/DELETE), /api/stats, importar, exportar…
schema.sql             tablas, índice FTS5 y triggers
```

## Diseño

- **Tipografía**: `--ui` (Geist) para la interfaz y los títulos, `--read` (Literata) para el texto que
  se lee (cuerpo de artículos y tuits). `--serif` (Fraunces) sólo para la marca y los títulos de diálogos.
  `--sans` (Inter) es la tipografía base del resto de la app.
- **Colores**: usa siempre las variables de `:root`, que tienen versión clara y oscura (la oscura se
  repite en `@media (prefers-color-scheme: dark)` y en `:root[data-theme="dark"]`; si añades un token, ponlo en
  los tres sitios). Texto: `--strong` (títulos), `--body` (texto), `--muted` (secundario). Fondos:
  `--bg`, `--panel` (tarjetas y ventanas), `--sunk` (zonas hundidas), `--field` (campos). Botones:
  `--btn`, `--btn-line`. Acento: `--accent`, `--accent-soft`. Otros: `--star`, `--danger`, `--line`.
- **Botones**: un botón tiene que parecer un botón (fondo `--btn`, borde `--btn-line`, 40–42 px de
  alto, radio 10 px). Acciones destructivas en `--danger` con borde. Iconos solos sólo con `aria-label`/`title`.
- **Lector** (`openItem`): ventana centrada con el texto a la izquierda y la ficha a la derecha; mientras
  está abierta, `html.reading` bloquea el scroll del fondo.
- **Móvil**: todo tiene que funcionar a 390 px de ancho, sin scroll horizontal.
- La maqueta de referencia está en https://claude.ai/artifact/3A9fXscm59Ea8CUW1sbfEM. Las
  especificaciones de cambios pendientes están en `docs/`.

## Probar en local (obligatorio antes de abrir un PR de interfaz)

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:seed:local -- /mnt/project-files/tweetshelf/copia-2026-10-28.json   # copia real de Javier
npm run dev &                                                                 # http://localhost:8787
npm run shots                                                                 # capturas en .wrangler/shots
```

- `npm run shots` saca la portada, un artículo y un hilo en escritorio (oscuro) y móvil (claro), y falla si
  la página da errores de JavaScript. Mira las capturas (la herramienta de leer ficheros abre PNG) y compáralas
  con la especificación antes de dar el trabajo por bueno. Usa Playwright, que en la nube ya está instalado;
  en otro equipo, `npm i -D playwright && npx playwright install chromium`.
- En la nube no cargan las imágenes de X ni los favicons (no hay salida a esas webs): es normal que salgan
  huecos o las portadas de reserva.
- `node --check public/app.js` detecta errores de sintaxis en segundos.
- La comprobación «Workers Builds» de los PRs falla siempre sin log (la vista previa de Cloudflare); no es
  del PR. Producción se despliega bien al mergear en `main`.
