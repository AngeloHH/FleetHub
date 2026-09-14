// El VIN, y sobre todo cuándo *no* lo es.
//
// Los casos usan vectores sintéticos: los válidos tienen un dígito de control
// calculado y los inválidos alteran únicamente ese dígito. Así se cubre la
// regresión del lector sin incorporar identificadores de una flota real.

import { describe, expect, test } from 'vitest'
import { hasVinCheckDigit, isValidVin, normalizeVin, VIN_LENGTH, vinCharactersOnly } from './vin'

/** Lo que hace `readVin` con lo que le da el OCR, sin el OCR de por medio. */
function leer(texto: string) {
  const limpio = vinCharactersOnly(texto)
  const candidatos: string[] = []
  for (let at = 0; at + VIN_LENGTH <= limpio.length; at += 1) {
    const candidato = limpio.slice(at, at + VIN_LENGTH)
    if (isValidVin(candidato)) candidatos.push(candidato)
  }
  return candidatos.find(hasVinCheckDigit) ?? null
}

// Vectores sintéticos cuyo dígito de control es correcto.
const VALIDOS = [
  '1FTFW1E06NFA00001',
  '1FTFW1E08NFA00002',
  '1FTFW1E0XNFA00003',
  '1FTFW1E01NFA00004',
  '1FTFW1E03NFA00005',
  '1FTFW1E05NFA00006',
  '1FTFW1E07NFA00007',
]

// Los mismos tipos de VIN, con el dígito de control alterado.
const INVALIDOS = [
  '1FTFW1E07NFA00001',
  '1FTFW1E09NFA00002',
  '1FTFW1E00NFA00003',
  '1FTFW1E02NFA00004',
  '1FTFW1E04NFA00005',
]

describe('el dígito de control', () => {
  test('lo cumplen los VIN que el proveedor decodificó limpios', () => {
    for (const vin of VALIDOS) expect(hasVinCheckDigit(vin), vin).toBe(true)
  })

  test('no lo cumple ninguno de los que se colaron mal leídos', () => {
    for (const vin of INVALIDOS) expect(hasVinCheckDigit(vin), vin).toBe(false)
  })

  test('la X vale diez, que es el único caso que no es un dígito', () => {
    expect(hasVinCheckDigit('1M8GDM9AXKP042788')).toBe(true)
  })

  test('cambiar un solo carácter lo rompe', () => {
    // Es lo que hace el OCR cuando confunde una S con un 5.
    expect(hasVinCheckDigit('1FTSW1E08NFA00001')).toBe(true)
    expect(hasVinCheckDigit('1FT5W1E08NFA00001')).toBe(false)
  })

  test('lo que no tiene forma de VIN no llega ni a contarse', () => {
    expect(hasVinCheckDigit('')).toBe(false)
    expect(hasVinCheckDigit('1FTFW1E06NFA0000')).toBe(false)
    expect(hasVinCheckDigit('1FTFW1E06NFA00001X')).toBe(false)
  })
})

describe('encontrar el VIN dentro de lo que lee la cámara', () => {
  test('lo encuentra aunque el OCR arrastre ruido por delante', () => {
    expect(leer('D 1FTFW1E07NFA00007')).toBe('1FTFW1E07NFA00007')
  })

  test('y aunque lo arrastre por detrás', () => {
    expect(leer('1FTFW1E07NFA00007 8B')).toBe('1FTFW1E07NFA00007')
  })

  test('lo encuentra entre el ruido de los dos lados', () => {
    expect(leer('VEHICULO 1FTFW1E07NFA00007 USA')).toBe('1FTFW1E07NFA00007')
  })

  test('si nada cuadra no devuelve el que mejor pinta, devuelve nada', () => {
    // Antes esto daba de alta una unidad. Ahora el visor sigue mirando, que es
    // gratis, en vez de inventarse un vehículo.
    for (const basura of INVALIDOS) expect(leer(basura), basura).toBeNull()
  })

  test('un texto sin nada dentro no da nada', () => {
    expect(leer('')).toBeNull()
    expect(leer('SOLO PALABRAS SUELTAS')).toBeNull()
  })
})

describe('teclear y leer se filtran distinto', () => {
  test('al teclear se corta en diecisiete, que es lo que cabe en el campo', () => {
    expect(normalizeVin('1FTFW1E07NFA00007XYZ')).toBe('1FTFW1E07NFA00007')
  })

  test('al leer no se corta, o solo habría una ventana posible', () => {
    // `normalizeVin` recortaba antes de buscar, así que la búsqueda de ventana
    // no podía encontrar el VIN sintético tras el carácter inicial.
    expect(vinCharactersOnly('D1FTFW1E07NFA00007').length).toBe(18)
  })

  test('los dos tiran lo que un VIN no puede llevar', () => {
    expect(normalizeVin('1ft-fw1e07 nfa00007')).toBe('1FTFW1E07NFA00007')
    expect(vinCharactersOnly('i o q I O Q')).toBe('')
  })
})
