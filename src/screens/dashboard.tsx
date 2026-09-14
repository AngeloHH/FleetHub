// Screens 00 and 00b — the live dashboard and the unit edit sheet.

import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { color, device, layout } from '../design/tokens'

// El mapa carga aparte: MapLibre es el trozo más pesado del bundle con
// diferencia, y la puerta de entrada no tiene por qué descargarlo. El hueco
// que deja mientras llega es el propio fondo del contenedor — la misma
// cuadrícula a la que el mapa degrada sin red.
const FleetMap = lazy(() =>
  import('../components/FleetMap').then((m) => ({ default: m.FleetMap })),
)
import { stateTone, VEHICLE_STATES, type Route, type Tone, type Vehicle } from '../domain'
import {
  getVehicle,
  assignVehicleRoute,
  latestVehiclePosition,
  listRoutes,
  recordEvent,
  setVehicleState,
  setVehicleRouteStartedAt,
  vehicleRoute,
  uploadPhoto,
  vehicleStates,
  type VehicleDetails,
  type VehiclePosition,
} from '../data'
import { useData } from '../data/useData'
import { Camera, Check, ChevronDown, ChevronRight, Close, Crosshair, Edit, Trash } from '../components/icons'
import {
  ActionBar,
  BackChevron,
  Btn,
  Card,
  Screen,
  ScreenBody,
  SectionLabel,
  SyncMeta,
  TopStrip,
} from '../components/ui'
import { useListboxMenu } from '../components/menu'
import s from './dashboard.module.css'
import { pressable } from '../lib/press'

const VIN = 'JT2BF22K1W0127K2310'

/** Dark bar showing the unit's VIN. */
function VinStrip({
  vin = VIN,
  padding = '11px 16px',
  size = 15,
}: {
  vin?: string
  padding?: string
  size?: number
}) {
  return (
    <div className={s.vin} style={{ padding }}>
      <span className={s.vinLabel}>VIN</span>
      <span className={s.vinValue} style={{ fontSize: size, letterSpacing: size > 13 ? 2 : 1.5 }}>
        {vin}
      </span>
    </div>
  )
}

function Metric({ label, value, unit, last, valueColor = color.ink }: {
  label: string
  /** Absent when the unit has never reported it, which draws an em dash. */
  value?: number
  unit?: string
  last?: boolean
  valueColor?: string
}) {
  // A unit with no fix has no speed and no fuel either; saying so beats
  // printing what the absence stringifies to.
  const missing = value === undefined
  return (
    <div
      className={s.metric}
      style={{ borderRight: last ? undefined : `1px solid ${color.border}` }}
    >
      <div className={s.metricLabel}>{label}</div>
      <div className={s.metricValue} style={{ color: missing ? color.mutedSoft : valueColor }}>
        {missing ? '—' : value}
        {unit && !missing && <span className={s.metricUnit}> {unit}</span>}
      </div>
    </div>
  )
}

// ── 00 · Dashboard ──────────────────────────────────────────────────────────

const TONE: Record<Tone, { fg: string; bg: string }> = {
  ok: { fg: color.ok, bg: color.okSoft },
  warn: { fg: color.warn, bg: color.warnSoft },
  danger: { fg: color.danger, bg: color.dangerSoft },
  muted: { fg: color.muted, bg: color.surfaceAlt },
}

/**
 * Vehicle detail, raised from the bottom when a unit is tapped. The map is the
 * screen; this only exists while something is selected.
 */
function UnitSheet({
  unit,
  state,
  onClose,
  onEdit,
  canEdit = true,
  onScan,
  canScan = true,
}: {
  unit: Vehicle
  /** Where it stands, which is its newest event and not a field on it. */
  state: string
  onClose: () => void
  onEdit?: () => void
  onScan?: () => void
  /**
   * Whether to offer each action at all. The gallery draws the sheet as the
   * design does, which is with both; the app asks first, because a reader who
   * is only allowed to look should not be shown a way in that refuses them.
   */
  canEdit?: boolean
  canScan?: boolean
}) {
  const tone = TONE[stateTone(state)]
  return (
    <div className={s.sheet} style={{ top: '50%' }}>
      <div className={s.sheetHead}>
        {/* The orange block the design gives the unit id is the close control:
            the id is already on the map marker and in the VIN row below. */}
        <button
          type="button"
          onClick={onClose}
          className={`fh-btn-accent fh-focus-ring ${s.sheetClose}`}
          aria-label="Cerrar ficha"
        >
          <Close size={18} color="#fff" />
        </button>
        <div className={s.sheetTitleCell}>
          <div className={s.sheetModel}>{unit.model}</div>
          <div className={s.sheetSpec}>{unit.spec}</div>
        </div>
        <div className={s.sheetStateCell}>
          <span
            className={s.sheetState}
            style={{ color: tone.fg, background: tone.bg, border: `1px solid ${tone.fg}` }}
          >
            {state}
          </span>
        </div>
      </div>

      <VinStrip vin={unit.vin} />

      <div className={s.metrics}>
        <Metric label="SEÑAL" value={unit.signalMin} unit="min" />
        <Metric label="VELOCIDAD" value={unit.speedKmh} unit="km/h" />
        <Metric label="COMBUSTIBLE" value={unit.fuelPct} unit="%" last />
      </div>

      <div className={s.position}>
        <span className={s.positionLabel}>POS</span>
        <span className={s.positionValue}>{unit.position}</span>
      </div>

      {(canEdit || canScan) && (
        <div className={s.sheetActions}>
          {canEdit && (
            <Btn
              variant="inkOutline"
              onClick={onEdit}
              style={{
                flex: 1,
                width: 'auto',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <Edit size={15} />
              MODIFICAR
            </Btn>
          )}
          {canScan && (
            <Btn onClick={onScan} style={{ flex: 1, width: 'auto' }}>
              ⌜ESCANEAR⌟
            </Btn>
          )}
        </div>
      )}
    </div>
  )
}

/** Half the frame, so the sheet meets the map at mid-screen. */
/** La ficha nace a mitad del marco — del que haya: el teléfono dibujado de
 *  la galería o la pantalla entera de la app. Por eso se mide y no se supone. */


export function Dashboard({
  at,
  onSelect,
  onBack,
  onEditUnit,
  canEdit = true,
  onScan,
  canScan = true,
}: {
  /**
   * The unit whose card is up, when the caller owns that. The app does,
   * because it keeps it in the address. Omit and the screen keeps its own,
   * which is what the gallery needs.
   */
  at?: string | null
  onSelect?: (id: string | null) => void
  onBack?: () => void
  onEditUnit?: (unit: Vehicle) => void
  onScan?: () => void
  /** What the sheet may offer about the unit that was tapped. */
  canEdit?: boolean
  canScan?: boolean
} = {}) {
  const recenter = useRef<(() => void) | null>(null)
  // Cuánto mide el marco de verdad: media pantalla de teléfono dibujado en la
  // galería, media pantalla entera en la app. La ficha y el mapa lo comparten.
  const measure = useRef<HTMLDivElement | null>(null)
  const [frameH, setFrameH] = useState<number>(device.height)
  useEffect(() => {
    const el = measure.current
    if (!el) return
    const ro = new ResizeObserver(() => setFrameH(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const [own, setOwn] = useState<string | null>(null)
  const selectedId = at === undefined ? own : at
  const setSelectedId = onSelect ?? setOwn
  const selected = useData(() => getVehicle(selectedId), [selectedId])
  const states = useData(vehicleStates) ?? {}

  return (
    <Screen>
      {/* The map fills the usable area between the strip and the tab bar. */}
      <div ref={measure} className={s.map}>
        <Suspense fallback={null}>
          <FleetMap
            selectedId={selectedId}
            onSelect={setSelectedId}
            bottomInset={selectedId ? Math.max(0, Math.round(frameH / 2) - layout.navHeight) : 0}
            recenterRef={recenter}
            locationEnabled={Boolean(onSelect)}
          />
        </Suspense>

        <div
          {...pressable(() => recenter.current?.())}
          aria-label="CENTRAR"
          className={s.recenter}
        >
          <Crosshair size={13} color={color.accent} />
          CENTRAR
        </div>
      </div>

      <TopStrip
        title="FLEETHUB_OPS"
        leading={onBack && <BackChevron onClick={onBack} />}
        // The fleet is 19 units; only the three with a live fix are plotted.
        trailing={<SyncMeta />}
      />

      {selected && (
        <UnitSheet
          unit={selected}
          state={states[selected.id] ?? ''}
          onClose={() => setSelectedId(null)}
          onEdit={() => onEditUnit?.(selected)}
          canEdit={canEdit}
          onScan={onScan}
          canScan={canScan}
        />
      )}

    </Screen>
  )
}

// ── 00b · Modificar unidad ──────────────────────────────────────────────────

function StateOption({
  name,
  note,
  selected,
  span,
  inline,
  onSelect,
}: {
  name: string
  note: string
  selected?: boolean
  span?: boolean
  inline?: boolean
  onSelect?: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={Boolean(selected)}
      // The note ("ACTUAL", "TALLER") would otherwise be read as part of it.
      aria-label={name}
      onClick={onSelect}
      className={selected ? `fh-focus-ring ${s.state}` : `fh-opt fh-focus-ring ${s.state}`}
      style={{
        border: selected ? `2px solid ${color.ok}` : `1px solid ${color.border}`,
        background: selected ? color.okSoft : color.surface,
        gridColumn: span ? '1 / -1' : undefined,
        display: inline ? 'flex' : undefined,
        alignItems: inline ? 'center' : undefined,
        justifyContent: inline ? 'space-between' : undefined,
      }}
    >
      <div className={s.stateName} style={{ color: selected ? color.ok : color.ink }}>
        {name}
      </div>
      <div
        className={s.stateNote}
        style={{ color: selected ? color.ok : color.muted, marginTop: inline ? 0 : 3 }}
      >
        {note}
      </div>
    </button>
  )
}

/** What a visit to 00b can change about a unit. */
export type UnitEdit = { id: string; status: string; route: string; note: string }

function positionStamp(value?: string) {
  const at = Date.parse(value ?? '')
  if (!Number.isFinite(at)) return null
  return new Intl.DateTimeFormat('es', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(at).toUpperCase()
}

function routeStartInput(value: string | null | undefined) {
  const date = new Date(value ?? '')
  if (!Number.isFinite(date.getTime())) return ''
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

function routeStartIso(value: string) {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

export function EditUnit({
  unit,
  by = null,
  onClose,
  onEditDetails,
  onSave,
  canRemove = false,
  onRemove,
}: {
  unit?: Vehicle
  /** The badge signing the events. Null on the gallery copy. */
  by?: string | null
  onClose?: () => void
  onEditDetails?: () => void
  onSave?: (edit: UnitEdit) => void
  /** Sólo administración. Un operador cambia el estado; no retira la unidad. */
  canRemove?: boolean
  onRemove?: () => void
} = {}) {
  const u = unit
  const routes = useData(listRoutes) ?? []
  const states = useData(vehicleStates) ?? {}
  const assigned = useData(() => (u ? vehicleRoute(u.vin) : Promise.resolve(null)), [u?.vin])

  /**
   * What the operator has picked, or null while they have picked nothing —
   * in which case the screen shows what the unit is now. Keeping the two apart
   * means a change arriving from elsewhere does not overwrite an edit midway.
   */
  const [picked, setPicked] = useState<string | null | undefined>(undefined)
  const [pickedRoute, setPickedRoute] = useState<Route | null>(null)
  const [pickedRouteStart, setPickedRouteStart] = useState<string | undefined>(undefined)
  const [note, setNote] = useState('')
  const [saveProblem, setSaveProblem] = useState<string | null>(null)
  /** Las fotos en mano, ya encogidas a JPEG. Suben al guardar. */
  const [shots, setShots] = useState<string[]>([])
  const [photoProblem, setPhotoProblem] = useState<string | null>(null)
  const [selectedShot, setSelectedShot] = useState<number | null>(null)
  const [reportedPosition, setReportedPosition] = useState<VehiclePosition | null>(null)
  const vin = u?.vin
  useEffect(() => {
    if (!vin) return
    let active = true
    setReportedPosition(null)
    void latestVehiclePosition(vin).then((position) => {
      if (active) setReportedPosition(position)
    })
    return () => { active = false }
  }, [vin])
  /**
   * Una foto en mano: se decodifica, se encoge y se queda en JPEG.
   *
   * El paso por el lienzo no es sólo para que pese menos. Es lo que convierte
   * cualquier cosa que el navegador sepa abrir —el HEIC de un iPhone, entre
   * otras— en el único formato que el servidor acepta, y de paso deja fuera
   * los metadatos del archivo original sin tener que quitarlos.
   *
   * Lo que el navegador no sabe abrir tiene que decirse. Antes la promesa se
   * rompía sola y la foto simplemente no aparecía: quien la había elegido se
   * quedaba mirando el hueco sin saber si había que esperar.
   */
  const attach = async (file: File) => {
    if (shots.length >= 6) return
    setPhotoProblem(null)
    let bitmap: ImageBitmap
    try {
      bitmap = await createImageBitmap(file)
    } catch {
      setPhotoProblem('NO SE PUDO LEER ESA IMAGEN · PRUEBA CON OTRA O USA LA CÁMARA')
      return
    }
    const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    setShots((have) => [...have, canvas.toDataURL('image/jpeg', 0.8)].slice(0, 6))
    setSelectedShot(null)
  }

  const current = u ? (states[u.id] ?? '') : ''
  const status = picked === undefined ? current : (picked ?? '')
  const route = pickedRoute ?? assigned ?? null
  const startsAt = pickedRouteStart ?? routeStartInput(assigned?.routeStartedAt)
  const coordinates: [number, number] | undefined = reportedPosition
    ? [reportedPosition.longitude, reportedPosition.latitude]
    : u?.coords
  const recordedAt = reportedPosition?.createdAt ?? u?.positionAt
  const accuracy = reportedPosition?.accuracy ?? u?.positionAccuracy
  const recordedStamp = positionStamp(recordedAt)
  const positionMeta = [
    recordedStamp ? `REGISTRADA ${recordedStamp}` : null,
    accuracy !== null && accuracy !== undefined && Number.isFinite(accuracy)
      ? `PRECISIÓN ±${Math.round(accuracy)} M`
      : null,
  ].filter(Boolean).join(' · ')

  /**
   * Records what changed, one event per thing — a state and a note are two
   * facts about the unit, not one edit of it.
   */
  const save = async () => {
    if (!u) return
    setSaveProblem(null)
    // What was *picked*, not what is on screen: the picker has to show some
    // route even for a unit that has none, and taking its word for it wrote a
    // route change into the log every time anyone opened this screen and
    // saved — for the six units that had never been given one.
    if (picked !== undefined && status !== current) {
      const changed = await setVehicleState(by, u.vin, u.id, picked)
      if (!changed.ok) {
        setSaveProblem(changed.reason)
        return
      }
    }
    if (pickedRoute && pickedRoute.id !== assigned?.id) {
      const linked = await assignVehicleRoute(u.vin, pickedRoute.id)
      if (!linked.ok) {
        setSaveProblem(linked.reason)
        return
      }
      await recordEvent(by, { vehicleId: u.id, kind: 'ruta', route: pickedRoute.code })
    }
    if (route && route.points.length > 1 && pickedRouteStart !== undefined) {
      const started = await setVehicleRouteStartedAt(u.vin, routeStartIso(pickedRouteStart))
      if (!started.ok) {
        setSaveProblem(started.reason)
        return
      }
    }
    if (note.trim() || shots.length) {
      const sent: string[] = []
      let fell = 0
      for (const shot of shots) {
        const up = await uploadPhoto(u.vin, shot)
        if (up.ok) sent.push(up.value)
        else fell += 1
      }
      const said = [note.trim(), fell ? `(${fell} FOTOS NO SUBIERON)` : '']
        .filter(Boolean)
        .join(' ')
      await recordEvent(by, { vehicleId: u.id, kind: 'adjuntos', note: said, photos: sent })
    }
    onSave?.({ id: u.id, status, route: route?.code ?? '', note: note.trim() })
  }

  const routeMenu = useListboxMenu({
    items: routes,
    isSelected: (r) => r.code === route?.code,
    onPick: (next) => {
      setPickedRoute(next)
      if (next.id !== assigned?.id) setPickedRouteStart('')
    },
    listLabel: 'Ruta asignada',
    triggerLabel: route ? `Ruta asignada: ${route.code} · ${route.name}` : 'Sin location asignada',
    rowSelector: '[data-row]',
    panelStyle: { borderTop: 'none' },
    renderOption: (r, selected) => (
      <>
        <span className={s.routeCode} style={{ color: selected ? color.accent : color.ink }}>
          {r.code}
        </span>
        <span className={s.routeName}>{r.name}</span>
        {selected && <Check size={13} color={color.accent} />}
      </>
    ),
  })

  // The unit and the routes arrive from the seam; there is nothing to draw
  // for the instant before they do.
  if (!u) return null

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
        <VinStrip vin={u.vin} padding="12px 16px" size={13} />
        <button
          type="button"
          onClick={onEditDetails}
          disabled={!onEditDetails}
          aria-label="Modificar información del vehículo"
          className={`fh-row ${onEditDetails ? 'fh-focus-ring' : ''} ${s.header}`}
        >
          <span className={s.headerText}>
            <span className={s.headerModel}>{u.model}</span>
            <span className={s.headerSpec}>{u.spec}</span>
          </span>
          {onEditDetails && <ChevronRight size={22} color={color.muted} />}
        </button>

        <SectionLabel style={{ padding: '14px 16px 0' }}>ESTADO DE LA UNIDAD</SectionLabel>
        <div
          role="radiogroup"
          aria-label="Estado de la unidad"
          className={s.states}
        >
          {VEHICLE_STATES.map((state, i) => (
            <StateOption
              key={state.name}
              name={state.name}
              // "ACTUAL" marks what the unit is now; the highlight marks what
              // it is being set to, so the two can differ.
              note={state.name === current ? 'ACTUAL' : state.note}
              selected={state.name === status}
              // VENDIDO closes the file, so it sits alone across the row.
              span={i === VEHICLE_STATES.length - 1}
              inline={i === VEHICLE_STATES.length - 1}
              onSelect={() => setPicked(state.name === status ? null : state.name)}
            />
          ))}
        </div>

        <SectionLabel style={{ padding: '16px 16px 0' }}>RUTA ASIGNADA</SectionLabel>
        {routes.length ? (
          <div ref={routeMenu.root} className={s.routeField}>
            <button
              {...routeMenu.triggerProps}
              data-row
              className={`fh-row ${routeMenu.triggerProps.className} ${s.routeTrigger}`}
            >
              <span className={s.routeTriggerText}>
                {route ? `${route.code} · ${route.name}` : 'SIN LOCATION ASIGNADA'}
              </span>
              <ChevronDown size={14} color={color.muted} />
            </button>
            {routeMenu.panel}
          </div>
        ) : (
          <Card style={{ margin: '8px 16px 0' }}>
            <div className={s.place}>SIN LOCATION DISPONIBLE</div>
          </Card>
        )}
        {saveProblem && <div className={s.saveProblem}>{saveProblem}</div>}

        {route && route.points.length > 1 ? (
          <>
            <SectionLabel style={{ padding: '16px 16px 0' }}>INICIO DE RUTA</SectionLabel>
            <Card style={{ margin: '8px 16px 0' }}>
              <div className={s.routeStart}>
                <input
                  type="datetime-local"
                  value={startsAt}
                  disabled={!onSave}
                  onChange={(event) => setPickedRouteStart(event.target.value)}
                  aria-label="Fecha y hora de inicio de ruta"
                  className={`fh-focus-ring ${s.routeStartInput}`}
                />
                <div className={s.placeCoords}>FECHA Y HORA DEL DISPOSITIVO</div>
              </div>
            </Card>
          </>
        ) : (
          <>
            <SectionLabel style={{ padding: '16px 16px 0' }}>UBICACIÓN</SectionLabel>
            <Card style={{ margin: '8px 16px 0' }}>
              <div className={s.place}>
                <div className={s.placeName}>
                  {coordinates
                    ? `${coordinates[1].toFixed(5)}, ${coordinates[0].toFixed(5)}`
                    : 'SIN UBICACIÓN REGISTRADA'}
                </div>
                <div className={s.placeCoords}>
                  {coordinates ? (positionMeta || 'ÚLTIMA POSICIÓN GUARDADA') : 'TODAVÍA NO LLEGÓ UNA POSICIÓN AL SERVIDOR'}
                </div>
              </div>
            </Card>
          </>
        )}

        <div className={s.photosHeader}>
          <SectionLabel>FOTOS DEL VEHÍCULO</SectionLabel>
          <SectionLabel style={{ letterSpacing: 1 }}>{onSave ? `${shots.length} / 6` : '2 / 6'}</SectionLabel>
        </div>
        <div className={s.photos}>
          {onSave ? (
            shots.map((shot, i) => (
              <div key={i} className={s.photoItem}>
                <button
                  type="button"
                  aria-label={`Seleccionar foto ${i + 1}`}
                  onClick={() => setSelectedShot(i)}
                  className={`fh-focus-ring ${s.photoSelect}`}
                >
                  <img src={shot} alt={`Foto ${i + 1}`} className={s.photo} />
                </button>
                {selectedShot === i && (
                  <button
                    type="button"
                    aria-label={`Eliminar foto ${i + 1}`}
                    onClick={() => {
                      setShots((current) => current.filter((_, index) => index !== i))
                      setSelectedShot(null)
                    }}
                    className={`fh-focus-ring ${s.photoDelete}`}
                  >
                    <Trash size={17} />
                    <span>ELIMINAR</span>
                  </button>
                )}
              </div>
            ))
          ) : (
            <>
              <div className={s.photo} />
              <div className={s.photo} />
            </>
          )}
          {(!onSave || shots.length < 6) && (
            <label
              className={`fh-photo ${s.photoAdd} ${onSave && shots.length === 0 ? s.photoAddWide : ''}`}
              style={{ cursor: onSave ? 'pointer' : undefined }}
            >
              <Camera size={19} color={color.muted} />
              <span className={s.photoAddLabel}>FOTO</span>
              {onSave && (
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  aria-label="Añadir foto"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void attach(file)
                    e.target.value = ''
                  }}
                />
              )}
            </label>
          )}
        </div>
        {photoProblem && <div className={s.saveProblem} role="alert">{photoProblem}</div>}
        <div className={s.photosNote}>DAÑOS, KILOMETRAJE O ENTREGA · SE SUBEN CON EL CAMBIO</div>

        <SectionLabel style={{ padding: '12px 16px 0' }}>NOTA (OPCIONAL)</SectionLabel>
        <div className={s.noteBox}>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label="Nota"
            rows={2}
            placeholder="EJ. ENTREGA REPROGRAMADA, LLANTA BAJA…"
            className={s.note}
          />
        </div>

        {canRemove && u && (
          <div className={s.removeBox}>
            <Btn
              variant="dangerOutline"
              onClick={() => {
                // Lo que se pierde, dicho antes y con sus nombres. No es
                // «borrar el vehículo»: la misma unidad puede seguir en la
                // flota de otra compañía, y este VIN se puede volver a
                // escanear después. Lo que no vuelve es el historial.
                const seguro = window.confirm(
                  'REMOVER DE LA FLOTA\n\n'
                  + `¿Estás seguro de que quieres quitar ${u.id} de la flota?\n\n`
                  + 'Todas las fotos y el estado van a desaparecer, incluyendo '
                  + 'los reportes realizados anteriormente. Esto no se puede '
                  + 'deshacer.',
                )
                if (seguro) onRemove?.()
              }}
              style={{ width: '100%', height: 48, fontSize: 12 }}
            >
              <Trash size={16} color={color.danger} />
              REMOVER DE LA FLOTA
            </Btn>
            <div className={s.removeNote}>
              SE VAN SUS FOTOS, SU ESTADO Y SUS REPORTES · NO SE PUEDE DESHACER
            </div>
          </div>
        )}
      </ScreenBody>

      <ActionBar>
        <Btn
          variant="ghostDark"
          onClick={onClose}
          style={{ flex: 1, width: 'auto', height: 52, fontSize: 12 }}
        >
          CANCELAR
        </Btn>
        <Btn
          onClick={() => void save()}
          style={{ flex: 1.4, width: 'auto', height: 52, fontSize: 12 }}
        >
          GUARDAR CAMBIOS
        </Btn>
      </ActionBar>
    </Screen>
  )
}

type VehicleDetailsDraft = {
  year: string
  make: string
  model: string
  trim: string
  body: string
  engine: string
}

function DetailInput({
  label,
  value,
  invalid,
  numeric,
  onChange,
}: {
  label: string
  value: string
  invalid?: boolean
  numeric?: boolean
  onChange: (value: string) => void
}) {
  return (
    <label className={s.detailRow}>
      <span className={s.detailLabel}>{label}</span>
      <input
        value={value}
        aria-label={label}
        aria-invalid={Boolean(invalid)}
        inputMode={numeric ? 'numeric' : 'text'}
        onChange={(event) => onChange(numeric
          ? event.target.value.replace(/\D/g, '').slice(0, 4)
          : event.target.value)}
        className={invalid ? `${s.detailInput} ${s.detailInputInvalid}` : s.detailInput}
      />
    </label>
  )
}

/** Pantalla abierta por el chevron de la cabecera de 00b. */
export function EditVehicleDetails({
  details,
  onBack,
  onSave,
}: {
  details: VehicleDetails
  onBack?: () => void
  onSave?: (draft: { year: number; make: string; model: string; trim?: string; body?: string; engine?: string }) => void
}) {
  const [draft, setDraft] = useState<VehicleDetailsDraft>({
    year: details.year === null ? '' : String(details.year),
    make: details.make ?? '',
    model: details.model ?? '',
    trim: details.trim ?? '',
    body: details.body ?? '',
    engine: details.engine ?? '',
  })
  const [submitted, setSubmitted] = useState(false)
  const year = Number(draft.year)
  const invalid = {
    year: !Number.isInteger(year) || year < 1886 || year > new Date().getUTCFullYear() + 2,
    make: !draft.make.trim(),
    model: !draft.model.trim(),
  }
  const set = (field: keyof VehicleDetailsDraft, value: string) =>
    setDraft((current) => ({ ...current, [field]: value }))
  const save = () => {
    setSubmitted(true)
    if (invalid.year || invalid.make || invalid.model) return
    onSave?.({
      year,
      make: draft.make.trim(),
      model: draft.model.trim(),
      trim: draft.trim.trim(),
      body: draft.body.trim(),
      engine: draft.engine.trim(),
    })
  }

  return (
    <Screen>
      <TopStrip title="FLEETHUB_OPS" leading={<BackChevron onClick={onBack} />} trailing={<SyncMeta />} />
      <ScreenBody bottom={96}>
        <VinStrip vin={details.vin} padding="12px 16px" size={13} />
        <SectionLabel style={{ padding: '16px 16px 0' }}>INFORMACIÓN DEL VEHÍCULO</SectionLabel>
        <Card style={{ margin: '8px 16px 0' }}>
          <DetailInput
            label="AÑO" value={draft.year} numeric invalid={submitted && invalid.year}
            onChange={(value) => set('year', value)}
          />
          <DetailInput
            label="MARCA" value={draft.make} invalid={submitted && invalid.make}
            onChange={(value) => set('make', value)}
          />
          <DetailInput
            label="MODELO" value={draft.model} invalid={submitted && invalid.model}
            onChange={(value) => set('model', value)}
          />
          <DetailInput label="TRIM" value={draft.trim} onChange={(value) => set('trim', value)} />
          <DetailInput label="TIPO" value={draft.body} onChange={(value) => set('body', value)} />
          <DetailInput label="MOTOR" value={draft.engine} onChange={(value) => set('engine', value)} />
        </Card>
      </ScreenBody>
      <ActionBar>
        <Btn variant="ghostDark" onClick={onBack} style={{ flex: 1, width: 'auto', height: 52, fontSize: 12 }}>
          CANCELAR
        </Btn>
        <Btn onClick={save} style={{ flex: 1.4, width: 'auto', height: 52, fontSize: 12 }}>
          GUARDAR INFORMACIÓN
        </Btn>
      </ActionBar>
    </Screen>
  )
}
