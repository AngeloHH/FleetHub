import { describe, expect, test } from 'vitest'
import { acceptPhoto, MAX_PHOTO_BYTES, PHOTO_TYPES } from './photos.mjs'

const be16 = (value) => Buffer.from([value >> 8, value & 0xff])

/** Un JPEG mínimo pero válido: SOI, JFIF, un SOF0 con medidas y el barrido. */
function jpeg({ width = 640, height = 480, extras = [] } = {}) {
  const app0 = Buffer.concat([
    Buffer.from([0xff, 0xe0]), be16(16),
    Buffer.from('JFIF\0', 'latin1'), Buffer.from([1, 1, 0, 0, 1, 0, 1, 0, 0]),
  ])
  const sof0 = Buffer.concat([
    Buffer.from([0xff, 0xc0]), be16(11), Buffer.from([8]),
    be16(height), be16(width), Buffer.from([1, 1, 0x11, 0]),
  ])
  const sos = Buffer.concat([
    Buffer.from([0xff, 0xda]), be16(8), Buffer.from([1, 1, 0, 0, 63, 0]),
    Buffer.from([0x12, 0x34, 0x56]), Buffer.from([0xff, 0xd9]),
  ])
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, ...extras, sof0, sos])
}

const jpegSegment = (marker, payload) =>
  Buffer.concat([Buffer.from([0xff, marker]), be16(payload.length + 2), payload])

const exif = () => jpegSegment(0xe1, Buffer.concat([
  Buffer.from('Exif\0\0', 'latin1'),
  // Un bloque TIFF de mentira con lo que de verdad preocupa dentro.
  Buffer.from('MM\0*GPSLatitude 25.7617 GPSLongitude -80.1918', 'latin1'),
]))

const xmp = () => jpegSegment(0xe2, Buffer.from('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>', 'latin1'))
const comment = () => jpegSegment(0xfe, Buffer.from('iPhone 15 Pro de Ángela', 'latin1'))

const crc = (() => {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  return (buffer) => {
    let c = 0xffffffff
    for (const byte of buffer) c = table[(c ^ byte) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
})()

function pngChunk(type, data = Buffer.alloc(0)) {
  const head = Buffer.alloc(4)
  head.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const tail = Buffer.alloc(4)
  tail.writeUInt32BE(crc(body), 0)
  return Buffer.concat([head, body, tail])
}

function png({ width = 32, height = 24, extras = [] } = {}) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.writeUInt8(8, 8)
  ihdr.writeUInt8(6, 9)
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    ...extras,
    pngChunk('IDAT', Buffer.from([0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x01])),
    pngChunk('IEND'),
  ])
}

function riff(chunks) {
  const body = Buffer.concat(chunks.map(({ type, data }) => {
    const head = Buffer.alloc(8)
    head.write(type, 0, 'latin1')
    head.writeUInt32LE(data.length, 4)
    return Buffer.concat([head, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)])
  }))
  const out = Buffer.alloc(12 + body.length)
  out.write('RIFF', 0, 'latin1')
  out.writeUInt32LE(4 + body.length, 4)
  out.write('WEBP', 8, 'latin1')
  body.copy(out, 12)
  return out
}

function webpExtended({ width = 100, height = 50, withMetadata = true } = {}) {
  const vp8x = Buffer.alloc(10)
  vp8x[0] = withMetadata ? 0x0c : 0x00
  vp8x.writeUIntLE(width - 1, 4, 3)
  vp8x.writeUIntLE(height - 1, 7, 3)
  return riff([
    { type: 'VP8X', data: vp8x },
    { type: 'VP8 ', data: Buffer.alloc(16) },
    ...(withMetadata
      ? [
          { type: 'EXIF', data: Buffer.from('GPSLatitude 25.7617', 'latin1') },
          { type: 'XMP ', data: Buffer.from('<x:xmpmeta/>', 'latin1') },
        ]
      : []),
  ])
}

describe('fotografías admitidas', () => {
  test('un JPEG entra y sale sin EXIF, sin XMP y sin comentario', () => {
    const dirty = jpeg({ extras: [exif(), xmp(), comment()] })
    expect(dirty.toString('latin1')).toContain('GPSLatitude')

    const accepted = acceptPhoto('image/jpeg', dirty)
    expect(accepted.ok).toBe(true)
    expect(accepted).toMatchObject({ ext: 'jpg', width: 640, height: 480 })
    expect(accepted.data.toString('latin1')).not.toContain('GPSLatitude')
    expect(accepted.data.toString('latin1')).not.toContain('xmpmeta')
    expect(accepted.data.toString('latin1')).not.toContain('Ángela')
    expect(accepted.strippedBytes).toBeGreaterThan(0)
  })

  test('conserva JFIF y la trama comprimida intactas', () => {
    const clean = acceptPhoto('image/jpeg', jpeg({ extras: [exif()] })).data
    expect(clean.toString('latin1')).toContain('JFIF')
    // Cabecera, SOF y barrido siguen ahí y el archivo abre por el principio.
    expect(clean.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]))
    expect(clean.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]))
    expect(clean.includes(Buffer.from([0xff, 0xda]))).toBe(true)
  })

  test('una foto sin metadatos no se toca', () => {
    const original = jpeg()
    const accepted = acceptPhoto('image/jpeg', original)
    expect(accepted.strippedBytes).toBe(0)
    expect(accepted.data).toEqual(original)
  })

  test('un PNG pierde el texto y la fecha, y conserva la imagen', () => {
    const dirty = png({
      extras: [
        pngChunk('tEXt', Buffer.from('Author\0Ángela', 'latin1')),
        pngChunk('eXIf', Buffer.from('MM\0*GPSLatitude', 'latin1')),
        pngChunk('tIME', Buffer.alloc(7)),
      ],
    })
    const accepted = acceptPhoto('image/png', dirty)
    expect(accepted).toMatchObject({ ok: true, ext: 'png', width: 32, height: 24 })
    expect(accepted.data.toString('latin1')).not.toContain('GPSLatitude')
    expect(accepted.data.toString('latin1')).not.toContain('Author')
    expect(accepted.data.toString('latin1')).toContain('IDAT')
    expect(accepted.data.toString('latin1')).toContain('IEND')
  })

  test('un WebP pierde EXIF y XMP, y apaga las banderas que los anunciaban', () => {
    const accepted = acceptPhoto('image/webp', webpExtended())
    expect(accepted).toMatchObject({ ok: true, ext: 'webp', width: 100, height: 50 })
    expect(accepted.data.toString('latin1')).not.toContain('GPSLatitude')
    expect(accepted.data.toString('latin1')).not.toContain('xmpmeta')
    // El primer byte del VP8X es el de las banderas: sin EXIF ni XMP.
    expect(accepted.data[20] & 0x0c).toBe(0)
    // Y el tamaño declarado del RIFF sigue cuadrando con lo que queda.
    expect(accepted.data.readUInt32LE(4)).toBe(accepted.data.length - 8)
  })
})

describe('fotografías rechazadas', () => {
  test('HEIC y HEIF no se aceptan porque no se pueden limpiar', () => {
    const heic = Buffer.concat([
      Buffer.alloc(4), Buffer.from('ftypheic', 'latin1'), Buffer.alloc(16),
    ])
    expect(acceptPhoto('image/heic', heic)).toMatchObject({ error: 'UNSUPPORTED_PHOTO' })
    expect(acceptPhoto('image/heif', heic)).toMatchObject({ error: 'UNSUPPORTED_PHOTO' })
    expect(PHOTO_TYPES['image/heic']).toBeUndefined()
  })

  test('un tipo que no es imagen, o un archivo que miente sobre el suyo', () => {
    expect(acceptPhoto('application/pdf', Buffer.from('%PDF-1.7')))
      .toMatchObject({ error: 'UNSUPPORTED_PHOTO' })
    expect(acceptPhoto('image/png', jpeg())).toMatchObject({ error: 'INVALID_PHOTO' })
    expect(acceptPhoto('image/jpeg', Buffer.from('no soy una foto')))
      .toMatchObject({ error: 'INVALID_PHOTO' })
  })

  test('una imagen enorme se rechaza sin descomprimirla', () => {
    expect(acceptPhoto('image/png', png({ width: 20_000, height: 20_000 })))
      .toMatchObject({ error: 'PHOTO_TOO_LARGE' })
    expect(acceptPhoto('image/jpeg', jpeg({ width: 9_000, height: 9_000 })))
      .toMatchObject({ error: 'PHOTO_TOO_LARGE' })
  })

  test('un archivo que pasa del tope de bytes', () => {
    const big = Buffer.concat([jpeg(), Buffer.alloc(MAX_PHOTO_BYTES)])
    expect(acceptPhoto('image/jpeg', big)).toMatchObject({ error: 'PHOTO_TOO_LARGE' })
  })

  test('un JPEG sin marco no dice cuánto mide y no entra', () => {
    const sinSof = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]), be16(4), Buffer.from([0, 0]),
      Buffer.from([0xff, 0xd9]),
    ])
    expect(acceptPhoto('image/jpeg', sinSof)).toMatchObject({ error: 'INVALID_PHOTO' })
  })

  test('el tipo viaja con parámetros y aun así se reconoce', () => {
    expect(acceptPhoto('IMAGE/JPEG; charset=binary', jpeg()).ok).toBe(true)
  })
})
