// What counts as a VIN.
/**
 * ISO 3779: seventeen characters, with I, O and Q excluded so they cannot be
 * misread as 1 and 0.
 *
 * Worth knowing: the sample VIN the design carries — JT2BF22K1W0127K2310 — is
 * nineteen characters, so it does not satisfy this. Typing is checked against
 * the standard; the camera path reports whatever the OCR returns, which is what
 * screen 02's confidence figure is for.
 */
export const VIN_LENGTH = 17

const VIN_ALPHABET = /^[A-HJ-NPR-Z0-9]+$/

/** Keeps only characters a VIN can contain, uppercased and capped at length. */
export function normalizeVin(input: string) {
  return vinCharactersOnly(input).slice(0, VIN_LENGTH)
}

/**
 * The same filtering without the cap.
 *
 * Typing is capped because a field that accepts an eighteenth character is
 * lying about what it wants. Reading is not: the OCR returns the plate and
 * whatever sat next to it, and the VIN has to be found inside that. Capping
 * first would leave exactly one candidate — the seventeen characters that
 * happen to come first — which is how a window starting one character early
 * gets accepted as a vehicle.
 */
export function vinCharactersOnly(input: string) {
  return input.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '')
}

export function isValidVin(vin: string) {
  return vin.length === VIN_LENGTH && VIN_ALPHABET.test(vin)
}

/**
 * The ninth character is arithmetic, not identity.
 *
 * Every other character is transliterated to a number, weighted by position and
 * summed; the remainder modulo eleven has to be what sits in position nine, with
 * ten written as X. Getting one character wrong almost always breaks it, which
 * is the point: NHTSA requires it of every vehicle sold in the United States, so
 * for this fleet a VIN that fails here is a misreading, not a vehicle.
 *
 * The camera needs this and the keyboard does not. A person typing is looking at
 * the plate; the OCR is guessing, and without an arithmetic check every
 * seventeen characters in the alphabet look equally plausible — including the
 * window that starts one character too early.
 */
const TRANSLITERATION: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
}

const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2]

export function hasVinCheckDigit(vin: string) {
  if (!isValidVin(vin)) return false
  let total = 0
  for (let at = 0; at < VIN_LENGTH; at += 1) {
    const character = vin[at]
    const value = character >= '0' && character <= '9'
      ? Number(character)
      : TRANSLITERATION[character]
    if (value === undefined) return false
    total += value * WEIGHTS[at]
  }
  const remainder = total % 11
  return vin[8] === (remainder === 10 ? 'X' : String(remainder))
}
