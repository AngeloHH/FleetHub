import { randomUUID } from 'node:crypto'

/**
 * Compañías. No tienen perfil ni información adicional: sólo una identidad y
 * la fecha en la que el servidor las creó.
 */
export class Companies {
  constructor(table, { save, now } = {}) {
    this.table = Array.isArray(table) ? table : []
    this.save = save ?? (() => {})
    this.now = now ?? (() => new Date())
  }

  create() {
    const company = {
      id: randomUUID(),
      createdAt: this.now().toISOString(),
    }
    this.table.push(company)
    this.save()
    return company
  }
}
