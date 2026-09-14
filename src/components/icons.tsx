// Icons used across the FleetHub screens.
//
// Most are Material Symbols Sharp at weight 400, drawn by the subset font that
// scripts/build-icon-font.mjs inlines. Four are still the design's own strokes,
// kept because Material has no glyph that means the same thing — see below.
//
// Every icon carries data-icon so it can be found without matching path data.

type IconProps = {
  size?: number
  color?: string
  /** Stroke width. Only the hand-drawn icons have one. */
  width?: number
  style?: React.CSSProperties
}

/**
 * A Material Symbol, addressed by its ligature. Decorative by definition —
 * every control that uses one names itself, and without aria-hidden a screen
 * reader would read the ligature out as "chevron_right".
 */
function Glyph({
  name,
  ligature,
  size = 16,
  color = 'currentColor',
  style,
}: IconProps & { name: string; ligature: string }) {
  return (
    <span
      className="fh-icon"
      data-icon={name}
      aria-hidden="true"
      style={{ fontSize: size, color, ...style }}
    >
      {ligature}
    </span>
  )
}

function Icon({
  name,
  size = 16,
  color = 'currentColor',
  width = 2,
  style,
  children,
  cap = 'round',
  join,
}: IconProps & {
  name: string
  children: React.ReactNode
  cap?: 'round' | 'butt'
  join?: 'round'
}) {
  return (
    <svg
      data-icon={name}
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinecap={cap}
      strokeLinejoin={join}
      style={{ flex: 'none', ...style }}
    >
      {children}
    </svg>
  )
}

export const ChevronLeft = (p: IconProps) => <Glyph name="chevron-left" ligature="chevron_left" {...p} />
export const ChevronRight = (p: IconProps) => <Glyph name="chevron-right" ligature="chevron_right" {...p} />
export const ChevronDown = (p: IconProps) => <Glyph name="chevron-down" ligature="keyboard_arrow_down" {...p} />
export const ChevronUp = (p: IconProps) => <Glyph name="chevron-up" ligature="keyboard_arrow_up" {...p} />
export const Close = (p: IconProps) => <Glyph name="close" ligature="close" {...p} />
export const Check = (p: IconProps) => <Glyph name="check" ligature="check" {...p} />
export const Search = (p: IconProps) => <Glyph name="search" ligature="search" {...p} />
export const Sliders = (p: IconProps) => <Glyph name="sliders" ligature="tune" {...p} />
export const Crosshair = (p: IconProps) => <Glyph name="crosshair" ligature="my_location" {...p} />
export const MapIcon = (p: IconProps) => <Glyph name="map" ligature="map" {...p} />
// The design draws the fleet's vehicle twice, with wheels for the operator's
// tab bar and without for the admin's. Material has the one truck, so both
// bars now carry it.
export const Truck = (p: IconProps) => <Glyph name="truck" ligature="local_shipping" {...p} />
export const TruckPlain = (p: IconProps) => (
  <Glyph name="truck-plain" ligature="local_shipping" {...p} />
)
export const Bell = (p: IconProps) => <Glyph name="bell" ligature="notifications" {...p} />
export const User = (p: IconProps) => <Glyph name="user" ligature="person" {...p} />
export const Grid = (p: IconProps) => <Glyph name="grid" ligature="grid_view" {...p} />
export const Users = (p: IconProps) => <Glyph name="users" ligature="group" {...p} />
export const FileText = (p: IconProps) => <Glyph name="file-text" ligature="description" {...p} />
export const Camera = (p: IconProps) => <Glyph name="camera" ligature="photo_camera" {...p} />
export const Bolt = (p: IconProps) => <Glyph name="bolt" ligature="bolt" {...p} />
export const Lines = (p: IconProps) => <Glyph name="lines" ligature="menu" {...p} />
export const Backspace = (p: IconProps) => <Glyph name="backspace" ligature="backspace" {...p} />
export const Refresh = (p: IconProps) => <Glyph name="refresh" ligature="refresh" {...p} />
export const Lock = (p: IconProps) => <Glyph name="lock" ligature="lock" {...p} />
export const Mail = (p: IconProps) => <Glyph name="mail" ligature="mail" {...p} />
export const Phone = (p: IconProps) => <Glyph name="phone" ligature="call" {...p} />
export const Send = (p: IconProps) => <Glyph name="send" ligature="send" {...p} />
export const Login = (p: IconProps) => <Glyph name="login" ligature="login" {...p} />
export const Dialpad = (p: IconProps) => <Glyph name="dialpad" ligature="dialpad" {...p} />
export const Edit = (p: IconProps) => <Glyph name="edit" ligature="edit" {...p} />
export const Save = (p: IconProps) => <Glyph name="save" ligature="save" {...p} />
export const Trash = (p: IconProps) => <Glyph name="trash" ligature="delete" {...p} />
export const ArrowRight = (p: IconProps) => <Glyph name="arrow-right" ligature="arrow_forward" {...p} />
export const Shield = (p: IconProps) => (
  <Glyph name="shield" ligature="admin_panel_settings" {...p} />
)

// ── Kept from the design ────────────────────────────────────────────────────
//
// Material's nearest glyphs mean something else here: qr_code_scanner draws a
// QR when what this app scans is a printed VIN, and there is no shutter at all
// — the closest is an empty circle.

export const Scan = (p: IconProps) => (
  <Icon name="scan" width={2.2} join="round" {...p}>
    <path d="M4 8V6a2 2 0 012-2h2M16 4h2a2 2 0 012 2v2M20 16v2a2 2 0 01-2 2h-2M8 20H6a2 2 0 01-2-2v-2" />
    <path d="M4 12h16" />
  </Icon>
)

/** Shutter glyph — a boxier camera than the photo-upload one. */
export const CameraShutter = (p: IconProps) => (
  <Icon name="camera-shutter" join="round" cap="butt" {...p}>
    <path d="M4 7h3l2-3h6l2 3h3v13H4z" />
    <circle cx="12" cy="13" r="3.5" />
  </Icon>
)
