// Las cabeceras que se despliegan, atadas a lo que la aplicación necesita.
//
// Hay funciones que no dependen sólo del código sino de una línea de
// `netlify.toml`, y cuando esa línea está mal el fallo no se parece a un
// fallo. El caso vivo fue el lector de VIN: compilar WebAssembly cuenta como
// evaluar código, una `script-src 'self'` a secas lo bloquea, `vinReader`
// atrapa el error y devuelve `null`, y la pantalla dice «LECTOR NO DISPONIBLE
// · USA MANUAL» como si fuera una decisión de producto.
//
// En desarrollo no se ve, porque el servidor de Vite no manda esa cabecera, y
// las pruebas de navegador tampoco, porque sirven el build sin ella. Así que
// se comprueba aquí, leyendo el fichero que de verdad viaja.

import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const csp = readFileSync('netlify.toml', 'utf8')
  .match(/Content-Security-Policy\s*=\s*"([^"]*)"/)?.[1] ?? ''

const directiva = (nombre) =>
  csp.split(';').map((trozo) => trozo.trim()).find((trozo) => trozo.startsWith(`${nombre} `)) ?? ''

describe('la política de seguridad que se despliega', () => {
  test('existe', () => {
    expect(csp).not.toBe('')
  })

  test('deja compilar WebAssembly, o el lector de VIN no arranca', () => {
    expect(directiva('script-src')).toContain("'wasm-unsafe-eval'")
  })

  test('y lo deja sin abrir eval() entero', () => {
    // `unsafe-eval` también arrancaría tesseract, y de paso ejecutaría
    // cualquier cadena que alguien construyera. Es la diferencia entre una
    // puerta y un boquete.
    expect(directiva('script-src')).not.toContain("'unsafe-eval'")
  })

  test('el worker nace de un blob y el visor pinta un stream', () => {
    expect(directiva('worker-src')).toContain('blob:')
    expect(directiva('media-src')).toContain('blob:')
  })

  test('y lo que estaba cerrado sigue cerrado', () => {
    expect(directiva('object-src')).toContain("'none'")
    expect(directiva('frame-ancestors')).toContain("'none'")
    expect(directiva('base-uri')).toContain("'self'")
  })
})
