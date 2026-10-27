# Migración de DíasLibres a Cloudflare

Destino separado: Worker `diaslibres-migracion` y D1 del mismo nombre. No se modifican los otros Workers o bases de la cuenta. El VPS continúa atendiendo el dominio durante la preparación.

## Arquitectura

Los archivos públicos se sirven con Workers Assets. El mismo servidor Express genera el HTML con SEO y los siete idiomas y procesa todas las APIs. Un Durable Object coordina las llamadas a LiteAPI, conserva los bloqueos de confirmación de pagos y guarda en SQLite las ofertas, los hoteles y los límites por IP para sobrevivir a reinicios. D1 guarda reservas, cuentas, sesiones, estadísticas y datos SEO. Los enlaces de acceso se consumen atómicamente en D1.

Claude sigue siendo el proveedor de IA; sus credenciales se configuran como secretos del Worker. LiteAPI/Nuitée y la pasarela actual siguen procesando los pagos. Las tarjetas bancarias no se trasladan ni se almacenan. Resend sigue enviando los correos de reservas. Los trabajos de conciliación usan un Cron Trigger cada 15 minutos; están desactivados en staging.

## Preparar una copia

Ejecutar en una carpeta de despliegue aislada del VPS, con Node 22.13 o posterior y la sesión de Wrangler autorizada:

```bash
npm ci
node --env-file=/opt/apps/Diaslibres/.env scripts/stage-cloudflare.mjs
```

El proceso prueba el código, crea D1, guarda una instantánea coherente de PostgreSQL en `/opt/backups/diaslibres-cloudflare`, importa los datos, compara cantidades y SHA-256 del contenido completo y publica el Worker. Envía solo las claves de servicios necesarias por stdin a Wrangler; no copia `DATABASE_URL` ni credenciales de otros servicios del VPS. Los respaldos tienen permisos 600; no deben publicarse ni enviarse por chat.

`MIGRATION_READ_ONLY=1` bloquea compras, cancelaciones y envío de correos de acceso. Las consultas de precios e IA siguen disponibles. El HTML temporal lleva `noindex`. No se cambia el DNS, no se detiene el servicio actual y no se reintentan pagos reales desde esta copia. Una reejecución comprueba la misma instantánea; si la importación quedó incompleta, se detiene sin borrar los datos.

Los archivos locales `wrangler.local.json` y `.migration-state.json` no se suben a Git. El primero contiene el identificador D1 real y la URL temporal; el segundo registra la base y la instantánea creadas por este proceso. No desplegar directamente la plantilla `wrangler.jsonc`, que tiene un identificador de ejemplo.

## Antes de cambiar el dominio

1. Comprobar la copia: HTML e idiomas, búsqueda, precios reales y respuesta de IA con `source=claude`. Verificar el almacenamiento D1, el correo y el modo sandbox de `/api/health`. Las comprobaciones técnicas no equivalen a un cobro real; la compra y su confirmación deben validarse en sandbox sin cargos antes de habilitar ventas.
2. Revisar la zona DNS devuelta por el preparador. Si `diaslibre.com` no es una zona activa en esa cuenta, resolver primero su configuración. No modificar registros de correo del VPS.
3. Preparar el cambio de dominio y una ventana breve sin nuevas escrituras. Detener el servicio de origen solo al hacer el corte final, guardando antes su configuración y un respaldo.
4. Crear una **segunda D1 vacía** para la instantánea final. Exportar de nuevo PostgreSQL tras detener el origen y verificar el contenido completo antes de usarla. Esto evita restaurar enlaces consumidos o reservas canceladas desde la instantánea inicial. No sobrescribir la base de pruebas ni reconciliar ambas copias simultáneamente.
5. Actualizar `DB`, `SITE_URL=https://diaslibre.com` y `MIGRATION_READ_ONLY=0` en la configuración preparada; configurar los dominios necesarios y desplegar. Preservar las URLs de retorno de LiteAPI y la configuración de los proveedores de acceso.
6. Verificar dominio, HTTPS, D1, IA, búsquedas, acceso y conciliación. Mantener el VPS y el respaldo para recuperación.

## Recuperación

Antes de habilitar escrituras en Cloudflare, se puede volver a activar el servicio VPS y restaurar el dominio. **Después de aceptar escrituras en Cloudflare no se puede volver directamente a la base PostgreSQL antigua**: antes hay que trasladar las nuevas reservas y cambios para evitar perder pagos o cuentas. No eliminar las bases ni los respaldos tras el primer despliegue.

## Validación local

`npm test` incluye pruebas reales de SQLite para la interfaz D1: pagos pendientes, cambios concurrentes, unicidad de checkout, cancelación, métricas y enlaces de un solo uso. El Worker se compila con `npx wrangler@4.153.0 deploy --dry-run --config cloudflare/wrangler.jsonc`. El arranque y las rutas de salud, HTML traducido, IA local y bloqueo de compras también se han comprobado en el motor workerd; Claude y los proveedores reales requieren los secretos del VPS y la verificación remota.
