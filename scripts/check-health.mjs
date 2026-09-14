// ¿Está en pie?
//
// Lo que ejecuta el monitor de disponibilidad, y también lo que se ejecuta a
// mano después de un despliegue. Pide /api/health, mira que conteste lo que
// tiene que contestar y en cuánto tiempo, y sale con código distinto de cero
// si algo no cuadra — que es el único idioma que entiende un cron.
//
// Comprueba la salud, no la fachada: un 200 con HTML es un host estático
// sirviendo index.html donde debería estar la API, y ese es precisamente el
// fallo que un monitor ingenuo no ve.
//
//   node scripts/check-health.mjs https://fleethub.example
//   HEALTH_URL=https://fleethub.example node scripts/check-health.mjs

const target = process.argv[2] ?? process.env.HEALTH_URL
const budgetMs = Number(process.env.HEALTH_BUDGET_MS ?? 5_000)
const webhook = process.env.ALERT_WEBHOOK_URL
const webhookToken = process.env.ALERT_WEBHOOK_TOKEN

if (!target) {
  console.error('Falta la dirección. Uso: node scripts/check-health.mjs <url> (o HEALTH_URL).')
  process.exit(2)
}

const url = new URL('/api/health', target)

/** Avisa a donde haya que avisar, sin que un aviso fallido tape el fallo real. */
async function alert(problem) {
  if (!webhook) return
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(webhookToken ? { authorization: `Bearer ${webhookToken}` } : {}),
      },
      body: JSON.stringify({
        level: 'error',
        event: 'health_check_failed',
        at: new Date().toISOString(),
        target: url.toString(),
        ...problem,
      }),
      signal: AbortSignal.timeout(8_000),
    })
  } catch (error) {
    console.error(`No se pudo avisar: ${error?.message ?? error}`)
  }
}

async function fail(problem) {
  console.error(JSON.stringify({ ok: false, target: url.toString(), ...problem }))
  await alert(problem)
  process.exit(1)
}

const startedAt = Date.now()
let response
try {
  response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(budgetMs + 5_000),
  })
} catch (error) {
  await fail({ reason: 'unreachable', message: String(error?.message ?? error) })
}

const ms = Date.now() - startedAt

if (!response.ok) await fail({ reason: 'status', status: response.status, ms })

const type = String(response.headers.get('content-type') ?? '')
if (!type.includes('application/json'))
  await fail({ reason: 'not-json', contentType: type, ms })

let body
try {
  body = await response.json()
} catch (error) {
  await fail({ reason: 'unparseable', message: String(error?.message ?? error), ms })
}

if (body?.ok !== true || body?.service !== 'fleethub-api')
  await fail({ reason: 'unexpected-body', body, ms })

if (ms > budgetMs) await fail({ reason: 'slow', ms, budgetMs })

console.log(JSON.stringify({
  ok: true,
  target: url.toString(),
  ms,
  environment: body.environment,
  release: body.release,
  storeVersion: body.storeVersion,
}))
