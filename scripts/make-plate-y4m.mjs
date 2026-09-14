// Fabrica la cámara falsa del e2e: un y4m con la placa del VIN estampado.
// Chromium lo sirve como si fuera el sensor, y el visor no distingue — ni debe.
import { chromium } from 'playwright'
import { PNG } from 'pngjs'
import { writeFileSync } from 'fs'

export async function makePlateY4m(path, vin = '3MVDMBBM2PM512094') {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const page = await browser.newPage({ viewport: { width: 780, height: 1688 } })
  await page.setContent(`
    <body style="margin:0;background:#3a3d38">
      <div style="position:absolute;left:60px;top:700px;width:660px;height:240px;
           background:linear-gradient(180deg,#cfd2cc,#b8bcb4);display:flex;
           align-items:center;justify-content:center">
        <span style="font:700 54px monospace;letter-spacing:4px;color:#22241f">${vin}</span>
      </div>
    </body>`)
  const png = PNG.sync.read(await page.screenshot())
  await browser.close()

  const { width: w, height: h, data } = png
  const ySize = w * h
  const cSize = ySize / 4
  const y = Buffer.alloc(ySize)
  const u = Buffer.alloc(cSize)
  const v = Buffer.alloc(cSize)
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const at = (j * w + i) * 4
      const [r, g, b] = [data[at], data[at + 1], data[at + 2]]
      y[j * w + i] = Math.min(235, Math.max(16, Math.round(0.257 * r + 0.504 * g + 0.098 * b + 16)))
      if (j % 2 === 0 && i % 2 === 0) {
        const c = (j / 2) * (w / 2) + i / 2
        u[c] = Math.round(-0.148 * r - 0.291 * g + 0.439 * b + 128)
        v[c] = Math.round(0.439 * r - 0.368 * g - 0.071 * b + 128)
      }
    }
  const frame = Buffer.concat([Buffer.from('FRAME\n'), y, u, v])
  const head = Buffer.from(`YUV4MPEG2 W${w} H${h} F10:1 Ip A1:1 C420\n`)
  // Seis cuadros del mismo sitio: Chromium repite el archivo en bucle, y la
  // placa no se mueve.
  writeFileSync(path, Buffer.concat([head, ...Array(6).fill(frame)]))
}
