// Screens 07, 07b and 08 — admin users, the sign-up code, and the report log.

import { useState } from 'react'
import { pressable } from '../lib/press'
import { color } from '../design/tokens'
import { Check, ChevronRight, Close } from '../components/icons'
import {
  ActionBar,
  BackChevron,
  Btn,
  Card,
  Dot,
  Screen,
  ScreenBody,
  SectionLabel,
  StripMeta,
  SyncMeta,
  TopStrip,
} from '../components/ui'
import s from './admin-users.module.css'
import { SearchBar, SegmentedRow } from './admin'
import { matchesQuery } from '../lib/search'
import {
  countdown,
  describeCode,
  describeMember,
  remaining,
  ROLES,
  type InviteCode,
  type Member,
  type Tone,
} from '../domain'

/** One row of the unused list, however it was arrived at. */
type Pending = { code: string; scope: string; ttl: string; soon: boolean }

/** A live key as that same row. */
function asPending(c: InviteCode): Pending {
  return {
    code: c.code,
    scope: describeCode(c),
    ttl: remaining(c),
    // Under six hours left is worth noticing.
    soon: new Date(c.expiresAt).getTime() - Date.now() < 6 * 3600_000,
  }
}
import { listMembers } from '../data'
import { useData } from '../data/useData'

/** Tone is a word in the domain; here is where it becomes a colour. */
const RAIL: Record<Tone, string> = {
  ok: color.ok,
  warn: color.warn,
  danger: color.danger,
  muted: color.border,
}

// ── 07 · Usuarios ───────────────────────────────────────────────────────────

function MemberRow({
  m,
  held,
  last,
  onOpen,
}: {
  m: Member
  /** Suspended right now. */
  held?: boolean
  last?: boolean
  onOpen?: () => void
}) {
  return (
    <div
      {...pressable(onOpen)}
      // Otherwise the name would drag the role, the id and the count with it.
      aria-label={onOpen ? m.name : undefined}
      className={`fh-row ${s.row}`}
      style={{
        borderBottom: last ? undefined : `1px solid ${color.borderSoft}`,
        cursor: onOpen ? 'pointer' : undefined,
        opacity: held ? 0.6 : undefined,
      }}
    >
      <div className={s.rail} style={{ background: RAIL[m.permissionTone] }} />
      <div className={s.rowBody}>
        <div className={s.rowTop}>
          <span className={s.name}>{m.listName}</span>
          <span
            className={s.role}
            // The company's own administrators stand out in the list.
            style={{ color: m.role === 'ADMINISTRADOR' ? color.accent : color.muted }}
          >
            {m.role}
          </span>
        </div>
        <div className={s.rowDetail}>{describeMember(m)}</div>
      </div>
      {m.scansToday && (
        <div className={s.count}>
          <div
            className={s.countValue}
            style={{ color: m.scansToday === '—' ? color.mutedSoft : color.ink }}
          >
            {m.scansToday}
          </div>
          <div className={s.countLabel}>HOY</div>
        </div>
      )}
      {held && <span className={s.held}>SUSPENDIDO</span>}
      <ChevronRight size={14} color={color.muted} />
    </div>
  )
}

export function AdminUsers({
  onBack,
  onOpen,
  onInvite,
}: {
  onBack?: () => void
  /** Opening someone is a route of its own now, so the caller navigates. */
  onOpen?: (person: Member) => void
  onInvite?: () => void
} = {}) {
  const all = useData(listMembers) ?? []

  const [query, setQuery] = useState('')
  /** 0 everyone, then the two named roles; 3 is whoever is neither. */
  const [segment, setSegment] = useState(0)
  const members = all.filter((m) => matchesQuery(query, m.name, m.listName, m.id))

  // Counted off the same list the rows come from. Written out, these drifted:
  // the strip claimed eight people above a list of six, and named four
  // operators where there are three. A number beside a list it does not come
  // from is worse than no number — it is read as the total and it is wrong.
  const withRole = (name: string) => members.filter((m) => m.role === name).length
  const operators = withRole('OPERADOR')
  const admins = withRole('ADMINISTRADOR')
  const shown = members.filter((m) => {
    if (segment === 1) return m.role === 'OPERADOR'
    if (segment === 2) return m.role === 'ADMINISTRADOR'
    if (segment === 3) return m.role !== 'OPERADOR' && m.role !== 'ADMINISTRADOR'
    return true
  })

  return (
    <Screen>
      <TopStrip
        title="FLEETHUB_OPS"
        leading={
          onBack && <BackChevron onClick={onBack} />
        }
        trailing={
          <StripMeta c={color.accent} onClick={onInvite} label="Nuevo usuario">
            <span className={s.action}>+ NUEVO</span>
          </StripMeta>
        }
      />

      <ScreenBody>
        <SearchBar placeholder="BUSCAR POR NOMBRE O ID" value={query} onChange={setQuery} />
        <SegmentedRow
          items={[
            `TODOS · ${members.length}`,
            `OPERADOR · ${operators}`,
            `ADMIN. · ${admins}`,
            `OTROS · ${members.length - operators - admins}`,
          ]}
          active={segment}
          onPick={setSegment}
          padding="10px 0"
          fontSize={9}
          letterSpacing={1}
          background={color.bg}
        />

        <div className={s.list}>
          {shown.map((m, i) => (
            <MemberRow
              key={m.id}
              m={m}
              held={Boolean(m.suspension)}
              last={i === shown.length - 1}
              onOpen={onOpen && (() => onOpen(m))}
            />
          ))}
          {shown.length === 0 && <div className={s.pendingEmpty}>NADIE COINCIDE CON LA BÚSQUEDA</div>}
        </div>

        {/* The list draws every member — `.list` clips nothing — so there is
            never anything further down to reach. Said unconditionally, this
            promised three more people that do not exist. */}
      </ScreenBody>
    </Screen>
  )
}

// ── 07b · Código de alta ────────────────────────────────────────────────────

function RoleOption({
  name,
  description,
  selected,
  onSelect,
  last,
}: {
  name: string
  description: string
  selected?: boolean
  onSelect?: () => void
  last?: boolean
}) {
  return (
    <div
      {...pressable(onSelect)}
      role={onSelect ? 'radio' : undefined}
      aria-checked={onSelect ? Boolean(selected) : undefined}
      aria-label={onSelect ? name : undefined}
      className={selected ? s.option : `fh-row ${s.option}`}
      style={{
        borderBottom: last ? undefined : `1px solid ${color.borderSoft}`,
        background: selected ? color.accentSoft : undefined,
      }}
    >
      <div
        className={s.tick}
        style={{
          border: `1.5px solid ${selected ? color.accent : color.mutedSoft}`,
          background: selected ? color.accent : undefined,
        }}
      >
        {selected && <Check size={9} color="#fff" width={3.4} />}
      </div>
      <div className={s.rowBody}>
        <div className={s.optionName}>{name}</div>
        <div className={s.optionDescription}>{description}</div>
      </div>
    </div>
  )
}

function PendingCode({
  code,
  scope,
  ttl,
  ttlColor,
  onRevoke,
  last,
}: {
  code: string
  scope: string
  ttl: string
  ttlColor: string
  onRevoke?: () => void
  last?: boolean
}) {
  return (
    <div
      className={s.pending}
      style={{ borderBottom: last ? undefined : `1px solid ${color.borderSoft}` }}
    >
      <span className={s.pendingCode}>{code}</span>
      <span className={s.pendingScope}>{scope}</span>
      <span className={s.pendingTtl} style={{ color: ttlColor }}>
        {ttl}
      </span>
      <span
        className={s.revoke}
        {...pressable(onRevoke)}
        aria-label={onRevoke ? `Revocar ${code}` : undefined}
      >
        REVOCAR
      </span>
    </div>
  )
}

export function AdminInviteCode({
  issued,
  pending,
  role = ROLES[0].name,
  onPickRole,
  onGenerate,
  onAnother,
  onRevoke,
  onClose,
  loading = false,
  error,
}: {
  /** The key being issued right now. Absent while the server is answering. */
  issued?: InviteCode
  /** The company's other live keys. Undefined only while they are loading. */
  pending?: InviteCode[]
  role?: string
  onPickRole?: (role: string) => void
  /** The administrator explicitly asks the server for the first invitation. */
  onGenerate?: () => void
  /** Retira la invitación ofrecida y emite otra para el mismo rol. */
  onAnother?: () => void
  onRevoke?: (code: string) => void
  onClose?: () => void
  loading?: boolean
  error?: string | null
} = {}) {
  const digits = issued ? issued.code.split('') : Array.from({ length: 6 }, () => '—')
  const rows = pending?.map(asPending) ?? []
  const [copied, setCopied] = useState(false)
  return (
    <Screen>
      <TopStrip
        title="FLEETHUB_OPS"
        leading={
          <span
            {...pressable(onClose)}
            aria-label={onClose ? 'Cerrar' : undefined}
            className={s.closer}
            style={{ cursor: onClose ? 'pointer' : undefined }}
          >
            <Close size={15} color={color.inkOn} />
          </span>
        }
        trailing={<SyncMeta />}
      />

      <ScreenBody bottom={96}>
        <div className={s.codePanel}>
          <SectionLabel className={s.onInk}>INVITACIÓN TEMPORAL · 6 CARACTERES</SectionLabel>
          <div className={s.digits}>
            {digits.map((ch, i) => (
              <div key={i} className={s.digit}>
                {ch}
              </div>
            ))}
          </div>
          <div className={s.expiry}>
            <span className={s.expiryLeft}>
              <Dot background={color.warnBright} size={6} />
              {issued
                ? `CADUCA EN ${countdown(issued)}`
                : error || (loading ? 'GENERANDO EN EL SERVIDOR…' : 'SIN INVITACIÓN')}
            </span>
            {issued && <span className={s.onInk}>UN SOLO USO</span>}
          </div>
          <div className={s.codeActions}>
            {!issued ? (
              <Btn
                onClick={loading ? undefined : onGenerate}
                style={{
                  width: '100%',
                  height: 44,
                  fontSize: 11,
                  letterSpacing: 1.5,
                  opacity: loading ? 0.6 : 1,
                }}
              >
                {loading ? 'GENERANDO…' : 'GENERAR INVITACIÓN'}
              </Btn>
            ) : (
              <>
                <Btn
                  onClick={() => {
                    void navigator.clipboard?.writeText(issued.code).then(() => {
                      setCopied(true)
                      setTimeout(() => setCopied(false), 1500)
                    })
                  }}
                  style={{ flex: 1, width: 'auto', height: 44, fontSize: 11, letterSpacing: 1.5 }}
                >
                  {copied ? 'COPIADO' : 'COPIAR'}
                </Btn>
                <Btn
                  onClick={() => {
                    const text = `Tu código de alta en FleetHub: ${issued.code} · caduca en ${countdown(issued)}`
                    if (navigator.share) void navigator.share({ text }).catch(() => {})
                    else void navigator.clipboard?.writeText(text)
                  }}
                  variant="ghostDark"
                  style={{
                    flex: 1,
                    width: 'auto',
                    height: 44,
                    fontSize: 11,
                    letterSpacing: 1.5,
                    borderWidth: 1.5,
                  }}
                >
                  COMPARTIR
                </Btn>
                <Btn
                  onClick={onAnother}
                  variant="ghostDark"
                  style={{
                    flex: 1,
                    width: 'auto',
                    height: 44,
                    fontSize: 11,
                    letterSpacing: 1.5,
                    borderWidth: 1.5,
                  }}
                >
                  OTRO
                </Btn>
              </>
            )}
          </div>
        </div>

        <SectionLabel style={{ padding: '14px 16px 0' }}>ROL DEL NUEVO USUARIO</SectionLabel>
        <Card style={{ margin: '8px 16px 0' }}>
          {ROLES.map((r, i) => (
            <RoleOption
              key={r.name}
              name={r.name}
              description={r.description}
              selected={r.name === role}
              onSelect={!issued && onPickRole ? () => onPickRole(r.name) : undefined}
              last={i === ROLES.length - 1}
            />
          ))}
        </Card>

        <div className={s.groupHeader}>
          <SectionLabel>CÓDIGOS SIN USAR</SectionLabel>
          <SectionLabel style={{ letterSpacing: 1 }}>{rows.length}</SectionLabel>
        </div>
        <Card className={s.pendingList}>
          {rows.map((c, i) => (
            <PendingCode
              key={c.code}
              code={c.code}
              scope={c.scope}
              ttl={c.ttl}
              ttlColor={c.soon ? color.warn : color.muted}
              onRevoke={onRevoke && (() => onRevoke(c.code))}
              last={i === rows.length - 1}
            />
          ))}
          {pending === undefined ? (
            <div className={s.pendingEmpty}>CARGANDO DESDE EL SERVIDOR…</div>
          ) : rows.length === 0 ? (
            <div className={s.pendingEmpty}>NINGUNO · EL DE ARRIBA ES EL ÚNICO ACTIVO</div>
          ) : null}
        </Card>
      </ScreenBody>

      <ActionBar>
        <Btn onClick={onClose} variant="ghostDark" style={{ flex: 1, width: 'auto', height: 52, fontSize: 12 }}>
          CERRAR
        </Btn>
        <Btn
          onClick={
            issued &&
            (() => {
              // Sin servicio de correo por decisión: mailto abre el del aparato,
              // que es enviar de verdad sin fingir un servidor de envío.
              const subject = encodeURIComponent('Tu código de alta en FleetHub')
              const mail = encodeURIComponent(
                `Código: ${issued.code}\nCaduca en ${countdown(issued)} · un solo uso.\nDescarga la app y regístrate con él.`,
              )
              window.location.href = `mailto:?subject=${subject}&body=${mail}`
            })
          }
          style={{ flex: 1.4, width: 'auto', height: 52, fontSize: 12 }}
        >
          ENVIAR POR CORREO
        </Btn>
      </ActionBar>
    </Screen>
  )
}
