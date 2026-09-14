# Preparación de FleetHub para producción

## Estado actual

Todo lo que no dependía de elegir base de datos está terminado. Queda la
migración del estado de Netlify Blobs a PostgreSQL —bloqueador 2— y un puñado
de cosas que no son código: credenciales de proveedores que hay que contratar,
una revisión legal y una tanda de pruebas en teléfonos de verdad. Cada una está
abajo con su nombre y con quién puede hacerla.

Mientras tanto el estado se guarda con comprobación de revisión, así que dos
peticiones simultáneas ya no se pisan en silencio: la que llega tarde recibe un
`409` y el cliente reintenta. No es una transacción y no pretende serlo — es
que dejar de perder escrituras no tenía por qué esperar a la base de datos.

## Bloqueadores

### 1. Aislamiento entre compañías

Cada usuario, location, vehículo, asignación, evento, foto, alerta y
autorización está asociado al UUID de su compañía, y toda lectura y
modificación filtra por él.

- [x] Añadir `companyId` a todas las entidades de negocio.
- [x] Filtrar todas las listas por la compañía de la sesión.
- [x] Verificar la compañía en cada modificación y eliminación.
- [x] Impedir asignaciones entre entidades de compañías diferentes.
- [x] Cubrir dos compañías simultáneas en pruebas de autorización.

### 2. Persistencia transaccional — pendiente de PostgreSQL

El estado completo se guarda hoy como un único objeto `state` en Netlify Blobs.
Blobs ofrece almacenamiento persistente y escritura condicional por ETag, que es
lo que impide perder escrituras, pero no transacciones que coordinen varias
operaciones.

**Esto es lo único que queda por diseñar y construir.** Es lo siguiente.

- [ ] Diseñar el esquema PostgreSQL.
- [ ] Crear migraciones versionadas y reversibles.
- [ ] Migrar usuarios, compañías, locations, vehículos, asignaciones y eventos.
- [ ] Mantener almacenamiento de objetos para las fotografías.
- [ ] Configurar backups y probar una restauración.
- [ ] Sustituir el reinicio por `STORE_VERSION` por migraciones de datos.

### 3. Verificación de identidad y abuso

- [x] Entregar los códigos por un canal configurable, o rechazar la operación
      si no hay ninguno en lugar de fingir que se envió.
- [x] Ocultar el OTP en respuestas de producción.
- [x] Mantener una opción explícita y exclusiva de desarrollo local.
- [x] Limitar creación y comprobación de códigos, por IP y destinatario.
- [x] Limitar intentos de contraseña y creación de compañías.
- [x] Rechazar campos internos como `staff` en registros públicos: quién es de
      FleetHub lo dice `FLEETHUB_STAFF_EMAILS`, no el cuerpo de una petición.
- [ ] **Contratar el proveedor de correo o SMS y poner sus credenciales.** El
      código está listo: `AUTH_DELIVERY_WEBHOOK_URL` recibe
      `{ addressee, purpose, code, expiresAt }`. Falta la cuenta.

### 4. Contrato compartido entre frontend y API

- [x] Sincronizar eventos de vehículos.
- [x] Sincronizar alertas descartadas.
- [x] Subir fotografías por `POST /api/vehicles/:vin/photos`.
- [x] Unificar el formato de eventos del frontend y del servidor.
- [x] Hacer autoritativos los accesos de soporte, con caducidad y auditoría en
      el servidor.
- [x] Describir el contrato en `endpoints.json`, con pruebas que impiden que se
      separe del servidor por los dos lados.

### 5. Sesiones y seguridad web

- [x] Invalidar sesiones al cerrar sesión.
- [x] Invalidar las demás sesiones al cambiar la contraseña.
- [x] Eliminar datos privados persistentes del navegador al cerrar sesión.
- [x] Retirar el login local mientras el modo offline no esté implementado.
- [x] Restringir CORS al origen permitido.
- [x] No enviar mensajes internos de excepciones al cliente.
- [x] Añadir CSP, HSTS, protección de frames y Permissions Policy.
- [x] Aplicar los mismos encabezados a respuestas de Netlify Functions.

### 6. Operación y despliegue

- [x] Inicializar el proyecto en Git y conservar historial de cambios.
- [x] Añadir integración continua para lint, tests y build.
- [x] Separar el almacenamiento de desarrollo, preview y producción.
- [x] Fijar la versión de Node.
- [x] Crear `.env.example` sin secretos.
- [x] Generar logs estructurados sin secretos y prepararlos para Sentry o un
      webhook.
- [x] Configurar monitor de disponibilidad y alertas: `/api/health`,
      `scripts/check-health.mjs` y el workflow `Disponibilidad`, que abre una
      incidencia si no hay webhook a donde avisar.
- [x] Documentar despliegue, rollback, recuperación y rotación de secretos.
- [ ] **Poner `HEALTH_URL` en el repositorio y, si se quiere aviso externo,
      `SENTRY_DSN` o `ALERT_WEBHOOK_URL`.** Sin `HEALTH_URL` el monitor termina
      sin hacer nada, a propósito: un rojo permanente enseña a ignorar los rojos.

## Antes de una beta controlada

- [x] Flujos E2E: registro, login, recuperación, invitaciones y cambio de clave.
- [x] Flujos E2E: escaneo/manual, asignación, cambio de estado, fotos y reportes.
- [x] Pruebas de concurrencia y aislamiento entre compañías.
- [x] Pruebas móviles automatizadas: permisos, GPS, foto que sube, archivo
      indecodificable, mapa sin WebGL y alta manual con posición.
- [x] Límites y alertas de consumo para Geoapify y el decodificador VIN.
- [x] Eliminación completa de una compañía y sus fotos.
- [x] Tratamiento de EXIF y límites seguros de formato, peso y dimensiones.
- [x] Decidir Face ID: se retira hasta implementarlo con passkeys/WebAuthn.
      Ver `DECISIONES.md`.
- [x] Mantener el producto explícitamente online hasta implementar offline.
- [x] Escribir la política de privacidad, retención y eliminación contra el
      código: `PRIVACIDAD.md`.
- [ ] **Probar cámara, GPS y HEIC en un iPhone y un Android reales.** Lo
      automatizable ya está automatizado; el sensor de la cámara, la precisión
      del GPS al aire libre y el decodificador HEIC de Safari necesitan
      aparatos. Guion en `OPERATIONS.md`, «Despliegue», paso 2.
- [ ] **Contratar un proveedor de tiles y poner `VITE_TILE_URL` con su
      `VITE_TILE_ATTRIBUTION`.** El código ya es agnóstico y el build de
      producción se detiene sin proveedor, porque el servidor público de
      OpenStreetMap no admite producción.
- [ ] **Revisar y publicar la política legal.** `PRIVACIDAD.md` describe el
      sistema; quien responda jurídicamente por el producto debe decidir el
      responsable del tratamiento y la base legal, y publicarla donde la
      aplicación enlace.

## Estado técnico verificado

- 333 pruebas automatizadas pasan.
- 12 pruebas E2E en navegador móvil: cinco de flujo completo —apertura, mismo
  origen, autenticación, y VIN → location → asignación → estado → GPS → foto →
  evento → alerta— y siete específicas de teléfono.
- El análisis estático no reporta errores.
- El build de producción termina correctamente.
- `npm audit` no reporta vulnerabilidades conocidas en dependencias de
  producción.
- El bundle de MapLibre sigue siendo grande —943 kB, ya en su propio trozo— y
  se optimizará después de PostgreSQL.

## Orden de trabajo recomendado

1. PostgreSQL: esquema, migraciones, backups y una restauración probada.
2. Las tres credenciales que faltan: correo/SMS, tiles y seguimiento de errores.
3. La tanda de pruebas en teléfonos reales.
4. La revisión legal de la política de privacidad.
5. Rendimiento, accesibilidad, offline y detalles visuales.

## Dónde está cada cosa

| Documento | Qué contiene |
| --- | --- |
| [`OPERATIONS.md`](./OPERATIONS.md) | Configuración, despliegue, rollback, vigilancia y rotación de secretos |
| [`PRIVACIDAD.md`](./PRIVACIDAD.md) | Qué se guarda, quién lo ve, cuánto dura y cómo se borra |
| [`DECISIONES.md`](./DECISIONES.md) | Las decisiones que estaban abiertas, y qué haría falta para cambiarlas |
| [`endpoints.json`](./endpoints.json) | El contrato del API, atado al servidor por pruebas |
| [`README.md`](./README.md) | Qué es la aplicación y cómo se trabaja en ella |
