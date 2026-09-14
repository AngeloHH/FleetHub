// El esquema, aplicado a donde se le diga.
//
// Un solo guion para las dos bases porque son la misma forma: la de casa, que
// se tira y se rehace cien veces mientras se trabaja, y la de Neon, que se
// toca una vez. Que sea el mismo codigo es lo que garantiza que lo probado en
// una sea lo desplegado en la otra.
//
//   node scripts/db.mjs aplicar              -- a la base local
//   node scripts/db.mjs aplicar --neon       -- a Neon, por la conexion directa
//   node scripts/db.mjs borrar [--neon]      -- deja el esquema vacio
//   node scripts/db.mjs contar [--neon]      -- filas por tabla
//
// A Neon se entra siempre por la conexion directa, no por la agrupada: crear
// tablas necesita estado de sesion y el agrupador en modo transaccion no lo
// da.

import { readFile } from 'node:fs/promises'
import process from 'node:process'
import pg from 'pg'

const LOCAL = 'postgresql://fleethub:fleethub@127.0.0.1:55433/fleethub'

/** Lee `.env` sin depender de nadie: es un fichero de pares, no un formato. */
async function entorno() {
  try {
    const texto = await readFile('.env', 'utf8')
    return Object.fromEntries(texto.split('\n')
      .filter((linea) => linea.includes('=') && !linea.trim().startsWith('#'))
      .map((linea) => [linea.slice(0, linea.indexOf('=')).trim(), linea.slice(linea.indexOf('=') + 1).trim()]))
  } catch { return {} }
}

/** Adonde va esto, y como se llama para poder decirlo sin enseñar la clave. */
async function destino(neon) {
  if (!neon) return { url: LOCAL, nombre: 'local (docker, puerto 55433)' }
  const env = await entorno()
  const url = env.NETLIFY_DATABASE_URL_UNPOOLED || process.env.NETLIFY_DATABASE_URL_UNPOOLED
  if (!url) throw new Error('falta NETLIFY_DATABASE_URL_UNPOOLED')
  return { url, nombre: url.split('@')[1]?.split('/')[0] ?? 'neon' }
}

const TABLAS = [
  'companies', 'users', 'locations', 'vehicles', 'vehicle_locations', 'user_locations',
  'events', 'vehicle_positions', 'photos', 'dismissals', 'grants', 'tokens', 'token_uses',
  'sessions', 'rate_limits', 'quotas', 'store_revision',
]

async function contar(cliente) {
  const filas = {}
  for (const tabla of TABLAS) {
    const { rows } = await cliente.query(`select count(*)::int n from ${tabla}`)
    filas[tabla] = rows[0].n
  }
  return filas
}

const orden = process.argv[2]
const neon = process.argv.includes('--neon')
const donde = await destino(neon)
const cliente = new pg.Client({ connectionString: donde.url })
await cliente.connect()

try {
  if (orden === 'aplicar') {
    // Se tira primero: el esquema no tiene versiones, se pone entero.
    await cliente.query('drop schema public cascade; create schema public;')
    await cliente.query(await readFile('db/schema.sql', 'utf8'))
    const hay = await contar(cliente)
    console.log(`esquema aplicado en ${donde.nombre}: ${Object.keys(hay).length} tablas, todas vacias`)
  } else if (orden === 'borrar') {
    await cliente.query('drop schema public cascade; create schema public;')
    console.log(`esquema borrado en ${donde.nombre}`)
  } else if (orden === 'contar') {
    const hay = await contar(cliente)
    const ancho = Math.max(...TABLAS.map((t) => t.length))
    console.log(`\n${donde.nombre}\n`)
    let total = 0
    for (const [tabla, n] of Object.entries(hay)) {
      total += n
      console.log(`  ${tabla.padEnd(ancho)}  ${String(n).padStart(6)}`)
    }
    console.log(`  ${'TOTAL'.padEnd(ancho)}  ${String(total).padStart(6)}\n`)
  } else {
    console.log('ordenes: aplicar | borrar | contar   (añade --neon para la de Neon)')
    process.exitCode = 1
  }
} finally {
  await cliente.end()
}
