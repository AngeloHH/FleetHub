// Qué es una alerta: una regla leída sobre la telemetría, no una tarjeta
// guardada. La flota no almacena que una unidad está en alerta — almacena que
// lleva 45 minutos a velocidad cero, y la regla de aquí decide que eso es una
// detención que alguien debe mirar. Descartarla sí es un hecho que se guarda:
// alguien la vio y la dio por atendida, con su hora y su nombre.

import type { Vehicle } from './types'
import { timeLabel } from './clock'

export type FleetAlert = {
  /** Estable mientras la condición siga: la unidad y el tipo. Descartar por
   *  id significa descartar ESTA condición, no la unidad para siempre. */
  id: string
  unit: string
  tone: 'danger' | 'warn'
  severity: string
  /** La hora en que empezó lo que la alerta cuenta, como la dibuja 04. */
  time: string
  title: string
  detail: string
  /** Lo que ofrece el botón primario, como lo rotula el diseño. */
  primary: string
}

/** Minutos parada a partir de los cuales una unidad en ruta es una alerta. */
export const STOPPED_AFTER = 30
/** Minutos sin reportar a partir de los cuales el silencio es una alerta. */
export const SILENT_AFTER = 120

/**
 * Las alertas activas de una flota, leídas de la telemetría de cada unidad.
 *
 * El orden es el del diseño: lo crítico antes que lo medio, y dentro de cada
 * tono la más reciente primero. `latestState` trae el último estado fijado por
 * unidad, porque una unidad VENDIDA o EN SERVICIO parada no es una detención —
 * es exactamente lo que se espera de ella.
 */
export function fleetAlerts(
  vehicles: Vehicle[],
  latestState: Record<string, string>,
  now: Date = new Date(),
  unassigned: ReadonlySet<string> = new Set(),
): FleetAlert[] {
  const alerts: FleetAlert[] = []
  const since = (min: number) => new Date(now.getTime() - min * 60_000)

  for (const v of vehicles) {
    const state = latestState[v.id]
    const resting = state === 'VENDIDO' || state === 'EN SERVICIO' || state === 'EN TALLER'

    if (unassigned.has(v.id)) {
      alerts.push({
        id: `${v.id}·sin-location`,
        unit: v.id,
        tone: 'warn',
        severity: 'MEDIA · SIN RUTA/PUNTO',
        time: timeLabel(now),
        title: `${v.id} · ${v.model.toUpperCase()} sin ruta/punto asignado`,
        detail: 'LA UNIDAD NO ESTÁ ASIGNADA A NINGUNA LOCATION',
        primary: 'VER UNIDAD',
      })
    }

    if (state === 'NO ENCONTRADO') {
      alerts.push({
        id: `${v.id}·perdida`,
        unit: v.id,
        tone: 'danger',
        severity: 'CRÍTICA · SIN LOCALIZAR',
        time: timeLabel(since(v.signalMin ?? 0)),
        title: `${v.id} · ${v.model.toUpperCase()} sin localizar`,
        detail: `ÚLTIMA POSICIÓN: ${v.position.toUpperCase()}`,
        primary: 'ÚLTIMA POSICIÓN',
      })
      continue
    }

    if ((v.signalMin ?? 0) >= SILENT_AFTER) {
      const hours = Math.floor((v.signalMin ?? 0) / 60)
      alerts.push({
        id: `${v.id}·señal`,
        unit: v.id,
        tone: 'warn',
        severity: 'MEDIA · SIN SEÑAL GPS',
        time: timeLabel(since(v.signalMin ?? 0)),
        title: `${v.id} · ${v.model.toUpperCase()} sin reportar hace ${hours} h`,
        detail: `ÚLTIMA POSICIÓN: ${v.position.toUpperCase()}`,
        primary: 'ÚLTIMA POSICIÓN',
      })
      continue
    }

    // Parada con señal viva: el GPS sigue contando, la unidad no se mueve, y
    // nadie la dio por descansando. Los patios y talleres no alertan.
    if (v.speedKmh === 0 && !resting && (v.signalMin ?? 0) >= STOPPED_AFTER) {
      alerts.push({
        id: `${v.id}·detenida`,
        unit: v.id,
        tone: 'danger',
        severity: 'CRÍTICA · DETENCIÓN PROLONGADA',
        time: timeLabel(since(v.signalMin ?? 0)),
        title: `${v.id} · ${v.model.toUpperCase()} lleva ${v.signalMin} min detenida`,
        detail: `${v.position.toUpperCase()} · MOTOR APAGADO · SIN RESPUESTA DEL OPERADOR`,
        primary: 'VER EN MAPA',
      })
    }
  }

  return alerts.sort((a, b) =>
    a.tone === b.tone ? a.time.localeCompare(b.time) : a.tone === 'danger' ? -1 : 1,
  )
}
