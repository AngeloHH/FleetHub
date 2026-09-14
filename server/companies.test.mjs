import { describe, expect, it } from 'vitest'
import { Companies } from './companies.mjs'

describe('compañías', () => {
  it('crea solamente un UUID y la fecha de creación', () => {
    const table = []
    let saves = 0
    const company = new Companies(table, {
      now: () => new Date('2026-08-18T12:00:00.000Z'),
      save: () => (saves += 1),
    }).create()

    expect(company).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      createdAt: '2026-08-18T12:00:00.000Z',
    })
    expect(Object.keys(company)).toEqual(['id', 'createdAt'])
    expect(table).toEqual([company])
    expect(saves).toBe(1)
  })
})
