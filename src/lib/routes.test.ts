import { describe, expect, test } from 'vitest'
import { blankRoute } from '../domain'
import { routeForEditing } from './routes'

describe('editor de locations', () => {
  test('conserva el primer borrador aunque todavía no existan locations guardadas', () => {
    const draft = blankRoute([])

    expect(routeForEditing([], draft.code, draft)).toBe(draft)
  })
})
