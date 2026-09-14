// Las ventanas de soporte: una clase, una tabla, una hora de cierre escrita.
//
// Un acceso de soporte no es un rol ni una membresía. Es una autorización con
// principio y final que una empresa concede gastando una llave de nivel
// SUPPORT, y que caduca sola — nadie tiene que acordarse de retirarla.
//
// Esta clase no sabe de HTTP y no habla español: devuelve razones de máquina
// (`UNKNOWN`, `ALREADY_OPEN`…) y quien la llama decide qué status y qué texto
// lee el operador. Tampoco escribe en disco: muta la tabla que le dan y avisa
// por `save`.

import { randomUUID } from 'node:crypto'
import { sameCompany } from './company.mjs'

/** Lo que dura una ventana. El mismo número que dibuja la pantalla 05c. */
export const SUPPORT_HOURS = 8

/** Los campos que salen de aquí. */
const PUBLIC = ['id', 'userId', 'companyId', 'code', 'grantedAt', 'expiresAt', 'endedAt']

export class Grants {
  /**
   * @param table  la tabla de autorizaciones; se muta en sitio
   * @param save   se llama después de cada escritura (opcional)
   * @param now    de dónde sale la hora, para poder probar el paso del tiempo
   */
  constructor(table, { save, now } = {}) {
    this.table = Array.isArray(table) ? table : []
    this.save = save ?? (() => {})
    this.now = now ?? (() => new Date())
  }

  // ── Obtener ───────────────────────────────────────────────────────────────

  /** Abierta ahora: concedida, no cerrada a mano y no caducada. */
  isLive(row) {
    if (!row || row.endedAt) return false
    return new Date(row.expiresAt) > this.now()
  }

  find(id) {
    return this.table.find((row) => row.id === id)
  }

  /**
   * Las que cumplen el filtro, la más reciente primero.
   *
   * `live` es opcional a propósito: administración quiere leer también las
   * que ya se cerraron — una auditoría busca que exista el registro de quién
   * entró y hasta cuándo, no un hueco.
   */
  list({ userId, companyId, live } = {}) {
    return this.table
      .filter((row) => (userId === undefined || row.userId === userId))
      .filter((row) => (companyId === undefined || sameCompany(row.companyId, companyId)))
      .filter((row) => (live === undefined || this.isLive(row) === live))
      .sort((a, b) => String(b.grantedAt).localeCompare(String(a.grantedAt)))
      .map((row) => this.view(row))
  }

  /** La ventana abierta de una cuenta, mire a la empresa que mire. */
  openFor(userId) {
    return this.table
      .filter((row) => row.userId === userId && this.isLive(row))
      .sort((a, b) => String(b.expiresAt).localeCompare(String(a.expiresAt)))
      .map((row) => this.view(row))[0]
  }

  // ── Crear ─────────────────────────────────────────────────────────────────

  /**
   * Abre una ventana.
   *
   * Una cuenta no puede tener dos abiertas a la vez, ni siquiera a empresas
   * distintas: mientras dura, la sesión trabaja *dentro* de una compañía, y
   * dos a la vez no tendría respuesta a la pregunta de cuál.
   */
  open({ userId, companyId, code, hours = SUPPORT_HOURS } = {}) {
    if (!userId || !companyId) return { ok: false, error: 'UNKNOWN' }
    if (this.openFor(userId)) return { ok: false, error: 'ALREADY_OPEN' }
    const at = this.now()
    const row = {
      id: randomUUID(),
      userId,
      companyId,
      code: code ?? null,
      grantedAt: at.toISOString(),
      expiresAt: new Date(at.getTime() + hours * 3_600_000).toISOString(),
      endedAt: null,
    }
    this.table.push(row)
    this.save()
    return { ok: true, grant: this.view(row) }
  }

  // ── Editar ────────────────────────────────────────────────────────────────

  /**
   * La cierra antes de tiempo. La fila se queda: lo que se guarda es que
   * alguien entró y hasta cuándo, no un hueco donde eso estuvo.
   */
  end(id, { by } = {}) {
    const row = this.find(id)
    if (!row) return { ok: false, error: 'UNKNOWN' }
    if (row.endedAt) return { ok: false, error: 'ALREADY_ENDED' }
    row.endedAt = this.now().toISOString()
    row.endedBy = by ?? null
    this.save()
    return { ok: true, grant: this.view(row) }
  }

  // ── Lo de dentro ──────────────────────────────────────────────────────────

  view(row) {
    const out = {}
    for (const key of PUBLIC) out[key] = row[key] ?? null
    out.live = this.isLive(row)
    return out
  }
}
