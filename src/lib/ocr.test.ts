// El preprocesado del visor, sin cámara y sin lector.
//
// Lo que se comprueba aquí no es que Tesseract acierte —eso necesita un
// navegador— sino la aritmética que le prepara la imagen, que es donde estuvo
// el fallo del 21 de agosto de 2026: las variantes se probaban sueltas y
// ninguna componía las dos, así que una placa con reflejo no la leía nadie.
// Estirar el rango y umbralizar después sí la lee; por separado, ninguno.
//
// El canvas se finge con lo justo que usan estas funciones. Es feo y es la
// única forma de que esto corra en node y no dependa de que alguien se acuerde
// de abrir un navegador.

import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { adaptive, stretched } from './ocr'

type Falso = {
  width: number
  height: number
  datos: Uint8ClampedArray
  getContext: () => unknown
}

/** Un canvas con lo mínimo: leer sus píxeles, crear una imagen y pintarla. */
function lienzo(width: number, height: number, relleno?: (x: number, y: number) => number): Falso {
  const datos = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const valor = relleno ? relleno(x, y) : 0
      const at = (y * width + x) * 4
      datos[at] = valor
      datos[at + 1] = valor
      datos[at + 2] = valor
      datos[at + 3] = 255
    }
  }
  const falso: Falso = {
    width,
    height,
    datos,
    // Se leen `falso.width`/`falso.height` en cada llamada y no los del
    // cierre: `paint` crea el lienzo vacío y le pone el tamaño después, que es
    // justo lo que hace un canvas de verdad.
    getContext: () => ({
      getImageData: () => ({ data: falso.datos, width: falso.width, height: falso.height }),
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      putImageData: (imagen: { data: Uint8ClampedArray }) => { falso.datos = imagen.data },
    }),
  }
  return falso
}

let antes: typeof globalThis.document

beforeAll(() => {
  antes = globalThis.document
  // `paint` crea un canvas para devolver el resultado.
  globalThis.document = {
    createElement: () => lienzo(0, 0),
  } as unknown as Document
})

afterAll(() => { globalThis.document = antes })

/** Gris de un lienzo falso, para poder mirarlo. */
const gris = (c: unknown) => {
  const falso = c as Falso
  const salida = new Uint8ClampedArray(falso.datos.length / 4)
  for (let at = 0; at < salida.length; at += 1) salida[at] = falso.datos[at * 4]
  return salida
}

const ANCHO = 200
const ALTO = 40

/**
 * Una placa con reflejo: barras oscuras sobre fondo claro, y encima un
 * degradado que va de +110 de luz a −110. Es el caso del parabrisas — media
 * placa con el cielo encima y la otra media en sombra.
 */
const esTexto = (x: number, y: number) => y > 10 && y < 30 && x > 8 && x < 192 && Math.floor(x / 6) % 2 === 0
const conReflejo = () => lienzo(ANCHO, ALTO, (x, y) => {
  const base = esTexto(x, y) ? 45 : 205
  return Math.max(0, Math.min(255, base + 110 - (220 * x) / ANCHO))
})

/** Cuántos píxeles quedan del lado correcto. */
function acierto(salida: Uint8ClampedArray) {
  let bien = 0
  for (let y = 0; y < ALTO; y += 1) {
    for (let x = 0; x < ANCHO; x += 1) {
      const negro = salida[y * ANCHO + x] < 128
      if (negro === esTexto(x, y)) bien += 1
    }
  }
  return bien / (ANCHO * ALTO)
}

describe('preparar la imagen para el lector', () => {
  test('estirar solo reparte el rango: no separa el texto del reflejo', () => {
    // Estirar es lineal y global, asi que un degradado sigue estando ahi. Por
    // eso no basta, y por eso hace falta el paso siguiente.
    const salida = gris(stretched(conReflejo() as unknown as HTMLCanvasElement))
    expect(acierto(salida)).toBeLessThan(0.9)
  })

  test('el umbral local sobre lo ya estirado sí lo separa', () => {
    const estirado = stretched(conReflejo() as unknown as HTMLCanvasElement)
    const salida = gris(adaptive(estirado as HTMLCanvasElement, false))
    expect(acierto(salida)).toBeGreaterThan(0.97)
  })

  test('y compuesto gana al umbral local a secas', () => {
    // Este es el orden que la tuberia usa, y la razon de que sea una tuberia y
    // no una lista de cosas que probar.
    const suelto = acierto(gris(adaptive(conReflejo() as unknown as HTMLCanvasElement, false)))
    const compuesto = acierto(gris(
      adaptive(stretched(conReflejo() as unknown as HTMLCanvasElement) as HTMLCanvasElement, false),
    ))
    expect(compuesto).toBeGreaterThanOrEqual(suelto)
  })

  test('no devuelve una mancha: lo negro es el texto y nada mas', () => {
    const estirado = stretched(conReflejo() as unknown as HTMLCanvasElement)
    const salida = gris(adaptive(estirado as HTMLCanvasElement, false))
    const negros = salida.reduce((n, v) => n + (v < 128 ? 1 : 0), 0) / salida.length
    let texto = 0
    for (let y = 0; y < ALTO; y += 1) for (let x = 0; x < ANCHO; x += 1) if (esTexto(x, y)) texto += 1
    expect(negros).toBeGreaterThan(0)
    expect(negros).toBeLessThan((texto / (ANCHO * ALTO)) * 1.6)
  })

  test('invertido devuelve lo contrario, para las placas en hueco', () => {
    const estirado = stretched(conReflejo() as unknown as HTMLCanvasElement)
    const normal = gris(adaptive(estirado as HTMLCanvasElement, false))
    const vuelto = gris(adaptive(estirado as HTMLCanvasElement, true))
    for (let at = 0; at < normal.length; at += 1) expect(vuelto[at]).toBe(255 - normal[at])
  })
})
