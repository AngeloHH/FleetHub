import { randomUUID } from 'node:crypto'
import { sameCompany } from './company.mjs'

export const VEHICLE_STATES = Object.freeze([
  { id: 1, name: 'EN RUTA', note: 'EN CAMINO', tone: 'ok' },
  { id: 2, name: 'CON DEPÓSITO', note: 'CON ANTICIPO', tone: 'warn' },
  { id: 3, name: 'EN SERVICIO', note: 'TALLER', tone: 'warn' },
  { id: 0, name: 'NO ENCONTRADO', note: 'SIN LOCALIZAR', tone: 'danger' },
  { id: 4, name: 'VENDIDO', note: 'CIERRA EL EXPEDIENTE', tone: 'muted' },
])

const STATE_IDS = new Set(VEHICLE_STATES.map((state) => state.id))
const VIN = /^[A-HJ-NPR-Z0-9]{17}$/
const clean = (value) => String(value ?? '').trim()
const normalizedVin = (value) => clean(value).toUpperCase()
const manualDetails = (details = {}) => ({
  year: details.year === null || details.year === undefined || details.year === '' ? null : Number(details.year),
  make: clean(details.make) || null,
  model: clean(details.model) || null,
  trim: clean(details.trim) || null,
  body: clean(details.body) || null,
  engine: clean(details.engine) || null,
})

/** Vehículos identificados únicamente por su VIN. */
export class Vehicles {
  constructor(rows, { save, now, companyId = null } = {}) {
    this.rows = rows ?? {}
    this.rows.vehicles ??= []
    this.rows.vehiclePositions ??= []
    this.rows.vehicleLocations ??= []
    this.rows.events ??= []
    this.rows.dismissals ??= []
    this.rows.photos ??= []
    this.save = save ?? (() => {})
    this.now = now ?? (() => new Date())
    this.companyId = companyId
  }

  belongs(row) {
    return this.companyId === null || sameCompany(row?.companyId, this.companyId)
  }

  create(vin, { companyId = this.companyId } = {}) {
    const identity = normalizedVin(vin)
    if (!VIN.test(identity)) return { ok: false, error: 'INVALID_VIN' }
    const known = this.find(identity)
    if (known) return { ok: true, created: false, vehicle: this.view(known) }

    const at = this.now().toISOString()
    const row = {
      vin: identity,
      companyId,
      state: null,
      decodeStatus: null,
      decodedAt: null,
      decoder: null,
      year: null,
      make: null,
      model: null,
      trim: null,
      body: null,
      engine: null,
      createdAt: at,
      updatedAt: at,
    }
    this.rows.vehicles.push(row)
    this.save()
    return { ok: true, created: true, vehicle: this.view(row) }
  }

  find(vin) {
    const identity = normalizedVin(vin)
    return this.rows.vehicles.find((row) => row.vin === identity && this.belongs(row))
  }

  get(vin) {
    const row = this.find(vin)
    return row ? this.view(row) : undefined
  }

  list() {
    return this.rows.vehicles.filter((row) => this.belongs(row)).map((row) => this.view(row))
  }

  setDecoded(vin, details = {}, { decoder } = {}) {
    const row = this.find(vin)
    if (!row) return { ok: false, error: 'VEHICLE_NOT_FOUND' }
    const normalized = manualDetails(details)
    const { year } = normalized
    if (year !== null && (!Number.isInteger(year) || year < 1886 || year > this.now().getUTCFullYear() + 2))
      return { ok: false, error: 'INVALID_YEAR' }
    if (!year || !normalized.make || !normalized.model)
      return { ok: false, error: 'INCOMPLETE_DECODE' }

    const at = this.now().toISOString()
    Object.assign(row, {
      ...normalized,
      decoder: clean(decoder) || null,
      decodeStatus: 'decoded',
      decodedAt: at,
      updatedAt: at,
    })
    this.save()
    return { ok: true, vehicle: this.view(row) }
  }

  requireManualDetails(vin) {
    const row = this.find(vin)
    if (!row) return { ok: false, error: 'VEHICLE_NOT_FOUND' }
    row.decodeStatus = 'manual-required'
    row.decodedAt = null
    row.decoder = null
    row.updatedAt = this.now().toISOString()
    this.save()
    return { ok: true, vehicle: this.view(row) }
  }

  setManualDetails(vin, details = {}) {
    const row = this.find(vin)
    if (!row) return { ok: false, error: 'VEHICLE_NOT_FOUND' }
    if (!['manual-required', 'manual'].includes(row.decodeStatus))
      return { ok: false, error: 'MANUAL_DETAILS_NOT_REQUIRED' }
    const normalized = manualDetails(details)
    const { year } = normalized
    if (!Number.isInteger(year) || year < 1886 || year > this.now().getUTCFullYear() + 2)
      return { ok: false, error: 'INVALID_YEAR' }
    if (!normalized.make || !normalized.model)
      return { ok: false, error: 'MISSING_VEHICLE_DETAILS' }

    Object.assign(row, normalized, {
      decodeStatus: 'manual', decodedAt: null, decoder: null,
      updatedAt: this.now().toISOString(),
    })
    this.save()
    return { ok: true, vehicle: this.view(row) }
  }

  /** Una corrección explícita del operador reemplaza los datos decodificados. */
  updateDetails(vin, details = {}) {
    const row = this.find(vin)
    if (!row) return { ok: false, error: 'VEHICLE_NOT_FOUND' }
    const normalized = manualDetails(details)
    const { year } = normalized
    if (!Number.isInteger(year) || year < 1886 || year > this.now().getUTCFullYear() + 2)
      return { ok: false, error: 'INVALID_YEAR' }
    if (!normalized.make || !normalized.model)
      return { ok: false, error: 'MISSING_VEHICLE_DETAILS' }

    Object.assign(row, normalized, {
      decodeStatus: 'manual', decodedAt: null, decoder: null,
      updatedAt: this.now().toISOString(),
    })
    this.save()
    return { ok: true, vehicle: this.view(row) }
  }

  setState(vin, state, { changedBy } = {}) {
    const row = this.find(vin)
    if (!row) return { ok: false, error: 'VEHICLE_NOT_FOUND' }
    if (state !== null && (!Number.isInteger(state) || !STATE_IDS.has(state)))
      return { ok: false, error: 'INVALID_STATE' }
    if (row.state === state) return { ok: true, changed: false, vehicle: this.view(row) }

    const at = this.now().toISOString()
    const previousState = row.state
    row.state = state
    row.updatedAt = at
    this.rows.events.unshift({
      id: randomUUID(), companyId: row.companyId ?? this.companyId, vin: row.vin, userId: changedBy ?? null,
      kind: 'state', previousState, state, createdAt: at,
    })
    this.save()
    return { ok: true, changed: true, vehicle: this.view(row) }
  }

  reportPosition(vin, position = {}, { reportedBy } = {}) {
    const row = this.find(vin)
    if (!row) return { ok: false, error: 'VEHICLE_NOT_FOUND' }
    const latitude = Number(position.latitude)
    const longitude = Number(position.longitude)
    const accuracy = position.accuracy === undefined || position.accuracy === null
      ? null
      : Number(position.accuracy)
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
        (accuracy !== null && (!Number.isFinite(accuracy) || accuracy < 0)))
      return { ok: false, error: 'INVALID_POSITION' }

    const createdAt = this.now().toISOString()
    const report = {
      id: randomUUID(), companyId: row.companyId ?? this.companyId, vin: row.vin, latitude, longitude, accuracy,
      reportedBy: reportedBy ?? null, createdAt,
    }
    this.rows.vehiclePositions.unshift(report)
    this.save()
    return { ok: true, position: { ...report }, vehicle: this.view(row) }
  }

  latestPosition(vin) {
    const identity = normalizedVin(vin)
    const report = this.rows.vehiclePositions.find((row) => row.vin === identity && this.belongs(row))
    return report ? { ...report } : null
  }

  /**
   * Saca una unidad de la flota de esta empresa.
   *
   * No borra el vehiculo del mundo: la clave de la tabla es la empresa mas el
   * VIN, asi que lo que se va es la fila de quien lo pide. Otra empresa que
   * tenga esa misma unidad la conserva entera, con su historial y sus fotos.
   *
   * Lo que si se va del todo es la relacion: los escaneos, el rastro de GPS,
   * las alertas descartadas y las fotografias. Devuelve los nombres de archivo
   * de esas fotografias porque aqui no se toca disco -- quien llama sabe donde
   * viven los objetos y las borra despues de confirmar.
   */
  remove(vin) {
    const identity = normalizedVin(vin)
    const index = this.rows.vehicles.findIndex((row) => row.vin === identity && this.belongs(row))
    if (index < 0) return { ok: false, error: 'VEHICLE_NOT_FOUND' }
    const orphanedPhotos = this.rows.photos
      .filter((row) => row.vin === identity && this.belongs(row) && row.filename)
      .map((row) => row.filename)
    this.rows.vehicles.splice(index, 1)
    this.removeWhere(this.rows.vehicleLocations, (row) => row.vin === identity && this.belongs(row))
    this.removeWhere(this.rows.vehiclePositions, (row) => row.vin === identity && this.belongs(row))
    this.removeWhere(this.rows.events, (row) => row.vin === identity && this.belongs(row))
    this.removeWhere(this.rows.dismissals, (row) => row.vin === identity && this.belongs(row))
    this.removeWhere(this.rows.photos, (row) => row.vin === identity && this.belongs(row))
    this.save()
    return { ok: true, vin: identity, orphanedPhotos }
  }

  view(row) {
    return {
      vin: row.vin,
      state: row.state,
      decodeStatus: row.decodeStatus,
      decodedAt: row.decodedAt,
      decoder: row.decoder,
      year: row.year,
      make: row.make,
      model: row.model,
      trim: row.trim,
      body: row.body,
      engine: row.engine,
      position: this.latestPosition(row.vin),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
  }

  removeWhere(table, predicate) {
    for (let index = table.length - 1; index >= 0; index -= 1)
      if (predicate(table[index])) table.splice(index, 1)
  }
}
