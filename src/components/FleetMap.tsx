// Live map for the dashboard — MapLibre over OpenStreetMap raster tiles,
// desaturated to sit inside the design's near-monochrome palette.

import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { color, font } from '../design/tokens'
import { stateTone, type Tone, type Vehicle } from '../domain'
import { listPlotted, vehicleStates } from '../data'
import { useData } from '../data/useData'

// Centro provisional de Lake Okeechobee, Florida. La ubicación real del
// dispositivo lo reemplaza apenas responde el navegador.
const CENTER: [number, number] = [-80.79658, 26.94869]
const ZOOM = 13.6

/** Lo que se lee cuando el aparato no puede con el mapa. */
const NO_MAP = 'ESTE APARATO NO PUEDE DIBUJAR EL MAPA · EL RESTO SIGUE FUNCIONANDO'

/**
 * Si este navegador puede dibujar el mapa.
 *
 * Se pregunta antes de construirlo porque MapLibre no avisa como uno esperaría:
 * sin WebGL2 no lanza desde el constructor, emite un evento de error y devuelve
 * un mapa a medio hacer con el que la siguiente línea revienta. Preguntar
 * primero convierte un fallo raro y tardío en una respuesta clara.
 */
function canDrawMaps() {
  try {
    return Boolean(document.createElement('canvas').getContext('webgl2'))
  } catch {
    return false
  }
}

const TONE: Record<Tone, string> = {
  ok: color.okBright,
  warn: color.warnBright,
  danger: '#ff8a80',
  muted: color.inkOnMuted,
}

function tag(text: string, background: string, fg: string) {
  return (
    `<div style="background:${background};color:${fg};font-family:${font.mono};font-size:10px;` +
    `font-weight:600;letter-spacing:1px;padding:5px 8px;white-space:nowrap;">${text}</div>`
  )
}

/**
 * Repaints a marker in place. The selected unit gets the design's crosshair and
 * accent tag; the rest stay small dark tags tinted by status.
 */
function paint(el: HTMLDivElement, unit: Vehicle, state: string, selected: boolean) {
  if (selected) {
    el.style.width = '74px'
    el.style.height = '74px'
    el.innerHTML =
      `<svg width="74" height="74" viewBox="0 0 74 74" fill="none" stroke="${color.accent}" stroke-width="1.5" style="position:absolute;inset:0;">` +
      '<circle cx="37" cy="37" r="24"/><path d="M37 1v16M37 57v16M1 37h16M57 37h16"/></svg>' +
      `<div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);background:${color.accent};color:#fff;` +
      `font-family:${font.mono};font-size:11px;font-weight:600;letter-spacing:1px;padding:6px 9px;white-space:nowrap;">${unit.id}</div>`
  } else {
    el.style.width = 'auto'
    el.style.height = 'auto'
    el.innerHTML = tag(unit.id, color.ink, TONE[stateTone(state)])
  }
}

export function FleetMap({
  selectedId,
  onSelect,
  /** Height the detail sheet covers, so a selected unit is framed above it. */
  bottomInset = 0,
  recenterRef,
  locationEnabled = false,
}: {
  selectedId: string | null
  onSelect: (id: string | null) => void
  bottomInset?: number
  recenterRef?: React.RefObject<(() => void) | null>
  /** La app viva pide el GPS al tocar; la galería permanece inerte. */
  locationEnabled?: boolean
}) {
  const [clock, setClock] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  const units = useData(() => listPlotted(new Date(clock)), [clock]) ?? []
  const states = useData(vehicleStates) ?? {}
  /**
   * The markers are built once and repainted after that — rebuilding them
   * would tear the map down and flicker the tiles. So the effect that builds
   * them keys on which vehicles there are, not on the array, and reads the
   * current ones through a ref.
   */
  const ids = units.map((u) => u.id).join()
  const coordinateKey = units.map((unit) => `${unit.id}:${unit.coords?.join(',')}`).join('|')
  const unitsRef = useRef(units)
  unitsRef.current = units
  /** A fresh object every read, so the effect keys on what is in it. */
  const stateKey = Object.entries(states).flat().join()
  const statesRef = useRef(states)
  statesRef.current = states

  const host = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const elements = useRef(new Map<string, HTMLDivElement>())
  const vehicleMarkers = useRef(new Map<string, maplibregl.Marker>())
  /** Latest callback, so selecting never has to tear the map down. */
  const select = useRef(onSelect)
  select.current = onSelect
  const currentPosition = useRef<[number, number] | null>(null)
  const locating = useRef(false)
  /**
   * Por qué no hay mapa, cuando no lo hay.
   *
   * MapLibre necesita WebGL y hay aparatos que no lo dan: un WebView con la
   * GPU desactivada, una política de empresa, un teléfono viejo. Construir el
   * mapa sin red de seguridad convertía eso en una pantalla de error y en
   * perder también la lista, la ficha y las pestañas, que sí funcionaban.
   */
  const [mapProblem, setMapProblem] = useState<string | null>(null)

  useEffect(() => {
    const el = host.current
    if (!el) return
    let active = true
    locating.current = false
    // Captured for the cleanup: the ref itself must not be read there.
    const nodes = elements.current
    const routeMarkers = vehicleMarkers.current

    if (!canDrawMaps()) {
      setMapProblem(NO_MAP)
      return
    }

    let instance: maplibregl.Map
    try {
      instance = new maplibregl.Map({
        container: el,
        center: CENTER,
        zoom: ZOOM,
        pitch: 0,
        dragRotate: false,
        attributionControl: { compact: true },
        style: {
          version: 8,
          sources: {
            tiles: {
              type: 'raster',
              // Configured per deployment: osm.org's public server carries the
              // development copy, but its usage policy rules out production —
              // a launch sets VITE_TILE_URL to its own provider. Attribution
              // travels with the URL because it belongs to whoever serves it.
              tiles: [import.meta.env.VITE_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
              tileSize: 256,
              attribution:
                import.meta.env.VITE_TILE_ATTRIBUTION ||
                '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            },
          },
          layers: [{ id: 'tiles', type: 'raster', source: 'tiles' }],
        },
      })
    } catch {
      setMapProblem(NO_MAP)
      return
    }
    setMapProblem(null)
    // Opcional por lo mismo: un mapa que se construyó a medias no tiene todos
    // sus controles, y perder la rotación es mejor que perder la pantalla.
    instance.touchZoomRotate?.disableRotation()
    map.current = instance

    let watchId: number | null = null
    let positionMarker: maplibregl.Marker | null = null
    let errorShown = false

    const updatePosition = (position: GeolocationPosition, centre = false) => {
      if (!active) return
      locating.current = false
      errorShown = false
      const center: [number, number] = [position.coords.longitude, position.coords.latitude]
      currentPosition.current = center
      if (!positionMarker) {
        const dot = document.createElement('div')
        dot.setAttribute('aria-label', 'Tu ubicación actual')
        dot.style.cssText =
          `width:18px;height:18px;border-radius:50%;background:${color.accent};` +
          'border:3px solid #fff;box-shadow:0 0 0 2px rgba(0,0,0,.28);'
        positionMarker = new maplibregl.Marker({ element: dot }).setLngLat(center).addTo(instance)
      } else {
        positionMarker.setLngLat(center)
      }
      if (centre) instance.flyTo({ center, zoom: ZOOM })
    }

    const locationError = (error: GeolocationPositionError) => {
      if (!active) return
      locating.current = false
      if (errorShown) return
      errorShown = true
      window.alert(
        error.code === error.PERMISSION_DENIED
          ? 'PERMISO DE UBICACIÓN DENEGADO · ACTÍVALO EN EL NAVEGADOR'
          : 'NO SE PUDO OBTENER TU UBICACIÓN',
      )
    }

    const startTracking = () => {
      if (!locationEnabled || watchId !== null || !navigator.geolocation) return
      watchId = navigator.geolocation.watchPosition(
        (position) => updatePosition(position),
        locationError,
        { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
      )
    }

    const locate = () => {
      if (!locationEnabled) {
        instance.flyTo({ center: CENTER, zoom: ZOOM })
        return
      }
      if (locating.current) return
      if (!navigator.geolocation) {
        window.alert('ESTE DISPOSITIVO NO OFRECE UBICACIÓN')
        return
      }
      // La marca se mantiene al día con watchPosition. CENTRAR usa esa lectura
      // inmediatamente y además pide una nueva para no quedarse donde estabas.
      startTracking()
      if (currentPosition.current) instance.flyTo({ center: currentPosition.current, zoom: ZOOM })
      locating.current = true
      navigator.geolocation.getCurrentPosition(
        (position) => updatePosition(position, true),
        locationError,
        { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
      )
    }

    // Entrar al mapa nace de un gesto del usuario. Aprovechamos ese momento
    // para pedir la ubicación y no enseñar primero una ciudad fija.
    locate()

    // The device frame can finish layout after the Map is constructed, so
    // re-measure or the projection (and every marker) lands in the wrong place.
    const fix = () => instance.resize()
    instance.on('load', fix)
    const t1 = setTimeout(fix, 300)
    const t2 = setTimeout(fix, 1000)
    const ro = new ResizeObserver(fix)
    ro.observe(el)

    const markers = unitsRef.current.map((unit) => {
      const node = document.createElement('div')
      node.style.cssText =
        'position:relative;display:flex;align-items:center;justify-content:center;cursor:pointer;'
      node.setAttribute('role', 'button')
      node.setAttribute('aria-label', `Unidad ${unit.id}`)
      node.addEventListener('click', (e) => {
        e.stopPropagation()
        select.current(unit.id)
      })
      nodes.set(unit.id, node)
      const marker = new maplibregl.Marker({ element: node }).setLngLat(unit.coords!).addTo(instance)
      routeMarkers.set(unit.id, marker)
      return marker
    })

    // Tapping the map itself clears the selection; marker clicks are DOM
    // overlays, so they never reach the canvas and cannot deselect by accident.
    instance.on('click', () => {
      select.current(null)
      locate()
    })

    if (recenterRef) {
      recenterRef.current = locate
    }

    return () => {
      active = false
      locating.current = false
      clearTimeout(t1)
      clearTimeout(t2)
      ro.disconnect()
      if (watchId !== null) navigator.geolocation.clearWatch(watchId)
      positionMarker?.remove()
      markers.forEach((m) => m.remove())
      routeMarkers.clear()
      nodes.clear()
      instance.remove()
      map.current = null
      if (recenterRef) recenterRef.current = null
    }
  }, [recenterRef, ids, locationEnabled])

  // Repaint on selection rather than rebuilding markers, which would drop the
  // map's own state and flicker the tiles.
  useEffect(() => {
    for (const unit of unitsRef.current) {
      const node = elements.current.get(unit.id)
      if (node) paint(node, unit, statesRef.current[unit.id] ?? '', unit.id === selectedId)
    }
  }, [selectedId, ids, stateKey])

  useEffect(() => {
    for (const unit of unitsRef.current) {
      if (unit.coords) vehicleMarkers.current.get(unit.id)?.setLngLat(unit.coords)
    }
  }, [coordinateKey])

  // Keep the selected unit clear of the sheet: padding shifts the map's idea of
  // centre into the strip still showing, so the marker never ends up under it.
  useEffect(() => {
    const instance = map.current
    if (!instance) return
    const unit = unitsRef.current.find((u) => u.id === selectedId)
    if (!unit) {
      instance.easeTo({ padding: { top: 0, right: 0, bottom: 0, left: 0 }, duration: 300 })
      return
    }
    instance.easeTo({
      center: unit.coords!,
      padding: { top: 0, right: 0, bottom: bottomInset, left: 0 },
      duration: 400,
    })
  }, [selectedId, bottomInset, ids, coordinateKey])

  return (
    <>
      {/*
       * Schematic backdrop. It normally sits unseen under the tiles, and only
       * shows through where they are missing — offline, or on a host that
       * blocks tile.openstreetmap.org — so the map degrades to a grid instead
       * of a blank grey rectangle.
       */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `repeating-linear-gradient(0deg, ${color.border} 0 1px, transparent 1px 34px),
                       repeating-linear-gradient(90deg, ${color.border} 0 1px, transparent 1px 34px),
                       ${color.surfaceAlt}`,
          opacity: 0.55,
        }}
      />
      <div
        ref={host}
        style={{
          position: 'absolute',
          inset: 0,
          filter: 'grayscale(.92) contrast(1.04) brightness(1.03)',
        }}
      />
      {mapProblem && (
        <div
          role="status"
          style={{
            position: 'absolute',
            insetInline: 16,
            top: 16,
            padding: '10px 12px',
            border: `1px solid ${color.border}`,
            background: color.surface,
            fontFamily: 'var(--fh-font-mono)',
            fontSize: 9,
            letterSpacing: 1.2,
            color: color.muted,
          }}
        >
          {mapProblem}
        </div>
      )}
    </>
  )
}
