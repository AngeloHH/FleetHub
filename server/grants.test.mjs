import { describe, expect, test } from 'vitest'
import { Grants, SUPPORT_HOURS } from './grants.mjs'
import { isStaff, staffEmails } from './staff.mjs'

const COMPANY = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const USER = '33333333-3333-4333-8333-333333333333'

const at = (iso) => () => new Date(iso)

describe('ventanas de soporte', () => {
  test('abre una ventana con la hora de cierre ya escrita', () => {
    const table = []
    const grants = new Grants(table, { now: at('2026-01-01T00:00:00.000Z') })
    const opened = grants.open({ userId: USER, companyId: COMPANY, code: 'ABC123' })

    expect(opened.ok).toBe(true)
    expect(opened.grant).toMatchObject({
      userId: USER,
      companyId: COMPANY,
      code: 'ABC123',
      grantedAt: '2026-01-01T00:00:00.000Z',
      endedAt: null,
      live: true,
    })
    expect(new Date(opened.grant.expiresAt).getTime() - Date.parse('2026-01-01T00:00:00.000Z'))
      .toBe(SUPPORT_HOURS * 3_600_000)
    expect(table).toHaveLength(1)
  })

  test('una cuenta no puede tener dos ventanas abiertas a la vez', () => {
    const grants = new Grants([])
    expect(grants.open({ userId: USER, companyId: COMPANY }).ok).toBe(true)
    expect(grants.open({ userId: USER, companyId: OTHER }))
      .toMatchObject({ ok: false, error: 'ALREADY_OPEN' })
  })

  test('caducada deja de estar abierta y permite pedir otra', () => {
    const table = []
    new Grants(table, { now: at('2026-01-01T00:00:00.000Z') })
      .open({ userId: USER, companyId: COMPANY })
    const later = new Grants(table, { now: at('2026-01-02T00:00:00.000Z') })

    expect(later.openFor(USER)).toBeUndefined()
    expect(later.list({ userId: USER, live: true })).toEqual([])
    expect(later.list({ userId: USER, live: false })).toHaveLength(1)
    expect(later.open({ userId: USER, companyId: OTHER }).ok).toBe(true)
  })

  test('cerrarla conserva la fila en lugar de dejar un hueco', () => {
    const table = []
    const grants = new Grants(table)
    const opened = grants.open({ userId: USER, companyId: COMPANY })

    const ended = grants.end(opened.grant.id, { by: USER })
    expect(ended.ok).toBe(true)
    expect(ended.grant.live).toBe(false)
    expect(ended.grant.endedAt).not.toBeNull()
    expect(table).toHaveLength(1)
    expect(grants.end(opened.grant.id)).toMatchObject({ ok: false, error: 'ALREADY_ENDED' })
    expect(grants.end('no-existe')).toMatchObject({ ok: false, error: 'UNKNOWN' })
  })

  test('no expone campos que no estén en el contrato', () => {
    const grants = new Grants([])
    const opened = grants.open({ userId: USER, companyId: COMPANY })
    grants.end(opened.grant.id, { by: 'quien-sea' })
    expect(Object.keys(grants.list({ userId: USER })[0]).sort()).toEqual(
      ['code', 'companyId', 'endedAt', 'expiresAt', 'grantedAt', 'id', 'live', 'userId'],
    )
  })
})

describe('quién es de FleetHub', () => {
  test('la lista configurada decide, no el cuerpo de la petición', () => {
    const emails = staffEmails('Soporte@FleetHub.test, otra@fleethub.test')
    expect(isStaff({ email: 'soporte@fleethub.test' }, emails)).toBe(true)
    expect(isStaff({ email: 'SOPORTE@FLEETHUB.TEST' }, emails)).toBe(true)
    expect(isStaff({ email: 'cliente@example.com' }, emails)).toBe(false)
    expect(isStaff(null, emails)).toBe(false)
  })

  test('no confía en una marca staff almacenada o enviada por el cliente', () => {
    expect(isStaff({ email: 'cliente@example.com', staff: true }, staffEmails(''))).toBe(false)
  })

  test('una lista vacía no convierte a nadie en soporte', () => {
    expect(isStaff({ email: 'cliente@example.com' }, staffEmails(''))).toBe(false)
    expect(isStaff({ email: '' }, staffEmails(' , , '))).toBe(false)
  })
})
