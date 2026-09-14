// Las reglas de la puerta: qué identifica, qué valida, y cómo se escribe un
// teléfono según el país que lo marca.

import { describe, expect, test } from 'vitest'
import {
  checkPassword,
  countryOf,
  formatCountdown,
  formatPhone,
  normalizePhone,
  passwordStrength,
  phoneHint,
  phonePlaceholder,
  validateEmail,
  validateName,
  validatePassword,
  validatePasswordConfirm,
  validatePhone,
} from './auth'

describe('correo y nombre', () => {
  test('un correo de trabajo pasa; lo que no lo parece, no', () => {
    expect(validateEmail('ana@empresa.mx')).toBeNull()
    expect(validateEmail('')).not.toBeNull()
    expect(validateEmail('sin-arroba.mx')).not.toBeNull()
    expect(validateEmail('dos @espacios.mx')).not.toBeNull()
  })

  test('el nombre pide al menos un apellido', () => {
    expect(validateName('Ana Torres')).toBeNull()
    expect(validateName('Ana')).not.toBeNull()
    expect(validateName('   ')).not.toBeNull()
  })
})

describe('teléfono', () => {
  const mx = countryOf('MX')
  const us = countryOf('US')

  test('se agrupa como lo escribe el país', () => {
    expect(formatPhone('5541287730', mx)).toBe('55 4128 7730')
    expect(formatPhone('5551234567', us)).toBe('555 123 4567')
    expect(phonePlaceholder(mx)).toBe('00 0000 0000')
  })

  test('un número internacional pegado pierde la lada, uno local no', () => {
    expect(normalizePhone('+52 55 4128 7730', mx)).toBe('5541287730')
    // Diez dígitos que empiezan por 52: ya es nacional, se queda como está.
    expect(normalizePhone('5241287730', mx)).toBe('5241287730')
  })

  test('la validación cuenta los dígitos del país elegido', () => {
    expect(validatePhone('5541287730', mx)).toBeNull()
    expect(validatePhone('554128773', mx)).not.toBeNull()
    expect(validatePhone('', mx)).not.toBeNull()
  })

  test('la confirmación enseña los cuatro últimos dígitos reales', () => {
    expect(phoneHint({ kind: 'phone', phone: '2125550100', country: 'US' })).toBe('···0100')
    expect(phoneHint({ kind: 'email', email: 'ana@empresa.mx' })).toBeUndefined()
  })
})

describe('contraseña', () => {
  test('las tres casillas del diseño marcan lo suyo', () => {
    expect(checkPassword('Corta1')).toEqual({ length: false, upperAndDigit: true, symbol: false })
    expect(checkPassword('LargaYfuerte12!')).toEqual({ length: true, upperAndDigit: true, symbol: true })
  })

  test('sólo las dos primeras reglas son obligatorias', () => {
    expect(validatePassword('MayusYnum8')).toBeNull()
    expect(validatePassword('minusculas8')).not.toBeNull()
    expect(validatePassword('corta')).not.toBeNull()
  })

  test('la fuerza sube por tramos y la confirmación exige igualdad', () => {
    expect(passwordStrength('').score).toBe(0)
    expect(passwordStrength('LargaYfuerte12!').label).toBe('FUERTE')
    expect(validatePasswordConfirm('Una1Una1', 'Una1Una1')).toBeNull()
    expect(validatePasswordConfirm('Una1Una1', 'Otra2Otra')).not.toBeNull()
  })
})

describe('la cuenta atrás', () => {
  test('581 segundos se leen 9:41', () => {
    expect(formatCountdown(581)).toBe('9:41')
    expect(formatCountdown(0)).toBe('0:00')
    expect(formatCountdown(-5)).toBe('0:00')
  })
})
