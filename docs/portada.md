# Especificación: portada con tarjetas nuevas (C) y vista de lista (D)

Aprobada por Javier el 28 oct 2026. Maqueta: artboards «C · Tarjetas más limpias» y «D · Vista de lista» en
https://claude.ai/artifact/3A9fXscm59Ea8CUW1sbfEM. Lee antes `CLAUDE.md` (reglas, tokens y cómo probar).

Sólo se toca la portada: `card()` y `renderGrid()` en `public/app.js`, la sección `/* --- tarjetas --- */`
de `public/style.css` y la barra superior de `public/index.html`. El lector (`openItem`) no cambia. No hace
falta tocar el Worker ni la base de datos: todo lo que se usa ya viene en `/api/items`.

## 1. Comunes a las dos vistas

- **Títulos limpios**: usa `cleanTitle(it.article_title, it.article_site)` (ya existe para el lector) y,
  además, los títulos de GitHub `GitHub - autor/repo: descripción` pasan a título `autor/repo`; si el elemento
  no tiene `article_excerpt`, la descripción hace de extracto. Crea una función `cardTitle(it)` que devuelva
  `{ title, excerpt }` y úsala en las dos vistas.
- **Origen**: si `fromX` (como ahora), el icono X y el texto «Artículo de X» (artículos) o «Tuit» / «Hilo de N»
  (tuits); si no, el favicon de 16 px (radio 4 px) y `article_site || domain`.
- **Icono de quitar de X**: `xIcon(it)` (ya existe). Nada de emojis nuevos en las tarjetas: el 📝 de
  `badge-note` y el 🧵 de `thread-badge` desaparecen (ver más abajo qué los sustituye).
- Los `data-act`, `data-tag`, `data-author`, `data-open` y `data-i` se mantienen tal cual: el manejador de
  clics de la línea `const act = t.closest("[data-act]")` no cambia, ni `syncItem()`, ni los atajos j/k.
- Tipografías: interfaz y títulos en `var(--ui)`; texto de tuits en `var(--read)`.

## 2. Vista de tarjetas (C)

Se mantiene el mosaico (`.grid { columns: 320px; column-gap: 18px; }`).

**Tarjeta con portada** (artículos, o tuits con imagen):
- `.card`: `padding: 12px`, radio 14 px, fondo `--panel`, borde 1 px `--line`, sin `overflow: hidden` en la
  imagen (la imagen va dentro con su propio radio). Hover: borde `--accent` y `box-shadow: 0 10px 30px
  rgba(0,0,0,.25)`; quita el `translateY`.
- Portada dentro de la tarjeta: `aspect-ratio: 1.9`, `border-radius: 9px`, `object-fit: cover`.
- Portada de reserva (sin imagen o si falla): fondo plano y apagado, nada de degradados saturados:
  `hsl(H 25% 22%)` en oscuro y `hsl(H 35% 88%)` en claro, con la inicial en `hsl(H 30% 62%)`, 600 40px
  `var(--ui)`. Para el claro/oscuro usa dos variables CSS (`--cover-l`, `--cover-ink-l`) en `:root` o pon el
  tono `H` en una variable en línea (`style="--h:120"`) y el color en CSS con `hsl(var(--h) …)`.
- Cuerpo: `padding: 14px 6px 4px`.
  - Fila de origen (12,5 px, `--muted`, `gap: 7px`): origen (nombre en 500 `--strong`) · minutos o fecha, y a
    la derecha el `byline(it)` actual (avatar 18 px y @usuario).
  - Título `h2`: `600 19px/1.28 var(--ui)`, `letter-spacing: -.015em`, `--strong`, máximo 3 líneas
    (`-webkit-line-clamp: 3`), `text-wrap: balance`.
  - Extracto: `14px/1.5`, `--muted`, máximo 2 líneas. Si hay `it.snippet` (búsqueda), el snippet sustituye al
    extracto con el mismo estilo y las marcas `<mark>`.
  - Pie (`.meta`, ver abajo).

**Tarjeta de tuit sin portada**:
- `.card` con `padding: 18px`.
- Cabecera: avatar redondo 34 px (o la inicial sobre `--line`), a su lado nombre (14 px 600 `--strong`) y
  debajo `@usuario · fecha` y, si es hilo, ` · Hilo de N` (12,5 px `--muted`); a la derecha el botón X
  (`data-act="tweet"`, icono 15 px `--muted`). Al pulsar el nombre o el @ filtra por autor (`data-author`).
- Texto: `400 16.5px/1.55 var(--read)`, `--body`, `white-space: pre-wrap`, máximo 5 líneas.
- Si el tuit tiene media, la primera imagen debajo del texto (`aspect-ratio: 1.6`, radio 9 px, `margin-top:
  12px`). Sólo la primera.
- Cita (`quoteBlock`): caja con fondo `--sunk`, borde 1 px `--line`, radio 10 px, `padding: 12px`, miniatura
  56×56 radio 8 a la derecha; primera línea «Cita a @usuario» (y « · Artículo de X» si es un artículo) en
  12,5 px `--muted`; debajo el título del artículo (14 px 600 `--strong`, 2 líneas) o el texto (2 líneas).
  Ojo: `quoteBlock` también se usa en el lector; haz una variante para tarjetas (`quoteBlock(q, true)` o
  una función nueva) en vez de cambiar el aspecto en el lector.

**Pie de la tarjeta** (`.meta`, 12 px, `gap: 6px`):
- Estado de extracción como ahora (⏳ / ⚠︎) si lo hay.
- Hasta 3 etiquetas, sin `#`: `12px`, `padding: 3px 9px`, radio 999 px, fondo `--btn`, texto `--body`;
  siguen siendo `data-tag` (pulsar filtra).
- Si tiene nota: «Nota: …» con la nota en una línea (`--muted`, `text-overflow: ellipsis`), en lugar del 📝.
- Si es favorito: estrella rellena de 15 px en `--star`.
- A la derecha del todo, si no está leído: un punto de 8 px en `--accent` con `title="Por leer"`.

**Acciones** (favorito, leído, quitar de X si `inX(it)`, abrir en X si no es de X):
- Ya no van en el pie. Van en una fila flotante arriba a la derecha (sobre la portada a 8 px del borde de la
  imagen, o arriba a la derecha de la cabecera en los tuits), botones de 34×34, radio 9, fondo
  `color-mix(in srgb, var(--panel) 85%, transparent)`, icono 17 px `--strong`; `.on` como ahora (acento o
  estrella).
- Sólo se ven con `.card:hover`, `.card:focus-within` y `.card.focused`; con `@media (hover: none)` (móvil)
  se ven siempre, en el pie, alineadas a la derecha.
- Todos son `<button>` con `title` y `aria-label`.

**Leídos**: `opacity: .6` (ahora .72).

## 3. Vista de lista (D)

- **Selector** en la barra superior, entre el `<select id="sort">` y «Sorpréndeme»: un grupo de dos botones
  «Tarjetas» / «Lista» (`role="group"`, `aria-label="Vista"`, cada botón con `aria-pressed`). Contenedor con
  fondo `--panel`, borde `--line`, radio 11 px, `padding: 3px`; botones de 36 px de alto, radio 8, 13 px; el
  activo en 600 con fondo `--btn` y texto `--strong`.
- Se guarda en `state.layout` (`"cards"` | `"list"`) y en `localStorage` con la clave `"layout"`, siempre con
  `try/catch` como el tema. Al cambiar sólo se repinta (`renderGrid()`), no se recarga de la API.
- `#grid` lleva la clase `list` en esta vista y `card()` elige la plantilla según `state.layout` (o crea
  `row(it, i)` y que `renderGrid` use una u otra). Mantén la clase `card` y `data-i` en cada fila para que el
  clic, el foco j/k y `syncItem` sigan funcionando.
- `.grid.list`: `display: block` (sin columnas), `max-width: 940px`.
- Fila: `display: grid; grid-template-columns: 112px minmax(0, 1fr) auto; gap: 18px; align-items: center;
  padding: 16px 12px; border-radius: 12px; border: 0; border-bottom: 1px solid var(--line); background:
  transparent; box-shadow: none; margin: 0;` Hover: fondo `--panel`.
- Miniatura: 112×76, radio 9, `object-fit: cover`; la de reserva igual que en tarjetas (inicial a 24 px). En
  tuits sin imagen, el avatar redondo de 44 px centrado en esa columna.
- Centro: fila de origen como en tarjetas pero en una línea: origen · minutos o fecha · @usuario. Título: en
  artículos `600 17px/1.35 var(--ui)`; en tuits el texto del tuit con `400 16.5px/1.4 var(--read)`; en ambos
  una sola línea con `text-overflow: ellipsis`. Debajo, extracto (o la segunda parte del tuit, o la cita) en
  14 px `--muted`, una línea.
- Derecha: las mismas acciones siempre visibles, 36×36, sin fondo, `--muted`, `.on` como ahora.
- Etiquetas, nota y punto de «por leer» no se muestran en la lista (sí la estrella rellena si es favorito, que
  es el botón de favorito en estado `.on`).
- Leídos: `opacity: .6`.
- **Móvil** (`max-width: 700px`): miniatura 72×56 (avatar 40), `gap: 12px`, y de las acciones sólo queda
  favorito.

## 4. Cómo comprobarlo

1. `node --check public/app.js`.
2. Carga la copia y arranca: ver «Probar en local» en `CLAUDE.md`.
3. `npm run shots` con la vista en tarjetas. Para la lista, cambia la vista en las capturas: añade al script
   un tercer pase que guarde `localStorage.layout = "list"` (con `page.addInitScript`) y saque
   `escritorio-lista.png` y `movil-lista.png`; ese cambio en `scripts/screenshots.cjs` entra en el PR.
4. Compara con la maqueta: textos legibles, nada cortado de forma rara, acciones visibles al pasar el ratón,
   sin scroll horizontal a 390 px, tema claro y oscuro bien.
5. Comprueba a mano con Playwright que: pulsar una tarjeta abre el lector; pulsar la estrella marca favorito
   sin abrir el lector; pulsar una etiqueta filtra; el selector cambia de vista y se recuerda al recargar.
6. Abre el PR contra `main` con las capturas descritas y lo que hayas comprobado.
