// Screens 05 and 05b — the operator profile and their editable details.

import { useEffect, useState, type ReactNode } from 'react'
import { color, font } from '../design/tokens'
import { ChevronDown, ChevronRight, Lock, Refresh, Shield, User } from '../components/icons'
import { useCountryMenu, useListboxMenu } from '../components/menu'
import {
  CODE_LENGTH,
  COMPANY,
  grantLeft,
  MEMBERS,
  ROLES,
  SUPPORT_HOURS,
  type Member,
  type SupportGrant,
  operatorCode,
} from '../domain'
import {
  ActionBar,
  BackChevron,
  Btn,
  Card,
  Dot,
  Screen,
  ScreenBody,
  SectionLabel,
  SyncMeta,
  Toggle,
  TopStrip,
} from '../components/ui'
import s from './profile.module.css'
import { pressable } from '../lib/press'
import {
  countryOf,
  formatPhone,
  normalizePhone,
  validateEmail,
  validateName,
  validatePhone,
} from '../lib/auth'

/** Tappable row: title, optional value, chevron. */
function LinkRow({
  title,
  value,
  last,
  children,
  onClick,
}: {
  title: string
  value?: string
  last?: boolean
  children?: ReactNode
  onClick?: () => void
}) {
  return (
    <div
      {...pressable(onClick)}
      // Without this the row's name would swallow its value too, e.g.
      // "Datos personales r.salgado@fleethub.mx".
      aria-label={onClick ? title : undefined}
      className={`fh-row ${s.link}`}
      style={{
        borderBottom: last ? undefined : `1px solid ${color.borderSoft}`,
        cursor: onClick ? 'pointer' : undefined,
      }}
    >
      <span className={s.linkTitle}>{title}</span>
      {value && <span className={s.linkValue}>{value}</span>}
      {children ?? <ChevronRight size={14} color={color.muted} />}
    </div>
  )
}

function Stat({
  label,
  value,
  unit,
  valueColor = color.ink,
  last,
}: {
  label: string
  value: string
  unit?: string
  valueColor?: string
  last?: boolean
}) {
  return (
    <div className={s.stat} style={{ borderRight: last ? undefined : `1px solid ${color.border}` }}>
      <div className={s.statLabel}>{label}</div>
      <div className={s.statValue} style={{ color: valueColor }}>
        {value}
        {unit && <span className={s.statUnit}> {unit}</span>}
      </div>
    </div>
  )
}

// ── 05 · Perfil ─────────────────────────────────────────────────────────────

const PERMISSION_TONE: Record<Member['permissionTone'], { fg: string; bg?: string }> = {
  ok: { fg: color.ok, bg: color.okSoft },
  muted: { fg: color.muted },
  warn: { fg: color.warn, bg: color.warnSoft },
  danger: { fg: color.danger, bg: color.dangerSoft },
}

/** El interruptor de push como lo permite el navegador: conceder se pide,
 *  revocar no existe — apagar es una preferencia del aparato, y se recuerda
 *  en su balda. */
function usePushSetting(live: boolean) {
  const supported = typeof Notification !== 'undefined'
  const [perm, setPerm] = useState<NotificationPermission | null>(
    supported ? Notification.permission : null,
  )
  const [pref, setPref] = useState(() => {
    try {
      return localStorage.getItem('fleethub.push') !== 'off'
    } catch {
      return true
    }
  })
  if (!live || !supported) return null
  const on = perm === 'granted' && pref
  const flip = (next: boolean) => {
    try {
      localStorage.setItem('fleethub.push', next ? 'on' : 'off')
    } catch {
      // Sin balda no hay memoria, pero el interruptor sigue mandando hoy.
    }
    setPref(next)
    if (next && perm !== 'granted') void Notification.requestPermission().then(setPerm)
  }
  return { on, denied: perm === 'denied', flip }
}

/** Cámara y GPS leídos del navegador, no pintados. Donde la consulta no
 *  exista, la respuesta honesta es no saber — nunca CONCEDIDOS de adorno. */
function usePermissions(live: boolean) {
  const [word, setWord] = useState('—')
  useEffect(() => {
    if (!live || !navigator.permissions?.query) return
    let alive = true
    const ask = (name: string) =>
      navigator.permissions
        .query({ name: name as PermissionName })
        .then((s) => s.state)
        .catch(() => 'unknown' as const)
    void Promise.all([ask('camera'), ask('geolocation')]).then(([cam, gps]) => {
      if (!alive) return
      const states = [cam, gps]
      if (states.every((s) => s === 'granted')) setWord('CONCEDIDOS')
      else if (states.some((s) => s === 'denied')) setWord('DENEGADOS')
      else setWord('SIN PEDIR')
    })
    return () => {
      alive = false
    }
  }, [live])
  return live ? word : null
}

export function Profile({
  // The app hands in the live person.
  person = MEMBERS[0],
  onBack,
  onOpenPersonalData,
  onOpenZone,
  onOpenScanHistory,
  onOpenSupport,
  onAdminister,
  canAdminister = true,
  onSignOut,
  onReactivate,
  onUpload,
}: {
  /** Whose profile this is. Defaults to the signed-in operator. */
  person?: Member
  onBack?: () => void
  onOpenPersonalData?: () => void
  onOpenZone?: () => void
  onOpenScanHistory?: () => void
  /** Only ever offered on a FleetHub account's own profile. */
  onOpenSupport?: () => void
  onAdminister?: () => void
  /**
   * Whether this person may reach the console. The gallery draws 05 as the
   * design does, which is with the button; the app asks first.
   */
  canAdminister?: boolean
  onSignOut?: () => void
  /** Qué hace SUBIR con lo pendiente. Ausente en la galería, que no sube. */
  onUpload?: () => void
  /** Only offered for a suspension you put on yourself. */
  onReactivate?: () => void
} = {}) {
  const tone = PERMISSION_TONE[person.permissionTone]
  /** A profile opened from somewhere else is someone else's. */
  const own = !onBack
  // La copia de la galería no consulta permisos ni los pide: es una estampa.
  const live = own && Boolean(onOpenPersonalData || onSignOut)
  const push = usePushSetting(live)
  const granted = usePermissions(live)
  const held = person.suspension ?? null
  return (
    <Screen>
      <TopStrip
        title="FLEETHUB_OPS"
        leading={
          onBack && <BackChevron onClick={onBack} />
        }
        trailing={<SyncMeta />}
      />

      <ScreenBody>
        {held && (
          <div className={s.hold}>
            <Lock size={17} color={color.danger} />
            <div style={{ flex: 1 }}>
              <div className={s.holdTitle}>
                {own ? 'Tu cuenta está suspendida' : 'Cuenta suspendida'}
              </div>
              <div className={s.note} style={{ marginTop: 2 }}>
                {held === 'self'
                  ? 'LA SUSPENDISTE TÚ · SOLO PUEDES VER TU PERFIL'
                  : 'SUSPENDIDA POR ADMINISTRACIÓN · CONTÁCTALES PARA REACTIVARLA'}
              </div>
            </div>
            {/* Only what you did to yourself can you undo. */}
            {own && held === 'self' && onReactivate && (
              <button
                type="button"
                onClick={onReactivate}
                className={`fh-btn-ink-accent fh-focus-ring ${s.inkAction}`}
              >
                REACTIVAR
              </button>
            )}
          </div>
        )}

        <div className={s.head}>
          <div className={s.mugshot}>
            <User size={34} color={color.accent} width={1.8} />
            <span className={s.mugshotId}>{operatorCode(person.userId || person.id)}</span>
          </div>
          <div className={s.identity}>
            <div className={s.name}>{person.name}</div>
            <div className={s.title}>{person.zone}</div>
            <div className={s.badges}>
              <span
                className={s.permission}
                style={{ color: tone.fg, background: tone.bg, border: `1px solid ${tone.fg}` }}
              >
                {person.permission}
              </span>
            </div>
          </div>
        </div>

        <div className={s.stats}>
          <Stat label="ESCANEOS HOY" value={person.scansToday} />
          <Stat label="A SU CARGO" value={person.unitsInCharge} unit="u" />
          <Stat
            label="SIN SINCRO"
            value={person.unsynced}
            valueColor={person.unsynced === '0' ? color.ink : color.warn}
            last
          />
        </div>

        {/* Nothing to warn about when everything is synced. */}
        {person.unsynced !== '0' && (
          <div className={s.pending}>
            <Refresh size={18} color={color.warn} />
            <div style={{ flex: 1 }}>
              <div className={s.pendingTitle}>
                {person.unsynced} {person.unsynced === '1' ? 'escaneo' : 'escaneos'} esperando red
              </div>
              <div className={s.note} style={{ marginTop: 2 }}>
                GUARDADOS LOCALMENTE · {person.unsyncedAt}
              </div>
            </div>
            <button onClick={onUpload} className={`fh-btn-ink-accent ${s.inkAction}`}>
              SUBIR
            </button>
          </div>
        )}

        <SectionLabel style={{ margin: '18px 16px 0' }}>CUENTA</SectionLabel>
        <Card style={{ margin: '8px 16px 0' }}>
          <LinkRow
            title="Datos personales"
            value={person.email}
            onClick={onOpenPersonalData}
          />
          <LinkRow title="Zona asignada" value={person.zone || 'SIN ZONA'} onClick={onOpenZone} />
          <LinkRow
            title="Historial de escaneos"
            value={person.scanHistory}
            onClick={onOpenScanHistory}
            last={!person.staff}
          />
          {/* Sólo en las cuentas de FleetHub: a la empresa no le sirve de nada
              una fila para pedir un permiso que no puede tener. */}
          {person.staff && (
            <LinkRow
              title="Acceso de soporte"
              value={
                person.supportUntil
                  ? `CADUCA EN ${grantLeft({ expiresAt: person.supportUntil } as SupportGrant)}`
                  : 'SIN ACCESO'
              }
              onClick={own ? onOpenSupport : undefined}
              last
            />
          )}
        </Card>

        {own && (
          <>
            <SectionLabel style={{ margin: '18px 16px 0' }}>DISPOSITIVO</SectionLabel>
            <Card style={{ margin: '8px 16px 0' }}>
              {/*
                Fuera de servicio, no apagado: FleetHub es explícitamente online
                mientras no exista la cola de escrituras —ver DECISIONES.md—, y
                un interruptor que se deja pulsar y no obedece invita a
                intentarlo y a creer que se consiguió.
              */}
              <LinkRow title="Modo sin conexión">
                <Toggle on={false} disabled label="Modo sin conexión" />
              </LinkRow>
              <LinkRow title="Alertas push">
                {push ? (
                  push.denied ? (
                    <span className={s.note}>DENEGADAS EN EL NAVEGADOR</span>
                  ) : (
                    <Toggle on={push.on} onChange={push.flip} label="Alertas push" />
                  )
                ) : (
                  <Toggle />
                )}
              </LinkRow>
              {/*
                Encendido es «los dos concedidos». No se puede cambiar desde
                aquí —los permisos los da el navegador, no la aplicación—, así
                que dice el estado y no finge que lo decide.
              */}
              <LinkRow title="Cámara y GPS" last>
                <Toggle on={granted === 'CONCEDIDOS'} disabled label="Cámara y GPS" />
              </LinkRow>
            </Card>

            <div className={s.actions}>
              {!held && canAdminister && (
                <Btn variant="ink" onClick={onAdminister} className={s.administer}>
                  <Shield size={16} />
                  ADMINISTRAR
                </Btn>
              )}
              <Btn
                variant="dangerOutline"
                onClick={onSignOut}
                style={{ flex: 1, width: 'auto', height: 48, fontSize: 12, letterSpacing: 1.5 }}
              >
                CERRAR SESIÓN
              </Btn>
            </div>
            <div className={s.build}>FLEETHUB v1.4.0 · BUILD 2608 · ÚLTIMA SINCRO 12:41</div>
          </>
        )}
      </ScreenBody>
    </Screen>
  )
}

// ── 05c · Acceso de soporte ─────────────────────────────────────────────────

/**
 * Where a FleetHub account spends a key and gets a window into a company.
 *
 * Its own screen and not a switch on 05, because what it grants ends: the
 * screen has to be able to say when, and to be somewhere you can come back to
 * and close it early.
 */
export function SupportAccess({
  company = COMPANY?.id ?? '',
  until,
  onRequest,
  onEnd,
  onBack,
}: {
  company?: string
  /** When the window closes, or absent when there is none open. */
  until?: string
  /** Returns the reason the key did not work, or null. */
  onRequest?: (code: string) => Promise<string | null>
  onEnd?: () => void
  onBack?: () => void
} = {}) {
  const [code, setCode] = useState('')
  const [failure, setFailure] = useState<string | null>(null)
  const open = Boolean(until)
  const left = until ? grantLeft({ expiresAt: until } as SupportGrant) : ''

  const ask = () => {
    void onRequest?.(code).then((reason) => {
      setFailure(reason)
      if (!reason) setCode('')
    })
  }

  return (
    <Screen>
      <TopStrip title="FLEETHUB_OPS" leading={<BackChevron onClick={onBack} />} trailing={<SyncMeta />} />

      <ScreenBody bottom={96} scroll>
        <SectionLabel style={{ padding: '14px 16px 0' }}>ACCESO DE SOPORTE</SectionLabel>

        <div className={`${s.supportState} ${open ? s.open : ''}`}>
          <span className={s.supportCompany}>{company}</span>
          <span className={`${s.supportLeft} ${open ? s.live : ''}`}>
            <Dot background={open ? color.warn : color.mutedSoft} size={6} />
            {open ? `CADUCA EN ${left}` : 'SIN ACCESO'}
          </span>
        </div>

        {open ? (
          <div className={s.supportKey}>
            <Btn
              variant="dangerOutline"
              onClick={onEnd}
              style={{ flex: 1, width: 'auto', height: 48, fontSize: 12, letterSpacing: 1.5 }}
            >
              TERMINAR ACCESO
            </Btn>
          </div>
        ) : (
          <>
            <div className={s.supportKey}>
              <input
                className={s.supportField}
                aria-label="LLAVE DE SOPORTE"
                placeholder="000000"
                maxLength={CODE_LENGTH}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.toUpperCase())
                  setFailure(null)
                }}
              />
              <Btn
                variant={code.length === CODE_LENGTH ? 'accent' : 'disabled'}
                onClick={ask}
                style={{ flex: 1, width: 'auto', height: 48, fontSize: 12, letterSpacing: 1.5 }}
              >
                PEDIR ACCESO
              </Btn>
            </div>
            {failure && <div className={s.supportError}>{failure}</div>}
          </>
        )}

        <p className={s.supportNote}>
          Con la llave puesta puedes hacer lo mismo que administración durante {SUPPORT_HOURS} horas.
          Se cierra sola: nadie tiene que acordarse de quitártela.
        </p>
      </ScreenBody>
    </Screen>
  )
}

// ── 05b · Datos personales ──────────────────────────────────────────────────

/**
 * A row of the "editable por ti" card. The design draws these as list rows, not
 * boxed fields, so focus is shown with an inset rule instead of a border —
 * which would otherwise reflow the row by its own width.
 */
function EditableRow({
  label,
  value,
  onChange,
  mono,
  prefix,
  expansion,
  containerRef,
  focused,
  onFocus,
  onBlur,
  error,
  last,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  mono?: boolean
  /** Adornment before the value, never part of it — a dialling code, say. */
  prefix?: ReactNode
  /** Panel laid out under the row, in flow, so it pushes the card down. */
  expansion?: ReactNode
  containerRef?: React.Ref<HTMLDivElement>
  focused: boolean
  onFocus: () => void
  onBlur: () => void
  error?: string
  last?: boolean
}) {
  const outline = error ? color.danger : focused ? color.accent : null
  return (
    // The rule between rows sits on the wrapper so an open panel stays above it.
    <div
      ref={containerRef}
      style={{ borderBottom: last ? undefined : `1px solid ${color.borderSoft}` }}
    >
      <div
        data-row
        className={s.row}
        style={{
          boxShadow: outline ? `inset 0 0 0 1.5px ${outline}` : undefined,
          background: focused ? color.bg : undefined,
        }}
      >
        <div className={s.fieldLabel}>{label}</div>
        <div className={s.rowValue}>
          {prefix}
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={onFocus}
            onBlur={onBlur}
            aria-label={label}
            className={s.rowInput}
            style={{
              fontFamily: mono ? font.mono : font.sans,
              fontSize: mono ? 13 : 15,
              fontWeight: mono ? 600 : 700,
            }}
          />
        </div>
        {error && <div className={s.rowError}>{error}</div>}
      </div>
      {expansion}
    </div>
  )
}

/**
 * A row whose value is chosen, not typed: the same shape as an editable one,
 * with a chevron and a panel that opens under it.
 */
function PickerRow({
  label,
  value,
  open,
  triggerProps,
  expansion,
  containerRef,
  last,
}: {
  label: string
  value: string
  open: boolean
  triggerProps: object
  expansion?: ReactNode
  containerRef?: React.Ref<HTMLDivElement>
  last?: boolean
}) {
  return (
    <div
      ref={containerRef}
      style={{ borderBottom: last ? undefined : `1px solid ${color.borderSoft}` }}
    >
      <button
        {...triggerProps}
        data-row
        className={`fh-row ${(triggerProps as { className?: string }).className ?? ''} ${s.pickerRow}`}
        style={{
          background: open ? color.bg : 'transparent',
          boxShadow: open ? `inset 0 0 0 1.5px ${color.accent}` : undefined,
        }}
      >
        <div className={s.fieldLabel}>{label}</div>
        <div className={s.rowValue}>
          <span className={s.pickerValue}>{value}</span>
          <ChevronDown size={14} color={color.muted} />
        </div>
      </button>
      {expansion}
    </div>
  )
}

/** Admin-owned field: same shape as an editable row, but padlocked. */
function LockedRow({
  label,
  value,
  mono,
  last,
}: {
  label: string
  value: string
  mono?: boolean
  last?: boolean
}) {
  return (
    <div
      className={s.locked}
      style={{ borderBottom: last ? undefined : `1px solid ${color.borderSoft}` }}
    >
      <div style={{ flex: 1 }}>
        <div className={s.fieldLabel}>{label}</div>
        <div
          className={s.lockedValue}
          style={{
            fontFamily: mono ? font.mono : font.sans,
            fontSize: mono ? 13 : 14,
            fontWeight: mono ? 600 : 700,
          }}
        >
          {value}
        </div>
      </div>
      <Lock size={14} color={color.mutedSoft} />
    </div>
  )
}

/** What the operator may change about themselves. */
/**
 * The three fields the person owns, plus the two an administrator assigns.
 * Only the first three are validated; an id and a role are whatever the
 * company says they are.
 */
export type Details = { name: string; email: string; phone: string; id: string; role: string }

function detailsOf(person: Member): Details {
  return {
    name: person.fullName,
    email: person.email,
    phone: person.phone,
    id: operatorCode(person.userId || person.id),
    role: person.role,
  }
}

function passwordAge(changedAt?: string) {
  const changed = Date.parse(changedAt ?? '')
  if (!Number.isFinite(changed)) return null
  const days = Math.max(0, Math.floor((Date.now() - changed) / 86_400_000))
  if (days === 0) return 'CAMBIADA HOY'
  return days === 1 ? 'HACE 1 DÍA' : `HACE ${days} DÍAS`
}

export function PersonalData({
  // The app hands in the live person.
  person = MEMBERS[0],
  admin,
  initial,
  country,
  onBack,
  onSave,
  onChangePassword,
  onSuspend,
}: {
  person?: Member
  /** An administrator can change what administration assigned. */
  admin?: boolean
  initial?: Details
  /** Overrides the person's own country; only the gallery copy needs to. */
  country?: string
  onBack?: () => void
  onSave?: (details: Details, country: string) => void
  onChangePassword?: () => void
  onSuspend?: () => void
} = {}) {
  const start = initial ?? detailsOf(person)
  /** Their own country, not the field's default — their number is grouped by
   *  where it is from, and MX and US are both ten digits. */
  const startIso = country ?? person.country
  const [form, setForm] = useState<Details>(start)
  /** The dialling code is part of the number, so it is editable here too. */
  const [iso, setIso] = useState(startIso)
  const [focus, setFocus] = useState<keyof Details | null>(null)
  const [touched, setTouched] = useState<Partial<Record<keyof Details, boolean>>>({})
  const changedPassword = passwordAge(person.passwordChangedAt)

  const dial = countryOf(iso)
  const picker = useCountryMenu({
    country: iso,
    onCountryChange: setIso,
    rowSelector: '[data-row]',
    // Inside the card the row supplies the surface and the card its border, so
    // the panel needs nothing but its own rule on top.
    panelStyle: { border: 'none', borderTop: `1px solid ${color.borderSoft}` },
  })

  /** Only an administrator picks a role, so only they see the accordion. */
  const roleMenu = useListboxMenu({
    items: ROLES,
    isSelected: (r) => r.name === form.role,
    onPick: (r) => set('role', r.name),
    listLabel: 'Rol',
    triggerLabel: `Rol: ${form.role}`,
    rowSelector: '[data-row]',
    panelStyle: { border: 'none', borderTop: `1px solid ${color.borderSoft}` },
    renderOption: (r, selected) => (
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className={s.roleOptionName} style={{ color: selected ? color.accent : color.ink }}>
          {r.name}
        </div>
        <div className={s.roleOptionDescription}>{r.description}</div>
      </div>
    ),
  })

  const errors: Partial<Record<keyof Details, string>> = {}
  const nameError = validateName(form.name)
  const emailError = validateEmail(form.email)
  const phoneError = validatePhone(form.phone, dial)
  if (nameError) errors.name = nameError
  if (emailError) errors.email = emailError
  if (phoneError) errors.phone = phoneError

  /** Nothing to save until something actually differs. */
  const dirty =
    form.name !== start.name ||
    form.email !== start.email ||
    form.phone !== start.phone ||
    form.role !== start.role ||
    iso !== startIso
  const ready = dirty && Object.keys(errors).length === 0

  const set = (field: keyof Details, value: string) =>
    setForm((f) => ({ ...f, [field]: value }))

  const rowProps = (field: keyof Details) => ({
    focused: focus === field,
    onFocus: () => setFocus(field),
    onBlur: () => {
      setFocus(null)
      setTouched((t) => ({ ...t, [field]: true }))
    },
    error: touched[field] ? errors[field] : undefined,
  })

  const submit = () => {
    if (!ready) {
      if (dirty) setTouched({ name: true, email: true, phone: true })
      return
    }
    onSave?.(form, iso)
  }

  return (
    <Screen>
      <TopStrip
        title="FLEETHUB_OPS"
        leading={
          <BackChevron onClick={onBack} />
        }
        trailing={<SyncMeta />}
      />

      <ScreenBody bottom={96} scroll>
        <div className={s.card}>
          <div className={s.cardPhoto}>
            <User size={30} color={color.accent} width={1.8} />
          </div>
          <div style={{ flex: 1 }}>
            <div className={s.fieldLabel}>FOTO DE CREDENCIAL</div>
            <div className={s.cardActions}>
              <span className={`${s.photoAction} ${s.photoChange}`}>CAMBIAR</span>
              <span className={`${s.photoAction} ${s.photoRemove}`}>QUITAR</span>
            </div>
          </div>
        </div>

        <SectionLabel style={{ padding: '14px 16px 0' }}>
          {admin ? 'DATOS DEL USUARIO' : 'EDITABLE POR TI'}
        </SectionLabel>
        <Card style={{ margin: '8px 16px 0' }}>
          <EditableRow
            label="NOMBRE COMPLETO"
            value={form.name}
            onChange={(v) => set('name', v)}
            {...rowProps('name')}
          />
          <EditableRow
            label="CORREO"
            value={form.email}
            onChange={(v) => set('email', v.trim())}
            mono
            {...rowProps('email')}
          />
          <EditableRow
            label="TELÉFONO"
            value={formatPhone(form.phone, dial)}
            onChange={(v) => set('phone', normalizePhone(v, dial))}
            mono
            containerRef={picker.root}
            prefix={
              <button {...picker.triggerProps} className={s.dial}>
                <span className={s.dialCode}>+{picker.current.dial}</span>
                <ChevronDown size={12} color={color.muted} />
              </button>
            }
            expansion={picker.panel}
            last={admin}
            {...rowProps('phone')}
          />
          {!admin && (
            <div
              {...pressable(onChangePassword)}
              aria-label={onChangePassword ? 'Cambiar contraseña' : undefined}
              className={`fh-row ${s.password}`}
            >
              <span className={s.passwordName}>Cambiar contraseña</span>
              {changedPassword && <span className={s.note}>{changedPassword}</span>}
              <ChevronRight size={14} color={color.muted} />
            </div>
          )}
        </Card>

        <SectionLabel style={{ padding: '16px 16px 0' }}>ASIGNADO POR ADMINISTRACIÓN</SectionLabel>
        {admin ? (
          <Card style={{ margin: '8px 16px 0' }}>
            <LockedRow label="ID DE OPERADOR" value={form.id} mono />
            <PickerRow
              label="ROL"
              value={form.role}
              open={Boolean(roleMenu.panel)}
              triggerProps={roleMenu.triggerProps}
              expansion={roleMenu.panel}
              containerRef={roleMenu.root}
              last
            />
          </Card>
        ) : (
          <>
            <Card style={{ margin: '8px 16px 0' }} background={color.bg}>
              <LockedRow label="ID DE OPERADOR" value={form.id} mono />
              <LockedRow label="ROL" value={form.role} last />
            </Card>
            <div className={s.note} style={{ margin: '9px 16px 0' }}>
              PARA CAMBIAR ESTOS CAMPOS SOLICÍTALO A ADMINISTRACIÓN
            </div>
          </>
        )}

        <Btn variant="dangerOutline" onClick={onSuspend} className={s.suspend}>
          SUSPENDER CUENTA
        </Btn>
      </ScreenBody>

      <ActionBar>
        <Btn
          variant="ghostDark"
          onClick={onBack}
          style={{ flex: 1, width: 'auto', height: 52, fontSize: 12 }}
        >
          CANCELAR
        </Btn>
        <Btn
          variant={ready ? 'accent' : 'disabled'}
          onClick={submit}
          style={{ flex: 1.4, width: 'auto', height: 52, fontSize: 12 }}
        >
          GUARDAR DATOS
        </Btn>
      </ActionBar>
    </Screen>
  )
}
