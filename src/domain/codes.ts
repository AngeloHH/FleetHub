// Whether a key to join a company still works, and why not when it does not.
//
// The rule lives here, apart from where the codes are stored and apart from
// the screen that asks: a code is spent, or withdrawn, or past its window, and
// those are facts about the code, not about who is looking at it.

import type { InviteCode, SupportGrant } from './types'
import { SUPPORT_HOURS, type CodeKind } from './vocabulary'

export type CodeStatus =
  /** Fewer than six digits typed: nothing to look up yet. */
  | { kind: 'incomplete' }
  | { kind: 'unknown' }
  | { kind: 'expired' }
  /** Someone already joined with it. A key opens the door once. */
  | { kind: 'spent' }
  | { kind: 'revoked' }
  /** A real, live key — for something else. Support keys join nobody. */
  | { kind: 'wrongKind' }
  | { kind: 'valid'; role: string }

export const CODE_LENGTH = 6

/**
 * What a code is worth right now.
 *
 * Order matters where two things are true at once: a code that was spent and
 * has since expired reads as spent, because that is the more useful thing to
 * be told — asking for another is the answer to expiry, and it is not the
 * answer here.
 */
export function statusOf(
  code: string,
  found: InviteCode | undefined,
  now: Date = new Date(),
  want: CodeKind = 'alta',
): CodeStatus {
  if (code.length < CODE_LENGTH) return { kind: 'incomplete' }
  if (!found) return { kind: 'unknown' }
  if (found.usedAt) return { kind: 'spent' }
  if (found.revokedAt) return { kind: 'revoked' }
  if (new Date(found.expiresAt) <= now) return { kind: 'expired' }
  // Checked after the dates so that a stale key reads as stale wherever it is
  // typed: being the wrong sort of key is the least of its problems.
  if (found.kind !== want) return { kind: 'wrongKind' }
  return { kind: 'valid', role: found.role }
}

/** Still worth handing to someone: not spent, not withdrawn, not run out. */
export function isLive(found: InviteCode, now: Date = new Date()) {
  return !found.usedAt && !found.revokedAt && new Date(found.expiresAt) > now
}

/** How long it has left, in the wording 07b uses: "4 H", "23 H 58 M". */
export function remaining(found: InviteCode, now: Date = new Date()) {
  const ms = new Date(found.expiresAt).getTime() - now.getTime()
  if (ms <= 0) return 'CADUCADO'
  const minutes = Math.floor(ms / 60_000)
  const hours = Math.floor(minutes / 60)
  if (hours >= 1) return `${hours} H`
  return `${minutes} M`
}

/** The same wording with the minutes, for the code being issued right now. */
export function countdown(found: InviteCode, now: Date = new Date()) {
  const ms = new Date(found.expiresAt).getTime() - now.getTime()
  if (ms <= 0) return 'CADUCADO'
  const minutes = Math.floor(ms / 60_000)
  return `${Math.floor(minutes / 60)} H ${minutes % 60} M`
}

/** What 07b writes beside a pending code: what the account will become. */
export function describeCode(found: InviteCode) {
  if (found.kind === 'soporte') return `SOPORTE · ${SUPPORT_HOURS} H DE ACCESO`
  return found.role
}

// ── El acceso de soporte ────────────────────────────────────────────────────

/** Open right now: granted, not closed early, not run out. */
export function grantIsLive(grant: SupportGrant, now: Date = new Date()) {
  return !grant.endedAt && new Date(grant.expiresAt) > now
}

/** What is left of the window, in 05's wording: "3 H 12 M", "24 M". */
export function grantLeft(grant: SupportGrant, now: Date = new Date()) {
  const ms = new Date(grant.expiresAt).getTime() - now.getTime()
  if (ms <= 0) return 'CADUCADO'
  const minutes = Math.floor(ms / 60_000)
  const hours = Math.floor(minutes / 60)
  return hours >= 1 ? `${hours} H ${minutes % 60} M` : `${minutes} M`
}

// ── El código de un solo uso ────────────────────────────────────────────────

/** Seconds a code stays valid — the design's "CADUCA EN 9:41". */
export const OTP_TTL = 9 * 60 + 41
/** Seconds before "REENVIAR" becomes available — the design's "0:24". */
export const OTP_RESEND_WAIT = 24
export const OTP_LENGTH = 6
