# FleetHub

FleetHub is a mobile fleet-management app. Operators scan a vehicle's VIN with the camera, locate each unit on a live map, and update its status (in transit, storage, service, reserved, sold).

## Stack

React 19 + TypeScript + Vite 8, with MapLibre GL for the live map.

## What's implemented

The whole of `FleetHub.dc.html` from the Claude Design project — 18 screens, each
in an iOS device frame:

| Code | Screen | Code | Screen |
| --- | --- | --- | --- |
| A | Sign in | 04 | Alerts |
| B | Registration | 05 | Profile |
| C | Confirm code | 05b | Personal information |
| D | Create password | 06 | Administration |
| 00 | Dashboard (live map) | 06b | Admin · Routes |
| 00b | Edit unit | 06c | Admin · Edit route |
| 01 | VIN scanning | 07 | Admin · Users |
| 02 | VIN confirmation | 07b | Admin · Enrollment code |
| 03 | Fleet | 08 | Admin · History |

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

## Address autocomplete

The location editor queries Geoapify through the server, so the API key is never
sent to the frontend. Copy `.env.example` to `.env`, set `GEOAPIFY_API_KEY`, and
restart `npm run server`. Search waits 300 ms after input, displays up to five
addresses, and stores only the selected address with its latitude and longitude.
The dropdown preserves the attribution required by Geoapify's free plan.

## Configuration and security

`.env.example` contains only variable names and development values. `.env` is
ignored and must never be published. Configure secrets in the Netlify dashboard
or CLI, not in `netlify.toml`.

Email and phone verification codes have two explicit modes:

- Local development: `ALLOW_INSECURE_AUTH_CODES=true` lets the interface display
  the code so the flow can be tested without a delivery provider.
- Production: configure `AUTH_DELIVERY_WEBHOOK_URL` and, optionally,
  `AUTH_DELIVERY_TOKEN`. The webhook receives `addressee`, `purpose`, `code`, and
  `expiresAt`. When insecure codes are disabled, the code never appears in the
  API response. If no delivery channel is available, the server rejects the
  operation instead of pretending that the code was sent.

`ALLOWED_ORIGINS` accepts a comma-separated list containing only the origins
that require CORS. When the app and its Function are deployed together, they
share the same origin and do not require open CORS access.

`FLEETHUB_STAFF_EMAILS` is a comma-separated list of internal support accounts.
Only private server configuration can grant support access; registration and
profile updates can never do so. Company access requires a support grant, is
recorded in the audit log, and expires after eight hours or when it is closed
manually.

## Pre-deployment checks

Run `npm run check`. It lints the code, runs every test, checks TypeScript, and
generates the production build. The same command runs in GitHub Actions through
`.github/workflows/quality.yml`. `npm run test:e2e` starts the build with the
local API and runs the mobile browser tests. On Windows it reuses Edge; in CI it
installs an isolated copy of Chromium.

## Documentation

| Document | Contents |
| --- | --- |
| [`PRODUCTION_READINESS.md`](./PRODUCTION_READINESS.md) | What remains before production and who can complete it |
| [`OPERATIONS.md`](./OPERATIONS.md) | Configuration, deployment, rollback, monitoring, and secret rotation |
| [`PRIVACIDAD.md`](./PRIVACIDAD.md) | What is stored, who can see it, how long it is retained, and how it is deleted |
| [`DECISIONES.md`](./DECISIONES.md) | Previously open decisions and what would be required to change them |
| [`endpoints.json`](./endpoints.json) | The API contract, kept in sync with the server through tests |

## No offline mode

FleetHub is explicitly an online application. The server is authoritative, and
the browser store is only a local copy rather than a queue of pending work.
There is no offline mode or local password access, and the profile states this
directly instead of presenting a switch that does nothing. The reasoning and
the requirements for changing this decision are documented in
[`DECISIONES.md`](./DECISIONES.md).

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
