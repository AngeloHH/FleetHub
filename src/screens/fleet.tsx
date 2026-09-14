// Screens 03 and 04 — the report log and the alerts inbox.

import { useState, type ReactNode } from 'react'
import { color } from '../design/tokens'
import { Check } from '../components/icons'
import {
  BackChevron,
  Card,
  Dot,
  Screen,
  ScreenBody,
  SectionLabel,
  StripMeta,
  SyncMeta,
  TopStrip,
} from '../components/ui'
import s from './fleet.module.css'
import { SearchBar, SegmentedRow } from './admin'
import { matchesQuery } from '../lib/search'
import { pressable } from '../lib/press'
import { dayLabel, eventDetail, eventTitle, timeLabel, type AlertDismissal, type EventKind, type FleetAlert, type Tone } from '../domain'
import { listDays, listEvents, listLatestPerVehicle, type FleetEntry } from '../data'
import { useData } from '../data/useData'

// ── 03 · Historial de reportes ──────────────────────────────────────────────

function LogEntry({
  time,
  title,
  detail,
  status,
  onOpen,
  unit,
  last,
  dim,
}: {
  time: string
  title: string
  detail: string
  /** Square status marker; absent on yesterday's archived rows. */
  status?: string
  /** Where the line happened, on the map. Absent leaves the row a reading. */
  onOpen?: () => void
  unit?: string
  last?: boolean
  dim?: boolean
}) {
  return (
    <div
      {...pressable(onOpen)}
      // Otherwise the row's name would drag its time and its detail along.
      aria-label={onOpen ? `${unit} en el mapa` : undefined}
      className={onOpen ? `fh-row ${s.entry}` : s.entry}
      style={{
        borderBottom: last ? undefined : `1px solid ${color.borderSoft}`,
        opacity: dim ? 0.7 : undefined,
        cursor: onOpen ? 'pointer' : undefined,
      }}
    >
      <div className={s.entryTime}>{time}</div>
      <div className={s.entryBody}>
        <div className={s.entryTitle}>{title}</div>
        <div className={s.entryDetail}>{detail}</div>
      </div>
      {status && <div className={s.entryStatus} style={{ background: status }} />}
    </div>
  )
}

const TONE: Record<Tone, string> = {
  ok: color.ok,
  warn: color.warn,
  danger: color.danger,
  muted: color.muted,
}

function DayHeader({ day, count, first }: { day: string; count: string; first?: boolean }) {
  return (
    <div className={s.dayHeader} style={{ padding: first ? '12px 16px 0' : '16px 16px 0' }}>
      <SectionLabel>{day}</SectionLabel>
      <SectionLabel style={{ letterSpacing: 1 }}>{count}</SectionLabel>
    </div>
  )
}

export function ReportHistory({
  onBack,
  mode = 'log',
  by = null,
  onOpenUnit,
}: {
  /**
   * Only supplied when the log was opened from elsewhere — reached from a tab
   * bar there is nothing to go back to, so no chevron is drawn.
   */
  onBack?: () => void
  /**
   * "log" is everything that happened, by day. "latest" is one row per
   * vehicle — the fleet as it stands, which is what the FLOTA tab asks for.
   */
  mode?: 'log' | 'latest'
  /**
   * Whose doing to show. A membership narrows the log to that person's own
   * entries, which is what a profile's scan history is; null is everyone,
   * which is what administration asks for.
   */
  by?: string | null
  /**
   * Takes a line to where it happened. The log names a vehicle on every row,
   * and 04 already treats "see it on the map" as going to that vehicle.
   */
  onOpenUnit?: (unit: string) => void
} = {}) {
  const latest = mode === 'latest'
  const all = useData(() => listEvents(by), [by]) ?? []
  const newest = useData(listLatestPerVehicle) ?? []
  const allDays = useData(() => listDays(by), [by]) ?? []

  const [query, setQuery] = useState('')
  /** 0 is everything; the rest each name one kind of line. */
  const [segment, setSegment] = useState(0)
  const KINDS: (EventKind | null)[] = [null, 'estado', 'ruta', 'adjuntos']

  const source: FleetEntry[] = latest
    ? newest
    : all.map((event) => ({
        id: event.id,
        vehicleId: event.vehicleId,
        vin: '',
        kind: event.kind,
        at: event.at,
        title: eventTitle(event),
        detail: eventDetail(event),
        tone: event.tone,
      }))

  // The search runs over the words the row shows — unit, title, detail — so
  // whatever can be read can be found, operator and VIN included.
  const found = source.filter((entry) =>
    matchesQuery(query, entry.vehicleId, entry.vin, entry.title, entry.detail),
  )
  // The segments count what the search left, so the numbers follow the field.
  const of = (kind: EventKind) => found.filter((e) => e.kind === kind).length
  const kind = KINDS[segment]
  const rows = kind ? found.filter((e) => e.kind === kind) : found
  // Only the days that still have something to show under them.
  const days = allDays.filter((day) => rows.some((entry) => entry.at && dayLabel(entry.at) === day))

  /** The log as a file: what EXPORTAR CSV hands over — the rows on show. */
  const exportCsv = () => {
    const cell = (v: string) => `"${v.replace(/"/g, '""')}"`
    const lines = [
      ['fecha', 'unidad', 'titulo', 'detalle'].join(','),
      ...rows.map((entry) => [entry.at ?? '', entry.vehicleId, entry.title, entry.detail].map(cell).join(',')),
    ]
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'fleethub-reportes.csv'
    a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <Screen>
      <TopStrip
        title="FLEETHUB_OPS"
        leading={
          onBack && <BackChevron onClick={onBack} />
        }
        trailing={
          <StripMeta c={color.accent} onClick={exportCsv}>
            <span className={s.exportar}>EXPORTAR CSV</span>
          </StripMeta>
        }
      />

      <ScreenBody>
        <SearchBar placeholder="BUSCAR POR UNIDAD, VIN U OPERADOR" value={query} onChange={setQuery} />
        <SegmentedRow
          items={[
            `TODO · ${found.length}`,
            `ESTADOS · ${of('estado')}`,
            `RUTA · ${of('ruta')}`,
            `ADJUNTOS · ${of('adjuntos')}`,
          ]}
          active={segment}
          onPick={setSegment}
          padding="10px 0"
          // Four segments need the tighter setting 07 already uses; at the
          // default the longest label runs into the edge.
          fontSize={9}
          letterSpacing={1}
          background={color.bg}
        />

        {latest ? (
          <>
            <div className={s.dayHeader} style={{ padding: '12px 16px 0' }}>
              <SectionLabel>ÚLTIMO REPORTE POR UNIDAD</SectionLabel>
              <SectionLabel style={{ letterSpacing: 1 }}>{rows.length} UNIDADES</SectionLabel>
            </div>
            <Card className={s.log}>
              {rows.map((entry, i) => (
                <LogEntry
                  key={entry.id}
                  time={entry.at ? timeLabel(entry.at) : '—'}
                  title={entry.title}
                  detail={entry.detail}
                  status={entry.tone && TONE[entry.tone]}
                  unit={entry.vehicleId}
                  onOpen={onOpenUnit && (() => onOpenUnit(entry.vehicleId))}
                  last={i === rows.length - 1}
                />
              ))}
            </Card>
          </>
        ) : (
          days.length === 0 ? (
            <div className={s.dayHeader} style={{ padding: '12px 16px 0' }}>
              <SectionLabel>NADA COINCIDE CON LA BÚSQUEDA</SectionLabel>
            </div>
          ) : (
          days.map((day, d) => {
            const ofDay = rows.filter((entry) => entry.at && dayLabel(entry.at) === day)
            return (
              <div key={day}>
                <DayHeader day={day} count={`${ofDay.length} REGISTROS`} first={d === 0} />
                <Card className={s.log}>
                  {ofDay.map((entry, i) => (
                    <LogEntry
                      key={entry.id}
                      time={entry.at ? timeLabel(entry.at) : '—'}
                      title={entry.title}
                      detail={entry.detail}
                      status={entry.tone && TONE[entry.tone]}
                      unit={entry.vehicleId}
                      onOpen={onOpenUnit && (() => onOpenUnit(entry.vehicleId))}
                      // The days already closed are drawn quieter.
                      dim={!entry.tone}
                      last={i === ofDay.length - 1}
                    />
                  ))}
                </Card>
              </div>
            )
          })
          )
        )}
      </ScreenBody>
    </Screen>
  )
}

// ── 04 · Alertas ────────────────────────────────────────────────────────────

function AlertCard({
  severity,
  time,
  title,
  detail,
  primary,
  onPrimary,
  onSecondary,
  primaryBg,
  primaryColor,
  secondary,
  accentColor,
  background,
  blink,
  style,
}: {
  severity: string
  time: string
  title: string
  detail: string
  primary: string
  /** What the primary action does. Absent draws it as the design does, dead. */
  onPrimary?: () => void
  onSecondary?: () => void
  /** The critical card fills its primary action red; the warning card uses ink. */
  primaryBg: string
  primaryColor: string
  secondary: string
  accentColor: string
  background: string
  blink?: boolean
  style?: React.CSSProperties
}) {
  return (
    <div style={{ border: `1.5px solid ${accentColor}`, background, ...style }}>
      <div className={s.alertHead} style={{ background: accentColor }}>
        <span className={s.alertSeverity}>
          {blink && <Dot background="#fff" duration="1.2s" />}
          {severity}
        </span>
        <span className={s.alertTime}>{time}</span>
      </div>
      <div className={s.alertBody}>
        <div className={s.alertTitle}>{title}</div>
        <div className={s.alertDetail}>{detail}</div>
        <div className={s.alertActions}>
          <button
            onClick={onPrimary}
            className={`${s.alertBtn} ${s.alertBtnPrimary}`}
            style={{ background: primaryBg, color: primaryColor }}
          >
            {primary}
          </button>
          <button onClick={onSecondary} className={`${s.alertBtn} ${s.alertBtnSecondary}`}>
            {secondary}
          </button>
        </div>
      </div>
    </div>
  )
}

function ResolvedRow({ children, time, last }: { children: ReactNode; time: string; last?: boolean }) {
  return (
    <div
      className={s.resolved}
      style={{ borderBottom: last ? undefined : `1px solid ${color.borderSoft}` }}
    >
      <Check size={15} color={color.ok} width={2.4} />
      <span className={s.resolvedText}>{children}</span>
      <span className={s.resolvedTime}>{time}</span>
    </div>
  )
}

export function Alerts({
  onSeeOnMap,
  alerts = [],
  resolved = [],
  onDismiss,
}: {
  onSeeOnMap?: (unit: string) => void
  /** Las activas de verdad, derivadas de la telemetría. */
  alerts?: FleetAlert[]
  /** Lo descartado hoy. */
  resolved?: AlertDismissal[]
  onDismiss?: (alert: FleetAlert) => void
} = {}) {
  const TONE_CARD = {
    danger: { bg: color.dangerSoft, accent: color.danger, primaryBg: color.danger, primaryColor: '#fff' },
    warn: { bg: color.warnSoft, accent: color.warn, primaryBg: color.ink, primaryColor: color.inkOn },
  }
  return (
      <Screen>
        <TopStrip title="FLEETHUB_OPS" trailing={<SyncMeta />} />
        <ScreenBody>
          <SectionLabel style={{ margin: '14px 16px 0' }}>ACTIVAS</SectionLabel>
          {alerts.map((a, i) => (
            <AlertCard
              key={a.id}
              style={{ margin: i === 0 ? '8px 16px 0' : '10px 16px 0' }}
              severity={a.severity}
              time={a.time}
              title={a.title}
              detail={a.detail}
              primary={a.primary}
              onPrimary={onSeeOnMap && (() => onSeeOnMap(a.unit))}
              onSecondary={onDismiss && (() => onDismiss(a))}
              primaryBg={TONE_CARD[a.tone].primaryBg}
              primaryColor={TONE_CARD[a.tone].primaryColor}
              secondary="DESCARTAR"
              accentColor={TONE_CARD[a.tone].accent}
              background={TONE_CARD[a.tone].bg}
              blink={a.tone === 'danger'}
            />
          ))}
          {alerts.length === 0 && (
            <Card style={{ margin: '8px 16px 0' }}>
              <div className={s.resolved}>
                <Check size={15} color={color.ok} width={2.4} />
                <span className={s.resolvedText}>Nada que mirar: toda la flota reporta</span>
              </div>
            </Card>
          )}

          <SectionLabel style={{ margin: '18px 16px 0' }}>RESUELTAS HOY</SectionLabel>
          <Card style={{ margin: '8px 16px 0' }}>
            {resolved.map((d, i) => (
              <ResolvedRow key={d.id} time={timeLabel(d.at)} last={i === resolved.length - 1}>
                {d.title}
              </ResolvedRow>
            ))}
            {resolved.length === 0 && (
              <div className={s.resolved}>
                <span className={s.resolvedText}>Ninguna todavía</span>
              </div>
            )}
          </Card>
        </ScreenBody>
      </Screen>
  )
}
