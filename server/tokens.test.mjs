import { describe, expect, test } from 'vitest'
import { Codes, PURPOSE, TIER } from './codes.mjs'
import { tokens } from './tokens.mjs'
import { matches, seal } from './users.mjs'

const PASSWORD = 'Una-Clave-Larga1'
const user = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  companyId: '0c9d7a55-1e34-42f8-9b7a-8ef2c6d04b19',
  fullName: 'Usuario de Prueba',
  email: 'usuario@example.com',
  phone: '2125550100',
  role: 'ADMINISTRADOR',
  suspension: null,
  password: seal(PASSWORD),
}

const memberOf = (identity) =>
  identity.email === user.email || identity.phone === user.phone ? user : undefined

const post = (body, grantSession = () => 'session-token') => tokens(
  'POST',
  new URLSearchParams(),
  null,
  {
    rows: { users: [user] },
    table: [],
    readBody: async () => body,
    save: () => {},
    memberOf,
    matches,
    grantSession,
  },
)

describe('sesión por contraseña', () => {
  test('compara con la contraseña de la fila y crea la sesión', async () => {
    const answer = await post({ purpose: 'SESSION', email: user.email, password: PASSWORD })
    expect(answer).toMatchObject({
      status: 200,
      body: {
        ok: true,
        code: 'session-token',
        token: { purpose: 'SESSION', userId: user.id, role: 'ADMINISTRADOR' },
      },
    })
  })

  test('una contraseña incorrecta no crea sesión', async () => {
    const grantSession = () => { throw new Error('NO DEBE CREAR SESIÓN') }
    const answer = await post({ purpose: 'SESSION', email: user.email, password: 'incorrecta' }, grantSession)
    expect(answer).toMatchObject({
      status: 401,
      body: { ok: false, error: 'INVALID_CREDENTIALS' },
    })
  })
})

describe('saludo del código', () => {
  test('el código de acceso devuelve el nombre sin repetir el teléfono completo', async () => {
    const answer = await post({
      purpose: PURPOSE.SIGN_IN,
      addressee: user.phone,
      phone: user.phone,
    })
    expect(answer).toMatchObject({ status: 200, body: { ok: true, name: user.fullName } })
  })
})

describe('invitaciones de la compañía', () => {
  test('un administrador sólo recibe las invitaciones de su propia compañía', async () => {
    const table = []
    const codes = new Codes(table)
    codes.create({
      purpose: PURPOSE.INVITE,
      tier: TIER.OPERATOR,
      companyId: user.companyId,
      createdBy: user.id,
      code: 'A1B2C3',
    })
    codes.create({
      purpose: PURPOSE.INVITE,
      tier: TIER.ADMIN,
      companyId: 'otra-compania',
      createdBy: 'otro-admin',
      code: 'D4E5F6',
    })

    const answer = await tokens(
      'GET',
      new URLSearchParams('purpose=INVITE&live=true'),
      { userId: user.id },
      {
        rows: { users: [user] },
        table,
        readBody: async () => ({}),
        save: () => {},
        memberOf,
        matches,
        grantSession: () => 'session-token',
      },
    )

    expect(answer.body.tokens.map((token) => token.code)).toEqual(['A1B2C3'])
  })

  test('un administrador no puede revocar una invitación de otra compañía', async () => {
    const table = []
    new Codes(table).create({
      purpose: PURPOSE.INVITE,
      tier: TIER.OPERATOR,
      companyId: 'otra-compania',
      createdBy: 'otro-admin',
      code: 'D4E5F6',
    })
    const answer = await tokens(
      'POST',
      new URLSearchParams(),
      { userId: user.id },
      {
        rows: { users: [user] }, table,
        readBody: async () => ({ action: 'revoke', code: 'D4E5F6' }),
        save: () => {}, memberOf, matches, grantSession: () => 'session-token',
      },
    )
    expect(answer).toMatchObject({ status: 404, body: { error: 'UNKNOWN' } })
    expect(new Codes(table).get('D4E5F6').revokedAt).toBeNull()
  })
})
