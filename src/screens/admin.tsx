// Screens 06, 06b and 06c — the admin overview, factory routes and route editor.

import { useEffect, useState, type ReactNode } from 'react'
import { color } from '../design/tokens'

import { blankRoute, type Route, type Tone } from '../domain'
import {
  fleetStanding,
  fleetValidation,
  estimateRoute,
  listRoutes,
  suggestAddresses,
  topScanners,
  type AddressSuggestion,
  type ScanWindow,
} from '../data'
import { useData } from '../data/useData'
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Close,
  Search,
} from '../components/icons'
import { TextField } from '../components/form'
import {
  ActionBar,
  BackChevron,
  Btn,
  Card,
  Screen,
  ScreenBody,
  SectionLabel,
  StripMeta,
  SyncMeta,
  Toggle,
  TopStrip,
} from '../components/ui'
import { matchesQuery } from '../lib/search'
import { pressable } from '../lib/press'
import s from './admin.module.css'

/** Tone is a word in the domain; here is where it becomes a colour. */
const TONE: Record<Tone, string> = {
  ok: color.ok,
  warn: color.warn,
  danger: color.danger,
  muted: color.muted,
}

/** Row of mutually exclusive segments; the active one inverts to ink. */
export function SegmentedRow({
  items,
  active,
  onPick,
  fontSize = 10,
  letterSpacing = 1.5,
  padding = '11px 0',
  background = color.surface,
}: {
  items: string[]
  active: number
  /** Omit where the segments are still a picture, as most of them are. */
  onPick?: (index: number) => void
  fontSize?: number
  letterSpacing?: number
  padding?: string
  background?: string
}) {
  return (
    <div className={s.segments} style={{ background }}>
      {items.map((item, i) => (
        <div
          key={item}
          {...pressable(onPick && (() => onPick(i)), 'tab')}
          aria-selected={onPick ? i === active : undefined}
          aria-label={onPick ? item : undefined}
          className={s.segment}
          style={{
            padding,
            fontSize,
            letterSpacing,
            background: i === active ? color.ink : undefined,
            color: i === active ? color.inkOn : color.muted,
            borderLeft: i > 0 ? `1px solid ${color.border}` : undefined,
          }}
        >
          {item}
        </div>
      ))}
    </div>
  )
}

/**
 * The search field the three list screens share. A real input now — it spent
 * its first life as a span with the placeholder painted on, which promised a
 * search nobody could type into.
 */
export function SearchBar({
  placeholder,
  value = '',
  onChange,
}: {
  placeholder: string
  value?: string
  onChange?: (value: string) => void
}) {
  return (
    <div className={s.search}>
      <Search size={15} color={color.muted} />
      <input
        className={s.searchInput}
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
      />
    </div>
  )
}


// ── 06 · Administración ─────────────────────────────────────────────────────

/** One state and how much of the fleet is in it. */
type Group = { name: string; count: number; tone: Tone }

/** A state as the legend writes it: EN RUTA reads "En ruta" beside its swatch. */
function sentence(name: string) {
  return name.charAt(0) + name.slice(1).toLowerCase()
}

/** How far round the ring one unit goes. r=54, so 2πr. */
const RING = 2 * Math.PI * 54

/**
 * Fleet-status donut. Each arc is one state, drawn as a dash of the ring's
 * own circumference and rotated -90° so the first starts at twelve o'clock.
 * What is left grey is the units nobody has reported on.
 */
function StatusDonut({ total, groups }: { total: number; groups: Group[] }) {
  let walked = 0
  const arcs = groups.map((g) => {
    const length = total ? (g.count / total) * RING : 0
    const arc = { tone: g.tone, name: g.name, length, offset: -walked }
    walked += length
    return arc
  })
  return (
    <div className={s.donut}>
      <svg width="132" height="132" viewBox="0 0 132 132" className={s.donutRings}>
        <circle cx="66" cy="66" r="54" fill="none" stroke={color.surfaceAlt} strokeWidth="17" />
        {arcs.map((a) => (
          <circle
            key={a.name}
            cx="66"
            cy="66"
            r="54"
            fill="none"
            stroke={TONE[a.tone]}
            strokeWidth="17"
            strokeDasharray={`${a.length.toFixed(1)} ${(RING - a.length).toFixed(1)}`}
            strokeDashoffset={a.offset.toFixed(1)}
          />
        ))}
      </svg>
      <div className={s.donutCentre}>
        <div className={s.donutCount}>{total}</div>
        <div className={s.donutLabel}>UNIDADES</div>
      </div>
    </div>
  )
}

function LegendRow({ c, label, value }: { c: string; label: string; value: string }) {
  return (
    <div className={s.legend}>
      <div className={s.legendSwatch} style={{ background: c }} />
      <span className={s.legendLabel}>{label}</span>
      <span className={s.legendValue}>{value}</span>
    </div>
  )
}

function LeaderRow({
  id,
  name,
  count,
  width,
  barColor,
  idColor = color.muted,
  last,
}: {
  id: string
  name: string
  count: string
  width: string
  barColor: string
  idColor?: string
  last?: boolean
}) {
  return (
    <div
      className={s.leader}
      style={{ borderBottom: last ? undefined : `1px solid ${color.borderSoft}` }}
    >
      <div className={s.leaderTop}>
        <span className={s.leaderId} style={{ color: idColor }}>
          {id}
        </span>
        <span className={s.leaderName}>{name}</span>
        <span className={s.leaderCount}>{count}</span>
      </div>
      <div className={s.leaderTrack}>
        <div style={{ width, background: barColor }} />
      </div>
    </div>
  )
}

/** The three windows, in the order the segments draw them. */
const PERIODS: { label: string; window: ScanWindow; title: string }[] = [
  { label: 'HOY', window: 'hoy', title: 'MÁS ESTADOS FIJADOS · HOY' },
  { label: 'SEMANA', window: 'semana', title: 'MÁS ESTADOS FIJADOS · 7 DÍAS' },
  { label: 'MES', window: 'mes', title: 'MÁS ESTADOS FIJADOS · 30 DÍAS' },
]

export function AdminOverview({ onBack }: { onBack?: () => void } = {}) {
  const fleet = useData(fleetStanding) ?? { total: 0, byState: [] as Group[] }
  // The period scopes the ranking — the one dated panel. The counters and the
  // donut read "now" and "today" by their own words, and keep them.
  const [period, setPeriod] = useState(0)
  const leaders = useData(() => topScanners(3, PERIODS[period].window), [period]) ?? []
  const checked = useData(fleetValidation) ?? { total: 0, today: 0, stale: 0 }
  /** The longest bar is the one at the top; the rest are drawn against it. */
  const most = leaders[0]?.count ?? 0
  return (
    <Screen>
      <TopStrip
        title="FLEETHUB_OPS"
        leading={
          <BackChevron onClick={onBack} />
        }
        trailing={<SyncMeta />}
      />

      <ScreenBody>
        <SegmentedRow items={PERIODS.map((p) => p.label)} active={period} onPick={setPeriod} />

        <div className={s.counters}>
          <div className={`${s.counter} ${s.counterLeft}`}>
            <SectionLabel style={{ letterSpacing: 1.5 }}>VIN REGISTRADOS</SectionLabel>
            <div className={s.counterValue} style={{ color: color.ink }}>
              {fleet.total}
            </div>
          </div>
          <div className={s.counter}>
            <SectionLabel style={{ letterSpacing: 1.5 }}>POR VALIDAR</SectionLabel>
            <div className={s.counterValue} style={{ color: color.warn }}>
              {checked.stale}
            </div>
          </div>
        </div>

        <div className={s.fleetPanel}>
          <SectionLabel>ESTADO DE LA FLOTA · AHORA</SectionLabel>
          <div className={s.fleetRow}>
            <StatusDonut total={fleet.total} groups={fleet.byState} />
            <div className={s.legendColumn}>
              {fleet.byState.map((g) => (
                <LegendRow
                  key={g.name}
                  c={TONE[g.tone]}
                  label={sentence(g.name)}
                  value={String(g.count)}
                />
              ))}
            </div>
          </div>
        </div>

        <div className={s.validated}>
          <div className={s.validatedHead}>
            <SectionLabel>VALIDADAS HOY</SectionLabel>
            <span className={s.validatedCount}>{`${checked.today} / ${checked.total}`}</span>
          </div>
          <div className={s.validatedTrack}>
            <div
              className={s.validatedFill}
              style={{ width: `${checked.total ? (checked.today / checked.total) * 100 : 0}%` }}
            />
          </div>
          <div className={s.validatedFoot}>
            <span className={s.stale}>{`${checked.stale} SIN REVISAR EN 24 H`}</span>
            <span className={s.link}>VER LISTA ▸</span>
          </div>
        </div>

        <div className={s.leadersHead}>
          <SectionLabel>{PERIODS[period].title}</SectionLabel>
          <span className={s.link}>HISTORIAL</span>
        </div>
        <Card style={{ margin: '8px 16px 0' }}>
          {leaders.map((who, i) => (
            <LeaderRow
              key={who.id}
              id={who.id}
              name={who.name}
              count={String(who.count)}
              width={`${most ? Math.round((who.count / most) * 100) : 0}%`}
              // The one at the top is the company's own measure of a good day.
              barColor={i === 0 ? color.accent : color.ink}
              idColor={i === 0 ? color.accent : color.muted}
              last={i === leaders.length - 1}
            />
          ))}
        </Card>
      </ScreenBody>
    </Screen>
  )
}

// ── 06b · Rutas de fábrica ──────────────────────────────────────────────────

/**
 * What a route row offers, which depends on who is looking:
 *   · 'open'   — the console's own list, where a route leads to 06c.
 *   · 'none'   — an operator reading the zone they were assigned.
 *   · 'select' — an administrator choosing the routes a user works.
 */
type RouteAction = 'open' | 'none' | 'select'

function formatDistance(meters: number | null) {
  if (meters === null) return '—'
  if (meters < 1000) return `${Math.round(meters)} m`
  const kilometers = meters / 1000
  return `${kilometers >= 10 ? Math.round(kilometers) : kilometers.toFixed(1)} km`
}

function formatDuration(seconds: number | null) {
  if (seconds === null) return '—'
  const minutes = Math.max(1, Math.round(seconds / 60))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}

function resultingEta(seconds: number | null, margin: number) {
  return seconds === null ? null : Math.round(seconds * (1 + margin / 100))
}

function RouteRow({
  route,
  last,
  action = 'open',
  selected,
  onToggle,
  onOpen,
}: {
  route: Route
  last?: boolean
  action?: RouteAction
  selected?: boolean
  onToggle?: () => void
  onOpen?: () => void
}) {
  const tappable = action !== 'none'
  return (
    <div
      className={tappable ? `fh-row ${s.route}` : s.route}
      {...pressable(action === 'select' ? onToggle : action === 'open' ? onOpen : undefined)}
      role={action === 'none' ? undefined : action === 'select' ? 'checkbox' : 'button'}
      aria-checked={action === 'select' ? Boolean(selected) : undefined}
      // Otherwise the name would drag the distance and the note along with it.
      aria-label={tappable ? `${route.code} · ${route.name}` : undefined}
      style={{
        borderBottom: last ? undefined : `1px solid ${color.borderSoft}`,
        cursor: tappable ? 'pointer' : undefined,
        background: action === 'select' && selected ? color.accentSoft : undefined,
        opacity: route.active ? undefined : 0.6,
      }}
    >
      <div
        className={s.routeRail}
        style={{ background: route.active ? TONE[route.actualTone] : color.border }}
      />
      <div style={{ flex: 1 }}>
        <div className={s.routeTop}>
          <span
            className={s.routeCode}
            style={{ color: route.active ? color.accent : color.muted }}
          >
            {route.code}
          </span>
          <span className={s.routeName}>{route.name}</span>
        </div>
        <div className={s.routeFigures}>
          <span>{formatDistance(route.distanceMeters)}</span>
          <span>EST. {formatDuration(resultingEta(route.durationSeconds, route.trafficMarginPercent))}</span>
          <span style={{ color: TONE[route.actualTone] }}>{route.actual}</span>
        </div>
        <div
          className={s.routeNote}
          style={{ color: route.noteTone ? TONE[route.noteTone] : color.muted }}
        >
          {route.note}
        </div>
      </div>
      {action === 'open' && (
        <ChevronRight size={14} color={color.muted} style={{ marginTop: 4 }} />
      )}
      {action === 'select' && (
        // Same square the role picker on 07b uses.
        <div
          className={s.tick}
          style={{
            border: `1.5px solid ${selected ? color.accent : color.mutedSoft}`,
            background: selected ? color.accent : undefined,
          }}
        >
          {selected && <Check size={10} color="#fff" width={3.4} />}
        </div>
      )}
    </div>
  )
}

/**
 * Also serves "zona asignada", reached from a profile: the same route list
 * without the traslados/garaje split, on whichever tab bar it is given.
 *
 * What the rows offer differs by who opened it. An operator reading their own
 * zone can only read it. An administrator looking at a user is choosing which
 * routes that user works, so the rows are checkboxes.
 */
export function AdminRoutes({
  showSegments = true,
  action = 'open',
  assigned = [],
  onAssign,
  onOpen,
  onNew,
  onBack,
}: {
  showSegments?: boolean
  action?: RouteAction
  /** Route codes already assigned, when the rows are checkboxes. */
  assigned?: string[]
  /** Called with the new set every time one is ticked. */
  onAssign?: (codes: string[]) => void
  /** Editing a route is a route of its own, so the caller navigates. */
  onOpen?: (route: Route) => void
  onNew?: () => void
  onBack?: () => void
} = {}) {
  /** Which of the two the console is looking at: 0 traslados, 1 garaje. */
  const [tab, setTab] = useState(0)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string[]>(assigned)
  const toggle = (code: string) =>
    setPicked((ps) => {
      const next = ps.includes(code) ? ps.filter((c) => c !== code) : [...ps, code]
      onAssign?.(next)
      return next
    })
  const all = useData(listRoutes) ?? []
  /**
   * What each half of the list is: a route with more than one point runs
   * between places, and a route with exactly one *is* a place. Nobody stores
   * which kind it is, because the points already say.
   */
  const inTab = showSegments
    ? all.filter((r) => (tab === 0 ? r.points.length > 1 : r.points.length === 1))
    : all
  // Searched over what the row shows: the code, the name, and every address —
  // which is what "ruta, fábrica o destino" names.
  const routes = inTab.filter((r) =>
    matchesQuery(query, r.code, r.name, ...r.points.map((p) => p.address)),
  )

  return (
    <Screen>
      <TopStrip
        title="FLEETHUB_OPS"
        leading={
          onBack && <BackChevron onClick={onBack} />
        }
        trailing={
          // Only on the console's own list. Reading the zone you were assigned
          // or ticking someone else's is no place to add a route.
          action === 'open' && (
            <StripMeta c={color.accent} onClick={onNew} label="Nueva ruta">
              <span className={s.action}>+ NUEVO</span>
            </StripMeta>
          )
        }
      />

      <ScreenBody>
        <SearchBar placeholder="BUSCAR RUTA, FÁBRICA O DESTINO" value={query} onChange={setQuery} />
        {showSegments && (
          <SegmentedRow
            items={['TRASLADOS', 'GARAJE']}
            active={tab}
            onPick={setTab}
            padding="10px 0"
            letterSpacing={1.2}
            background={color.bg}
          />
        )}

        <div className={s.list}>
          {routes.map((r, i) => (
            <RouteRow
              key={r.code}
              route={r}
              last={i === routes.length - 1}
              action={action}
              selected={picked.includes(r.code)}
              onToggle={() => toggle(r.code)}
              onOpen={onOpen && (() => onOpen(r))}
            />
          ))}
          {routes.length === 0 && <div className={s.hint}>NADA COINCIDE CON LA BÚSQUEDA</div>}
        </div>

        {/* The note only makes sense where the rows do something. */}
        {action !== 'none' && (
          <div className={s.hint}>
            {action === 'select'
              ? 'MARCA LAS RUTAS QUE TRABAJA ESTE USUARIO'
              : 'TOCA UNA RUTA PARA EDITAR SU DESTINO Y ESTIMACIÓN'}
          </div>
        )}
      </ScreenBody>
    </Screen>
  )
}

// ── 06c · Editar ruta ───────────────────────────────────────────────────────

/** A point of the route. The first is the origin, the last the destination. */
type Point = {
  key: number
  id?: string
  address: string
  reference: string
  latitude?: number
  longitude?: number
}

/** The route's own points, given the ids the list edits them by. */
function pointsOf(route: Route): Point[] {
  return route.points.map((p, i) => ({ key: i + 1, ...p }))
}

/** What a point is called depends only on where it sits in the list. */
function pointLabel(i: number, total: number) {
  if (total === 1) return 'GARAJE'
  if (i === 0) return 'ORIGEN'
  if (i === total - 1) return 'DESTINO'
  return `PARADA ${i}`
}

/** The address as the row shows it — the reference qualifies it, as in the
 *  design's "Fábrica Toluca · Puerta 3". */
function describePoint(point: Point) {
  return [point.address, point.reference].filter(Boolean).join(' · ')
}

/**
 * One point is a garage, more than one is a run. None is neither, which is
 * where a route starts and where deleting can leave it — so the list can go
 * empty, and what an empty one cannot do is be saved.
 */
const MIN_POINTS = 0



/** Move a point one place up or down the route. */
function MoveButton({
  dir,
  disabled,
  onClick,
}: {
  dir: 'up' | 'down'
  disabled: boolean
  onClick: () => void
}) {
  const Arrow = dir === 'up' ? ChevronUp : ChevronDown
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={dir === 'up' ? 'Subir punto' : 'Bajar punto'}
      className={disabled ? s.move : `fh-focus-ring ${s.move}`}
      style={{ opacity: disabled ? 0.3 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
    >
      <Arrow size={14} color={color.muted} />
    </button>
  )
}

function EndpointRow({
  label,
  value,
  selected,
  onSelect,
  onOpen,
  onMoveUp,
  onMoveDown,
}: {
  label: string
  /** Empty until the point is given an address. */
  value: string
  selected: boolean
  onSelect: () => void
  onOpen: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
}) {
  return (
    <div
      className={s.endpoint}
      style={{
        background: selected ? color.accentSoft : undefined,
        boxShadow: selected ? `inset 0 0 0 1.5px ${color.accent}` : undefined,
      }}
    >
      <div className={s.endpointMoves}>
        <MoveButton dir="up" disabled={!onMoveUp} onClick={() => onMoveUp?.()} />
        <MoveButton dir="down" disabled={!onMoveDown} onClick={() => onMoveDown?.()} />
      </div>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={`${label}: ${value || 'sin dirección'}`}
        className={
          selected ? `fh-focus-ring ${s.endpointSelect}` : `fh-row fh-focus-ring ${s.endpointSelect}`
        }
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className={s.endpointLabel}>{label}</div>
          {value ? (
            <div className={s.endpointValue}>{value}</div>
          ) : (
            <div className={s.endpointEmpty}>SIN DIRECCIÓN</div>
          )}
        </div>
      </button>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Ubicar ${label}`}
        className={`fh-focus-ring ${s.endpointOpen}`}
      >
        <ChevronRight size={14} color={color.muted} />
      </button>
    </div>
  )
}

function OpRow({ title, value, last, children }: { title: string; value?: string; last?: boolean; children?: ReactNode }) {
  return (
    <div
      className={`fh-row ${s.op}`}
      style={{
        borderBottom: last ? undefined : `1px solid ${color.borderSoft}`,
        cursor: children || value !== undefined ? undefined : 'pointer',
      }}
    >
      <span className={s.opTitle}>{title}</span>
      {value && <span className={s.opValue}>{value}</span>}
      {children ?? (value === undefined ? <ChevronRight size={14} color={color.muted} /> : null)}
    </div>
  )
}

export function AdminEditRoute({
  route = blankRoute([]),
  onBack,
  onSave,
  onDelete,
}: {
  route?: Route
  onBack?: () => void
  /** Hands back the route as edited; the caller decides where it goes. */
  onSave?: (route: Route) => void
  /** Drops the route and returns to the list. Absent on the gallery copy. */
  onDelete?: () => void
} = {}) {
  const [name, setName] = useState(route.name)
  const [nameFocused, setNameFocused] = useState(false)
  const [points, setPoints] = useState<Point[]>(() => pointsOf(route))
  /** An inactive route is one nothing is scheduled on. */
  const [active, setActive] = useState(route.active)
  const [trafficMarginPercent, setTrafficMarginPercent] = useState(route.trafficMarginPercent)
  const [distanceMeters, setDistanceMeters] = useState<number | null>(route.distanceMeters)
  const [durationSeconds, setDurationSeconds] = useState<number | null>(route.durationSeconds)
  const [calculating, setCalculating] = useState(false)
  /** Which point the footer acts on; nothing is selected to begin with. */
  const [selected, setSelected] = useState<number | null>(null)
  /** Which point is being located on 06d, if any. */
  const [editing, setEditing] = useState<number | null>(null)

  useEffect(() => {
    const valid = points.length > 1 && points.every((point) =>
      Number.isFinite(point.latitude) && Number.isFinite(point.longitude))
    if (!valid) {
      setDistanceMeters(null)
      setDurationSeconds(null)
      setCalculating(false)
      return
    }
    let current = true
    const timer = window.setTimeout(() => {
      setCalculating(true)
      void estimateRoute(points.map((point) => ({
        latitude: point.latitude!, longitude: point.longitude!,
      })), trafficMarginPercent).then((result) => {
        if (!current) return
        if (result.ok) {
          setDistanceMeters(result.value.distanceMeters)
          setDurationSeconds(result.value.durationSeconds)
        } else {
          setDistanceMeters(null)
          setDurationSeconds(null)
        }
        setCalculating(false)
      })
    }, 350)
    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [points, trafficMarginPercent])

  const move = (i: number, by: number) =>
    setPoints((ps) => {
      const next = [...ps]
      const [p] = next.splice(i, 1)
      next.splice(i + by, 0, p)
      return next
    })

  const removeSelected = () => {
    if (selected === null || points.length <= MIN_POINTS) return
    setPoints((ps) => ps.filter((p) => p.key !== selected))
    setSelected(null)
  }

  const addStop = () =>
    setPoints((ps) => {
      const key = Math.max(0, ...ps.map((p) => p.key)) + 1
      const stop = { key, address: '', reference: '' }
      // Added to a garage the new point becomes the destination; added to a
      // route it goes before the destination, which stays last.
      return ps.length < 2 ? [...ps, stop] : [...ps.slice(0, -1), stop, ps[ps.length - 1]]
    })

  const canRemove = selected !== null && points.length > MIN_POINTS
  /** A route with nowhere to go is not a route yet. */
  const savable = Boolean(name.trim()) && points.length > 0 && points.every(
    (point) => point.address.trim() && Number.isFinite(point.latitude) && Number.isFinite(point.longitude),
  )

  // Locating a point takes over the screen — 06d is where its address is set.
  const editIndex = points.findIndex((p) => p.key === editing)
  if (editIndex >= 0) {
    return (
      <AdminPoint
        label={pointLabel(editIndex, points.length)}
        initial={points[editIndex]}
        onBack={() => setEditing(null)}
        onSave={(point) => {
          setPoints((ps) => ps.map((candidate) =>
            candidate.key === editing ? { ...candidate, ...point } : candidate))
          setEditing(null)
        }}
      />
    )
  }

  return (
    <Screen>
      <TopStrip
        title="FLEETHUB_OPS"
        leading={
          <span
            {...pressable(onBack)}
            aria-label={onBack ? 'Cerrar' : undefined}
            className={s.closer}
            style={{ cursor: onBack ? 'pointer' : undefined }}
          >
            <Close size={15} color={color.inkOn} />
          </span>
        }
        trailing={<SyncMeta />}
      />

      <ScreenBody bottom={96}>
        <div className={s.head}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={() => setNameFocused(true)}
            onBlur={() => setNameFocused(false)}
            aria-label="Nombre de la ruta"
            placeholder="NOMBRE DE LA RUTA"
            className={s.routeTitle}
            style={{
              background: nameFocused ? color.bg : 'transparent',
              boxShadow: nameFocused ? `inset 0 0 0 1.5px ${color.accent}` : undefined,
              margin: nameFocused ? '-4px -6px' : 0,
              padding: nameFocused ? '4px 6px' : 0,
            }}
          />
          <div className={s.headMeta}>
            {route.code} · CREADA {route.created}
          </div>
        </div>

        <SectionLabel style={{ padding: '14px 16px 0' }}>
          {points.length === 0
            ? 'SIN PUNTOS TODAVÍA'
            : points.length === 1
              ? 'GARAJE'
              : 'ORIGEN Y DESTINO'}
        </SectionLabel>
        <Card style={{ margin: '8px 16px 0' }}>
          {points.map((point, i) => {
            const last = i === points.length - 1
            return (
              <EndpointRow
                key={point.key}
                label={pointLabel(i, points.length)}
                value={describePoint(point)}
                selected={selected === point.key}
                onSelect={() => setSelected(selected === point.key ? null : point.key)}
                onOpen={() => setEditing(point.key)}
                onMoveUp={i > 0 ? () => move(i, -1) : undefined}
                onMoveDown={last ? undefined : () => move(i, 1)}
              />
            )
          })}
          <div className={s.pointActions}>
            <button
              type="button"
              disabled={!canRemove}
              onClick={removeSelected}
              className={
                canRemove
                  ? `fh-row fh-focus-ring ${s.pointAction} ${s.removePoint}`
                  : `${s.pointAction} ${s.removePoint}`
              }
              style={{ opacity: canRemove ? 1 : 0.4, cursor: canRemove ? 'pointer' : 'not-allowed' }}
            >
              ELIMINAR PUNTO
            </button>
            <button
              type="button"
              onClick={addStop}
              className={`fh-row fh-focus-ring ${s.pointAction} ${s.addStop}`}
            >
              + PARADA
            </button>
          </div>
        </Card>

        <SectionLabel style={{ padding: '16px 16px 0' }}>TIEMPO DE TRASLADO</SectionLabel>
        <Card style={{ margin: '8px 16px 0' }}>
          <div className={s.timeRow}>
            <span className={s.timeLabel}>DISTANCIA</span>
            <span className={s.timeValue}>{calculating ? 'CALCULANDO…' : formatDistance(distanceMeters)}</span>
          </div>
          <div className={s.timeRow}>
            <span className={s.timeLabel}>MARGEN POR TRÁFICO</span>
            <div className={s.stepper}>
              <button
                type="button"
                aria-label="Reducir margen de tráfico"
                disabled={trafficMarginPercent === 0}
                onClick={() => setTrafficMarginPercent((margin) => Math.max(0, margin - 5))}
                className={`fh-focus-ring ${s.stepperKey} ${s.stepperMinus}`}
              >–</button>
              <div className={s.stepperValue}>+{trafficMarginPercent} %</div>
              <button
                type="button"
                aria-label="Aumentar margen de tráfico"
                disabled={trafficMarginPercent === 100}
                onClick={() => setTrafficMarginPercent((margin) => Math.min(100, margin + 5))}
                className={`fh-focus-ring ${s.stepperKey} ${s.stepperPlus}`}
              >+</button>
            </div>
          </div>
          <div className={s.eta}>
            <span className={s.etaLabel}>ETA RESULTANTE</span>
            <span className={s.etaValue}>
              {calculating ? 'CALCULANDO…' : formatDuration(resultingEta(durationSeconds, trafficMarginPercent))}
            </span>
          </div>
        </Card>

        <SectionLabel style={{ padding: '16px 16px 0' }}>OPERACIÓN</SectionLabel>
        <Card style={{ margin: '8px 16px 0' }}>
          <OpRow title="Unidades asignadas" value={String(route.assignedVehicleCount)} />
          <OpRow title="Ruta activa" last>
            <Toggle on={active} onChange={setActive} label="Ruta activa" />
          </OpRow>
        </Card>

        <button
          type="button"
          onClick={onDelete}
          className={`fh-focus-ring ${s.deleteRoute}`}
          style={{ cursor: onDelete ? 'pointer' : 'default' }}
        >
          ELIMINAR RUTA
        </button>
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
          variant={savable ? 'accent' : 'disabled'}
          onClick={() =>
            savable &&
            onSave?.({
              ...route,
              name,
              active,
              trafficMarginPercent,
              distanceMeters,
              durationSeconds,
              points: points.map(({ key: _, ...point }) => ({
                ...point,
                latitude: point.latitude!,
                longitude: point.longitude!,
              })),
            })
          }
          style={{ flex: 1.4, width: 'auto', height: 52, fontSize: 12 }}
        >
          GUARDAR RUTA
        </Btn>
      </ActionBar>
    </Screen>
  )
}

// ── 06d · Ubicar un punto ───────────────────────────────────────────────────

/**
 * Where a point of a route gets its address. Reached from the chevron on 06c.
 *
 * The address is selected from the server's canonical suggestions. What the
 * operator sees and the coordinates used by maps therefore describe the same
 * place; the optional reference remains FleetHub's own driver note.
 */
export function AdminPoint({
  label = 'ORIGEN',
  initial = { address: '', reference: '' },
  onBack,
  onSave,
}: {
  /** What this point is called on the route it belongs to. */
  label?: string
  initial?: { address: string; reference: string; latitude?: number; longitude?: number }
  onBack?: () => void
  onSave?: (point: { address: string; reference: string; latitude: number; longitude: number }) => void
} = {}) {
  const [address, setAddress] = useState(initial.address)
  const [reference, setReference] = useState(initial.reference)
  const initialPosition = Number.isFinite(initial.latitude) && Number.isFinite(initial.longitude)
    ? { latitude: initial.latitude!, longitude: initial.longitude! }
    : null
  const [position, setPosition] = useState(initialPosition)
  const [chosenAddress, setChosenAddress] = useState(initialPosition ? initial.address : '')
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [focus, setFocus] = useState<'address' | 'reference' | null>(null)
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    const query = address.trim()
    if (query === chosenAddress && position) {
      setSuggestions([])
      setSearching(false)
      setSearched(false)
      setSearchError(null)
      return
    }
    if (query.length < 3) {
      setSuggestions([])
      setSearching(false)
      setSearched(false)
      setSearchError(null)
      return
    }
    let alive = true
    const timer = window.setTimeout(() => {
      setSearching(true)
      setSearchError(null)
      void suggestAddresses(query).then((result) => {
        if (!alive) return
        setSearching(false)
        setSearched(true)
        if (!result.ok) {
          setSuggestions([])
          setSearchError(result.reason)
          return
        }
        setSuggestions(result.value)
      })
    }, 300)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [address, chosenAddress, position])

  const choose = (suggestion: AddressSuggestion) => {
    setAddress(suggestion.address)
    setChosenAddress(suggestion.address)
    setPosition({ latitude: suggestion.latitude, longitude: suggestion.longitude })
    setSuggestions([])
    setSearchError(null)
    setSearched(false)
    setTouched(false)
  }

  const error = !address.trim()
    ? 'ESCRIBE LA DIRECCIÓN DEL PUNTO'
    : !position || address.trim() !== chosenAddress
      ? 'SELECCIONA UNA DIRECCIÓN DE LA LISTA'
      : undefined
  const ready = !error

  const field = (name: 'address' | 'reference') => ({
    focused: focus === name,
    onFocus: () => setFocus(name),
    onBlur: () => {
      setFocus(null)
      setTouched(true)
    },
  })

  return (
    <Screen>
      <TopStrip
        title="FLEETHUB_OPS"
        leading={
          onBack && <BackChevron onClick={onBack} />
        }
        trailing={<SyncMeta />}
      />

      <ScreenBody bottom={96} scroll>
        {/* Which point of the route is being located. It used to sit in the
            strip, which now carries the session's sync line instead. */}
        <SectionLabel style={{ padding: '18px 16px 0' }}>PUNTO · {label}</SectionLabel>

        <TextField
          label="DIRECCIÓN"
          value={address}
          onChange={(value) => {
            setAddress(value)
            setPosition(null)
            setChosenAddress('')
          }}
          error={touched ? error : undefined}
          placeholder="CALLE Y NÚMERO, COLONIA, CIUDAD"
          autoComplete="street-address"
          style={{ margin: '10px 16px 0' }}
          expansion={
            searching || searchError || suggestions.length || (searched && address.trim().length >= 3) ? (
              <div className={s.addressSuggestions} role="listbox" aria-label="Direcciones sugeridas">
                {searching && <div className={s.addressSuggestionState}>BUSCANDO DIRECCIONES…</div>}
                {!searching && searchError && (
                  <div className={s.addressSuggestionError}>{searchError}</div>
                )}
                {!searching && !searchError && suggestions.map((suggestion) => (
                  <button
                    key={`${suggestion.latitude}:${suggestion.longitude}:${suggestion.address}`}
                    type="button"
                    role="option"
                    aria-selected="false"
                    className={`fh-row fh-focus-ring ${s.addressSuggestion}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choose(suggestion)}
                  >
                    {suggestion.address}
                  </button>
                ))}
                {!searching && !searchError && searched && suggestions.length === 0 && (
                  <div className={s.addressSuggestionState}>NO ENCONTRAMOS ESA DIRECCIÓN</div>
                )}
                <a
                  className={s.addressAttribution}
                  href="https://www.geoapify.com/"
                  target="_blank"
                  rel="noreferrer"
                >
                  POWERED BY GEOAPIFY
                </a>
              </div>
            ) : undefined
          }
          {...field('address')}
        />

        <TextField
          label="REFERENCIA (OPCIONAL)"
          value={reference}
          onChange={setReference}
          placeholder="PUERTA 3, ANDÉN B, PATIO TRASERO…"
          style={{ margin: '14px 16px 0' }}
          {...field('reference')}
        />

        <div className={s.pointNote}>
          ES LO QUE EL OPERADOR VE EN LA RUTA · LA REFERENCIA SE MUESTRA DESPUÉS DE LA DIRECCIÓN
        </div>
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
          onClick={() => {
            if (!ready) {
              setTouched(true)
              return
            }
            onSave?.({
              address: chosenAddress,
              reference: reference.trim(),
              latitude: position!.latitude,
              longitude: position!.longitude,
            })
          }}
          style={{ flex: 1.4, width: 'auto', height: 52, fontSize: 12 }}
        >
          GUARDAR PUNTO
        </Btn>
      </ActionBar>
    </Screen>
  )
}
