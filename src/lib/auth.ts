// Access rules shared by sign-in, registration and code verification.

/**
 * A dialling destination. `groups` drives both the display grouping and the
 * expected national length (its sum) — the two always agree because they come
 * from the same source.
 */
export type Country = {
  /** ISO code. The key, because +1 covers more than one country. */
  iso: string
  dial: string
  name: string
  groups: number[]
}

export const COUNTRIES: Country[] = [
  { iso: 'US', dial: '1', name: 'Estados Unidos', groups: [3, 3, 4] },
  { iso: 'MX', dial: '52', name: 'México', groups: [2, 4, 4] },
  { iso: 'CA', dial: '1', name: 'Canadá', groups: [3, 3, 4] },
  { iso: 'AR', dial: '54', name: 'Argentina', groups: [2, 4, 4] },
  { iso: 'BR', dial: '55', name: 'Brasil', groups: [2, 5, 4] },
  { iso: 'CL', dial: '56', name: 'Chile', groups: [1, 4, 4] },
  { iso: 'CO', dial: '57', name: 'Colombia', groups: [3, 3, 4] },
  { iso: 'CR', dial: '506', name: 'Costa Rica', groups: [4, 4] },
  { iso: 'EC', dial: '593', name: 'Ecuador', groups: [2, 3, 4] },
  { iso: 'ES', dial: '34', name: 'España', groups: [3, 3, 3] },
  { iso: 'GT', dial: '502', name: 'Guatemala', groups: [4, 4] },
  { iso: 'PA', dial: '507', name: 'Panamá', groups: [4, 4] },
  { iso: 'PE', dial: '51', name: 'Perú', groups: [3, 3, 3] },
]

/** What a phone field starts on, and the head of the list it starts at. */
export const DEFAULT_COUNTRY = 'US'

export function countryOf(iso: string): Country {
  return COUNTRIES.find((c) => c.iso === iso) ?? COUNTRIES[0]
}

/** Digits a national number carries, excluding the dialling code. */
export function nationalLength(c: Country) {
  return c.groups.reduce((total, g) => total + g, 0)
}

export type RegistrationDraft = {
  name: string
  email: string
  /** ISO code of the dialling country — see COUNTRIES. */
  country: string
  /** National digits only, as typed; formatting happens at the edge. */
  phone: string
  companyCode: string
  /**
   * The person is setting up the company rather than joining one. Turning it
   * on asks the server to create the company and puts its token here.
   */
  isAdmin: boolean
}

export const EMPTY_DRAFT: RegistrationDraft = {
  name: '',
  email: '',
  country: DEFAULT_COUNTRY,
  phone: '',
  companyCode: '',
  isAdmin: false,
}

/** The validated inputs — deliberately not every draft key (`isAdmin` is a mode, not a field). */
export type Field = 'name' | 'email' | 'phone' | 'companyCode'

/** Keeps only hex characters, uppercased — what the six code boxes accept. */
export function toHex(input: string) {
  return input.toUpperCase().replace(/[^0-9A-F]/g, '')
}

export function digitsOf(input: string) {
  return input.replace(/\D/g, '')
}

/**
 * Groups the national digits the way the country writes them (`55 4128 7730`
 * for Mexico), formatting progressively so the field reads correctly while
 * being typed.
 *
 * The dialling code is deliberately NOT part of this: it is chosen beside the
 * input. Baking it into the value round-trips it back through `normalizePhone`
 * on every keystroke, which appends the code to itself.
 */
export function formatPhone(digits: string, country: Country) {
  const d = digits.slice(0, nationalLength(country))
  const out: string[] = []
  let at = 0
  for (const size of country.groups) {
    if (at >= d.length) break
    out.push(d.slice(at, at + size))
    at += size
  }
  return out.join(' ')
}

/** Shape hint for the field, e.g. `00 0000 0000` for Mexico. */
export function phonePlaceholder(country: Country) {
  return country.groups.map((size) => '0'.repeat(size)).join(' ')
}

/**
 * National digits, without the dialling code. Tolerates a pasted international
 * number (`+52 55 4128 7730`) by dropping a leading dialling code — but only
 * when the result is too long to be a national number already, so a local
 * number that happens to start with those digits survives.
 */
export function normalizePhone(input: string, country: Country) {
  const max = nationalLength(country)
  const d = digitsOf(input)
  const stripped = d.length > max && d.startsWith(country.dial) ? d.slice(country.dial.length) : d
  return stripped.slice(0, max)
}

// A pragmatic address check: one @, no spaces, a dot-separated domain. Deliberately
// not RFC 5322 — that rejects almost nothing and confuses more than it helps.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function validateName(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return 'ESCRIBE TU NOMBRE COMPLETO'
  if (trimmed.split(/\s+/).length < 2) return 'INCLUYE AL MENOS UN APELLIDO'
  return null
}

/** Standalone so sign-in can reuse it without inventing a registration draft. */
export function validateEmail(value: string): string | null {
  if (!value.trim()) return 'ESCRIBE TU CORREO DE TRABAJO'
  if (!EMAIL.test(value.trim())) return 'ESTE CORREO NO PARECE VÁLIDO'
  return null
}

export function validatePhone(value: string, country: Country): string | null {
  if (!value) return 'ESCRIBE TU TELÉFONO MÓVIL'
  const max = nationalLength(country)
  if (value.length !== max) return `SON ${max} DÍGITOS EN ${country.name.toUpperCase()}`
  return null
}

export function validateField(field: Field, draft: RegistrationDraft): string | null {
  const value = draft[field]
  switch (field) {
    case 'name':
      return validateName(value)
    case 'email':
      return validateEmail(value)
    case 'phone':
      return validatePhone(value, countryOf(draft.country))
    case 'companyCode':
      // Whether a code works is not something this side can know — it is a
      // fact about a row, with a date and a use on it, and the screen asks.
      // All that is checkable here is that six digits were typed.
      if (draft.isAdmin) return value.length === 6 ? null : 'NO SE PUDO GENERAR EL CÓDIGO'
      return value.length === 6 ? null : 'FALTAN DÍGITOS DEL CÓDIGO'
  }
}

export const FIELDS: Field[] = ['name', 'email', 'phone', 'companyCode']

// ── Passwords ───────────────────────────────────────────────────────────────

/** The design's three checklist rules. Only the first two are required. */
export type PasswordRules = { length: boolean; upperAndDigit: boolean; symbol: boolean }

export function checkPassword(pw: string): PasswordRules {
  return {
    length: pw.length >= 8,
    upperAndDigit: /[A-ZÁÉÍÓÚÑ]/.test(pw) && /\d/.test(pw),
    symbol: /[^\p{L}\d]/u.test(pw),
  }
}

/** Four segments, as the design draws them. */
export type Strength = { score: 0 | 1 | 2 | 3 | 4; label: string; tone: 'danger' | 'warn' | 'ok' }

export function passwordStrength(pw: string): Strength {
  const rules = checkPassword(pw)
  const score = ((rules.length ? 1 : 0) +
    (rules.upperAndDigit ? 1 : 0) +
    (rules.symbol ? 1 : 0) +
    (pw.length >= 12 ? 1 : 0)) as Strength['score']

  if (!pw) return { score: 0, label: '—', tone: 'danger' }
  if (score <= 1) return { score, label: 'DÉBIL', tone: 'danger' }
  if (score === 2) return { score, label: 'REGULAR', tone: 'warn' }
  if (score === 3) return { score, label: 'BUENA', tone: 'ok' }
  return { score, label: 'FUERTE', tone: 'ok' }
}

export function validatePassword(pw: string): string | null {
  if (!pw) return 'ESCRIBE UNA CONTRASEÑA'
  const rules = checkPassword(pw)
  if (!rules.length) return 'MÍNIMO 8 CARACTERES'
  if (!rules.upperAndDigit) return 'FALTA UNA MAYÚSCULA O UN NÚMERO'
  return null
}

export function validatePasswordConfirm(pw: string, confirm: string): string | null {
  if (!confirm) return 'REPITE LA CONTRASEÑA'
  if (pw !== confirm) return 'LAS CONTRASEÑAS NO COINCIDEN'
  return null
}

// ── One-time codes ──────────────────────────────────────────────────────────

// How long the countdown runs and how many boxes there are: the screen draws
// these. Issuing a code is not here — that happens where the rows are.
export { OTP_LENGTH, OTP_RESEND_WAIT, OTP_TTL } from '../domain/codes'

/** `581` → `9:41`. */
export function formatCountdown(seconds: number) {
  const s = Math.max(0, seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Where a code was sent, and how the screen should describe it. */
export type Recipient = { kind: 'email'; email: string } | { kind: 'phone'; phone: string; country: string }

export function describeRecipient(to: Recipient) {
  return to.kind === 'email' ? to.email : `+${countryOf(to.country).dial} ${formatPhone(to.phone, countryOf(to.country))}`
}

/** La parte del teléfono que una confirmación puede enseñar sin repetirlo entero. */
export function phoneHint(to: Recipient) {
  if (to.kind !== 'phone') return undefined
  const digits = digitsOf(to.phone)
  return digits ? `···${digits.slice(-4)}` : undefined
}

export function validateAll(draft: RegistrationDraft): Partial<Record<Field, string>> {
  const errors: Partial<Record<Field, string>> = {}
  for (const f of FIELDS) {
    const error = validateField(f, draft)
    if (error) errors[f] = error
  }
  return errors
}

export function isComplete(draft: RegistrationDraft) {
  return Object.keys(validateAll(draft)).length === 0
}
