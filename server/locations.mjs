import { randomUUID } from 'node:crypto'
import { sameCompany } from './company.mjs'

const clean = (value) => String(value ?? '').trim()
const normalizedVin = (value) => clean(value).toUpperCase()
const DEFAULT_TRAFFIC_MARGIN = 15

/**
 * Ubicaciones, sus puntos y sus asignaciones.
 *
 * Una ubicación no almacena un tipo separado: con dos o más puntos es una
 * ruta. Así el tipo nunca puede contradecir el contenido que lo determina.
 */
export class Locations {
  constructor(rows, { save, now, companyId = null } = {}) {
    this.rows = rows ?? {}
    this.rows.locations ??= []
    this.rows.userLocations ??= []
    this.rows.vehicleLocations ??= []
    this.rows.users ??= []
    this.rows.vehicles ??= []
    this.save = save ?? (() => {})
    this.now = now ?? (() => new Date())
    this.companyId = companyId
  }

  belongs(row) {
    return this.companyId === null || sameCompany(row?.companyId, this.companyId)
  }

  trafficMargin(value, fallback = DEFAULT_TRAFFIC_MARGIN) {
    const margin = value === undefined ? fallback : Number(value)
    if (!Number.isInteger(margin) || margin < 0 || margin > 100)
      return { ok: false, error: 'INVALID_TRAFFIC_MARGIN' }
    return { ok: true, margin }
  }

  create({ name, active = true, points = [], trafficMarginPercent, companyId = this.companyId } = {}) {
    const locationName = clean(name)
    if (!locationName) return { ok: false, error: 'MISSING_LOCATION_NAME' }
    if (typeof active !== 'boolean') return { ok: false, error: 'INVALID_ACTIVE' }
    const prepared = this.preparePoints(points)
    if (!prepared.ok) return prepared
    const margin = this.trafficMargin(trafficMarginPercent)
    if (!margin.ok) return margin

    const at = this.now().toISOString()
    const row = {
      id: randomUUID(),
      companyId,
      name: locationName,
      points: prepared.points,
      active,
      trafficMarginPercent: margin.margin,
      createdAt: at,
      updatedAt: at,
    }
    this.rows.locations.push(row)
    this.save()
    return { ok: true, location: this.view(row) }
  }

  get(id) {
    const row = this.find(id)
    return row ? this.view(row) : undefined
  }

  find(id) {
    return this.rows.locations.find((row) => row.id === id && this.belongs(row))
  }

  list() {
    return this.rows.locations.filter((row) => this.belongs(row)).map((row) => this.view(row))
  }

  update(id, { name, active, points, trafficMarginPercent } = {}) {
    const row = this.find(id)
    if (!row) return { ok: false, error: 'LOCATION_NOT_FOUND' }

    const next = { ...row }
    if (name !== undefined) {
      const locationName = clean(name)
      if (!locationName) return { ok: false, error: 'MISSING_LOCATION_NAME' }
      next.name = locationName
    }
    if (active !== undefined) {
      if (typeof active !== 'boolean') return { ok: false, error: 'INVALID_ACTIVE' }
      next.active = active
    }
    if (points !== undefined) {
      const prepared = this.preparePoints(points, row.points)
      if (!prepared.ok) return prepared
      next.points = prepared.points
    }
    if (trafficMarginPercent !== undefined) {
      const margin = this.trafficMargin(trafficMarginPercent)
      if (!margin.ok) return margin
      next.trafficMarginPercent = margin.margin
    }
    next.updatedAt = this.now().toISOString()
    Object.assign(row, next)
    this.save()
    return { ok: true, location: this.view(row) }
  }

  addPoint(locationId, draft = {}) {
    const row = this.find(locationId)
    if (!row) return { ok: false, error: 'LOCATION_NOT_FOUND' }
    const prepared = this.preparePoint(draft)
    if (!prepared.ok) return prepared

    const point = prepared.point
    ;(row.points ??= []).push(point)
    row.updatedAt = this.now().toISOString()
    this.save()
    return { ok: true, point: { ...point }, location: this.view(row) }
  }

  updatePoint(locationId, pointId, { address, reference, latitude, longitude } = {}) {
    const row = this.find(locationId)
    if (!row) return { ok: false, error: 'LOCATION_NOT_FOUND' }
    const point = (row.points ?? []).find((candidate) => candidate.id === pointId)
    if (!point) return { ok: false, error: 'POINT_NOT_FOUND' }

    const next = { ...point }
    if (address !== undefined) {
      const pointAddress = clean(address)
      if (!pointAddress) return { ok: false, error: 'MISSING_POINT_ADDRESS' }
      next.address = pointAddress
    }
    if (reference !== undefined) next.reference = clean(reference)
    if (latitude !== undefined || longitude !== undefined) {
      const position = this.position(latitude, longitude)
      if (!position.ok) return position
      next.latitude = position.latitude
      next.longitude = position.longitude
    }
    Object.assign(point, next)
    row.updatedAt = this.now().toISOString()
    this.save()
    return { ok: true, point: { ...point }, location: this.view(row) }
  }

  position(latitude, longitude) {
    const lat = Number(latitude)
    const lon = Number(longitude)
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180)
      return { ok: false, error: 'INVALID_POINT_POSITION' }
    return { ok: true, latitude: lat, longitude: lon }
  }

  preparePoint({ id, address, reference, latitude, longitude } = {}, known = new Set()) {
    const pointAddress = clean(address)
    if (!pointAddress) return { ok: false, error: 'MISSING_POINT_ADDRESS' }
    const position = this.position(latitude, longitude)
    if (!position.ok) return position
    return {
      ok: true,
      point: {
        id: known.has(id) ? id : randomUUID(),
        address: pointAddress,
        reference: clean(reference),
        latitude: position.latitude,
        longitude: position.longitude,
      },
    }
  }

  preparePoints(points, current = []) {
    if (!Array.isArray(points)) return { ok: false, error: 'INVALID_POINTS' }
    const known = new Set((current ?? []).map((point) => point.id))
    const prepared = []
    for (const draft of points) {
      const result = this.preparePoint(draft, known)
      if (!result.ok) return result
      prepared.push(result.point)
    }
    return { ok: true, points: prepared }
  }

  removePoint(locationId, pointId) {
    const row = this.find(locationId)
    if (!row) return { ok: false, error: 'LOCATION_NOT_FOUND' }
    const index = (row.points ?? []).findIndex((point) => point.id === pointId)
    if (index < 0) return { ok: false, error: 'POINT_NOT_FOUND' }
    row.points.splice(index, 1)
    row.updatedAt = this.now().toISOString()
    this.save()
    return { ok: true, location: this.view(row) }
  }

  setRouteEstimate(locationId, estimate) {
    const row = this.find(locationId)
    if (!row) return { ok: false, error: 'LOCATION_NOT_FOUND' }
    if (!estimate || (row.points ?? []).length < 2) {
      delete row.distanceMeters
      delete row.durationSeconds
      delete row.geometry
      delete row.routingProvider
      delete row.routingTraffic
      delete row.routingCalculatedAt
    } else {
      const distanceMeters = Math.round(Number(estimate.distanceMeters))
      const durationSeconds = Math.round(Number(estimate.durationSeconds))
      if (!Number.isFinite(distanceMeters) || distanceMeters < 0
        || !Number.isFinite(durationSeconds) || durationSeconds < 0)
        return { ok: false, error: 'INVALID_ROUTE_ESTIMATE' }
      row.distanceMeters = distanceMeters
      row.durationSeconds = durationSeconds
      const source = Array.isArray(estimate.geometry) && estimate.geometry.length >= 2
        ? estimate.geometry
        : (row.points ?? []).map((point) => [point.longitude, point.latitude])
      const geometry = source.map((coordinate) => [Number(coordinate?.[0]), Number(coordinate?.[1])])
      if (geometry.length < 2 || geometry.some(([longitude, latitude]) =>
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180
        || !Number.isFinite(latitude) || latitude < -90 || latitude > 90))
        return { ok: false, error: 'INVALID_ROUTE_ESTIMATE' }
      row.geometry = geometry
      row.routingProvider = clean(estimate.routingProvider) || null
      row.routingTraffic = clean(estimate.routingTraffic) || null
      row.routingCalculatedAt = clean(estimate.routingCalculatedAt) || this.now().toISOString()
    }
    row.updatedAt = this.now().toISOString()
    this.save()
    return { ok: true, location: this.view(row) }
  }

  assignUser(locationId, userId, assignedBy) {
    if (!this.find(locationId)) return { ok: false, error: 'LOCATION_NOT_FOUND' }
    if (!this.rows.users.some((row) => row.id === userId && this.belongs(row))) return { ok: false, error: 'USER_NOT_FOUND' }
    return this.assign(this.rows.userLocations, { userId, locationId }, assignedBy)
  }

  unassignUser(locationId, userId) {
    return this.unassign(this.rows.userLocations, { userId, locationId })
  }

  assignVehicle(locationId, vin, assignedBy) {
    const identity = normalizedVin(vin)
    if (!this.find(locationId)) return { ok: false, error: 'LOCATION_NOT_FOUND' }
    if (!this.rows.vehicles.some((row) => row.vin === identity && this.belongs(row))) return { ok: false, error: 'VEHICLE_NOT_FOUND' }
    return this.assign(this.rows.vehicleLocations, { vin: identity, locationId }, assignedBy)
  }

  /** La ficha de una unidad elige una location concreta, sin asumir la primera. */
  replaceVehicleLocation(locationId, vin, assignedBy) {
    const identity = normalizedVin(vin)
    if (!this.find(locationId)) return { ok: false, error: 'LOCATION_NOT_FOUND' }
    if (!this.rows.vehicles.some((row) => row.vin === identity && this.belongs(row)))
      return { ok: false, error: 'VEHICLE_NOT_FOUND' }
    for (let index = this.rows.vehicleLocations.length - 1; index >= 0; index -= 1)
      if (this.rows.vehicleLocations[index].vin === identity && this.belongs(this.rows.vehicleLocations[index]))
        this.rows.vehicleLocations.splice(index, 1)
    return this.assign(this.rows.vehicleLocations, { vin: identity, locationId }, assignedBy)
  }

  unassignVehicle(locationId, vin) {
    return this.unassign(this.rows.vehicleLocations, { vin: normalizedVin(vin), locationId })
  }

  forUser(userId, { activeOnly = false } = {}) {
    const ids = new Set(this.rows.userLocations.filter((row) => row.userId === userId && this.belongs(row)).map((row) => row.locationId))
    return this.rows.locations
      .filter((row) => this.belongs(row) && ids.has(row.id) && (!activeOnly || row.active === true))
      .map((row) => this.view(row))
  }

  forVehicle(vin, { activeOnly = false } = {}) {
    const identity = normalizedVin(vin)
    const assignments = this.rows.vehicleLocations.filter((row) => row.vin === identity && this.belongs(row))
    const byLocation = new Map(assignments.map((row) => [row.locationId, row]))
    return this.rows.locations
      .filter((row) => this.belongs(row) && byLocation.has(row.id) && (!activeOnly || row.active === true))
      .map((row) => {
        const assignment = byLocation.get(row.id)
        return {
          ...this.view(row),
          assignedAt: assignment.assignedAt,
          routeStartedAt: assignment.routeStartedAt ?? null,
        }
      })
  }

  setVehicleRouteStartedAt(vin, value, changedBy) {
    const identity = normalizedVin(vin)
    const assignment = this.rows.vehicleLocations.find((row) => row.vin === identity && this.belongs(row))
    if (!assignment) return { ok: false, error: 'VEHICLE_LOCATION_NOT_FOUND' }
    const location = this.find(assignment.locationId)
    if (!location) return { ok: false, error: 'LOCATION_NOT_FOUND' }
    if ((location.points ?? []).length < 2) return { ok: false, error: 'ROUTE_START_NOT_APPLICABLE' }
    let routeStartedAt = null
    if (value !== null && value !== undefined && value !== '') {
      const timestamp = new Date(value)
      if (!Number.isFinite(timestamp.getTime())) return { ok: false, error: 'INVALID_ROUTE_STARTED_AT' }
      routeStartedAt = timestamp.toISOString()
    }
    assignment.routeStartedAt = routeStartedAt
    assignment.routeStartedBy = changedBy ?? null
    assignment.updatedAt = this.now().toISOString()
    this.save()
    return { ok: true, assignment: { ...assignment }, location: this.get(location.id) }
  }

  activeIdsForUser(userId) {
    return new Set(this.forUser(userId, { activeOnly: true }).map((row) => row.id))
  }

  remove(id) {
    const index = this.rows.locations.findIndex((row) => row.id === id && this.belongs(row))
    if (index < 0) return { ok: false, error: 'LOCATION_NOT_FOUND' }
    this.rows.locations.splice(index, 1)
    this.removeAssignments(this.rows.userLocations, id)
    this.removeAssignments(this.rows.vehicleLocations, id)
    this.save()
    return { ok: true, locationId: id }
  }

  view(row) {
    const points = Array.isArray(row.points) ? row.points.map((point) => ({ ...point })) : []
    const margin = this.trafficMargin(row.trafficMarginPercent).ok
      ? this.trafficMargin(row.trafficMarginPercent).margin
      : DEFAULT_TRAFFIC_MARGIN
    const durationSeconds = Number.isFinite(Number(row.durationSeconds)) ? Number(row.durationSeconds) : null
    return {
      id: row.id,
      name: row.name,
      points,
      isRoute: points.length > 1,
      active: row.active === true,
      trafficMarginPercent: margin,
      distanceMeters: Number.isFinite(Number(row.distanceMeters)) ? Number(row.distanceMeters) : null,
      durationSeconds,
      geometry: Array.isArray(row.geometry)
        ? row.geometry.map((coordinate) => [...coordinate])
        : [],
      etaSeconds: durationSeconds === null ? null : Math.round(durationSeconds * (1 + margin / 100)),
      routingProvider: row.routingProvider ?? null,
      routingTraffic: row.routingTraffic ?? null,
      routingCalculatedAt: row.routingCalculatedAt ?? null,
      assignedVehicleCount: this.rows.vehicleLocations.filter((assignment) => this.belongs(assignment) && assignment.locationId === row.id).length,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
  }

  assign(table, subject, assignedBy) {
    const subjectId = subject.userId ?? subject.vin
    const id = `${subjectId}:${subject.locationId}`
    let assignment = table.find((row) => row.id === id && this.belongs(row))
    if (!assignment) {
      assignment = { id, companyId: this.companyId, ...subject, assignedAt: this.now().toISOString(), assignedBy }
      table.push(assignment)
      this.save()
    }
    return { ok: true, assignment: { ...assignment } }
  }

  unassign(table, subject) {
    const index = table.findIndex((row) => this.belongs(row) && Object.entries(subject).every(([key, value]) => row[key] === value))
    if (index >= 0) {
      table.splice(index, 1)
      this.save()
    }
    return { ok: true, ...subject }
  }

  removeAssignments(table, locationId) {
    for (let index = table.length - 1; index >= 0; index -= 1)
      if (this.belongs(table[index]) && table[index].locationId === locationId) table.splice(index, 1)
  }
}
