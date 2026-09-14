// Screens A–D — sign in, registration with a company code, 6-digit
// verification, and password creation.

import { useEffect, useState, type ReactNode } from 'react'
import { pressable } from '../lib/press'
import { color } from '../design/tokens'
// `Login` is this file's own screen A, so the glyph takes an alias.
import {
  ArrowRight,
  Check,
  Close,
  Dialpad,
  Lock,
  Login as LoginIcon,
  Mail,
  Phone,
  Send,
} from '../components/icons'
import { BackChevron, Btn, Card, Screen, StripTitle, Toggle, TopStrip } from '../components/ui'
import { FieldLabel, CodeInput, PhoneField, TextField } from '../components/form'
import {
  checkPassword,
  countryOf,
  DEFAULT_COUNTRY,
  formatCountdown,
  OTP_LENGTH,
  OTP_RESEND_WAIT,
  OTP_TTL,
  passwordStrength,
  validateEmail,
  validatePassword,
  validatePasswordConfirm,
  validatePhone,
  type Recipient,
  nationalLength,
  phonePlaceholder,
  normalizePhone,
  EMPTY_DRAFT,
  formatPhone,
  validateAll,
  type Field as DraftField,
  type RegistrationDraft,
} from '../lib/auth'
import { CODE_LENGTH, type CodeStatus } from '../domain'
import s from './auth.module.css'

function StepBack({
  label,
  step,
  onBack,
}: {
  label: string
  step: string
  onBack?: () => void
}) {
  return (
    <TopStrip
      title={label}
      leading={<BackChevron onClick={onBack} />}
      trailing={<span className={s.step}>{step}</span>}
    />
  )
}

// ── A · Inicio de sesión ────────────────────────────────────────────────────

type LoginMode = 'email' | 'phone'

/** Why a way in was refused, or nothing if it was not. */
type Reason = string | null | void | Promise<string | null | void>

export function Login({
  onSendCode,
  onPasswordSignIn,
  onForgot,
  onRegister,
}: {
  /** Returns a reason the code cannot be sent, or null. */
  onSendCode?: (to: Recipient) => Reason
  /**
   * Returns an error to display, or null on success. Both ways in ask
   * somewhere else whether this identity may come in, and somewhere else is
   * asynchronous — a server, one day.
   */
  onPasswordSignIn?: (to: Recipient, password: string) => Reason
  /**
   * Starts a password reset for this identity. The same shape as sending a
   * code, because that is what it does — the difference is what confirming
   * the code earns, and that is decided where the flows are.
   */
  onForgot?: (to: Recipient) => Reason
  onRegister?: () => void
} = {}) {
  const [mode, setMode] = useState<LoginMode>('email')
  const [method, setMethod] = useState<'code' | 'password'>('code')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [shown, setShown] = useState(false)
  const [countryIso, setCountryIso] = useState(DEFAULT_COUNTRY)
  const [touched, setTouched] = useState(false)
  const [focused, setFocused] = useState<'identity' | 'password' | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const country = countryOf(countryIso)
  const error = mode === 'email' ? validateEmail(email) : validatePhone(phone, country)
  /** In password mode the refusal shows under the password, as it always has. */
  const identityError = method === 'code' ? failure : null
  const ready = !error && (method === 'code' || password.length > 0)

  const recipient = (): Recipient =>
    mode === 'email'
      ? { kind: 'email', email: email.trim() }
      : { kind: 'phone', phone, country: countryIso }

  const submit = async () => {
    if (!ready) {
      setTouched(true)
      return
    }
    const refusal =
      method === 'code'
        ? await onSendCode?.(recipient())
        : await onPasswordSignIn?.(recipient(), password)
    setFailure(refusal ?? null)
  }

  const switchMethod = () => {
    setMethod((m) => (m === 'code' ? 'password' : 'code'))
    setFailure(null)
    setPassword('')
  }

  const tab = (value: LoginMode, label: string, icon: ReactNode) => (
    <div
      {...pressable(() => {
        setMode(value)
        setTouched(false)
        setFailure(null)
      })}
      // The glyph sits in the same node as the label, so without a name of its
      // own the tab reads as "mailCORREO".
      aria-label={label}
      aria-pressed={mode === value}
      className={s.tab}
      style={{
        background: mode === value ? color.ink : undefined,
        color: mode === value ? color.inkOn : color.muted,
      }}
    >
      {icon}
      {label}
    </div>
  )

  return (
    <Screen>
      <div className={s.brand}>
        <div className={s.wordmark}>
          <StripTitle>FLEETHUB_OPS</StripTitle>
        </div>
        <div className={s.tagline}>CONSOLA DE FLOTA · ACCESO DE OPERADOR</div>
        <div className={s.rule} />
      </div>

      <div className={s.form}>
        <div className={s.tabs}>
          {tab('email', 'CORREO', <Mail size={14} />)}
          {tab('phone', 'TELÉFONO', <Phone size={14} />)}
        </div>

        {mode === 'email' ? (
          <TextField
            label="CORREO DE TRABAJO"
            value={email}
            onChange={(v) => {
              setEmail(v)
              setFailure(null)
            }}
            placeholder="nombre@empresa.mx"
            inputMode="email"
            autoComplete="email"
            mono
            style={{ marginTop: 20 }}
            error={identityError ?? (touched ? (error ?? undefined) : undefined)}
            focused={focused === 'identity'}
            onFocus={() => setFocused('identity')}
            onBlur={() => {
              setFocused(null)
              setTouched(true)
            }}
          />
        ) : (
          <PhoneField
            label="TELÉFONO MÓVIL"
            value={formatPhone(phone, country)}
            onChange={(v) => {
              setPhone(normalizePhone(v, country))
              setFailure(null)
            }}
            country={countryIso}
            onCountryChange={(iso) => {
              setCountryIso(iso)
              setPhone((p) => p.slice(0, nationalLength(countryOf(iso))))
            }}
            placeholder={phonePlaceholder(country)}
            style={{ marginTop: 20 }}
            error={identityError ?? (touched ? (error ?? undefined) : undefined)}
            focused={focused === 'identity'}
            onFocus={() => setFocused('identity')}
            onBlur={() => {
              setFocused(null)
              setTouched(true)
            }}
          />
        )}

        {method === 'password' && (
          <TextField
            label="CONTRASEÑA"
            value={password}
            onChange={(v) => {
              setPassword(v)
              setFailure(null)
            }}
            type={shown ? 'text' : 'password'}
            autoComplete="current-password"
            mono
            style={{ marginTop: 16 }}
            trailing={<RevealToggle shown={shown} onToggle={() => setShown((v) => !v)} />}
            error={failure ?? undefined}
            focused={focused === 'password'}
            onFocus={() => setFocused('password')}
            onBlur={() => setFocused(null)}
          />
        )}

        <Btn
          variant={ready ? 'accent' : 'disabled'}
          onClick={() => void submit()}
          className={s.submit}
        >
          {method === 'code' ? <Send size={16} /> : <LoginIcon size={16} />}
          {method === 'code' ? 'ENVIAR CÓDIGO' : 'ENTRAR'}
        </Btn>
        <div className={s.hint}>
          {method === 'code' ? (
            'TE MANDAMOS UN CÓDIGO DE 6 DÍGITOS · NO NECESITAS CONTRASEÑA'
          ) : (
            <>
              {'LA QUE DEFINISTE AL CREAR TU CUENTA · '}
              <span
                aria-label="Recuperar contraseña"
                className={s.link}
                {...pressable(() => {
                  // The reset is for the identity typed above; without one
                  // there is nobody to reset, and the field says so.
                  if (error) {
                    setTouched(true)
                    return
                  }
                  void Promise.resolve(onForgot?.(recipient())).then((refusal) =>
                    setFailure(refusal ?? null),
                  )
                })}
              >
                ¿LA OLVIDASTE?
              </span>
            </>
          )}
        </div>

        <div className={s.or}>
          <div className={s.orLine} />
          <span className={s.orWord}>O</span>
          <div className={s.orLine} />
        </div>
        <button className={`fh-opt ${s.otherWay}`} onClick={switchMethod}>
          {/* The icon follows the method being offered, not the one in use. */}
          {method === 'code' ? <Lock size={15} /> : <Dialpad size={15} />}
          {method === 'code' ? 'ENTRAR CON CONTRASEÑA' : 'ENTRAR CON CÓDIGO'}
        </button>
      </div>

      <div className={s.footer}>
        <div className={s.footerLine}>
          <span className={s.muted}>¿NO TIENES CUENTA?</span>
          <span {...pressable(onRegister)} className={s.link}>
            REGÍSTRATE
          </span>
        </div>
        <div className={s.build}>FLEETHUB v1.4.0 · BUILD 2608</div>
      </div>
    </Screen>
  )
}

// ── B · Registro ────────────────────────────────────────────────────────────

/**
 * What the lookup came back with, in the design's banner treatment.
 *
 * The verdict is handed in rather than worked out: whether a code still works
 * is a fact about a row somewhere else, with a date and a use on it.
 */
function CodeBanner({
  status,
  show,
  isAdmin,
}: {
  status: CodeStatus | null
  show: boolean
  isAdmin: boolean
}) {
  // Nothing to look up when the code was just minted for this account.
  if (isAdmin) {
    return (
      <Banner tone="ok" icon={<Check size={14} color={color.ok} />}>
        CÓDIGO NUEVO · ROL ADMINISTRADOR
      </Banner>
    )
  }

  if (!status) return null

  if (status.kind === 'valid') {
    return (
      <Banner tone="ok" icon={<Check size={14} color={color.ok} />}>
        {`ROL ${status.role}`}
      </Banner>
    )
  }
  if (!show) return null

  const message =
    status.kind === 'incomplete'
      ? 'FALTAN DÍGITOS DEL CÓDIGO'
      : status.kind === 'expired'
        ? 'ESTE CÓDIGO YA CADUCÓ · PIDE OTRO'
        : status.kind === 'spent'
          ? 'ESTE CÓDIGO YA SE USÓ · PIDE OTRO'
          : status.kind === 'revoked'
            ? 'ESTE CÓDIGO FUE CANCELADO · PIDE OTRO'
            : status.kind === 'wrongKind'
              ? 'ESTE CÓDIGO NO SIRVE PARA DARSE DE ALTA'
              : 'ESTE CÓDIGO NO EXISTE'

  return (
    <Banner tone="danger" icon={<Close size={14} color={color.danger} />}>
      {message}
    </Banner>
  )
}

function Banner({
  tone,
  icon,
  children,
}: {
  tone: 'ok' | 'danger'
  icon: ReactNode
  children: string
}) {
  const c = tone === 'ok' ? color.ok : color.danger
  return (
    <div
      className={s.banner}
      style={{ border: `1px solid ${c}`, background: tone === 'ok' ? color.okSoft : color.dangerSoft }}
    >
      {icon}
      <span className={s.bannerText} style={{ color: c }}>
        {children}
      </span>
    </div>
  )
}

export function Register({
  initial = EMPTY_DRAFT,
  onCheckCode,
  onCreateCompany,
  onContinue,
  onBack,
  onSignIn,
}: {
  initial?: RegistrationDraft
  /**
   * Asks what a code is worth. Absent on the gallery copy, which draws the
   * screen with nothing typed and so has nothing to ask about.
   */
  onCheckCode?: (code: string) => Promise<CodeStatus>
  /** Crea la compañía y devuelve su llave de administrador. */
  onCreateCompany?: () => Promise<{ ok: true; value: string } | { ok: false; reason: string }>
  onContinue?: (draft: RegistrationDraft) => void
  onBack?: () => void
  onSignIn?: () => void
} = {}) {
  const [draft, setDraft] = useState<RegistrationDraft>(initial)
  const [touched, setTouched] = useState<Partial<Record<DraftField, boolean>>>({})
  const [focus, setFocus] = useState<DraftField | null>(null)
  /** What was typed before switching to admin, so switching back restores it. */
  const [redeemedCode, setRedeemedCode] = useState(initial.isAdmin ? '' : initial.companyCode)
  /** The last answer about the code in the boxes, or null before there is one. */
  const [status, setStatus] = useState<CodeStatus | null>(null)
  const [creatingCompany, setCreatingCompany] = useState(false)

  /**
   * Ask as soon as six digits are there, and forget the answer the moment the
   * code changes — an answer about a code nobody is typing any more is worse
   * than none.
   */
  useEffect(() => {
    // Short of six digits there is nothing to ask, and that is itself an
    // answer; null is "asked, still waiting", which shows nothing.
    const short = draft.companyCode.length < CODE_LENGTH
    setStatus(short ? { kind: 'incomplete' } : null)
    if (draft.isAdmin || short || !onCheckCode) return
    let alive = true
    void onCheckCode(draft.companyCode).then((answer) => {
      if (alive) setStatus(answer)
    })
    return () => {
      alive = false
    }
  }, [draft.companyCode, draft.isAdmin, onCheckCode])

  const errors = validateAll(draft)
  // The lookup has the last word: six digits are typed but the code may be
  // spent, withdrawn or past its window, and only the other side knows.
  const ready =
    Object.keys(errors).length === 0 && (draft.isAdmin || status?.kind === 'valid')

  /** An error only surfaces once the field has been visited. */
  const errorOf = (f: DraftField) => (touched[f] ? (errors[f] ?? undefined) : undefined)

  const set = (f: DraftField, value: string) => setDraft((d) => ({ ...d, [f]: value }))
  const blur = (f: DraftField) => {
    setFocus(null)
    setTouched((t) => ({ ...t, [f]: true }))
  }

  const submit = () => {
    if (!ready) {
      setTouched({ name: true, email: true, phone: true, companyCode: true })
      return
    }
    onContinue?.(draft)
  }

  const country = countryOf(draft.country)

  /** Switching country re-shapes the number; trim anything the new one can't hold. */
  const setCountry = (iso: string) =>
    setDraft((d) => ({
      ...d,
      country: iso,
      phone: d.phone.slice(0, nationalLength(countryOf(iso))),
    }))

  const setAdmin = async (next: boolean) => {
    if (!next) {
      setDraft((d) => ({ ...d, isAdmin: false, companyCode: redeemedCode }))
      setTouched((t) => ({ ...t, companyCode: true }))
      return
    }

    if (creatingCompany) return
    const previousCode = draft.companyCode
    setRedeemedCode(previousCode)
    setDraft((d) => ({ ...d, isAdmin: true, companyCode: '' }))
    setTouched((t) => ({ ...t, companyCode: false }))
    setCreatingCompany(true)
    const answer = onCreateCompany
      ? await onCreateCompany()
      : { ok: false as const, reason: 'NO SE PUDO CREAR LA EMPRESA' }
    setCreatingCompany(false)
    if (answer.ok) {
      setDraft((d) => ({ ...d, isAdmin: true, companyCode: answer.value }))
      return
    }
    setDraft((d) => ({ ...d, isAdmin: false, companyCode: previousCode }))
    window.alert(answer.reason)
  }

  const fieldProps = (f: DraftField) => ({
    error: errorOf(f),
    focused: focus === f,
    onFocus: () => setFocus(f),
    onBlur: () => blur(f),
  })

  return (
    <Screen>
      <StepBack label="FLEETHUB_OPS" step="PASO 1 DE 3" onBack={onBack} />

      <div className={s.registerForm}>
        <TextField
          label="NOMBRE COMPLETO"
          value={draft.name}
          onChange={(v) => set('name', v)}
          placeholder="Nombre y apellidos"
          autoComplete="name"
          {...fieldProps('name')}
        />

        <TextField
          label="CORREO DE TRABAJO"
          value={draft.email}
          onChange={(v) => set('email', v.trim())}
          placeholder="nombre@empresa.mx"
          inputMode="email"
          autoComplete="email"
          mono
          style={{ marginTop: 16 }}
          {...fieldProps('email')}
        />

        <PhoneField
          label="TELÉFONO MÓVIL"
          value={formatPhone(draft.phone, country)}
          onChange={(v) => set('phone', normalizePhone(v, country))}
          country={draft.country}
          onCountryChange={setCountry}
          placeholder={phonePlaceholder(country)}
          style={{ marginTop: 16 }}
          {...fieldProps('phone')}
        />

        <div className={s.codeHeader}>
          <FieldLabel>CÓDIGO DE EMPRESA</FieldLabel>
          {draft.isAdmin ? (
            <FieldLabel style={{ letterSpacing: 1 }}>
              {creatingCompany ? 'CREANDO…' : 'GENERADO POR EL SERVIDOR'}
            </FieldLabel>
          ) : (
            <FieldLabel style={{ letterSpacing: 1 }}>6 DÍGITOS HEX</FieldLabel>
          )}
        </div>
        <div className={s.codeBoxes}>
          <CodeInput
            value={draft.companyCode}
            onChange={(v) => set('companyCode', v)}
            onComplete={() => setTouched((t) => ({ ...t, companyCode: true }))}
            invalid={Boolean(errorOf('companyCode'))}
            locked={draft.isAdmin}
          />
        </div>

        <CodeBanner
          status={status}
          show={Boolean(touched.companyCode)}
          isAdmin={draft.isAdmin}
        />

        <div className={s.codeNote}>
          {draft.isAdmin
            ? 'ESTE SERÁ EL CÓDIGO DE TU EMPRESA · LO REPARTES A TU EQUIPO'
            : 'TU ADMINISTRADOR LO GENERA · CADUCA EN 24 H'}
        </div>

        <div
          className={s.adminRow}
          style={{
            border: `1px solid ${draft.isAdmin ? color.accent : color.border}`,
            background: draft.isAdmin ? color.accentSoft : color.surface,
          }}
        >
          <div style={{ flex: 1 }}>
            <div className={s.adminName}>Soy el administrador</div>
            <div className={s.note} style={{ marginTop: 3 }}>
              DOY DE ALTA LA EMPRESA · NO CANJEO CÓDIGO
            </div>
          </div>
          <Toggle on={draft.isAdmin} onChange={(next) => void setAdmin(next)} label="Soy el administrador" />
        </div>
      </div>

      <div className={s.registerFooter}>
        <Btn variant={ready ? 'accent' : 'disabled'} onClick={submit} className={s.continue}>
          <ArrowRight size={16} />
          CONTINUAR
        </Btn>
        <div className={s.signIn}>
          <span className={s.muted}>¿YA TIENES CUENTA?</span>
          <span {...pressable(onSignIn)} className={s.link}>
            INICIA SESIÓN
          </span>
        </div>
      </div>
    </Screen>
  )
}

// ── C · Confirmar código ────────────────────────────────────────────────────

const otpSecondsLeft = (expiresAt?: string) => {
  const end = Date.parse(expiresAt ?? '')
  return Number.isFinite(end) ? Math.max(0, Math.ceil((end - Date.now()) / 1000)) : OTP_TTL
}

export function VerifyCode({
  name,
  sentTo = '',
  smsHint,
  code,
  expiresAt,
  onConfirm,
  onVerified,
  onResend,
  onBack,
}: {
  /** Nombre que acompaña el código sin repetir el teléfono completo. */
  name?: string
  /** Where the code went, already formatted. */
  sentTo?: string
  smsHint?: string
  /**
   * The code that is currently outstanding. The screen no longer checks
   * against it — it cannot, and should not be able to. It is here so that a
   * newly issued one restarts the clocks and clears what was typed.
   */
  code?: string
  /** Caducidad real del servidor; permite continuar correctamente tras recargar. */
  expiresAt?: string
  /** Asks whether the digits are right. Returns why not, or null. Without it
   *  the screen is a static preview and anything six digits long passes. */
  onConfirm?: (digits: string) => Promise<string | null>
  onVerified?: () => void
  onResend?: () => void
  onBack?: () => void
} = {}) {
  const [digits, setDigits] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [expiresIn, setExpiresIn] = useState(() => otpSecondsLeft(expiresAt))
  const [resendIn, setResendIn] = useState(OTP_RESEND_WAIT)

  // A newly issued code restarts both clocks and clears what was typed.
  useEffect(() => {
    setDigits('')
    setError(null)
    setExpiresIn(otpSecondsLeft(expiresAt))
    setResendIn(OTP_RESEND_WAIT)
  }, [code, expiresAt])

  useEffect(() => {
    const id = setInterval(() => {
      setExpiresIn((s) => Math.max(0, s - 1))
      setResendIn((s) => Math.max(0, s - 1))
    }, 1000)
    return () => clearInterval(id)
  }, [])

  const expired = expiresIn === 0
  const complete = digits.length === OTP_LENGTH
  const ready = complete && !expired

  const confirm = async () => {
    if (expired) {
      setError('EL CÓDIGO CADUCÓ · PIDE OTRO')
      return
    }
    if (!complete) {
      setError('FALTAN DÍGITOS DEL CÓDIGO')
      return
    }
    // Nobody to ask: this is the static preview, so let it pass.
    if (!onConfirm) {
      onVerified?.()
      return
    }
    const reason = await onConfirm(digits)
    if (!reason) {
      onVerified?.()
      return
    }
    setError(reason)
    setDigits('')
  }

  const resend = () => {
    if (resendIn > 0) return
    onResend?.()
  }

  return (
    <Screen>
      <StepBack label="FLEETHUB_OPS" step="PASO 2 DE 3" onBack={onBack} />

      <div className={s.verify}>
        <FieldLabel>{name ? `HOLA, ${name.trim().split(/\s+/)[0].toUpperCase()}` : 'CONFIRMA TU CÓDIGO'}</FieldLabel>
        <div className={s.sms}>
          {smsHint
            ? `CÓDIGO PARA EL NÚMERO TERMINADO EN ${smsHint}`
            : `CÓDIGO ENVIADO A ${sentTo || 'TU CORREO'}`}
        </div>

        <div className={s.digits}>
          <CodeInput
            mode="numeric"
            autoFocus
            value={digits}
            onChange={(v) => {
              setError(null)
              setDigits(v)
            }}
            invalid={Boolean(error)}
            height={58}
            fontSize={24}
          />
        </div>

        <div className={s.clocks}>
          <span style={{ color: expired ? color.danger : color.muted }}>
            {expired ? 'EL CÓDIGO CADUCÓ' : `EL CÓDIGO CADUCA EN ${formatCountdown(expiresIn)}`}
          </span>
          <span
            {...pressable(resendIn === 0 ? resend : undefined)}
            style={{
              color: resendIn === 0 ? color.accent : color.muted,
              fontWeight: resendIn === 0 ? 600 : 400,
              cursor: resendIn === 0 ? 'pointer' : 'default',
            }}
          >
            {resendIn === 0 ? 'REENVIAR' : `REENVIAR EN ${formatCountdown(resendIn)}`}
          </span>
        </div>

        {error && <div className={s.verifyError}>{error}</div>}

        <Btn
          variant={ready ? 'accent' : 'disabled'}
          onClick={() => void confirm()}
          style={{ marginTop: error ? 12 : 20 }}
        >
          CONFIRMAR
        </Btn>
      </div>

    </Screen>
  )
}

// ── D · Crear contraseña ────────────────────────────────────────────────────

function RuleRow({
  met,
  children,
  last,
}: {
  met: boolean
  children: ReactNode
  last?: boolean
}) {
  return (
    <div
      className={s.rule2}
      style={{ borderBottom: last ? undefined : `1px solid ${color.borderSoft}` }}
    >
      {met ? <Check size={14} color={color.ok} /> : <div className={s.ruleBox} />}
      <span className={s.ruleText} style={{ color: met ? color.ink : color.muted }}>
        {children}
      </span>
    </div>
  )
}

/** The design's "VER" affordance, toggling the field between dots and text. */
function RevealToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={shown ? 'Ocultar contraseña' : 'Mostrar contraseña'}
      className={`fh-focus-ring ${s.reveal}`}
    >
      {shown ? 'OCULTAR' : 'VER'}
    </button>
  )
}

export function CreatePassword({
  onCreate,
  onBack,
  requireCurrent = false,
}: {
  onCreate?: (password: string, current?: string) => void
  onBack?: () => void
  requireCurrent?: boolean
} = {}) {
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [shown, setShown] = useState(false)
  const [touched, setTouched] = useState<{ current?: boolean; password?: boolean; confirm?: boolean }>({})
  const [focus, setFocus] = useState<'current' | 'password' | 'confirm' | null>(null)

  const rules = checkPassword(password)
  const strength = passwordStrength(password)
  const passwordError = validatePassword(password)
  const confirmError = validatePasswordConfirm(password, confirm)
  const currentError = requireCurrent && !current ? 'ESCRIBE TU CONTRASEÑA ACTUAL' : null
  const ready = !currentError && !passwordError && !confirmError

  const submit = () => {
    if (!ready) {
      setTouched({ current: true, password: true, confirm: true })
      return
    }
    onCreate?.(password, current || undefined)
  }

  const strengthColor =
    strength.tone === 'ok' ? color.ok : strength.tone === 'warn' ? color.warn : color.danger

  return (
    <Screen>
      <StepBack label="FLEETHUB_OPS" step="PASO 3 DE 3" onBack={onBack} />

      <div className={s.passwordForm}>
        <div className={s.title}>{requireCurrent ? 'Cambia tu contraseña' : 'Define tu contraseña'}</div>
        <div className={s.subtitle}>
          {requireCurrent ? 'CONFIRMA PRIMERO LA CONTRASEÑA QUE USAS AHORA' : 'LA USARÁS SOLO SI NO PUEDES RECIBIR EL CÓDIGO'}
        </div>

        {requireCurrent && (
          <TextField
            label="CONTRASEÑA ACTUAL"
            value={current}
            onChange={setCurrent}
            type={shown ? 'text' : 'password'}
            autoComplete="current-password"
            mono
            style={{ marginTop: 22 }}
            error={touched.current ? (currentError ?? undefined) : undefined}
            focused={focus === 'current'}
            onFocus={() => setFocus('current')}
            onBlur={() => {
              setFocus(null)
              setTouched((t) => ({ ...t, current: true }))
            }}
          />
        )}

        <TextField
          label={requireCurrent ? 'CONTRASEÑA NUEVA' : 'CONTRASEÑA'}
          value={password}
          onChange={setPassword}
          type={shown ? 'text' : 'password'}
          autoComplete="new-password"
          mono
          style={{ marginTop: requireCurrent ? 18 : 22 }}
          trailing={<RevealToggle shown={shown} onToggle={() => setShown((v) => !v)} />}
          error={touched.password ? (passwordError ?? undefined) : undefined}
          focused={focus === 'password'}
          onFocus={() => setFocus('password')}
          onBlur={() => {
            setFocus(null)
            setTouched((t) => ({ ...t, password: true }))
          }}
        />

        <div className={s.meter}>
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={s.meterBar}
              style={{ background: i < strength.score ? strengthColor : color.surfaceAlt }}
            />
          ))}
        </div>
        <div className={s.strength} style={{ color: password ? strengthColor : color.muted }}>
          SEGURIDAD: {strength.label}
        </div>

        <TextField
          label="CONFIRMAR CONTRASEÑA"
          value={confirm}
          onChange={setConfirm}
          type={shown ? 'text' : 'password'}
          autoComplete="new-password"
          mono
          style={{ marginTop: 18 }}
          error={touched.confirm ? (confirmError ?? undefined) : undefined}
          focused={focus === 'confirm'}
          onFocus={() => setFocus('confirm')}
          onBlur={() => {
            setFocus(null)
            setTouched((t) => ({ ...t, confirm: true }))
          }}
        />

        <Card style={{ marginTop: 18 }}>
          <RuleRow met={rules.length}>MÍNIMO 8 CARACTERES</RuleRow>
          <RuleRow met={rules.upperAndDigit}>UNA MAYÚSCULA Y UN NÚMERO</RuleRow>
          <RuleRow met={rules.symbol} last>
            UN SÍMBOLO (RECOMENDADO)
          </RuleRow>
        </Card>

        {/*
          El interruptor de Face ID estaba aquí y ya no está.
          Prometía entrar con la cara y no había nada detrás: no existe la
          biometría a la que conectarlo y lo único que hacía era recordar que
          alguien lo había encendido. Un control que promete lo que no hace es
          peor que no tenerlo, así que se retira hasta que exista de verdad —
          con passkeys y WebAuthn, que es como se hace esto en un navegador y
          no un interruptor sino un registro de credencial.
        */}
      </div>

      <div className={s.registerFooter}>
        <Btn variant={ready ? 'accent' : 'disabled'} onClick={submit}>
          {requireCurrent ? 'ACTUALIZAR CONTRASEÑA ▸' : 'CREAR CUENTA ▸'}
        </Btn>
        <div className={s.terms}>AL CONTINUAR ACEPTAS EL USO INTERNO DE LA FLOTA</div>
      </div>
    </Screen>
  )
}
