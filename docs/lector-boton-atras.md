# Especificación: el botón «atrás» cierra el lector

Aprobada por Javier el 29 oct 2026. Lee antes `CLAUDE.md` (reglas y cómo probar).

**Problema**: en el móvil el lector ocupa toda la pantalla y lo natural es cerrarlo con el gesto o el botón
«atrás». Hoy el lector no deja nada en el historial (`openItem` sólo añade la clase `open` al `#drawer`), así que
«atrás» sale de Tweetshelf y vuelve a la web anterior.

**Solución**: abrir el lector apunta una entrada en el historial con `history.pushState` y la URL pasa a
`#/item/<id>`. Al ir atrás, el evento `popstate` cierra el lector. Sólo se toca `public/app.js` (unas 30
líneas). No cambian el Worker, la base de datos, el HTML ni el CSS.

## 1. Comportamiento esperado

| Situación | Resultado |
|---|---|
| Abrir un elemento desde la portada (clic, Enter, «Sorpréndeme») | Se abre el lector y la URL pasa a `#/item/<id>`. Hay **una** entrada nueva en el historial. |
| Ya en el lector, pasar a otro elemento (j/k, un citado, «Citado por», «Quedarme sólo con el citado») | La URL cambia al nuevo id, pero **sin** entrada nueva (`replaceState`). Un solo «atrás» vuelve a la portada. |
| Repintar el mismo elemento (favorito, leído, etiquetas, f/r/e) | La URL no cambia y tampoco se añade ninguna entrada. |
| «Atrás» (gesto de iOS/Android, botón del navegador, Alt+←) con el lector abierto | Se cierra el lector. La URL vuelve a la de la portada, sin hash, y el scroll de la portada se queda donde estaba. |
| Cerrar con la X, Esc o tocando el fondo (`#scrim`) | Igual que «atrás»: se llama a `history.back()` y el cierre real lo hace `popstate`. Así no queda una entrada colgando que haga falta pulsar dos veces. |
| «Adelante» después de cerrar | Se vuelve a abrir el mismo elemento. |
| Eliminar el elemento desde el lector | Se cierra como con la X y después `refresh()`, igual que ahora. Si luego se va «adelante», el elemento ya no existe: se muestra un toast «Ese elemento ya no está en tu estantería» y se vuelve atrás. |
| Filtrar por autor desde el lector (`data-author`) | Se cierra como con la X y se aplica el filtro, igual que ahora. |
| Recargar la página con el lector abierto | Se vuelve a abrir el mismo elemento, encima de la portada. «Atrás» lo cierra. |
| Abrir un enlace directo `…/#/item/<id>` en una pestaña nueva | Se carga la portada, se abre el elemento encima y «atrás» cierra el lector **sin salir** de Tweetshelf. |
| Enlace directo a un id que no existe | Se queda la portada, sin hash, y aparece el toast «Ese elemento ya no está en tu estantería». |

Lo que **no** cambia: la portada no se recarga al cerrar (ni `load()` ni `refresh()`), el foco y `state.focus`
se mantienen y los atajos de teclado funcionan igual.

## 2. Implementación en `public/app.js`

### 2.1. Separar «ocultar» de «cerrar»

- Renombra la función actual `closeDrawer()` a `hideDrawer()`, sin cambiar su cuerpo. Es la que oculta el
  lector de verdad.
- Crea una función `closeDrawer()` nueva, que es la que usan todos los sitios que hoy cierran el lector (la X,
  Esc, el `#scrim`, eliminar y filtrar por autor):

```js
// Cerrar es «ir atrás»: así la X, Esc y el gesto del móvil dejan el historial igual.
function closeDrawer() {
  if (history.state?.reader) history.back();
  else hideDrawer();
}
```

La rama `else` cubre que el lector se haya abierto sin entrada en el historial (no debería pasar, pero así nunca
se queda abierto).

**Ojo con eliminar**: hoy hace `closeDrawer(); return refresh();`. `history.back()` es asíncrono, pero eso no
importa, porque `refresh()` no depende del lector. Déjalo como está.

### 2.2. Apuntar la entrada al abrir

Al final del bloque de `openItem` donde ya se calcula `const wasOpen = d.classList.contains("open");`, después
de añadir la clase `open`:

```js
  // Una sola entrada en el historial por lectura: «atrás» siempre vuelve a la portada.
  const url = `#/item/${encodeURIComponent(full.id)}`;
  if (history.state?.reader) history.replaceState({ reader: full.id }, "", url);
  else history.pushState({ reader: full.id }, "", url);
```

Usa `history.state?.reader` y no `wasOpen`. Así funciona también cuando el lector se abre desde `popstate`
(adelante) o al recargar, que es cuando ya existe la entrada.

### 2.3. Escuchar `popstate`

```js
// Atrás/adelante del navegador: el historial manda sobre el lector.
addEventListener("popstate", () => {
  const id = history.state?.reader;
  if (!id && state.open) hideDrawer();
  else if (id && state.open?.id !== id) openReader(id);
});
```

### 2.4. Abrir desde la URL (recarga y enlaces directos)

Crea `openReader(id)`, que abre por id y avisa si ya no existe. Úsala en `popstate` y en el arranque:

```js
async function openReader(id) {
  try { await openItem({ id }); }
  catch {
    toast("Ese elemento ya no está en tu estantería");
    if (history.state?.reader) history.replaceState(null, "", location.pathname + location.search);
    hideDrawer();
  }
}
```

Al arrancar, donde hoy está la última línea `refresh();`:

```js
refresh();
// Recarga con el lector abierto: la entrada ya existe y se reutiliza. Enlace directo: se deja la portada
// debajo (sin hash) y se abre encima, para que «atrás» no saque de Tweetshelf.
const deep = location.hash.match(/^#\/item\/([^/]+)$/);
if (history.state?.reader) openReader(history.state.reader);
else if (deep) {
  history.replaceState(null, "", location.pathname + location.search);
  openReader(decodeURIComponent(deep[1]));
}
```

`openItem` pide el elemento completo a `/api/items/:id`, así que no hace falta esperar a que acabe `refresh()`.

## 3. Casos raros ya contemplados

- **Sesión caducada**: `api()` manda a `/login` y el hash se pierde. Después de entrar se ve la portada, y es
  aceptable.
- **Recargar varias veces**: como al recargar se reutiliza la entrada (`replaceState`), no se acumulan entradas.
- **Escape dentro de un campo** (notas, etiquetas): sigue quitando el foco, sin cerrar, igual que ahora.
- **Diálogo de importar y menú lateral del móvil**: quedan fuera de este cambio y siguen igual.
- **Ids**: son ids de tuit (números largos en texto). Nunca los conviertas a `Number`, porque pierden precisión.

## 4. Cómo probarlo

1. `node --check public/app.js` y `npm run shots`, que no deben dar errores de JavaScript.
2. Comprueba con Playwright, en un script suelto que no hace falta subir, contra `http://localhost:8787` con la
   copia sembrada:
   - Abrir la portada, clic en la primera `.card` → `#drawer.open` existe y `location.hash` empieza por
     `#/item/`.
   - Pulsar `j` dos veces → el hash cambia, y `page.goBack()` **una vez** deja el lector cerrado y la URL sin hash.
   - `page.goForward()` → vuelve a abrirse el lector.
   - Abrir, pulsar Esc → lector cerrado, URL sin hash. Volver a abrir, clic en la X y después en el `#scrim` → igual.
   - Ir a `about:blank` y luego a `http://localhost:8787/#/item/<id real>` → lector abierto; `page.goBack()` →
     lector cerrado y la página **sigue** en localhost.
   - `page.reload()` con el lector abierto → sigue abierto; `page.goBack()` → portada.
   - `…/#/item/0` → portada sin hash y toast visible.
   - Repítelo con un viewport de 390×844 (móvil).
3. En el cuerpo del PR, describe lo que se ha comprobado de esta lista.
