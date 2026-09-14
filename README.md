# FleetHub

FleetHub is a mobile fleet-management app. Operators scan a vehicle's VIN with the camera, locate each unit on a live map, and update its status (in transit, storage, service, reserved, sold)

## Stack

React 19 + TypeScript + Vite 8, with MapLibre GL for the live map.

## What's implemented

The whole of `FleetHub.dc.html` from the Claude Design project — 18 screens, each
in an iOS device frame:

| Code | Screen | Code | Screen |
| --- | --- | --- | --- |
| A | Inicio de sesión | 04 | Alertas |
| B | Registro | 05 | Perfil |
| C | Confirmar código | 05b | Datos personales |
| D | Crear contraseña | 06 | Administración |
| 00 | Dashboard (mapa en vivo) | 06b | Admin · Rutas |
| 00b | Modificar unidad | 06c | Admin · Editar ruta |
| 01 | Escaneo VIN | 07 | Admin · Usuarios |
| 02 | Confirmación VIN | 07b | Admin · Código de alta |
| 03 | Flota | 08 | Admin · Historial |

### Layout

- `src/design/tokens.ts` — colours, type stacks and the frame/strip metrics every screen shares.
- `src/components/IOSDevice.tsx` — the device frame, ported from the design project's `ios-frame.jsx`. Only the frame and status bar are ported: the screens are full-bleed and never pass `title`, `dark` or `keyboard`, so the kit's nav bar, list, glass pill and keyboard would be dead code.
- `src/components/ui.tsx` — top strip, tab bars, buttons, cards, toggle.
- `src/components/icons.tsx` — the design's SVG icon set.
- `src/components/FleetMap.tsx` — MapLibre over OpenStreetMap raster tiles.
- `src/screens/*.tsx` — the screens, grouped by flow.

### Notes on the port

- **Hover.** The design expresses hover through a `style-hover` attribute, which
  is a feature of the `dc-runtime` that renders `.dc.html` and does not exist in
  React. Each distinct `style-hover` value maps to one class in `src/index.css`.
- **Fonts.** Archivo, IBM Plex Mono and Instrument Serif are inlined as data URIs
  by `npm run build:fonts` (see below) rather than linked from Google Fonts, so
  the app has no third-party runtime dependency.
- **The map's grayscale.** `filter: grayscale(.92)` is applied to the map
  container, and MapLibre renders markers inside that container — so the orange
  crosshair is desaturated along with the tiles. That is what the design source
  does, and it is reproduced as-is rather than "fixed".

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with HMR at `localhost:5173` |
| `npm run build` | Type-check (`tsc -b`) then build to `dist/` |
| `npm run build:preview` | Build to `dist-preview/`, inlining every asset into `preview.html` |
| `npm run build:fonts` | Re-download the web fonts and regenerate `src/assets/fonts.css` |
| `npm run preview` | Serve the `dist/` build locally |
| `npm run lint` | oxlint |

## Autocompletado de direcciones

El editor de locations consulta Geoapify a través del servidor; la llave nunca
se envía al frontend. Copia `.env.example` como `.env`, establece
`GEOAPIFY_API_KEY` y reinicia `npm run server`. La búsqueda espera 300 ms entre
la escritura y la consulta, muestra hasta cinco direcciones y guarda únicamente
la dirección seleccionada con su latitud y longitud. El desplegable conserva la
atribución exigida por el plan gratuito.

## Configuración y seguridad

`.env.example` contiene únicamente nombres y valores de desarrollo; `.env` está
ignorado y nunca debe publicarse. En Netlify los secretos se configuran desde el
panel o CLI, no en `netlify.toml`.

Los códigos de correo/teléfono tienen dos modos explícitos:

- Desarrollo local: `ALLOW_INSECURE_AUTH_CODES=true` permite que la interfaz
  muestre el código para probar el flujo sin proveedor.
- Producción: configure `AUTH_DELIVERY_WEBHOOK_URL` y opcionalmente
  `AUTH_DELIVERY_TOKEN`. El webhook recibe `addressee`, `purpose`, `code` y
  `expiresAt`; con la opción insegura desactivada el código nunca aparece en la
  respuesta del API. Si no existe un canal de entrega, el servidor rechaza la
  operación en lugar de fingir que envió el código.

`ALLOWED_ORIGINS` acepta una lista separada por comas para los únicos orígenes
que necesiten CORS. La aplicación desplegada junto a su Function funciona por
mismo origen y no necesita CORS abierto.

`FLEETHUB_STAFF_EMAILS` es la lista separada por comas de cuentas internas de
soporte. Sólo la configuración privada del servidor puede convertir una cuenta
en soporte; un registro o una modificación de perfil nunca puede hacerlo. El
acceso a una compañía usa una llave de soporte, queda registrado y caduca a las
ocho horas o cuando se cierra manualmente.

## Comprobación antes de desplegar

Ejecuta `npm run check`. El comando revisa el código, ejecuta todas las pruebas,
comprueba TypeScript y genera el build. El mismo comando está configurado en
GitHub Actions mediante `.github/workflows/quality.yml`. `npm run test:e2e`
levanta el build con la API local y ejecuta las pruebas de navegador móvil; en
Windows reutiliza Edge y en CI instala Chromium de forma aislada.

## Los documentos

| Documento | Qué contiene |
| --- | --- |
| [`PRODUCTION_READINESS.md`](./PRODUCTION_READINESS.md) | Qué falta para producción y quién puede hacerlo |
| [`OPERATIONS.md`](./OPERATIONS.md) | Configuración, despliegue, rollback, vigilancia y rotación de secretos |
| [`PRIVACIDAD.md`](./PRIVACIDAD.md) | Qué se guarda, quién lo ve, cuánto dura y cómo se borra |
| [`DECISIONES.md`](./DECISIONES.md) | Las decisiones que estaban abiertas, y qué haría falta para cambiarlas |
| [`endpoints.json`](./endpoints.json) | El contrato del API, atado al servidor por pruebas |

## Sin conexión no

FleetHub es explícitamente online. El servidor manda y la balda del navegador es
su copia, no una cola de trabajo pendiente: no hay modo sin conexión, no hay
acceso local con contraseña y el perfil lo dice en lugar de ofrecer un
interruptor que no enciende nada. El porqué y qué haría falta para cambiarlo
están en [`DECISIONES.md`](./DECISIONES.md).

### `build:preview`

Builds with `vite-plugin-singlefile` so JS and CSS are inlined, then runs
`scripts/make-preview.mjs`, which inlines any sprite and strips the document
wrapper. The result — `dist-preview/preview.html` — has zero external
references, so it can be opened or hosted anywhere as a single file. The script
exits non-zero if any external reference survives.

Map tiles are the one thing a single file cannot carry: they are fetched from
whatever `VITE_TILE_URL` names — `tile.openstreetmap.org` in development — at
runtime. Where that host is unreachable the map falls back to a schematic grid
and still draws its unit markers, and on a device without WebGL2 it says so
instead of taking the screen down with it.
