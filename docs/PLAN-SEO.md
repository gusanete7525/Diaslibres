# Plan SEO de DíasLibres — viabilidad y versión revisada

Revisado el 6/10/2026 sobre el código de `main` (commit 8cf95b3) y la web en producción.
Para quien lo implemente: lee este documento entero antes de tocar nada.

## Veredicto

**Viable y recomendable, con ajustes.** La arquitectura SEO ya está muy bien hecha
(páginas por ciudad, filtros y rutas generadas en servidor, 7 idiomas con hreflang,
sitemaps por idioma, robots, llms.txt, IndexNow, JSON-LD). El plan encaja en ella sin
cambiar nada de reservas, pagos, cuentas ni LiteAPI. Riesgo bajo si se respetan las
condiciones de abajo.

## Lo que he comprobado

| Punto del plan | Situación real | Conclusión |
|---|---|---|
| `src/seo.js` | 328 líneas: `homePage`, `cityPage`, `routePage`, `renderPage`, `sitemap`, `sitemapIndex`. La portada solo cambia título y descripción. | Es el sitio correcto. Añadir una función `hubPage(lang, kind)`. |
| Rutas en `server.js` | `homeUrl`, `/{hoteles}/:slug`, `/{hoteles}/:slug/:filter`, `/{vuelos}/:slug` por idioma (líneas 133-154). `/hoteles` y `/vuelos` sin ciudad hoy dan 404. | Las rutas nuevas no chocan con nada. |
| Vuelos en el título | `/api/config` en producción: `liveFlights: true`, `flights: true`. | Se puede vender «vuelos» en la portada sin engañar. |
| Idiomas | Las URLs se traducen con `LANGS[lang].hotels/flights` (`src/i18n.js`). Textos: diccionarios `public/i18n/<idioma>.js` (unas 587 frases). | Las páginas nuevas necesitan una palabra de URL por idioma y sus frases en los 6 diccionarios. |
| Ciudades | `src/places.js`: 366 ciudades (159 en España, incluidas Valencia, Alicante, Benidorm, Dénia, Jávea, Calpe…) y 171 rutas. | La selección de ciudades españolas ya está hecha. |
| Rutas desde Levante | Salidas desde VLC: 4. Desde ALC: **0**. Desde MAD: 45. | `/viajes-desde-alicante` hoy saldría vacía. Antes hay que añadir rutas a `ROUTES`. |
| `app.js` | Solo entiende `data-start-view` = `flights` o `hotels` (línea ~1789). | Para `/viajes-con-ia` y `/donde-viajar` hay que añadir un valor (p. ej. `ai`) que enfoque la caja de IA. Cambio mínimo. |
| Pruebas | 8 archivos; `api.test.js` ya tiene 17 comprobaciones de SEO (sitemap, canonical, hreflang, robots, llms). No hay `seo.test.js`. | Crear `test/seo.test.js` sin quitar las que ya hay. |
| robots.txt / sitemap.xml | Dinámicos y correctos en producción. `express.static` va después de esas rutas, así que un archivo estático ni se serviría. | De acuerdo: no crear archivos. |
| `render.yaml` | Correcto. | No tocar. |

## Ajustes al plan original

1. **Título de portada: no perder «días libres / calendario».** «Viajes con inteligencia
   artificial» casi no se busca, y «vuelos y hoteles» a secas compite con Booking y
   Skyscanner. Lo único de DíasLibres es el calendario de precios. Propuesta (≤ 60 caracteres):
   - Título: `DíasLibres · Vuelos y hoteles baratos con calendario e IA`
   - Descripción (≤ 155): `Busca vuelos y hoteles, mira en un calendario qué días están libres y cuándo es más barato, o cuéntale a la IA cómo quieres viajar. Pago seguro.`
2. **H1 de portada.** De acuerdo con el cambio, pero el H1 tiene `data-i18n`: hay que
   traducirlo en los 6 diccionarios o saldrá en español en /en/, /fr/…
   - H1: `Encuentra tu próximo viaje con inteligencia artificial`
   - Subtítulo: `Busca vuelos y hoteles, compara precios o cuéntale a DíasLibres cómo quieres viajar.`
   - Debajo, la ventaja: `Mira qué días están libres y descubre cuándo es más barato viajar.`
3. **Páginas nuevas = contenido real, no texto de relleno.** Cinco páginas × 7 idiomas
   son 35 URLs; si son párrafos genéricos, Google las trata como contenido escaso y puede
   rebajar todo el dominio. Cada una debe tener enlaces y datos que ya existen:
   - `/hoteles`: ciudades agrupadas (España por comunidad/costa, Europa, mundo) + filtros populares.
   - `/vuelos`: rutas agrupadas por origen (Madrid, Barcelona, Valencia…) con enlace a cada `/vuelos/x-y`.
   - `/escapadas`: listas por tipo usando `FILTERS` y `city.type` (playa, montaña, spa, con niños, mascotas).
   - `/donde-viajar` y `/viajes-con-ia`: ejemplos de búsqueda que lanzan la IA de verdad
     (los mismos «ex-card» de la portada, ampliados) + destinos sugeridos. **Valorar fusionarlas
     en una sola** si no hay contenido distinto para las dos; dos páginas casi iguales se
     canibalizan.
4. **URLs traducidas.** Añadir a `LANGS` la palabra de cada página nueva por idioma
   (p. ej. `trips: 'viajes-con-ia' | 'ai-trips' | 'voyages-ia'…`, `escapes`, `whereTo`).
   `urlOf()` y `renderPage()` ya generan canonical y hreflang a partir de `key.type`:
   añadir `type: 'hub'` con `key.kind`.
5. **`/viajes-desde-{ciudad}` (fase 4): solo tras ampliar `ROUTES`.** Hoy Alicante no tiene
   ninguna ruta de salida y Valencia 4. Primero añadir en `places.js` las rutas reales desde
   ALC y VLC (las que opere el proveedor de vuelos en vivo) y generar la página solo si hay
   ≥ 5 rutas; si no, `noindex` (igual que ya se hace con los filtros vacíos).
6. **Datos estructurados.** De acuerdo con no inventar. En las páginas nuevas basta con
   `BreadcrumbList` (ya sale solo con `page.crumb`) y, en `/hoteles` y `/vuelos`,
   `ItemList` con los enlaces que se muestran. Nada de `Offer`/`AggregateRating` sin datos reales.
7. **`noindex`.** Mantener lo que hay (portada con parámetros, filtros vacíos, destinos
   inventados) y añadir: páginas hub de idioma sin traducción completa → `noindex` hasta
   que estén traducidas.
8. **llms.txt.** De acuerdo con la nueva frase de presentación; añadir enlaces a las páginas nuevas.

## Orden de trabajo (sin cambios de fondo)

1. **Fase 1** — `src/seo.js` (`homePage` nuevo, `hubPage`, sitemap), `server.js` (rutas
   hub por idioma), `test/seo.test.js`. `npm test` debe seguir en 54/54 + las nuevas.
2. **Fase 2** — portada: `index.html` (H1 y subtítulo), `styles.css` (bloques nuevos),
   `app.js` (solo `data-start-view="ai"`), frases nuevas en `public/i18n/*.js`.
3. **Fase 3** — contenido de las 4-5 páginas hub en los 7 idiomas.
4. **Fase 4** — rutas desde VLC/ALC en `places.js` y `/viajes-desde-*`.

## Qué comprobar antes de cada `git push` (push a `main` publica en Render)

- `npm test` en verde.
- Arrancar en local y revisar con `curl`: título, H1, canonical, hreflang, `noindex` y
  JSON-LD de `/`, `/en/`, `/hoteles`, `/en/hotels`, una ciudad, un filtro, una ruta y un 404.
- `/sitemap-es.xml` contiene las páginas nuevas y ninguna `noindex`.
- La búsqueda con IA, hoteles, vuelos, trenes y una reserva siguen funcionando igual.

## No tocar

LiteAPI, pagos, reservas, cuentas, PostgreSQL, correo, trenes, precios, calendario,
`render.yaml` y el sistema de idiomas (solo añadir frases y palabras de URL).

## Estado (6/10/2026)

Hecho y probado (`npm test`: 63/63, de ellas 9 nuevas en `test/seo.test.js`):

- **Portada:** título y descripción nuevos; H1 «Encuentra tu próximo viaje con *inteligencia
  artificial*» y subtítulo con vuelos, hoteles e IA, manteniendo el calendario. Traducidos a los 6 idiomas.
- **Páginas generales** en los 7 idiomas, con canonical, hreflang, migas y sitemap:
  `/hoteles` (todas las ciudades por zonas), `/vuelos` (todas las rutas por origen),
  `/escapadas` (playa, montaña, spa, niños, mascotas, todo incluido) y `/donde-viajar`
  (cómo usar la IA + destinos por tipo). `/viajes-con-ia` se ha fusionado en `/donde-viajar`
  para no tener dos páginas iguales.
- **Pie de todas las páginas:** «Explora: Hoteles · Vuelos · Escapadas · ¿Dónde viajar?».
- **app.js:** en las páginas generales no se lanza la búsqueda (se quedan los enlaces a la
  vista); en «¿Dónde viajar?» el cursor va a la caja de la IA.
- **llms.txt:** nueva presentación y enlaces a las páginas generales.
- No se ha tocado `styles.css` (las clases `.seo-intro` y `.seo-links` ya sirven),
  ni reservas, pagos, cuentas, LiteAPI, trenes ni `render.yaml`.

Pendiente:

- Fase 4: añadir rutas reales desde Valencia y Alicante a `ROUTES` y crear `/viajes-desde-*`.
- Tras publicar: enviar de nuevo `sitemap.xml` en Search Console y pedir la indexación de las 4 páginas.
