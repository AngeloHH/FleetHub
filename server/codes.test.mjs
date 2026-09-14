// Lo que tiene que ser cierto de un código, dicho una vez.

import { describe, expect, it } from 'vitest'
import { Codes, PURPOSE, TIER } from './codes.mjs'

const ADMIN = 'b7c04f18-9a2e-4d13-bb65-71c8f0a3e5d2'
const JOINER = '0c9d7a55-1e34-42f8-9b7a-8ef2c6d04b19'

/** Un reloj que se puede empujar hacia adelante. */
function clock(start = '2026-08-13T18:00:00.000Z') {
  let at = new Date(start)
  return { now: () => at, pass: (seconds) => (at = new Date(at.getTime() + seconds * 1_000)) }
}

const invite = (codes, tier = TIER.OPERATOR) =>
  codes.create({ purpose: PURPOSE.INVITE, tier, createdBy: ADMIN })

describe('crear', () => {
  it('devuelve la fila con los campos acordados y el código aparte', () => {
    const codes = new Codes([], clock())
    const made = invite(codes)
    expect(made.ok).toBe(true)
    expect(made.code).toMatch(/^[0-9A-F]{6}$/)
    expect(made.row).toEqual({
      code: made.code,
      purpose: 'INVITE',
      tier: TIER.OPERATOR,
      createdAt: '2026-08-13T18:00:00.000Z',
      createdBy: ADMIN,
      expiresAt: '2026-08-14T18:00:00.000Z',
      triesLeft: 5,
      usedBy: [],
      revokedAt: null,
      revokedBy: null,
      delegatedTo: null,
      companyId: null,
      status: 'live',
    })
  })

  it('los de un solo uso son numéricos y no se guardan en claro', () => {
    const table = []
    const codes = new Codes(table, clock())
    const made = codes.create({ purpose: PURPOSE.SIGN_IN, addressee: 'r@sal.mx', createdBy: JOINER })
    expect(made.code).toMatch(/^\d{6}$/)
    expect(made.row.code).toBeNull()
    expect(JSON.stringify(table)).not.toContain(made.code)
  })

  it('no escribe la dirección a la que va', () => {
    const table = []
    new Codes(table, clock()).create({ purpose: PURPOSE.REGISTER, addressee: 'r@sal.mx' })
    expect(JSON.stringify(table)).not.toContain('r@sal.mx')
  })

  it('normaliza la dirección una vez para emitir y comprobar', () => {
    const codes = new Codes([], clock())
    const made = codes.create({ purpose: PURPOSE.SIGN_IN, addressee: '  R@Sal.MX ' })
    expect(codes.verify(made.code, { purpose: PURPOSE.SIGN_IN, addressee: 'r@sal.mx' }).ok).toBe(true)
  })

  it('reenviar retira cualquier código anterior de la misma dirección', () => {
    const codes = new Codes([], clock())
    const first = codes.create({ purpose: PURPOSE.SIGN_IN, addressee: 'r@sal.mx' })
    const second = codes.create({ purpose: PURPOSE.PASSWORD_RESET, addressee: 'R@SAL.MX' })
    expect(codes.verify(first.code, { purpose: PURPOSE.SIGN_IN, addressee: 'r@sal.mx' }).error).toBe('REVOKED')
    expect(codes.verify(second.code, { purpose: PURPOSE.PASSWORD_RESET, addressee: 'r@sal.mx' }).ok).toBe(true)
  })

  it('la invitación puede guardar la compañía que recibirá al usuario', () => {
    const codes = new Codes([], clock())
    const made = codes.create({ purpose: PURPOSE.INVITE, tier: 1, createdBy: ADMIN, companyId: 'company-1' })
    expect(made.row.companyId).toBe('company-1')
  })

  it('un tier que no existe no se emite', () => {
    const codes = new Codes([], clock())
    expect(invite(codes, 9).error).toBe('INVALID_TIER')
  })

  it('acepta un código solicitado válido y libre', () => {
    const codes = new Codes([], clock())
    const made = codes.create({
      purpose: PURPOSE.INVITE,
      tier: TIER.OPERATOR,
      code: 'A1B2C3',
    })
    expect(made.row).toMatchObject({ code: 'A1B2C3' })
    expect(codes.create({ purpose: PURPOSE.INVITE, tier: 1, code: 'A1B2C3' }).error)
      .toBe('CODE_TAKEN')
  })

  it('el soporte de FleetHub es un tier, no otro tipo de código', () => {
    const codes = new Codes([], clock())
    expect(invite(codes, TIER.SUPPORT).row.tier).toBe(3)
  })

  it('nunca repite un código vivo', () => {
    const codes = new Codes([], clock())
    const seen = new Set(Array.from({ length: 200 }, () => invite(codes).code))
    expect(seen.size).toBe(200)
  })
})

describe('obtener', () => {
  it('lista todas las invitaciones del sistema', () => {
    const codes = new Codes([], clock())
    invite(codes)
    codes.create({ purpose: PURPOSE.INVITE, tier: 1, createdBy: ADMIN })
    expect(codes.list({ purpose: PURPOSE.INVITE })).toHaveLength(2)
  })

  it('el derivado no sale nunca', () => {
    const codes = new Codes([], clock())
    codes.create({ purpose: PURPOSE.SIGN_IN, addressee: 'r@sal.mx' })
    expect(codes.list()[0]).not.toHaveProperty('secret')
    expect(codes.list()[0]).not.toHaveProperty('owner')
  })
})

describe('estado', () => {
  it('REGISTER reserva el UUID, lo escribe en usedBy y permite reclamarlo una vez', () => {
    const codes = new Codes([], clock())
    const made = codes.create({ purpose: PURPOSE.REGISTER, addressee: 'r@sal.mx' })
    const reserved = codes.reserveRegistration(made.code, { addressee: 'r@sal.mx' })

    expect(reserved.ok).toBe(true)
    expect(reserved.userId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(reserved.row.usedBy).toEqual([
      { at: '2026-08-13T18:00:00.000Z', by: reserved.userId },
    ])
    expect(reserved.row.status).toBe('used')
    expect(reserved.row).not.toHaveProperty('registration')
    expect(codes.registration(reserved.receipt, { addressee: 'otro@sal.mx' }).ok).toBe(false)
    expect(codes.registration(reserved.receipt, { addressee: 'r@sal.mx' })).toEqual({
      ok: true,
      userId: reserved.userId,
    })
    expect(codes.claimRegistration(reserved.receipt, { addressee: 'r@sal.mx' }).ok).toBe(true)
    expect(codes.registration(reserved.receipt, { addressee: 'r@sal.mx' }).error).toBe('CLAIMED')
  })

  it('caduca solo, sin que nadie lo toque', () => {
    const time = clock()
    const codes = new Codes([], time)
    const made = invite(codes)
    time.pass(24 * 3_600 + 1)
    expect(codes.get(made.code).status).toBe('expired')
    expect(codes.verify(made.code).error).toBe('EXPIRED')
  })

  it('la invitación crea una sola cuenta y conserva quién la usó', () => {
    const time = clock()
    const codes = new Codes([], time)
    const made = invite(codes)
    expect(codes.spend(made.code, { by: JOINER }).ok).toBe(true)
    time.pass(3_600)
    expect(codes.spend(made.code, { by: ADMIN }).error).toBe('USED')
    expect(codes.get(made.code).usedBy).toEqual([
      { at: '2026-08-13T18:00:00.000Z', by: JOINER },
    ])
    expect(codes.get(made.code).status).toBe('used')
  })

  it('los códigos dirigidos mueren al llegar a su único uso', () => {
    const codes = new Codes([], clock())
    const directed = codes.create({ purpose: PURPOSE.REGISTER, addressee: 'r@sal.mx' })
    expect(codes.spend(directed.code, { by: JOINER, addressee: 'r@sal.mx' }).ok).toBe(true)
    expect(codes.verify(directed.code, { addressee: 'r@sal.mx' }).error).toBe('USED')
  })

  it('cancelarlo deja fecha y quién', () => {
    const codes = new Codes([], clock())
    const made = invite(codes)
    expect(codes.revoke(made.code, { by: ADMIN }).ok).toBe(true)
    expect(codes.get(made.code)).toMatchObject({
      revokedAt: '2026-08-13T18:00:00.000Z',
      revokedBy: ADMIN,
      status: 'revoked',
    })
  })

  it('lo ya gastado no se puede cancelar', () => {
    const codes = new Codes([], clock())
    const made = codes.create({ purpose: PURPOSE.REGISTER, addressee: 'r@sal.mx' })
    codes.spend(made.code, { by: JOINER, addressee: 'r@sal.mx' })
    expect(codes.verify(made.code, { addressee: 'r@sal.mx' }).error).toBe('USED')
  })

  it('el propósito equivocado no vale aunque el código sea bueno', () => {
    const codes = new Codes([], clock())
    const made = invite(codes)
    expect(codes.verify(made.code, { purpose: PURPOSE.SIGN_IN }).error).toBe('WRONG_PURPOSE')
  })
})

describe('los intentos', () => {
  it('mirar no gasta', () => {
    const codes = new Codes([], clock())
    const made = invite(codes)
    codes.verify(made.code)
    codes.verify(made.code)
    expect(codes.get(made.code).status).toBe('live')
    expect(codes.get(made.code).triesLeft).toBe(5)
  })

  it('fallar sí, y a los cinco se quema', () => {
    const codes = new Codes([], clock())
    codes.create({ purpose: PURPOSE.SIGN_IN, addressee: 'r@sal.mx', createdBy: JOINER })
    for (let n = 0; n < 4; n++)
      expect(codes.verify('000000', { addressee: 'r@sal.mx' }).error).toBe('INVALID_CODE')
    expect(codes.verify('000000', { addressee: 'r@sal.mx' }).error).toBe('BURNED')
    expect(codes.list()[0].status).toBe('burned')
  })

  it('el código de otro no cobra en el tuyo', () => {
    const codes = new Codes([], clock())
    const mine = codes.create({ purpose: PURPOSE.SIGN_IN, addressee: 'r@sal.mx' })
    codes.create({ purpose: PURPOSE.SIGN_IN, addressee: 'm@sal.mx' })
    expect(codes.verify(mine.code, { addressee: 'm@sal.mx' }).ok).toBe(false)
    expect(codes.find(mine.code, 'r@sal.mx').triesLeft).toBe(5)
  })

  it('el bueno entra con su dirección y sin ella no', () => {
    const codes = new Codes([], clock())
    const made = codes.create({ purpose: PURPOSE.SIGN_IN, addressee: 'r@sal.mx' })
    expect(codes.verify(made.code, { addressee: 'r@sal.mx' }).ok).toBe(true)
    expect(codes.verify(made.code).error).toBe('UNKNOWN')
  })
})

describe('el almacén', () => {
  it('avisa después de cada escritura y no antes', () => {
    let saves = 0
    const codes = new Codes([], { ...clock(), save: () => (saves += 1) })
    const made = invite(codes)
    expect(saves).toBe(1)
    codes.verify(made.code)
    expect(saves).toBe(1)
    codes.revoke(made.code, { by: ADMIN })
    expect(saves).toBe(2)
  })
})
