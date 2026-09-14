// Design tokens lifted from FleetHub.dc.html.
//
// The design is an "industrial console": square corners everywhere
// (border-radius is 0 by default), heavy Archivo for headings, IBM Plex Mono
// for every label, and a single orange accent doing all the signalling.

export const color = {
  /** Page behind the device frames. */
  canvas: '#141217',
  /** Muted lilac used for the gallery's screen captions. */
  canvasLabel: '#9a93a8',
  canvasTitle: '#f5f2ec',

  /** Screen background. */
  bg: '#e8e9e4',
  /** Cards, fields, raised rows. */
  surface: '#f4f5f1',
  /** Inset headers and filled tracks. */
  surfaceAlt: '#dcdfd8',

  /** Near-black used for strips, footers and primary borders. */
  ink: '#1c1e1a',
  /** Body text on dark strips. */
  inkOn: '#e8e9e4',
  /** Secondary text on dark strips. */
  inkOnMuted: '#9aa093',
  /** Outline on dark strips. */
  inkBorder: '#4b4f47',

  border: '#c8ccc2',
  borderSoft: '#dcdfd8',
  muted: '#7e8478',
  mutedSoft: '#a9ada3',
  mutedDeep: '#5b6055',

  accent: '#e8590c',
  accentHover: '#c94a08',
  accentSoft: '#fdf1e9',

  ok: '#1c7a3d',
  okSoft: '#d9efdc',
  okBright: '#7ee2a0',

  warn: '#b07d00',
  warnSoft: '#fdf8ec',
  warnBright: '#ffd166',

  danger: '#b3261e',
  dangerSoft: '#fdf0ee',
} as const

export const font = {
  sans: "'Archivo', system-ui, -apple-system, sans-serif",
  mono: "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace",
  serif: "'Instrument Serif', Georgia, serif",
} as const

/** Device frame size the design was drawn against. */
export const device = { width: 402, height: 874 } as const

/**
 * The dark strip every screen hangs below sits at y=54 — clear of the status
 * bar — and content starts at 96. Screens with a taller header start at 110.
 */
export const layout = {
  stripTop: 54,
  contentTop: 96,
  /** Operator tab bar / admin tab bar. */
  navHeight: 88,
  /** Two-button save/cancel footer. */
  actionBarHeight: 96,
} as const

/** Uppercase monospace caption — the design's most repeated text style. */
export function label(size = 9, letterSpacing = 2, c: string = color.muted) {
  return {
    fontFamily: font.mono,
    fontSize: size,
    letterSpacing,
    color: c,
  } as const
}
