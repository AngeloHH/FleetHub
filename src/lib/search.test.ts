// Buscar es encontrar lo tecleado en las palabras que la fila ya enseña.

import { expect, test } from 'vitest'
import { matchesQuery } from './search'

test('sin nada tecleado, todo pasa', () => {
  expect(matchesQuery('', 'VH-0204')).toBe(true)
  expect(matchesQuery('   ', 'VH-0204')).toBe(true)
})

test('encuentra sin distinguir mayúsculas, en cualquiera de los textos', () => {
  expect(matchesQuery('vh-0204', 'VH-0204', 'EN RUTA')).toBe(true)
  expect(matchesQuery('ruta', 'VH-0204', 'EN RUTA')).toBe(true)
  expect(matchesQuery('garaje', 'VH-0204', 'EN RUTA')).toBe(false)
})

test('un texto ausente no revienta ni cuenta', () => {
  expect(matchesQuery('algo', undefined, 'ALGO MÁS')).toBe(true)
  expect(matchesQuery('algo', undefined)).toBe(false)
})
