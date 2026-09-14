// Las fotografías, antes de tocar el almacenamiento.
//
// Una foto de una unidad llega desde el teléfono de quien está delante de ella,
// y un archivo de cámara trae escrito mucho más que la unidad: dónde se tomó,
// con qué aparato, a veces con qué número de serie. Nada de eso es del reporte
// y nada de eso debe quedar guardado, así que se quita aquí y no «más
// adelante»: lo que se guarda con metadatos ya está publicado.
//
// También se ponen los topes. No los del disco —eso lo decide el contrato de
// almacenamiento— sino los que impiden que un archivo pequeño cueste mucho:
// una imagen de doce mil por doce mil ocupa poco comprimida y media hora de
// CPU al abrirla. El tamaño declarado se comprueba sin descomprimir nada.
//
// Este módulo no sabe de HTTP: devuelve razones de máquina y quien lo llama
// decide el status y el texto que lee el operador.

/** Lo que puede pesar una foto. Suficiente para 1280 px al 80 % con margen. */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024
/** Lado máximo admitido, en píxeles. */
export const MAX_PHOTO_SIDE = 12_000
/** Superficie máxima. Es el tope que de verdad protege de una bomba de zip. */
export const MAX_PHOTO_PIXELS = 40_000_000

const JPEG_SOI = Buffer.from([0xff, 0xd8])
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

/**
 * Los segmentos de un JPEG que sólo describen la toma.
 *
 * APP0 se conserva porque es JFIF —densidad y miniatura del propio formato— y
 * quitarlo deja archivos que algunos lectores antiguos rechazan. De APP1 en
 * adelante viven EXIF, XMP e IPTC, que es exactamente lo que sobra, y COM es
 * un comentario libre donde cabe cualquier cosa.
 */
const dropsJpegSegment = (marker) => (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe

/** Los trozos de un PNG que llevan texto o fecha. iCCP se queda: es color. */
const PNG_METADATA = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME'])

const readUInt16 = (data, at) => data.readUInt16BE(at)

// ── Medidas ──────────────────────────────────────────────────────────────────

function jpegSize(data) {
  let at = 2
  while (at + 4 <= data.length) {
    if (data[at] !== 0xff) return null
    const marker = data[at + 1]
    // Los marcadores sin carga: relleno, reinicio y fin.
    if (marker === 0xff) { at += 1; continue }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { at += 2; continue }
    const length = readUInt16(data, at + 2)
    if (length < 2) return null
    // SOF0…SOF15, menos los tres que comparten el rango y no describen la trama.
    const isFrame = marker >= 0xc0 && marker <= 0xcf
      && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isFrame) {
      if (at + 9 > data.length) return null
      return { height: readUInt16(data, at + 5), width: readUInt16(data, at + 7) }
    }
    if (marker === 0xda) return null
    at += 2 + length
  }
  return null
}

function pngSize(data) {
  if (data.length < 24 || data.subarray(12, 16).toString('latin1') !== 'IHDR') return null
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
}

function webpSize(data) {
  for (const chunk of riffChunks(data)) {
    if (chunk.type === 'VP8X' && chunk.data.length >= 10)
      return {
        width: chunk.data.readUIntLE(4, 3) + 1,
        height: chunk.data.readUIntLE(7, 3) + 1,
      }
    if (chunk.type === 'VP8 ' && chunk.data.length >= 10) {
      // Trama clave: tres bytes de arranque, dos de firma y las medidas en
      // catorce bits cada una.
      if (chunk.data[3] !== 0x9d || chunk.data[4] !== 0x01 || chunk.data[5] !== 0x2a) return null
      return {
        width: chunk.data.readUInt16LE(6) & 0x3fff,
        height: chunk.data.readUInt16LE(8) & 0x3fff,
      }
    }
    if (chunk.type === 'VP8L' && chunk.data.length >= 5) {
      if (chunk.data[0] !== 0x2f) return null
      const bits = chunk.data.readUInt32LE(1)
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
    }
  }
  return null
}

// ── RIFF ─────────────────────────────────────────────────────────────────────

function* riffChunks(data) {
  if (data.length < 12 || data.subarray(0, 4).toString('latin1') !== 'RIFF') return
  let at = 12
  while (at + 8 <= data.length) {
    const type = data.subarray(at, at + 4).toString('latin1')
    const size = data.readUInt32LE(at + 4)
    if (size > data.length - at - 8) return
    yield { type, data: data.subarray(at + 8, at + 8 + size), size, at }
    // Los trozos de un RIFF empiezan siempre en posición par.
    at += 8 + size + (size % 2)
  }
}

// ── Limpieza ─────────────────────────────────────────────────────────────────

function stripJpeg(data) {
  const kept = [JPEG_SOI]
  let at = 2
  while (at + 2 <= data.length) {
    if (data[at] !== 0xff) break
    const marker = data[at + 1]
    if (marker === 0xff) { at += 1; continue }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      kept.push(data.subarray(at, at + 2))
      at += 2
      continue
    }
    if (marker === 0xd9) { kept.push(data.subarray(at, at + 2)); at += 2; break }
    if (at + 4 > data.length) break
    const length = readUInt16(data, at + 2)
    if (length < 2 || at + 2 + length > data.length) break
    if (marker === 0xda) {
      // A partir del comienzo del barrido ya no hay segmentos que separar:
      // es la imagen comprimida y viaja tal cual.
      kept.push(data.subarray(at))
      at = data.length
      break
    }
    if (!dropsJpegSegment(marker)) kept.push(data.subarray(at, at + 2 + length))
    at += 2 + length
  }
  return Buffer.concat(kept)
}

function stripPng(data) {
  const kept = [data.subarray(0, 8)]
  let at = 8
  while (at + 8 <= data.length) {
    const length = data.readUInt32BE(at)
    const type = data.subarray(at + 4, at + 8).toString('latin1')
    const end = at + 12 + length
    if (length > data.length - at - 12) break
    if (!PNG_METADATA.has(type)) kept.push(data.subarray(at, end))
    at = end
    if (type === 'IEND') break
  }
  return Buffer.concat(kept)
}

function stripWebp(data) {
  const kept = []
  let changed = false
  for (const chunk of riffChunks(data)) {
    if (chunk.type === 'EXIF' || chunk.type === 'XMP ') { changed = true; continue }
    const whole = data.subarray(chunk.at, chunk.at + 8 + chunk.size + (chunk.size % 2))
    if (chunk.type === 'VP8X' && chunk.size >= 1) {
      // Las banderas dicen que el archivo trae EXIF o XMP. Al quitarlos hay
      // que apagarlas, o un lector estricto buscará lo que ya no está.
      const copy = Buffer.from(whole)
      const flags = copy[8]
      copy[8] = flags & ~0x0c
      if (copy[8] !== flags) changed = true
      kept.push(copy)
      continue
    }
    kept.push(whole)
  }
  if (!kept.length) return data
  const body = Buffer.concat(kept)
  const out = Buffer.alloc(12 + body.length)
  out.write('RIFF', 0, 'latin1')
  out.writeUInt32LE(4 + body.length, 4)
  out.write('WEBP', 8, 'latin1')
  body.copy(out, 12)
  return changed || out.length !== data.length ? out : data
}

// ── Los formatos que se aceptan ──────────────────────────────────────────────

/**
 * Qué se admite y qué se hace con ello.
 *
 * HEIC y HEIF no están, y su ausencia es una decisión y no un olvido: son
 * contenedores ISOBMFF cuyos metadatos no se pueden quitar sin decodificarlos,
 * y guardar una foto de iPhone con su EXIF intacto es publicar dónde estaba
 * quien la tomó. La aplicación nunca envía una: la cámara pasa por un lienzo y
 * lo que sube es siempre JPEG. Un cliente que mande HEIC recibe un 415 que se
 * lo dice.
 */
export const PHOTO_TYPES = {
  'image/jpeg': {
    ext: 'jpg',
    valid: (data) => data.length > 3 && data.subarray(0, 2).equals(JPEG_SOI) && data[2] === 0xff,
    size: jpegSize,
    strip: stripJpeg,
  },
  'image/png': {
    ext: 'png',
    valid: (data) => data.subarray(0, 8).equals(PNG_SIGNATURE),
    size: pngSize,
    strip: stripPng,
  },
  'image/webp': {
    ext: 'webp',
    valid: (data) => data.length >= 12
      && data.subarray(0, 4).toString('latin1') === 'RIFF'
      && data.subarray(8, 12).toString('latin1') === 'WEBP',
    size: webpSize,
    strip: stripWebp,
  },
}

/**
 * Acepta una foto, o dice por qué no.
 *
 * El orden importa: primero el tipo, luego que el archivo sea de verdad de ese
 * tipo, luego lo que mide —sin descomprimirlo— y sólo al final se limpia. Así
 * nada de lo caro se hace sobre algo que iba a rechazarse igualmente.
 */
export function acceptPhoto(contentType, data, { maxBytes = MAX_PHOTO_BYTES } = {}) {
  const type = PHOTO_TYPES[String(contentType ?? '').split(';')[0].trim().toLowerCase()]
  if (!type) return { ok: false, error: 'UNSUPPORTED_PHOTO' }
  if (!Buffer.isBuffer(data) || !type.valid(data)) return { ok: false, error: 'INVALID_PHOTO' }
  if (data.length > maxBytes) return { ok: false, error: 'PHOTO_TOO_LARGE' }

  const size = type.size(data)
  if (!size || !Number.isInteger(size.width) || !Number.isInteger(size.height)
    || size.width < 1 || size.height < 1)
    return { ok: false, error: 'INVALID_PHOTO' }
  if (size.width > MAX_PHOTO_SIDE || size.height > MAX_PHOTO_SIDE
    || size.width * size.height > MAX_PHOTO_PIXELS)
    return { ok: false, error: 'PHOTO_TOO_LARGE' }

  const clean = type.strip(data)
  return {
    ok: true,
    ext: type.ext,
    data: clean,
    width: size.width,
    height: size.height,
    /** Cuánto se quitó. Cero significa que no traía metadatos, no que no se miró. */
    strippedBytes: data.length - clean.length,
  }
}
