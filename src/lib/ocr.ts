// Leer el VIN estampado — los números de la guantera, no un código de barras.
//
// El lector es tesseract compilado a wasm, cargado sólo cuando el visor lo
// necesita y servido desde /tess con la app misma: un patio sin cobertura no
// puede depender de un CDN. Un solo worker para toda la sesión, porque
// arrancarlo cuesta más que usarlo.
//
// La honestidad del visor vive aquí: readVin devuelve un VIN válido o null —
// nunca «lo que creyó ver». Diecisiete caracteres del alfabeto del VIN,
// encontrados como ventana dentro de lo leído, porque el OCR arrastra ruido
// por los bordes y el VIN de verdad viene con él pegado.

import { hasVinCheckDigit, isValidVin, VIN_LENGTH, vinCharactersOnly } from '../domain'
import type { Worker } from 'tesseract.js'

let reader: Promise<Worker | null> | null = null

/** El worker, una vez. Si los activos no están donde deben —la copia de un
 *  solo archivo no los lleva— la respuesta es null, no una excepción a mitad
 *  de un cuadro. */
function vinReader(): Promise<Worker | null> {
  reader ??= (async () => {
    try {
      const { createWorker, OEM, PSM } = await import('tesseract.js')
      const base = `${import.meta.env.BASE_URL}tess`
      const worker = await createWorker('eng', OEM.LSTM_ONLY, {
        workerPath: `${base}/worker.min.js`,
        corePath: base,
        langPath: base,
      })
      await worker.setParameters({
        // El alfabeto del VIN: sin I, sin O, sin Q. Todo lo demás es ruido.
        tessedit_char_whitelist: 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789',
        tessedit_pageseg_mode: PSM.SINGLE_LINE,
      })
      return worker
    } catch {
      return null
    }
  })()
  return reader
}

/** ¿Hay lector? Para que el visor pueda decir «no» antes de prometer leer. */
export function readerAvailable() {
  return vinReader().then((w) => w !== null)
}

/**
 * Lee un cuadro y devuelve el VIN que contenga, o null. Un VIN es válido o no
 * es: la ventana de diecisiete se comprueba con la regla del dominio, y lo
 * que no la pasa no sale de aquí.
 */
/** El VIN que haya dentro de un texto leído, o null. */
export function vinInside(text: string): string | null {
  // Sin recortar a diecisiete: lo que hace falta es buscar el VIN dentro de lo
  // leído, y recortar antes deja una sola ventana posible.
  const clean = vinCharactersOnly(text)
  const candidates: string[] = []
  for (let at = 0; at + VIN_LENGTH <= clean.length; at++) {
    const candidate = clean.slice(at, at + VIN_LENGTH)
    if (isValidVin(candidate)) candidates.push(candidate)
  }
  // El dígito de control decide. Diecisiete caracteres del alfabeto los cumple
  // cualquier trozo del texto; la aritmética de la posición nueve, casi
  // ninguno. Si nada cuadra, no se devuelve el que mejor pinta: se devuelve
  // nada, y el visor sigue mirando. Otro cuadro no cuesta nada, y una unidad
  // dada de alta con un VIN mal leído sí.
  return candidates.find(hasVinCheckDigit) ?? null
}

/**
 * El mismo cuadro, mirado de tres maneras.
 *
 * La placa del parabrisas se lee a través de un cristal: media placa con el
 * reflejo del cielo encima y la otra media en sombra del salpicadero. Un
 * umbral único sobre una imagen así se come una mitad, y es lo que hace
 * Tesseract por dentro. Un umbral que se calcula por vecindad no tiene ese
 * problema — cada zona se compara con la suya.
 *
 * Se prueban en orden de lo que suele funcionar, y se para en cuanto una da un
 * VIN que cuadra. Poder permitirse esto es consecuencia del digito de control:
 * antes, procesar de forma agresiva colaba basura; ahora la basura no pasa.
 */
function* readings(frame: HTMLCanvasElement) {
  // El orden no es una lista de cosas que probar: es una tubería. Estirar
  // primero y umbralizar después es lo único que lee una placa con reflejo, y
  // ninguno de los dos pasos lo consigue por su cuenta — medido sobre una
  // placa con el sol encima, los dos sueltos fallan y compuestos aciertan.
  // Estirar reparte el rango que el reflejo había aplastado; el umbral local
  // ya tiene entonces señal con la que comparar.
  const evened = stretched(frame) ?? frame
  yield adaptive(evened, false)
  yield evened
  yield frame
}

export async function readVin(frame: HTMLCanvasElement): Promise<string | null> {
  const worker = await vinReader()
  if (!worker) return null
  for (const attempt of readings(frame)) {
    if (!attempt) continue
    const { data } = await worker.recognize(attempt)
    const vin = vinInside(data.text)
    if (vin) return vin
  }
  return null
}

/** La luminancia de cada pixel, que es lo unico que le importa al lector. */
function luminance(frame: HTMLCanvasElement) {
  const context = frame.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  const image = context.getImageData(0, 0, frame.width, frame.height)
  const grey = new Uint8ClampedArray(frame.width * frame.height)
  for (let at = 0; at < grey.length; at += 1) {
    const pixel = at * 4
    grey[at] = (image.data[pixel] * 299 + image.data[pixel + 1] * 587 + image.data[pixel + 2] * 114) / 1000
  }
  return { grey, width: frame.width, height: frame.height, image, context }
}

function paint(source: ReturnType<typeof luminance>, grey: Uint8ClampedArray) {
  if (!source) return null
  const out = document.createElement('canvas')
  out.width = source.width
  out.height = source.height
  const context = out.getContext('2d')
  if (!context) return null
  const image = context.createImageData(source.width, source.height)
  for (let at = 0; at < grey.length; at += 1) {
    const pixel = at * 4
    image.data[pixel] = grey[at]
    image.data[pixel + 1] = grey[at]
    image.data[pixel + 2] = grey[at]
    image.data[pixel + 3] = 255
  }
  context.putImageData(image, 0, 0)
  return out
}

/** Gris con el rango estirado: lo mas oscuro a negro, lo mas claro a blanco. */
export function stretched(frame: HTMLCanvasElement) {
  const source = luminance(frame)
  if (!source) return null
  let low = 255
  let high = 0
  for (const value of source.grey) {
    if (value < low) low = value
    if (value > high) high = value
  }
  const span = Math.max(1, high - low)
  const out = new Uint8ClampedArray(source.grey.length)
  for (let at = 0; at < out.length; at += 1) out[at] = ((source.grey[at] - low) * 255) / span
  return paint(source, out)
}

/**
 * Umbral adaptativo por integral (Bradley): cada pixel contra la media de su
 * vecindad, no contra la de la imagen entera. Es lo que sobrevive a que media
 * placa este al sol y la otra media a la sombra.
 */
export function adaptive(frame: HTMLCanvasElement, invert: boolean) {
  const source = luminance(frame)
  if (!source) return null
  const { grey, width, height } = source
  const sums = new Float64Array((width + 1) * (height + 1))
  for (let y = 0; y < height; y += 1) {
    let row = 0
    for (let x = 0; x < width; x += 1) {
      row += grey[y * width + x]
      sums[(y + 1) * (width + 1) + x + 1] = sums[y * (width + 1) + x + 1] + row
    }
  }
  // Una ventana del ancho de un caracter aproximado: la placa cruza el marco.
  const radius = Math.max(4, Math.round(width / 34))
  const out = new Uint8ClampedArray(grey.length)
  for (let y = 0; y < height; y += 1) {
    const top = Math.max(0, y - radius)
    const bottom = Math.min(height - 1, y + radius)
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - radius)
      const right = Math.min(width - 1, x + radius)
      const count = (bottom - top + 1) * (right - left + 1)
      const total = sums[(bottom + 1) * (width + 1) + right + 1]
        - sums[top * (width + 1) + right + 1]
        - sums[(bottom + 1) * (width + 1) + left]
        + sums[top * (width + 1) + left]
      // El 88 % de la media local: el margen que evita que el ruido del fondo
      // uniforme se convierta en manchas negras.
      const dark = grey[y * width + x] * count < total * 0.88
      out[y * width + x] = (invert ? !dark : dark) ? 0 : 255
    }
  }
  return paint(source, out)
}

/**
 * El trozo del vídeo que cae dentro del marco de puntería, como canvas listo
 * para leer. El vídeo cubre el visor recortándose (object-fit: cover), así
 * que el rectángulo del marco hay que deshacerlo a coordenadas del sensor.
 */
export function frameUnder(video: HTMLVideoElement, plate: DOMRect, screen: DOMRect) {
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh) return null
  const scale = Math.max(screen.width / vw, screen.height / vh)
  const offsetX = (scale * vw - screen.width) / 2
  const offsetY = (scale * vh - screen.height) / 2
  const sx = (plate.left - screen.left + offsetX) / scale
  const sy = (plate.top - screen.top + offsetY) / scale
  const sw = plate.width / scale
  const sh = plate.height / scale

  /*
   * El tamaño de salida se saca del sensor, no de la pantalla.
   *
   * Antes era «el doble del marco, con techo de mil», y eso convertía un
   * recorte de 1650 píxeles reales en uno de 668: se tiraba a la basura el
   * detalle que la cámara sí había capturado. Ampliar no inventa nada, pero
   * reducir sí destruye.
   *
   * Así que se usa lo que hay —`sw`, el ancho real del recorte— y sólo se
   * amplía cuando el sensor da poco. El techo existe porque un sensor de 4K
   * entero no le rinde al lector y sí le cuesta tiempo.
   */
  const outW = Math.round(Math.min(Math.max(sw, plate.width * 2), 1600))
  const outH = Math.max(1, Math.round((outW * sh) / Math.max(1, sw)))
  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  canvas.getContext('2d')?.drawImage(video, sx, sy, sw, sh, 0, 0, outW, outH)
  return canvas
}
