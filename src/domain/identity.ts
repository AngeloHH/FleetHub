/**
 * Etiqueta humana estable derivada de una identidad canónica.
 *
 * No es una identidad ni promete unicidad: relaciones, URLs e historial usan
 * siempre el UUID o VIN completo. El prefijo sólo explica qué tipo de objeto
 * se está mostrando y tampoco forma parte de la identidad.
 */
export function displayCode(prefix: string, identity: string) {
  let hash = 2_166_136_261
  for (const character of identity) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16_777_619)
  }
  return `${prefix}-${String((hash >>> 0) % 10_000).padStart(4, '0')}`
}

export const operatorCode = (uuid: string) => displayCode('OP', uuid)
export const locationCode = (uuid: string) => displayCode('LOC', uuid)
export const vehicleCode = (vin: string) => displayCode('VH', vin.trim().toUpperCase())
