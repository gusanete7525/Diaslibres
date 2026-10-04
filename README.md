# DíasLibres

Agencia de reservas de **hoteles y vuelos** donde no hace falta elegir fechas para ver qué hay.

- **Calendario de disponibilidad en cada hotel y vuelo**: los días libres salen en **verde** (con su precio) y los completos en **rojo**. Tocas un día verde para la entrada y otro para la salida, y listo.
- **Gráfica de precios**: barras con el precio de cada día de los próximos 60 días; se marca el día más barato, y al pasar el ratón ves precio y plazas libres.
- **«Días más baratos»**: un botón calcula las noches seguidas libres más económicas para la estancia que buscas.
- **Precios, disponibilidad y reservas reales con LiteAPI** (opcional): con `LITEAPI_KEY` definida, los hoteles de la ciudad buscada, sus fotos, estrellas y opiniones vienen de [LiteAPI](https://liteapi.travel/). El calendario se rellena con el precio real de cada noche (sin tarifa esa noche = día en rojo), cargado por semanas y guardado 3 h en caché. Reservar pide el presupuesto exacto (habitación, régimen y si es reembolsable), bloquea la tarifa y confirma la reserva; «Mis reservas» la cancela también en LiteAPI. Con una clave `sand_…` todo ocurre en el entorno de pruebas de LiteAPI: no se cobra nada. Los vuelos siguen simulados.
- **Hoteles reales de cualquier ciudad** vía OpenStreetMap (sin registro ni clave): al buscar un destino, el servidor localiza la ciudad con Nominatim y pide a Overpass los hoteles con nombre de la zona (hasta 30), con estrellas, dirección y web si figuran. Se guardan en caché una semana (`data/osm-cache.json`) y las peticiones se espacian ≥1 s para respetar las [normas de uso](https://operations.osmfoundation.org/policies/api/). Si OSM no responde, se muestran los hoteles del catálogo con un aviso. Desactivable con `DIASLIBRES_OSM=off`; URLs configurables con `NOMINATIM_URL`, `OVERPASS_URL` y `OSM_USER_AGENT` (pon uno que te identifique, p. ej. con tu email).
- **Búsqueda con IA**: escribe en lenguaje natural («playa con niños en Canarias 5 noches», «vuelos de Madrid a Lisboa») y se rellenan los filtros solos.
  - Con `ANTHROPIC_API_KEY` usa Claude (modelo `claude-opus-5-5`, configurable con `DIASLIBRES_MODEL`) con salida estructurada.
  - Sin clave funciona igualmente con un intérprete local de palabras clave.
- **Reserva directa**: la reserva se confirma al momento con un código (`DL-XXXXXX`), se comprueba la disponibilidad noche a noche y el día pasa a rojo cuando se llena. En «Mis reservas» puedes consultarlas y cancelarlas por email.

## Arrancar

```bash
npm install
npm start               # http://localhost:3000
# opcional:
ANTHROPIC_API_KEY=sk-ant-... npm start
LITEAPI_KEY=sand_... npm start   # hoteles con datos de LiteAPI
```

Detrás de un proxy (`HTTPS_PROXY`), arranca con `NODE_USE_ENV_PROXY=1` para que Node lo use (Node ≥ 22.21).

Tests: `npm test`

## Estructura

| Ruta | Qué hace |
|---|---|
| `server.js` | API Express + estáticos |
| `src/catalog.js` | Hoteles, vuelos y modelo de demanda/temporada |
| `src/availability.js` | Calendario diario (precio, plazas libres), búsqueda, ventana más barata y validación de reservas |
| `src/liteapi.js` | LiteAPI: hoteles, precio por noche, presupuesto, reserva y cancelación |
| `src/osm.js` | Hoteles de OpenStreetMap (Nominatim + Overpass) con caché |
| `src/ai.js` | Búsqueda en lenguaje natural (Claude o intérprete local) |
| `src/store.js` | Reservas guardadas en `data/bookings.json` |
| `public/` | Interfaz (HTML/CSS/JS sin dependencias, modo claro y oscuro) |

### API

- `GET /api/hotels?destination=&nights=&maxPrice=&sort=price|stars&tags=&days=`
- `GET /api/flights?origin=&destination=&maxPrice=&days=`
- `POST /api/ai-search` `{ query }`
- `POST /api/quote` · `POST /api/bookings` `{ type: "hotel"|"flight", itemId, checkIn, checkOut | date, units, name, email }`
- `GET /api/bookings?email=` · `POST /api/bookings/:code/cancel` `{ email }`

## Notas

Los **24 hoteles son reales** (2 por ciudad): nombre, categoría, dirección, web oficial y una fuente pública de verificación están en `src/catalog.js`. Lo que **no** es real es el inventario: precios y ocupación de «otros clientes» se generan de forma determinista según temporada y fin de semana, y se suman las reservas reales hechas en la web. Las reservas no se envían al hotel y no hay pasarela de pago; para producción haría falta una base de datos, pagos y conexión a proveedores reales (channel manager / GDS).

## Pago y reservas

- **Pago del cliente (por defecto con LiteAPI):** «Pagar y reservar» bloquea la habitación al precio mostrado (`/api/checkout`), muestra el formulario de tarjeta de la pasarela de LiteAPI y, al pagar, el cliente vuelve a `/?pago=<id>`, donde la reserva se confirma con el pago (`/api/checkout/:id/confirm`). Sin pago completado no hay reserva ni cargo. En el entorno de pruebas se paga con la tarjeta `4242 4242 4242 4242`, cualquier fecha futura y cualquier CVC.
- `LITEAPI_PAYMENT=account` vuelve al modo anterior (se carga a la cuenta de LiteAPI del titular); con la clave real solo funciona con `ALLOW_REAL_BOOKINGS=1`.
- `PUBLIC_URL` (opcional): dirección pública de la web para la vuelta del pago, si no se deduce bien de la petición.
- **Emails al cliente:** confirmación y cancelación con [Resend](https://resend.com) si defines `RESEND_API_KEY`. `MAIL_FROM` es el remitente (por ejemplo `DíasLibres <reservas@tudominio.es>`, con el dominio verificado en Resend); sin dominio propio, Resend solo deja enviar a tu propio email desde `onboarding@resend.dev`. Un fallo del email nunca anula la reserva.
- **Reservas guardadas:** en PostgreSQL si hay `DATABASE_URL` (Render la crea con `render.yaml`); si no, en `data/bookings.json`.

## Publicar en internet (Render)

El repositorio incluye `render.yaml` para desplegar en [Render](https://render.com) con su plan gratuito:

1. Crea una cuenta en Render y conecta tu GitHub.
2. **New → Blueprint** y elige este repositorio (rama `main`).
3. Render pedirá los valores de `LITEAPI_KEY` (y opcionalmente `ANTHROPIC_API_KEY`). No se guardan en el repositorio.
4. Al terminar, la web queda en `https://diaslibres.onrender.com` (o un nombre parecido).

Notas del plan gratuito: el servicio se duerme tras un rato sin visitas (la primera visita tarda ~1 min en despertar). Las reservas se guardan en la base de datos PostgreSQL que crea `render.yaml`; consulta en Render los límites de su plan gratuito de bases de datos.

**Clave real de LiteAPI:** con una clave que no empieza por `sand_` los precios, la disponibilidad y los cobros son reales: el cliente paga con su tarjeta en la pasarela de LiteAPI y la reserva se hace en el hotel.

## Dominio propio y plan

1. En Render, cambia el servicio al plan **Starter** (de pago) para que la web no se duerma. En `render.yaml` sería `plan: starter`.
2. Compra el dominio (por ejemplo `diaslibres.es`) en un registrador.
3. En Render → servicio → **Settings → Custom Domains**, añade el dominio y crea en tu registrador los registros DNS que te indique. Render pone el certificado HTTPS solo.
4. Define `PUBLIC_URL=https://tudominio.es` para que la vuelta del pago use el dominio.

## Información legal

`public/legal.html` es una **plantilla** de aviso legal, condiciones de reserva, privacidad y cookies. Complétala con los datos marcados entre corchetes y revísala con un asesor antes de vender. Al reservar, el cliente debe aceptar las condiciones y la política de privacidad.
