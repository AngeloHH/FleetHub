# Operación de FleetHub

Este documento cubre el despliegue actual en Netlify mientras los datos siguen
en Netlify Blobs. La migración a PostgreSQL tendrá su propio procedimiento de
migración, copia de seguridad y restauración.

## Configuración obligatoria

Los secretos se guardan en las variables de entorno de Netlify, nunca en Git ni
en `netlify.toml`. Antes de exponer el sitio deben revisarse:

- `GEOAPIFY_API_KEY`: autocompletado y geocodificación de direcciones.
- `AUTH_DELIVERY_WEBHOOK_URL`: entrega real de códigos por correo o SMS.
- `AUTH_DELIVERY_TOKEN`: autenticación del webhook, si el receptor la exige.
- `ALLOW_INSECURE_AUTH_CODES=false`: obligatorio en producción.
- `FLEETHUB_STAFF_EMAILS`: correos internos de soporte, separados por comas.
- `GEOAPIFY_DAILY_LIMIT` y `VIN_DECODER_DAILY_LIMIT`: topes diarios; el servidor
  avisa al 80 % y deja de llamar al proveedor al agotarlos.
- `SENTRY_DSN` o `ALERT_WEBHOOK_URL`: destino externo para errores y avisos.
- `VITE_TILE_URL` y `VITE_TILE_ATTRIBUTION`: proveedor de mapas para producción.
- `ALLOWED_ORIGINS`: sólo los dominios adicionales que realmente deban llamar
  al API. El frontend y la Function en el mismo sitio no necesitan CORS.

Los deploys de preview y desarrollo usan almacenes separados. Únicamente el
contexto `production` escribe en `fleethub-data` y `fleethub-photos`.

## Comprobación previa

Desde una copia limpia del repositorio:

```powershell
npm ci
npm run check
npm run test:e2e
```

El primer comando instala exactamente las versiones bloqueadas. `check` ejecuta
análisis estático, 333 pruebas y el build. Las doce pruebas E2E crean sus datos
sólo en memoria y comprueban en un navegador móvil la apertura, el mismo origen,
el registro del primer administrador, login, invitación de operador,
recuperación, cambio de contraseña y el flujo completo de una unidad.

GitHub Actions ejecuta los mismos controles en cada push y pull request. No se
debe promover un deploy cuya ejecución de `Quality` haya fallado.

## Despliegue

El flujo recomendado es conectar el repositorio al sitio de Netlify:

1. Cada rama o pull request produce un deploy preview aislado.
2. Se comprueba manualmente registro, login, mapa, cámara, GPS y subida de foto
   desde al menos un iPhone y un Android reales.
3. Sólo la rama principal promueve a producción después de pasar `Quality`.
4. Tras promover, se ejecuta `npm run check:health -- https://<dominio>` y se
   abre la URL pública. La comprobación falla si el API no contesta, si
   contesta algo que no es su JSON —el `index.html` de un host estático, por
   ejemplo— o si tarda más de lo permitido.

No debe desplegarse con `ALLOW_INSECURE_AUTH_CODES=true`: en ese modo los códigos
pueden aparecer en la respuesta para facilitar el desarrollo local.

## Rollback

Si falla la aplicación, desde Netlify se publica nuevamente el último deploy de
producción conocido como correcto. Después se repiten las comprobaciones de la
URL pública y del API.

Un rollback de código no revierte datos de Netlify Blobs. Mientras no exista
PostgreSQL, cualquier cambio que altere la estructura almacenada debe conservar
compatibilidad hacia atrás y usar la migración de `STORE_VERSION`. No se debe
subir una versión que borre o reinicie el almacén para resolver incompatibilidad.

## Vigilancia

`GET /api/health` contesta sin sesión y sin contar nada de dentro: qué servicio
es, en qué entorno, qué versión y qué versión de almacén. Que conteste ya prueba
lo que importa —el proceso vive y el almacén se pudo leer—, y con el almacén
caído devuelve `503`, no un `200` tranquilizador.

El monitor viaja con el repositorio: el workflow `Disponibilidad`
(`.github/workflows/uptime.yml`) ejecuta `scripts/check-health.mjs` cada diez
minutos. Un monitor que hay que contratar y configurar aparte es un monitor que
el día del despliegue nadie configuró.

Para ponerlo en marcha, en *Settings* del repositorio:

- Variables → `HEALTH_URL`: dirección pública de producción. Sin ella el
  workflow termina sin hacer nada.
- Variables → `HEALTH_URL_STAGING`: la de preview. Su fallo no tumba el trabajo.
- Variables → `HEALTH_BUDGET_MS`: milisegundos admitidos; 5000 por defecto.
- Secrets → `ALERT_WEBHOOK_URL` y `ALERT_WEBHOOK_TOKEN`: a dónde va el aviso.

Sin webhook el aviso no se pierde: el workflow abre una incidencia en el propio
repositorio con la etiqueta `disponibilidad`, y comenta en ella mientras siga
abierta en lugar de abrir una nueva cada diez minutos.

Las excepciones del servidor se escriben como JSON estructurado sin enviar el
detalle interno al navegador. Si se configura `SENTRY_DSN`, los errores se
envían a Sentry; `ALERT_WEBHOOK_URL` recibe además avisos de cuota. El nivel de
registro se ajusta con `FLEETHUB_LOG_LEVEL` (`debug`, `info`, `warn`, `error`);
por defecto se escribe desde `info`, que incluye una línea por petición.

## Eliminación de una compañía

Nada se borra por antigüedad: los datos se guardan hasta que alguien los borra.
Las sesiones, los códigos y los contadores de límite dejan de valer al vencer
—se comprueba su fecha en cada uso— pero sus filas se quedan.

`DELETE /api/companies/current?confirm=<companyId>` permite a un administrador
de la propia compañía borrar usuarios, unidades, locations, GPS, historial,
fotos, accesos, tokens y sesiones. Una cuenta de soporte no puede ejercer esta
acción usando una ventana temporal.

## Rotación de secretos

Para rotar una llave o token:

1. Crear la credencial nueva en el proveedor.
2. Reemplazar la variable privada en Netlify sin escribir el valor en Git.
3. publicar un deploy y comprobar la función afectada;
4. revocar la credencial anterior;
5. revisar los logs por errores posteriores.

Si se sospecha exposición, se revoca primero la credencial comprometida y se
desactiva temporalmente la función dependiente si todavía no existe reemplazo.
La llave de Geoapify debe restringirse por cuota y, cuando el proveedor lo
permita, por origen o servicio.

## Fotografías

El servidor acepta JPEG, PNG y WebP reales; rechaza archivos disfrazados, más de
8 MiB, más de 12 000 píxeles por lado o más de 40 megapíxeles. Antes de guardar
elimina EXIF, XMP, comentarios y metadatos textuales. La cámara del frontend
produce JPEG, por lo que una foto tomada en iPhone no depende de subir el HEIC
original.

## PostgreSQL pendiente

La beta con información real no debe abrirse hasta sustituir el objeto global de
Blobs por tablas transaccionales, migraciones versionadas y copias de seguridad
con una restauración probada. Las fotografías pueden continuar en almacenamiento
de objetos; PostgreSQL guardará su registro y relación con compañía, VIN y
operador.
