// Read the plate's QR code or printed VIN locally in the browser.

import { hasVinCheckDigit, VIN_LENGTH, vinCharactersOnly } from '../domain'
import type { Worker } from 'tesseract.js'
import { brightDetails, estimatePlateLine, findVinLine, plateStrokes } from './vin-image'

let reader: Promise<Worker | null> | null = null
let barcodeReader: Promise<Awaited<ReturnType<typeof loadBarcodeReader>> | null> | undefined

async function loadBarcodeReader() {
  const [zxing, { default: wasmUrl }] = await Promise.all([
    import('zxing-wasm/reader'),
    import('zxing-wasm/reader/zxing_reader.wasm?url'),
  ])
  await zxing.prepareZXingModule({
    overrides: { locateFile: () => wasmUrl },
    fireImmediately: true,
  })
  return zxing.readBarcodes
}

function qrReader() {
  barcodeReader ??= loadBarcodeReader().catch(() => null)
  return barcodeReader
}

async function readQr(frame: HTMLCanvasElement): Promise<string | null> {
  const readBarcodes = await qrReader()
  const context = frame.getContext('2d', { willReadFrequently: true })
  if (!readBarcodes || !context) return null
  const attempts = [
    () => context.getImageData(0, 0, frame.width, frame.height),
    () => brightDetails(frame, 6, 9),
    () => brightDetails(frame, 12, 18),
  ]
  for (const prepare of attempts) {
    const image = prepare()
    if (!image) continue
    const codes = await readBarcodes(image, { formats: ['QRCode'] })
    const vins = new Set(codes.map((code) => code.text.trim().toUpperCase()).filter(hasVinCheckDigit))
    if (vins.size === 1) return vins.values().next().value ?? null
    if (vins.size > 1) return null
  }
  return null
}

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
export async function readerAvailable() {
  return Boolean((await qrReader()) ?? (await vinReader()))
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
  const candidates = new Set<string>()
  for (let at = 0; at + VIN_LENGTH <= clean.length; at++) {
    const candidate = clean.slice(at, at + VIN_LENGTH)
    if (hasVinCheckDigit(candidate)) candidates.add(candidate)
  }
  // El dígito de control decide. Diecisiete caracteres del alfabeto los cumple
  // cualquier trozo del texto; la aritmética de la posición nueve, casi
  // ninguno. Si nada cuadra, no se devuelve el que mejor pinta: se devuelve
  // nada, y el visor sigue mirando. Otro cuadro no cuesta nada, y una unidad
  // dada de alta con un VIN mal leído sí.
  return candidates.size === 1 ? candidates.values().next().value ?? null : null
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
  if (!frame.width || !frame.height) return null
  const qr = await readQr(frame).catch(() => null)
  if (qr) return qr

  const worker = await vinReader()
  if (!worker) return null
  const printed = await readBrightVin(frame, worker)
  if (printed) return printed
  for (const attempt of readings(frame)) {
    if (!attempt) continue
    const { data } = await worker.recognize(attempt)
    const vin = vinInside(data.text)
    if (vin) return vin
  }
  return readGlareVin(frame, worker)
}

async function readGlareVin(frame: HTMLCanvasElement, worker: Worker) {
  const edges = plateStrokes(frame, 5, 27, true)
  const line = edges && estimatePlateLine(edges.glyphs, frame.width, frame.height)
  if (!line) return null
  const source = document.createElement('canvas')
  const binary = document.createElement('canvas')
  const context = source.getContext('2d', { willReadFrequently: true })
  const output = binary.getContext('2d')
  if (!context || !output) return null

  const expanded = estimatePlateLine(edges.glyphs, frame.width, frame.height, true) ?? line
  const x = Math.max(0, expanded.x - Math.round(expanded.height * 0.07))
  const flat = {
    x,
    y: expanded.y + Math.round(expanded.height * 0.01),
    width: Math.min(frame.width - x, expanded.width + Math.round(expanded.height * 0.11)),
    height: Math.round(expanded.height * 0.88),
    slope: expanded.slope + 0.005,
  }
  const reads: string[] = []
  for (const { crop, scale, radius, contrast } of [
    { crop: line, scale: 0.7, radius: 3, contrast: 25 },
    { crop: line, scale: 0.7, radius: 3, contrast: 27 },
    { crop: line, scale: 0.7, radius: 4, contrast: 29 },
    { crop: flat, scale: 1, radius: 4, contrast: 26 },
    { crop: flat, scale: 1, radius: 6, contrast: 24 },
    { crop: flat, scale: 1, radius: 7, contrast: 24 },
  ]) {
    source.width = binary.width = Math.round(crop.width * scale)
    source.height = binary.height = Math.round(crop.height * scale)
    const rise = crop.slope * source.width
    context.setTransform(1, -crop.slope, 0, 1, 0, crop === flat ? source.height * 0.17 : Math.max(0, rise))
    context.drawImage(frame, crop.x, crop.y, crop.width, crop.height, 0, 0, source.width, source.height)
    const strokes = plateStrokes(source, radius, contrast, true)
    if (!strokes) continue
    output.putImageData(strokes.image, 0, 0)
    const { data } = await worker.recognize(binary)
    const text = vinCharactersOnly(data.text)
    if (text.length !== VIN_LENGTH) continue
    if (hasVinCheckDigit(text) && reads.includes(text)) return text
    reads.push(text)
  }
  return reconcileVinReads(reads)
}

/** Only combine characters the OCR actually saw at the same position. */
export function reconcileVinReads(reads: string[]) {
  const candidates = new Set<string>()
  for (let i = 0; i < reads.length; i++) {
    const first = reads[i]
    if (first.length !== VIN_LENGTH) continue
    for (const second of reads.slice(i + 1)) {
      if (second.length !== VIN_LENGTH || first[8] !== second[8]) continue
      const differences = [...first].flatMap((char, at) => char === second[at] ? [] : [at])
      if (differences.length > 2) continue
      const options = differences.reduce((values, at) => [
        ...values,
        ...values.map((value) => value.slice(0, at) + second[at] + value.slice(at + 1)),
      ], [first])
      for (const option of options) if (hasVinCheckDigit(option)) candidates.add(option)
    }
  }
  return candidates.size === 1 ? candidates.values().next().value ?? null : null
}

async function readBrightVin(frame: HTMLCanvasElement, worker: Worker) {
  // Try stronger background rejection and a larger text sample if the
  // camera's resampling has made the thin strokes hard to distinguish.
  return (await readVinLine(frame, worker, 24, 1, [24, 18, 32]))
    ?? readVinLine(frame, worker, 32, 1.25, [16, 20])
}

async function readVinLine(
  frame: HTMLCanvasElement, worker: Worker, contrastLevel: number, scale: number, thresholds: number[],
) {
  const contrast = brightDetails(frame, 12, contrastLevel)
  const line = contrast && findVinLine(contrast)
  if (!line) return null
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(line.width * scale)
  canvas.height = Math.round(line.height * scale)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  context.drawImage(frame, line.x, line.y, line.width, line.height, 0, 0, canvas.width, canvas.height)

  // Require agreement between two contrast levels before accepting faint text.
  const binary = document.createElement('canvas')
  binary.width = canvas.width
  binary.height = canvas.height
  const output = binary.getContext('2d')
  if (!output) return null
  const seen = new Set<string>()
  for (const threshold of thresholds) {
    const image = brightDetails(canvas, Math.round(12 * scale), threshold)
    if (!image) continue
    output.putImageData(image, 0, 0)
    const { data } = await worker.recognize(binary)
    const vin = vinCharactersOnly(data.text)
    if (!hasVinCheckDigit(vin)) continue
    if (seen.has(vin)) return vin
    seen.add(vin)
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
  if (!vw || !vh || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null
  const scale = Math.max(screen.width / vw, screen.height / vh)
  const offsetX = (scale * vw - screen.width) / 2
  const offsetY = (scale * vh - screen.height) / 2
  // Snap to sensor pixels so fractional CSS positions do not blur thin strokes.
  const left = (plate.left - screen.left + offsetX) / scale
  const right = (plate.right - screen.left + offsetX) / scale
  // Include the text at the edges of the guide, even on narrow displays.
  const margin = (right - left) * 0.1
  const sx = Math.max(0, Math.round(left - margin))
  const sy = Math.round((plate.top - screen.top + offsetY) / scale)
  const sw = Math.min(vw, Math.round(right + margin)) - sx
  const sh = Math.round(plate.height / scale)

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
  canvas.getContext('2d', { willReadFrequently: true })?.drawImage(video, sx, sy, sw, sh, 0, 0, outW, outH)
  return canvas
}
