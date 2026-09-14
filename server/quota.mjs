// Lo que FleetHub gasta en proveedores de fuera, con un tope y un aviso.
//
// Geoapify y el decodificador de VIN se cobran por petición y se agotan por
// día. Sin contador, el primer aviso de que se acabó el plan es que la
// aplicación deja de encontrar direcciones un martes por la tarde; y sin tope,
// un bucle en un cliente puede gastarse el mes de la empresa en una hora.
//
// El contador vive con el estado y no en memoria: en una función sin servidor
// cada petición puede caer en un proceso nuevo, y un contador en memoria sería
// siempre cero. Es aproximado a propósito —dos peticiones a la vez pueden
// contar una sola— y eso está bien: esto es un tope de seguridad, no una
// factura.
//
// Esta clase no sabe de HTTP ni habla español: devuelve razones de máquina.

const clean = (value) => String(value ?? '').trim()

const number = (value, fallback) => {
  const text = clean(value)
  // Sin valor es «no configurado», no «cero»: un cero apagaría el tope, que es
  // lo contrario de lo que quiere quien no ha tocado la variable.
  if (!text) return fallback
  const parsed = Number(text)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback
}

/**
 * Los topes por día y proveedor.
 *
 * Los valores por defecto van por debajo del plan gratuito de cada uno, para
 * que el tope salte antes que el proveedor y la respuesta sea nuestra: «sin
 * cuota» se puede explicar, un 402 ajeno no.
 */
export const dailyLimits = (env = process.env) => ({
  geoapify: number(env.GEOAPIFY_DAILY_LIMIT, 2_500),
  'vin-decoder': number(env.VIN_DECODER_DAILY_LIMIT, 5_000),
})

/** A qué altura se avisa de que se está acabando. */
export const WARN_AT = 0.8

/** El día al que se imputa el gasto, en UTC. */
export const dayOf = (at) => at.toISOString().slice(0, 10)

export class Quotas {
  /**
   * @param table   el objeto de contadores; se muta en sitio
   * @param save    se llama después de cada escritura (opcional)
   * @param now     de dónde sale la hora, para poder probar el cambio de día
   * @param limits  los topes; por defecto los de la configuración
   * @param notify  a quién se avisa al cruzar el umbral (opcional)
   */
  constructor(table, { save, now, limits, notify } = {}) {
    this.table = table && typeof table === 'object' ? table : {}
    this.save = save ?? (() => {})
    this.now = now ?? (() => new Date())
    this.limits = limits ?? dailyLimits()
    this.notify = notify ?? (() => {})
  }

  limitOf(provider) {
    return this.limits[provider] ?? 0
  }

  /** Lo gastado hoy. Un día distinto es un contador distinto. */
  used(provider) {
    const row = this.table[provider]
    return row && row.day === dayOf(this.now()) ? row.count : 0
  }

  state(provider) {
    const limit = this.limitOf(provider)
    const used = this.used(provider)
    return { provider, used, limit, remaining: Math.max(0, limit - used) }
  }

  /**
   * Apunta una petición, o dice que no queda.
   *
   * El tope se comprueba antes de contar: la que sobra no se gasta, y por eso
   * una vez agotado el contador se queda quieto en el tope en lugar de subir
   * indefinidamente mientras alguien insiste.
   */
  spend(provider, cost = 1) {
    const limit = this.limitOf(provider)
    const day = dayOf(this.now())
    const row = this.table[provider]
    const used = row && row.day === day ? row.count : 0
    if (limit > 0 && used + cost > limit) {
      return { ok: false, error: 'QUOTA_EXCEEDED', ...this.state(provider) }
    }
    this.table[provider] = { day, count: used + cost, warned: row?.day === day ? row.warned === true : false }
    this.save()

    // El aviso se manda una vez por día y proveedor: repetirlo con cada
    // petición convertiría la alarma en ruido justo cuando importa leerla.
    const next = this.table[provider]
    if (limit > 0 && !next.warned && next.count >= Math.floor(limit * WARN_AT)) {
      next.warned = true
      this.save()
      this.notify('provider_quota_warning', {
        provider, used: next.count, limit, day, remaining: Math.max(0, limit - next.count),
      })
    }
    return { ok: true, ...this.state(provider) }
  }

  /**
   * Envuelve la llamada a un proveedor con su contador.
   *
   * Devuelve una función con la misma forma que la original — `{ ok, ... }` —
   * para que quien la usa no tenga que saber que hay una cuota por medio.
   */
  guard(provider, call, { onExceeded } = {}) {
    if (!call) return call
    return async (...args) => {
      const allowed = this.spend(provider)
      if (!allowed.ok) {
        this.notify('provider_quota_exceeded', {
          provider, used: allowed.used, limit: allowed.limit, day: dayOf(this.now()),
        }, 'error')
        return onExceeded ? onExceeded(allowed) : { ok: false, error: 'QUOTA_EXCEEDED' }
      }
      return call(...args)
    }
  }
}
