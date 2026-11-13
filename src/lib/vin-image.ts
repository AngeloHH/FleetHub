/**
 * Keep pixels brighter than their local background. This brings out white
 * letters and QR modules even when reflected sky changes the background.
 */
export function brightDetails(frame: HTMLCanvasElement, radius: number, contrast: number) {
  const { width, height } = frame
  const context = frame.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  const image = context.getImageData(0, 0, width, height)
  const { data } = image
  const stride = width + 1
  const sums = new Uint32Array(stride * (height + 1))
  const grey = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    let row = 0
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const p = i * 4
      grey[i] = Math.round((299 * data[p] + 587 * data[p + 1] + 114 * data[p + 2]) / 1000)
      row += grey[i]
      sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1] + row
    }
  }
  for (let y = 0; y < height; y++) {
    const top = Math.max(0, y - radius)
    const bottom = Math.min(height, y + radius + 1)
    for (let x = 0; x < width; x++) {
      const left = Math.max(0, x - radius)
      const right = Math.min(width, x + radius + 1)
      const total = sums[bottom * stride + right] - sums[top * stride + right]
        - sums[bottom * stride + left] + sums[top * stride + left]
      const mean = total / ((bottom - top) * (right - left))
      const i = y * width + x
      const value = grey[i] > mean + contrast ? 0 : 255
      data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = value
    }
  }
  return image
}

type Box = { x: number; y: number; width: number; height: number }

function* inkComponents(ink: Uint8Array, width: number, height: number) {
  const seen = new Uint8Array(width * height)
  for (let i = 0; i < seen.length; i++) {
    if (seen[i] || !ink[i]) continue
    const pixels = [i]
    seen[i] = 1
    let left = width
    let right = 0
    let top = height
    let bottom = 0
    for (let p = 0; p < pixels.length; p++) {
      const pixel = pixels[p]
      const x = pixel % width
      const y = Math.floor(pixel / width)
      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
      for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny++) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx++) {
          const next = ny * width + nx
          if (seen[next] || !ink[next]) continue
          seen[next] = 1
          pixels.push(next)
        }
      }
    }
    yield { x: left, y: top, width: right - left + 1, height: bottom - top + 1, pixels }
  }
}

function glyphRow(glyphs: Box[], maxGap: number) {
  let best: Box[] = []
  glyphs.sort((a, b) => a.x - b.x)
  for (const first of glyphs) {
    const row = [first]
    for (const next of glyphs) {
      const last = row[row.length - 1]
      const gap = next.x - (last.x + last.width)
      if (gap > first.height * maxGap) break
      if (gap < 0 || Math.abs(next.y - last.y) > first.height * 0.35) continue
      if (Math.abs(next.height - first.height) > first.height * 0.22) continue
      row.push(next)
    }
    if (row.length > best.length) best = row
  }
  return best
}

/** Isolate a row of similarly sized glyphs from dust, logos and the QR. */
export function findVinLine({ data, width, height }: ImageData): Box | null {
  const ink = Uint8Array.from({ length: width * height }, (_, p) => Number(data[p * 4] === 0))
  const glyphs: Box[] = []
  for (const { x, y, width: w, height: h } of inkComponents(ink, width, height)) {
    if (h >= 12 && w >= h * 0.16 && w <= h) glyphs.push({ x, y, width: w, height: h })
  }
  const best = glyphRow(glyphs, 0.85)
  if (best.length < 14 || best.length > 19) return null

  const padding = best[0].height
  const x = Math.max(0, best[0].x - Math.round(padding * 0.65))
  const y = Math.max(0, Math.min(...best.map((glyph) => glyph.y)) - Math.round(padding * 0.25))
  const right = Math.min(width, Math.max(...best.map((glyph) => glyph.x + glyph.width)) + Math.round(padding * 0.53))
  const bottom = Math.min(height, Math.max(...best.map((glyph) => glyph.y + glyph.height)) + Math.round(padding * 0.03))
  return { x, y, width: right - x, height: bottom - y }
}

/**
 * Extract thin bright strokes by comparing a pixel with both sides of a
 * possible stroke. A one-sided brightness jump is usually a reflection edge.
 */
export function plateStrokes(frame: HTMLCanvasElement, radius: number, contrast: number, blue: boolean) {
  const context = frame.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  const { width, height } = frame
  const image = context.getImageData(0, 0, width, height)
  const { data } = image
  const raw = Uint8Array.from({ length: width * height }, (_, p) => {
    const at = p * 4
    return blue ? data[at + 2] : (299 * data[at] + 587 * data[at + 1] + 114 * data[at + 2]) / 1000
  })
  const grey = new Float32Array(raw.length)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const p = y * width + x
      grey[p] = (4 * raw[p] + 2 * (raw[p - 1] + raw[p + 1] + raw[p - width] + raw[p + width])
        + raw[p - width - 1] + raw[p - width + 1] + raw[p + width - 1] + raw[p + width + 1]) / 16
    }
  }
  const ink = new Uint8Array(raw.length)
  const vertical = width * radius
  for (let y = radius + 1; y < height - radius - 1; y++) {
    for (let x = radius + 1; x < width - radius - 1; x++) {
      const p = y * width + x
      const background = Math.min(
        Math.max(grey[p - radius], grey[p + radius]),
        Math.max(grey[p - vertical], grey[p + vertical]),
        Math.max(grey[p - vertical - radius], grey[p + vertical + radius]),
        Math.max(grey[p - vertical + radius], grey[p + vertical - radius]),
      )
      const sensitivity = Math.max(0.18, Math.min(1.15, (255 - background) / 110))
      ink[p] = Number(grey[p] - background >= contrast * sensitivity)
    }
  }
  const glyphs: Box[] = []
  for (const { x, y, width: w, height: h, pixels } of inkComponents(ink, width, height)) {
    if (pixels.length < 20 || h < 7 || w > width * 0.2) {
      for (const p of pixels) ink[p] = 0
    } else if (h >= 14 && w >= h * 0.14 && w <= h) {
      glyphs.push({ x, y, width: w, height: h })
    }
  }
  for (let p = 0; p < ink.length; p++) {
    const foreground = ink[p] || ink[p - 1] || ink[p + 1] || ink[p - width] || ink[p + width]
    data[p * 4] = data[p * 4 + 1] = data[p * 4 + 2] = foreground ? 0 : 255
  }
  return { image, glyphs }
}

export function estimatePlateLine(glyphs: Box[], width: number, height: number, wide = false) {
  const row = glyphRow(glyphs, 1.55)
  if (row.length < 9) return null
  const first = row[0]
  const last = row[row.length - 1]
  const textHeight = row.map((glyph) => glyph.height).sort((a, b) => a - b)[Math.floor(row.length / 2)]
  const slope = (last.y - first.y) / (last.x - first.x)
  const top = Math.min(...row.map((glyph) => glyph.y - (glyph.x - first.x) * slope))
  // Leave space for glyphs lost at either end of the line.
  const margin = textHeight * (row.length >= 16 ? 0.9 : wide ? 2.65 : 1.6)
  const x = Math.max(0, Math.round(first.x - margin))
  const y = Math.max(0, Math.round(top - textHeight * 0.3))
  const right = Math.min(width, Math.round(last.x + last.width + margin * (wide ? 0.8 : 1)))
  const bottom = Math.min(height, Math.round(top + Math.max(0, slope * (right - first.x)) + textHeight * (wide ? 1.22 : 1.45)))
  return { x, y, width: right - x, height: bottom - y, slope }
}
