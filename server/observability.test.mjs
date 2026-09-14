import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { log, parseSentryDsn, Reporter, safeFields } from './observability.mjs'

let previous

beforeEach(() => {
  previous = { ...process.env }
})

afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]
  Object.assign(process.env, previous)
  vi.restoreAllMocks()
})

describe('lo que se puede escribir en un registro', () => {
  test('los secretos salen marcados, nunca con su valor', () => {
    const safe = safeFields({
      authorization: 'Bearer abc123',
      password: 'Clave-Segura1',
      code: '481516',
      registrationToken: 'zzz',
      vin: '3MVDMBBM2PM512094',
    })
    expect(safe).toMatchObject({
      authorization: '[oculto]', password: '[oculto]', code: '[oculto]', registrationToken: '[oculto]',
      vin: '3MVDMBBM2PM512094',
    })
    expect(JSON.stringify(safe)).not.toContain('abc123')
    expect(JSON.stringify(safe)).not.toContain('Clave-Segura1')
  })

  test('un correo se reduce a su dominio', () => {
    expect(safeFields({ email: 'Angela@example.com' })).toEqual({ addresseeDomain: '@example.com' })
    expect(safeFields({ addressee: 'sin-arroba' })).toEqual({ addresseeDomain: '' })
  })

  test('también dentro de un objeto anidado', () => {
    expect(safeFields({ request: { password: 'x', path: '/api/tokens' } }))
      .toEqual({ request: { password: '[oculto]', path: '/api/tokens' } })
  })

  test('lo indefinido no ocupa sitio', () => {
    expect(safeFields({ a: undefined, b: null, c: 0 })).toEqual({ b: null, c: 0 })
  })
})

describe('el registro', () => {
  test('escribe una línea JSON con el nivel, el hecho y la hora', () => {
    process.env.FLEETHUB_LOG_LEVEL = 'info'
    process.env.FLEETHUB_ENVIRONMENT = 'staging'
    process.env.FLEETHUB_RELEASE = 'abc1234'
    const written = vi.spyOn(console, 'log').mockImplementation(() => {})

    const line = log('info', 'api_request', { path: '/api/vehicles', status: 200 })

    expect(written).toHaveBeenCalledTimes(1)
    expect(JSON.parse(written.mock.calls[0][0])).toMatchObject({
      level: 'info', event: 'api_request', path: '/api/vehicles', status: 200,
      environment: 'staging', release: 'abc1234', service: 'fleethub-api',
    })
    expect(line.at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  test('el umbral decide qué se imprime, no qué se sabe', () => {
    process.env.FLEETHUB_LOG_LEVEL = 'error'
    const written = vi.spyOn(console, 'log').mockImplementation(() => {})
    const failed = vi.spyOn(console, 'error').mockImplementation(() => {})

    const quiet = log('info', 'api_request', { status: 200 })
    log('error', 'api_error', { status: 500 })

    expect(written).not.toHaveBeenCalled()
    expect(failed).toHaveBeenCalledTimes(1)
    // La línea existe igual: quien avisa la necesita entera.
    expect(quiet).toMatchObject({ level: 'info', event: 'api_request', status: 200 })
  })
})

describe('el DSN de Sentry', () => {
  test('se parte en llave y destino', () => {
    expect(parseSentryDsn('https://abc123@o1.ingest.sentry.io/45'))
      .toEqual({ key: 'abc123', endpoint: 'https://o1.ingest.sentry.io/api/45/envelope/' })
  })

  test('lo que no es un DSN no lo es', () => {
    expect(parseSentryDsn('')).toBeNull()
    expect(parseSentryDsn('no-es-una-url')).toBeNull()
    expect(parseSentryDsn('https://o1.ingest.sentry.io/45')).toBeNull()
    expect(parseSentryDsn('https://abc123@o1.ingest.sentry.io/')).toBeNull()
  })
})

describe('los avisos', () => {
  const reporterWith = (options) => new Reporter({ dsn: '', webhook: '', ...options })

  test('sin destino configurado se registra y no se manda nada', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetcher = vi.fn()
    const reporter = reporterWith({ fetcher })

    expect(reporter.configured).toBe(false)
    await reporter.capture(new Error('algo se rompió'), { event: 'api_error', path: '/api/vehicles' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  test('el webhook recibe la línea entera, sin secretos', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetcher = vi.fn(async () => ({ ok: true }))
    const reporter = reporterWith({
      webhook: 'https://avisos.test/hook', webhookToken: 'llave', fetcher,
    })

    await reporter.capture(new Error('algo se rompió'), {
      event: 'api_error', path: '/api/tokens', authorization: 'Bearer secreto',
    })

    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, options] = fetcher.mock.calls[0]
    expect(url).toBe('https://avisos.test/hook')
    expect(options.headers.authorization).toBe('Bearer llave')
    const sent = JSON.parse(options.body)
    expect(sent).toMatchObject({
      level: 'error', event: 'api_error', path: '/api/tokens',
      message: 'algo se rompió', kind: 'Error', authorization: '[oculto]',
    })
    expect(options.body).not.toContain('Bearer secreto')
  })

  test('a Sentry va un sobre con su cabecera de autenticación', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetcher = vi.fn(async () => ({ ok: true }))
    const reporter = reporterWith({
      dsn: 'https://llave@o1.ingest.sentry.io/45',
      fetcher,
      randomId: () => '0'.repeat(32),
    })

    await reporter.capture(new Error('algo se rompió'), { event: 'api_error' })

    const [url, options] = fetcher.mock.calls[0]
    expect(url).toBe('https://o1.ingest.sentry.io/api/45/envelope/')
    expect(options.headers['x-sentry-auth']).toContain('sentry_key=llave')
    const [head, type, event] = options.body.split('\n').map((line) => JSON.parse(line))
    expect(head.event_id).toBe('0'.repeat(32))
    expect(type).toEqual({ type: 'event' })
    expect(event).toMatchObject({
      level: 'error',
      logger: 'api_error',
      exception: { values: [{ type: 'Error', value: 'algo se rompió' }] },
    })
  })

  test('un aviso que no es un error no llega a Sentry', async () => {
    const fetcher = vi.fn(async () => ({ ok: true }))
    const reporter = reporterWith({ dsn: 'https://llave@o1.ingest.sentry.io/45', fetcher })

    await reporter.notify('provider_quota_warning', { provider: 'geoapify' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  test('un destino caído no se propaga a quien estaba atendiendo', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const complained = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetcher = vi.fn(async () => { throw new Error('sin red') })
    const reporter = reporterWith({ webhook: 'https://avisos.test/hook', fetcher })

    await expect(reporter.capture(new Error('roto'))).resolves.toBeInstanceOf(Array)
    expect(complained).toHaveBeenCalled()
    expect(JSON.parse(complained.mock.calls[0][0]).event).toBe('alert_delivery_failed')
  })
})
