// Turning something typed into something storable.
//
// The rule this file exists to keep: what proves an account is yours is never
// kept as what you typed. Not the password, not the six digits — both are
// derived, salted, and compared by deriving again.
//
// PBKDF2 because it is what the browser gives. A server would use argon2 or
// bcrypt, and it would do this on its own side of the wire; the shape is the
// same and the seam is already asynchronous, so the day this moves nothing
// above it changes.

/**
 * How much work a derivation costs.
 *
 * Stored with each secret rather than assumed, because the number only ever
 * goes up: raising it here must not lock out everyone whose password was
 * derived with the old one. It says how an existing secret was made, not how
 * the next one must be.
 */
export const ROUNDS = 100_000

const enc = new TextEncoder()

/** Bytes as hex, which is how a row can hold them. */
function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Sixteen random bytes, so two people who choose the same password do not
 *  end up with the same stored secret. */
export function newSalt() {
  return hex(crypto.getRandomValues(new Uint8Array(16)).buffer)
}

async function derive(input: string, salt: string | Uint8Array, rounds: number) {
  const key = await crypto.subtle.importKey('raw', enc.encode(input), 'PBKDF2', false, [
    'deriveBits',
  ])
  const saltBuffer: ArrayBuffer = typeof salt === 'string'
    ? enc.encode(salt).buffer
    : Uint8Array.from(salt).buffer
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBuffer, iterations: rounds, hash: 'SHA-256' },
    key,
    256,
  )
  return hex(bits)
}

const bytesFromHex = (value: string) =>
  Uint8Array.from(value.match(/.{2}/g) ?? [], (pair) => Number.parseInt(pair, 16))

const base64 = (bytes: Uint8Array) =>
  btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')).replace(/=+$/, '')

const decode64 = (value: string) => {
  const padded = value + '='.repeat((4 - (value.length % 4)) % 4)
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
}

/** Locks something away in the same self-describing PHC string as the API. */
export async function seal(input: string, rounds = ROUNDS): Promise<string> {
  const salt = newSalt()
  const hash = await derive(input, salt, rounds)
  return `$pbkdf2-sha256$i=${rounds}$${base64(enc.encode(salt))}$${base64(bytesFromHex(hash))}`
}

/**
 * Whether something typed matches what was stored.
 *
 * Compared in constant time — not because a browser timing attack is the
 * threat here, but because the day this runs on a server it is the same
 * function, and a comparison that returns early on the first wrong character
 * tells the caller how much of it was right.
 */
export async function matches(input: string, secret: string | undefined) {
  if (!secret) return false
  const parts = secret.split('$')
  if (parts.length !== 5 || parts[1] !== 'pbkdf2-sha256') return false
  const rounds = Number(parts[2].replace(/^i=/, ''))
  if (!Number.isInteger(rounds) || rounds < 1) return false
  try {
    return equal(await derive(input, decode64(parts[3]), rounds), hex(decode64(parts[4]).buffer))
  } catch {
    return false
  }
}

function equal(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
