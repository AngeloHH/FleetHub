// Turns the `build:preview` output into a single self-contained HTML fragment
// that can be published as a shareable page.
//
// Two things the singlefile build can leave behind:
//   1. An SVG sprite in `public/`, referenced as `<use href="/icons.svg#id">`.
//      It stays an external file, so we inline it and rewrite the refs to `#id`.
//      Optional — the app currently ships its icons as components instead.
//   2. The `<!doctype>/<html>/<head>/<body>` wrapper, which the host supplies.

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const at = (p) => fileURLToPath(new URL(p, root))

const html = await readFile(at('dist-preview/index.html'), 'utf8')
const sprite = await readFile(at('public/icons.svg'), 'utf8').catch(() => '')

const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? 'FleetHub'

// Everything inside <head> minus the bits the host owns (charset, viewport,
// title, favicon), plus everything inside <body>.
const head = html.match(/<head>([\s\S]*?)<\/head>/)?.[1] ?? ''
const body = html.match(/<body>([\s\S]*?)<\/body>/)?.[1] ?? ''

const keptHead = head
  .replace(/<meta\s+charset[^>]*>/gi, '')
  .replace(/<meta\s+name="viewport"[^>]*>/gi, '')
  .replace(/<title>[\s\S]*?<\/title>/gi, '')
  .replace(/<link\s+rel="icon"[^>]*>/gi, '')

// Hidden sprite: same symbol ids, now same-document, so `<use href="#id">` resolves.
const inlineSprite = sprite
  ? sprite
      .replace(/<\?xml[^>]*\?>/g, '')
      .replace(/<svg/, '<svg aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden"')
  : ''

const fragment = `<title>${title}</title>
${keptHead.trim()}
${inlineSprite.trim()}
${body.trim()}`.replace(/(?:\.?\/|\/)icons\.svg#/g, '#')

await writeFile(at('dist-preview/preview.html'), fragment)

const remaining = [...fragment.matchAll(/(?:src|href)=[`"'](?!#|https?:|data:|mailto:)([^`"']+)/g)]
  .map((m) => m[1])
if (remaining.length) {
  console.error('External refs left behind (page will not be self-contained):', remaining)
  process.exit(1)
}
console.log(`preview.html written — ${(fragment.length / 1024).toFixed(0)} kB, no external refs`)
