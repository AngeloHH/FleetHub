export type RouteCoordinate = [number, number]

const radians = (degrees: number) => degrees * Math.PI / 180

function distance([fromLon, fromLat]: RouteCoordinate, [toLon, toLat]: RouteCoordinate) {
  const latitude = radians(toLat - fromLat)
  const longitude = radians(toLon - fromLon)
  const a = Math.sin(latitude / 2) ** 2
    + Math.cos(radians(fromLat)) * Math.cos(radians(toLat)) * Math.sin(longitude / 2) ** 2
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function estimatedRoutePosition(
  geometry: RouteCoordinate[],
  routeStartedAt: string | null,
  etaSeconds: number | null,
  now: Date = new Date(),
): { coordinates: RouteCoordinate; progress: number; completed: boolean } | null {
  if (!routeStartedAt || !Number.isFinite(Number(etaSeconds)) || Number(etaSeconds) <= 0
    || !Array.isArray(geometry) || geometry.length < 2) return null
  const started = Date.parse(routeStartedAt)
  if (!Number.isFinite(started)) return null
  const valid = geometry.every(([longitude, latitude]) =>
    Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
    && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90)
  if (!valid) return null

  const progress = Math.min(1, Math.max(0, (now.getTime() - started) / (Number(etaSeconds) * 1_000)))
  const lengths = geometry.slice(1).map((point, index) => distance(geometry[index], point))
  const total = lengths.reduce((sum, length) => sum + length, 0)
  if (total === 0) return { coordinates: geometry[0], progress, completed: progress >= 1 }
  const target = total * progress
  let travelled = 0
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index]
    if (travelled + length >= target) {
      const ratio = length === 0 ? 0 : (target - travelled) / length
      const [fromLon, fromLat] = geometry[index]
      const [toLon, toLat] = geometry[index + 1]
      return {
        coordinates: [fromLon + (toLon - fromLon) * ratio, fromLat + (toLat - fromLat) * ratio],
        progress,
        completed: progress >= 1,
      }
    }
    travelled += length
  }
  return { coordinates: geometry.at(-1)!, progress: 1, completed: true }
}
