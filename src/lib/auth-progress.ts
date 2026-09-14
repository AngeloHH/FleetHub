import { EMPTY_DRAFT, type Recipient, type RegistrationDraft } from './auth'

const KEY = 'fleethub.auth-progress'
const FLOWS = new Set(['register', 'signin', 'reset'])

export type SentCode = {
  to: Recipient
  code?: string
  expiresAt: string
  flow: 'register' | 'signin' | 'reset'
  name?: string
}

export type AuthProgress = {
  draft: RegistrationDraft
  sent: SentCode | null
  resetFor: string | null
  registrationToken: string | null
}

export const EMPTY_AUTH_PROGRESS: AuthProgress = {
  draft: EMPTY_DRAFT,
  sent: null,
  resetFor: null,
  registrationToken: null,
}

type SessionShelf = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const shelf = (): SessionShelf | null => {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

const isRecipient = (value: unknown): value is Recipient => {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return row.kind === 'email'
    ? typeof row.email === 'string'
    : row.kind === 'phone' && typeof row.phone === 'string' && typeof row.country === 'string'
}

const isDraft = (value: unknown): value is RegistrationDraft => {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    typeof row.name === 'string' &&
    typeof row.email === 'string' &&
    typeof row.country === 'string' &&
    typeof row.phone === 'string' &&
    typeof row.companyCode === 'string' &&
    typeof row.isAdmin === 'boolean'
  )
}

const isSent = (value: unknown): value is SentCode => {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    isRecipient(row.to) &&
    (row.code === undefined || typeof row.code === 'string') &&
    typeof row.expiresAt === 'string' &&
    typeof row.flow === 'string' &&
    FLOWS.has(row.flow) &&
    (row.name === undefined || typeof row.name === 'string')
  )
}

/** Recupera únicamente un progreso completo y escrito por esta versión. */
export function readAuthProgress(storage: SessionShelf | null = shelf()): AuthProgress {
  if (!storage) return EMPTY_AUTH_PROGRESS
  try {
    const parsed = JSON.parse(storage.getItem(KEY) ?? 'null') as Record<string, unknown> | null
    if (!parsed || !isDraft(parsed.draft)) return EMPTY_AUTH_PROGRESS
    return {
      draft: parsed.draft,
      sent: parsed.sent === null || parsed.sent === undefined
        ? null
        : isSent(parsed.sent) ? parsed.sent : null,
      resetFor: typeof parsed.resetFor === 'string' ? parsed.resetFor : null,
      registrationToken:
        typeof parsed.registrationToken === 'string' ? parsed.registrationToken : null,
    }
  } catch {
    return EMPTY_AUTH_PROGRESS
  }
}

export function writeAuthProgress(
  progress: AuthProgress,
  storage: SessionShelf | null = shelf(),
) {
  try {
    storage?.setItem(KEY, JSON.stringify(progress))
  } catch {
    // El registro sigue funcionando mientras esta pestaña permanezca abierta.
  }
}

export function clearAuthProgress(storage: SessionShelf | null = shelf()) {
  try {
    storage?.removeItem(KEY)
  } catch {
    // Nada que limpiar cuando el navegador no ofrece almacenamiento.
  }
}
