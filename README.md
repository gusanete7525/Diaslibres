# DíasLibres

Agencia de reservas de **hoteles y vuelos** donde no hace falta elegir fechas para ver qué hay.

- **Calendario de disponibilidad en cada hotel y vuelo**: los días libres salen en **verde** (con su precio) y los completos en **rojo**. Tocas un día verde para la entrada y otro para la salida, y listo.
- **Gráfica de precios**: barras con el precio de cada día de los próximos 60 días; se marca el día más barato, y al pasar el ratón ves precio y plazas libres.
- **«Días más baratos»**: un botón calcula las noches seguidas libres más económicas para la estancia que buscas.
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
```

Tests: `npm test`

## Estructura

| Ruta | Qué hace |
|---|---|
| `server.js` | API Express + estáticos |
| `src/catalog.js` | Hoteles, vuelos y modelo de demanda/temporada |
| `src/availability.js` | Calendario diario (precio, plazas libres), búsqueda, ventana más barata y validación de reservas |
| `src/ai.js` | Búsqueda en lenguaje natural (Claude o intérprete local) |
| `src/store.js` | Reservas guardadas en `data/bookings.json` |
| `public/` | Interfaz (HTML/CSS/JS sin dependencias, modo claro y oscuro) |

### API

- `GET /api/hotels?destination=&nights=&maxPrice=&sort=price|rating&tags=&days=`
- `GET /api/flights?origin=&destination=&maxPrice=&days=`
- `POST /api/ai-search` `{ query }`
- `POST /api/quote` · `POST /api/bookings` `{ type: "hotel"|"flight", itemId, checkIn, checkOut | date, units, name, email }`
- `GET /api/bookings?email=` · `POST /api/bookings/:code/cancel` `{ email }`

## Notas

El catálogo es de demostración: precios y ocupación de «otros clientes» se generan de forma determinista según temporada y fin de semana, y se suman las reservas reales hechas en la web. No hay pasarela de pago; para producción haría falta una base de datos, pagos y conexión a proveedores reales (channel manager / GDS).
