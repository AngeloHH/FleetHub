// Screens 01 and 02 — the VIN camera and the OCR result.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { color } from '../design/tokens'
import { Bolt, CameraShutter, Check, ChevronDown, Lines, Save } from '../components/icons'
import {
  BackChevron,
  Btn,
  Card,
  Screen,
  ScreenBody,
  SectionLabel,
  StripMeta,
  SyncMeta,
  TopStrip,
} from '../components/ui'
import s from './scan.module.css'
import { pressable } from '../lib/press'
import { TextField } from '../components/form'
import { isValidVin, normalizeVin, VIN_LENGTH } from '../domain'
import { prepareVehicle, saveVehicleDetails, type VehicleDetails } from '../data'
import { frameUnder, readerAvailable, readVin } from '../lib/ocr'

const VIN = 'JT2BF22K1W0127K2310'

// ── 01 · Escaneo VIN ────────────────────────────────────────────────────────

function ViewfinderControl({
  icon,
  label,
  onPress,
}: {
  icon: ReactNode
  label: string
  onPress?: () => void
}) {
  return (
    <div
      {...pressable(onPress)}
      aria-label={onPress ? label : undefined}
      className={s.control}
    >
      <div className={s.controlKey}>{icon}</div>
      <span className={s.controlLabel}>{label}</span>
    </div>
  )
}

/** One of the four orange brackets framing the VIN plate. */
function Corner({ x, y }: { x: 'left' | 'right'; y: 'top' | 'bottom' }) {
  const edge = `3px solid ${color.accent}`
  const left = x === 'left'
  const top = y === 'top'
  return (
    <div
      style={{
        position: 'absolute',
        left: left ? 0 : undefined,
        right: left ? undefined : 0,
        top: top ? 0 : undefined,
        bottom: top ? undefined : 0,
        width: 34,
        height: 34,
        borderLeft: left ? edge : undefined,
        borderRight: left ? undefined : edge,
        borderTop: top ? edge : undefined,
        borderBottom: top ? undefined : edge,
      }}
    />
  )
}

/** Dónde está la cámara: pidiéndose, en vivo, negada, o sin haberla. */
type CameraState = 'idle' | 'asking' | 'live' | 'denied' | 'none'

export function ScanVin({
  onBack,
  onDetected,
  onManual,
}: {
  onBack?: () => void
  /** Un VIN leído del cuadro — un código de barras que decía uno válido. */
  onDetected?: (vin: string) => void
  onManual?: () => void
} = {}) {
  // La copia de la galería no lleva handlers, y tampoco debe pedir permisos:
  // un libro de estampas que enciende tu cámara al abrirse es un susto, no
  // una referencia. Sólo la app viva pregunta.
  const live = Boolean(onDetected || onManual)
  const video = useRef<HTMLVideoElement | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const [camera, setCamera] = useState<CameraState>('idle')
  const [miss, setMiss] = useState<string | null>(null)
  /** Qué hace el lector: aún nada, buscando cuadro a cuadro, o no lo hay. */
  const [reading, setReading] = useState<'idle' | 'looking' | 'unavailable'>('idle')
  const plateRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!live) return
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera('none')
      return
    }
    let alive = true
    setCamera('asking')
    navigator.mediaDevices
      /*
       * Se pide resolución, y se pide alta.
       *
       * Sin pedirla, el navegador da su gusto — en muchos teléfonos 640×480.
       * El VIN del parabrisas es una placa pequeña que ocupa un tercio del
       * encuadre, así que a esa resolución sus caracteres miden diez o doce
       * píxeles de alto y el lector necesita treinta. Por debajo de eso no lee
       * mal: es que no hay nada que leer, y ampliar el recorte después no
       * inventa el detalle que la cámara no capturó.
       *
       * `ideal` y no `exact` a propósito: una cámara que no llegue da lo que
       * pueda en vez de negarse, que es preferible a quedarse sin visor.
       */
      .getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      })
      .then((got) => {
        if (!alive) {
          got.getTracks().forEach((t) => t.stop())
          return
        }
        stream.current = got
        if (video.current) video.current.srcObject = got
        setCamera('live')
      })
      .catch(() => alive && setCamera('denied'))
    return () => {
      alive = false
      stream.current?.getTracks().forEach((t) => t.stop())
      stream.current = null
    }
  }, [live])

  /** Un cuadro del trozo que cae bajo el marco, listo para leer. */
  const frame = () => {
    const el = video.current
    const plate = plateRef.current?.getBoundingClientRect()
    const screen = el?.parentElement?.getBoundingClientRect()
    if (!el || !plate || !screen) return null
    return frameUnder(el, plate, screen)
  }

  /**
   * El bucle: mientras la cámara está en vivo, el visor lee el marco cuadro a
   * cuadro — los números estampados, no un código de barras — y en cuanto un
   * cuadro contiene un VIN válido, el visor avanza solo. Un cuadro cada
   * segundo y nunca dos a la vez: leer cuesta más que mirar.
   */
  useEffect(() => {
    if (camera !== 'live' || !onDetected) return
    let alive = true
    let busy = false
    void readerAvailable().then((yes) => {
      if (alive) setReading(yes ? 'looking' : 'unavailable')
    })
    const tick = setInterval(async () => {
      if (busy || !alive) return
      busy = true
      try {
        const shot = frame()
        const vin = shot && (await readVin(shot))
        if (vin && alive) {
          clearInterval(tick)
          onDetected(vin)
        }
      } finally {
        busy = false
      }
    }, 1000)
    return () => {
      alive = false
      clearInterval(tick)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, onDetected])

  /** CAPTURAR: una lectura ahora mismo, con respuesta — el bucle calla, el
   *  botón contesta. Sin cámara, la salida es MANUAL. */
  const capture = async () => {
    setMiss(null)
    const offerManual = (message: string) => {
      setMiss(message)
      if (window.confirm(`${message}\n\nACEPTAR: ESCRIBIR EL VIN MANUALMENTE\nCANCELAR: REINTENTAR`))
        onManual?.()
    }
    if (camera !== 'live') {
      offerManual(
        camera === 'denied'
          ? 'NO SE PUDO USAR LA CÁMARA'
          : 'NO SE ENCONTRÓ UN VIN VÁLIDO',
      )
      return
    }
    try {
      const shot = frame()
      const vin = shot && (await readVin(shot))
      if (vin) onDetected?.(vin)
      else if (reading === 'unavailable') offerManual('LECTOR DE VIN NO DISPONIBLE')
      else offerManual('NO SE ENCONTRÓ UN VIN VÁLIDO')
    } catch {
      offerManual('NO SE ENCONTRÓ UN VIN VÁLIDO')
    }
  }

  return (
    <Screen background="#0d0e0c">
      <div className={s.lens} />
      {live && camera === 'live' && (
        <video
          // El stream se engancha aquí y no donde resolvió el permiso: este
          // elemento sólo existe cuando camera es live, así que en aquel
          // momento video.current era null y el feed se quedaba en negro —
          // en un teléfono de verdad, no sólo en los tests.
          ref={(el) => {
            video.current = el
            if (el && stream.current && el.srcObject !== stream.current) {
              el.srcObject = stream.current
              void el.play?.()?.catch?.(() => {})
            }
          }}
          autoPlay
          playsInline
          muted
          className={s.feed}
        />
      )}

      <TopStrip
        title="FLEETHUB_OPS"
        leading={
          <BackChevron onClick={onBack} />
        }
        trailing={
          live && camera !== 'live' ? (
            <StripMeta>
              {camera === 'denied'
                ? 'CÁMARA DENEGADA'
                : camera === 'none'
                  ? 'SIN CÁMARA'
                  : 'PIDIENDO CÁMARA…'}
            </StripMeta>
          ) : (
            <SyncMeta />
          )
        }
      />

      <div className={s.hintRow}>
        <div className={s.hint}>FOTOGRAFÍA EL VIN · PARABRISAS O MARCO DE PUERTA</div>
      </div>

      <div ref={plateRef} className={s.plate}>
        <Corner x="left" y="top" />
        <Corner x="right" y="top" />
        <Corner x="left" y="bottom" />
        <Corner x="right" y="bottom" />
        <div className={s.plateEdge} style={{ animation: 'fh-focus 2.4s ease-in-out infinite' }} />
        {/* La placa dibujada es la referencia del diseño y el telón de un
            visor sin cámara. Con la cámara en vivo el marco enmarca al mundo,
            no a un VIN pintado. */}
        {camera !== 'live' && (
          <div className={s.plateVin}>
            <span className={s.plateVinText}>{VIN}</span>
          </div>
        )}
      </div>

      <div className={s.aim}>
        <span className={s.aimText} style={miss ? { color: color.accent } : undefined}>
          {miss ??
            (reading === 'looking'
              ? 'LEYENDO LOS NÚMEROS · MANTÉN EL VIN DENTRO DEL MARCO'
              : reading === 'unavailable'
                ? 'LECTOR NO DISPONIBLE · USA MANUAL'
                : 'MANTÉN EL CÓDIGO DENTRO DEL MARCO')}
        </span>
      </div>

      <div className={s.controls}>
        <div className={s.controlsRow}>
          <ViewfinderControl icon={<Bolt size={20} color={color.inkOnMuted} />} label="FLASH" />

          <div
            {...pressable(live ? () => void capture() : undefined)}
            aria-label={live ? 'CAPTURAR' : undefined}
            className={s.shutter}
          >
            <div className={s.shutterRing}>
              <div className={s.shutterKey}>
                <CameraShutter size={26} color="#fff" />
              </div>
            </div>
            <span className={s.shutterLabel}>CAPTURAR</span>
          </div>

          <ViewfinderControl
            icon={<Lines size={20} color={color.inkOnMuted} />}
            label="MANUAL"
            onPress={onManual}
          />
        </div>
      </div>
    </Screen>
  )
}

// ── 02 · Confirmación ───────────────────────────────────────────────────────

function SpecRow({ label, children, last }: { label: string; children: ReactNode; last?: boolean }) {
  return (
    <div
      className={s.specRow}
      style={{ borderBottom: last ? undefined : `1px solid ${color.borderSoft}` }}
    >
      <span className={s.specLabel}>{label}</span>
      {children}
    </div>
  )
}

function SpecValue({ children }: { children: ReactNode }) {
  return <span className={s.specValue}>{children}</span>
}

function CardHeader({ children }: { children: ReactNode }) {
  return (
    <div className={s.cardHeader}>{children}</div>
  )
}

type ManualDetails = {
  year: string
  make: string
  model: string
  trim: string
  body: string
  engine: string
}

const EMPTY_DETAILS: ManualDetails = {
  year: '', make: '', model: '', trim: '', body: '', engine: '',
}

function ManualSpecRow({
  label,
  value,
  onChange,
  last,
  numeric,
  invalid,
  onBlur,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  last?: boolean
  numeric?: boolean
  invalid?: boolean
  onBlur?: () => void
}) {
  return (
    <SpecRow label={label} last={last}>
      <input
        className={`${s.manualSpecInput} ${invalid ? s.manualSpecInputInvalid : ''}`}
        aria-label={label}
        aria-invalid={Boolean(invalid)}
        value={value}
        inputMode={numeric ? 'numeric' : 'text'}
        onBlur={onBlur}
        onChange={(event) => onChange(numeric ? event.target.value.replace(/\D/g, '').slice(0, 4) : event.target.value)}
      />
    </SpecRow>
  )
}

/** Lo que 02 entrega al guardar: la ficha decodificada y, si la dieron, dónde. */
export type SaveDraft = {
  model?: string
  spec?: string
  /** El grupo elegido en la ficha, si la empresa nombra alguno. */
  zone?: string
  coords?: [number, number]
  accuracy?: number | null
  /** La ubicación se pidió y no llegó — el aviso lo dice al guardar. */
  noPosition?: boolean
}

export function VinConfirm({
  vin,
  source = 'ocr',
  unitId,
  zone,
  onPickZone,
  onRetry,
  onSave,
  onBack,
}: {
  /** Ausente es la copia de la galería: dibuja la ficha literal del diseño y
   *  no llama a nadie — ni a la API ni al GPS. */
  vin?: string
  /** Typed VINs carry no confidence figure — there was no reading to score. */
  source?: 'ocr' | 'manual'
  /** La matrícula que recibirá si es nueva, derivada donde están las filas. */
  unitId?: string
  /** El grupo al que quedará asignada — una zona de la empresa, o ninguna. */
  zone?: string
  /** Pasa al siguiente grupo. Ausente cuando no hay entre qué elegir. */
  onPickZone?: () => void
  onRetry?: () => void
  onSave?: (draft: SaveDraft) => void
  onBack?: () => void
} = {}) {
  const live = Boolean(vin)
  const shown = vin ?? VIN
  const [vehicle, setVehicle] = useState<VehicleDetails | null>(null)
  const [manualRequired, setManualRequired] = useState(false)
  const [decodeError, setDecodeError] = useState<string | null>(null)
  const [manual, setManual] = useState<ManualDetails>(EMPTY_DETAILS)
  const [problem, setProblem] = useState<string | null>(null)
  const [loading, setLoading] = useState(live)
  const [saving, setSaving] = useState(false)
  const [manualTouched, setManualTouched] = useState<Partial<Record<'year' | 'make' | 'model', boolean>>>({})

  useEffect(() => {
    if (!live || !vin) return
    let alive = true
    setVehicle(null)
    setManualRequired(false)
    setDecodeError(null)
    setManual(EMPTY_DETAILS)
    setManualTouched({})
    setProblem(null)
    setLoading(true)
    void prepareVehicle(vin).then((result) => {
      if (!alive) return
      setLoading(false)
      if (!result.ok) {
        setProblem(result.reason)
        return
      }
      setVehicle(result.value.vehicle)
      setManualRequired(result.value.manualRequired)
      setDecodeError(result.value.decodeError)
    })
    return () => {
      alive = false
    }
  }, [live, vin])

  /**
   * Guardar pide primero la ubicación: la unidad debe quedar donde de verdad
   * está, que es donde está quien la tiene delante. Negada o sin GPS, se
   * guarda igual — sin posición y diciéndolo — porque el registro de la
   * mirada vale por sí solo.
   */
  const save = async () => {
    if (saving) return
    setSaving(true)
    setProblem(null)
    let details = vehicle
    if (manualRequired && vin) {
      const year = Number(manual.year)
      if (!Number.isInteger(year) || !manual.make.trim() || !manual.model.trim()) {
        setManualTouched({ year: true, make: true, model: true })
        setProblem('COMPLETA AÑO, MARCA Y MODELO')
        setSaving(false)
        return
      }
      const result = await saveVehicleDetails(vin, {
        year,
        make: manual.make.trim(),
        model: manual.model.trim(),
        trim: manual.trim.trim(),
        body: manual.body.trim(),
        engine: manual.engine.trim(),
      })
      if (!result.ok) {
        setProblem(result.reason)
        setSaving(false)
        return
      }
      details = result.value
      setVehicle(details)
      setManualRequired(false)
    }
    if (live && !details) {
      setProblem(problem ?? 'ESPERA LA RESPUESTA DEL SERVIDOR')
      setSaving(false)
      return
    }
    const spec = details
      ? [details.trim, details.body, details.year].filter(Boolean).join(' · ') || undefined
      : undefined
    const model = details
      ? [details.make, details.model].filter(Boolean).join(' ') || undefined
      : undefined
    const finish = (coords?: [number, number], accuracy?: number | null) =>
      onSave?.({ model, spec, zone, coords, accuracy, noPosition: !coords })
    if (!navigator.geolocation) {
      finish()
      return
    }
    navigator.geolocation.getCurrentPosition(
      (at) => finish(
        [at.coords.longitude, at.coords.latitude],
        Number.isFinite(at.coords.accuracy) ? at.coords.accuracy : null,
      ),
      () => finish(),
      { timeout: 8000, maximumAge: 60_000 },
    )
  }

  const card = live
    ? {
        make: vehicle?.make ?? '…', model: vehicle?.model ?? '…', year: vehicle?.year ?? '…',
        trim: vehicle?.trim ?? '—', body: vehicle?.body ?? '—', engine: vehicle?.engine ?? '—',
      }
    : { make: 'TOYOTA', model: 'COROLLA', year: 2021, trim: 'LE', body: 'SEDÁN 4P', engine: '1.8L L4' }
  const setManualField = (field: keyof ManualDetails, value: string) =>
    setManual((current) => ({ ...current, [field]: value }))
  const requiredMissing = {
    year: !manual.year.trim(),
    make: !manual.make.trim(),
    model: !manual.model.trim(),
  }
  const touchManual = (field: 'year' | 'make' | 'model') =>
    setManualTouched((current) => ({ ...current, [field]: true }))

  return (
    <Screen>
      <TopStrip
        title={source === 'ocr' ? 'RESULTADO_OCR' : 'CAPTURA_MANUAL'}
        leading={
          <BackChevron onClick={onBack} />
        }
        trailing={<SyncMeta />}
      />

      <ScreenBody bottom={0} style={{ paddingBottom: 110 }}>
        <div className={s.readout}>
          <div>
            <SectionLabel className={s.readoutLabel}>
              {source === 'ocr' ? 'VIN DETECTADO' : 'VIN CAPTURADO'}
            </SectionLabel>
            <div className={s.readoutVin}>{shown}</div>
          </div>
          <Check size={24} color={color.okBright} width={2.2} />
        </div>

        <Card style={{ margin: '0 16px' }}>
          <CardHeader>
            {manualRequired
              ? decodeError === 'DECODER_UNAVAILABLE'
                ? 'NHTSA NO RESPONDIÓ · COMPLETA LA FICHA'
                : 'NHTSA RESPONDIÓ SIN DATOS SUFICIENTES · COMPLETA LA FICHA'
              : loading
                ? 'CONSULTANDO NHTSA…'
                : vehicle?.decodeStatus === 'manual'
                  ? 'DATOS CAPTURADOS MANUALMENTE'
                  : 'DECODIFICACIÓN NHTSA'}
          </CardHeader>
          {manualRequired ? (
            <>
              <ManualSpecRow
                label="AÑO" value={manual.year} numeric
                invalid={manualTouched.year && requiredMissing.year}
                onBlur={() => touchManual('year')}
                onChange={(value) => setManualField('year', value)}
              />
              <ManualSpecRow
                label="MARCA" value={manual.make}
                invalid={manualTouched.make && requiredMissing.make}
                onBlur={() => touchManual('make')}
                onChange={(value) => setManualField('make', value)}
              />
              <ManualSpecRow
                label="MODELO" value={manual.model}
                invalid={manualTouched.model && requiredMissing.model}
                onBlur={() => touchManual('model')}
                onChange={(value) => setManualField('model', value)}
              />
              <ManualSpecRow label="TRIM" value={manual.trim} onChange={(value) => setManualField('trim', value)} />
              <ManualSpecRow label="TIPO" value={manual.body} onChange={(value) => setManualField('body', value)} />
              <ManualSpecRow label="MOTOR" value={manual.engine} last onChange={(value) => setManualField('engine', value)} />
            </>
          ) : (
            <>
              <SpecRow label="MARCA"><SpecValue>{card.make}</SpecValue></SpecRow>
              <SpecRow label="MODELO"><SpecValue>{card.model}</SpecValue></SpecRow>
              <SpecRow label="AÑO"><SpecValue>{card.year}</SpecValue></SpecRow>
              <SpecRow label="TRIM"><SpecValue>{card.trim}</SpecValue></SpecRow>
              <SpecRow label="TIPO"><SpecValue>{card.body}</SpecValue></SpecRow>
              <SpecRow label="MOTOR" last><SpecValue>{card.engine}</SpecValue></SpecRow>
            </>
          )}
        </Card>

        {problem && <div className={s.decodeProblem}>{problem}</div>}

        <Card style={{ margin: '14px 16px 0' }}>
          <CardHeader>ASIGNACIÓN</CardHeader>
          <SpecRow label="ID UNIDAD">
            <span className={s.unitId}>{live ? `${unitId ?? '—'} (AUTO)` : '— (AUTO)'}</span>
          </SpecRow>
          <SpecRow label="GRUPO" last>
            {live ? (
              <span
                className={s.group}
                {...pressable(onPickZone)}
                aria-label={onPickZone ? `Grupo: ${zone || 'SIN GRUPO'} · cambiar` : undefined}
              >
                {zone || 'SIN GRUPO'}
                {/* El galón sólo donde hay entre qué elegir: una empresa recién
                    nacida no tiene grupos, y prometer un menú vacío es mentir. */}
                {onPickZone && <ChevronDown size={13} color={color.muted} />}
              </span>
            ) : (
              <span className={s.group}>
                CDMX NORTE <ChevronDown size={13} color={color.muted} />
              </span>
            )}
          </SpecRow>
        </Card>

        <div className={s.footer}>
          <Btn
            variant="inkOutline"
            onClick={onRetry}
            style={{ flex: 1, width: 'auto', fontSize: 12, letterSpacing: 1.5 }}
          >
            REINTENTAR
          </Btn>
          <Btn
            onClick={onSave && save}
            style={{
              flex: 1.4,
              width: 'auto',
              fontSize: 12,
              letterSpacing: 1.5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <Save size={15} />
            {saving ? 'GUARDANDO…' : loading ? 'CONSULTANDO VIN…' : 'GUARDAR UNIDAD'}
          </Btn>
        </div>
      </ScreenBody>
    </Screen>
  )
}

// ── 01b · Captura manual ────────────────────────────────────────────────────

/**
 * The fallback behind the viewfinder's MANUAL control: one field, nothing else.
 * As soon as what has been typed is a valid VIN it hands over to screen 02 —
 * there is no confirm button because reaching seventeen valid characters is
 * itself the confirmation.
 */
export function ManualVin({
  onDetected,
  onBack,
}: {
  onDetected?: (vin: string) => void
  onBack?: () => void
} = {}) {
  const [vin, setVin] = useState('')
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (isValidVin(vin)) onDetected?.(vin)
  }, [vin, onDetected])

  return (
    <Screen>
      <TopStrip
        title="FLEETHUB_OPS"
        leading={
          <BackChevron onClick={onBack} />
        }
        trailing={<StripMeta>SIN CÁMARA</StripMeta>}
      />

      <div className={s.manual}>
        <div className={s.manualTitle}>Escribe el VIN</div>

        <TextField
          label="NÚMERO DE IDENTIFICACIÓN"
          value={vin}
          onChange={(v) => setVin(normalizeVin(v))}
          placeholder={'\u00B7'.repeat(VIN_LENGTH)}
          autoComplete="off"
          mono
          style={{ marginTop: 20 }}
          focused={focused}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />

        <div className={s.counter}>
          <span>{VIN_LENGTH} CARACTERES · SIN I, O NI Q</span>
          <span style={{ color: vin.length === VIN_LENGTH ? color.ok : color.muted }}>
            {vin.length} / {VIN_LENGTH}
          </span>
        </div>
      </div>
    </Screen>
  )
}
