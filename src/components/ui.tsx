// Building blocks shared by the FleetHub screens.

import type { CSSProperties, ReactNode } from 'react'
import { fleetStanding, lastSync } from '../data'
import { useData } from '../data/useData'
import { color, layout } from '../design/tokens'
import { sinceLabel } from '../domain'
import { Bell, ChevronLeft, Grid, MapIcon, Scan, Truck, TruckPlain, User, Users, FileText } from './icons'
import { pressable } from '../lib/press'
import s from './ui.module.css'

/** Full-bleed screen surface. Anchors to the device frame, not to a wrapper. */
export function Screen({
  children,
  background = color.bg,
}: {
  children: ReactNode
  background?: string
}) {
  return (
    <div className={s.screen} style={{ background }}>
      {children}
    </div>
  )
}

/**
 * Wordmark with the accent underscore the design puts in every strip title,
 * e.g. `FLEETHUB_OPS` renders the `_` in orange.
 */
export function StripTitle({ children }: { children: string }) {
  const i = children.indexOf('_')
  if (i === -1) return <>{children}</>
  return (
    <>
      {children.slice(0, i)}
      <span className={s.underscore}>_</span>
      {children.slice(i + 1)}
    </>
  )
}

/** The dark header strip, pinned just below the status bar. */
export function TopStrip({
  title,
  leading,
  trailing,
}: {
  title: string
  leading?: ReactNode
  trailing?: ReactNode
}) {
  return (
    <div className={s.strip}>
      <span className={s.stripTitle}>
        {leading}
        {/* The title keeps an element of its own: an icon font puts its
            ligature name in the DOM text, and sharing a node would splice
            "chevron_left" onto the front of the title. */}
        <span>
          <StripTitle>{title}</StripTitle>
        </span>
      </span>
      {trailing}
    </div>
  )
}

/** Small square that pulses — "live" indicator in strips and alert headers. */
export function Dot({
  background = color.okBright,
  size = 7,
  duration = '1.6s',
}: {
  background?: string
  size?: number
  duration?: string
}) {
  return (
    <span
      style={{
        width: size,
        height: size,
        background,
        animation: `fh-blink ${duration} infinite`,
        flex: 'none',
      }}
    />
  )
}

/** Right-hand strip text, optionally preceded by a status dot. */
export function StripMeta({
  children,
  c = color.inkOnMuted,
  dot,
  onClick,
  label,
}: {
  children: ReactNode
  c?: string
  dot?: string
  onClick?: () => void
  /** Accessible name, for when the children are more drawing than word. */
  label?: string
}) {
  return (
    <span
      {...pressable(onClick)}
      aria-label={onClick ? label : undefined}
      className={s.meta}
      style={{ color: c, cursor: onClick ? 'pointer' : undefined }}
    >
      {dot && <Dot background={dot} />}
      {children}
    </span>
  )
}

/**
 * The strip's live status: a pulsing square, then how long ago the log was
 * last added to and how many units the company has. Every screen inside the
 * session shows the same line, so it lives here rather than being retyped on
 * each of them — and it reads the same rows the rest of 06 counts, so the
 * strip and the donut cannot say different things about the same fleet.
 *
 * It is worked out on each render rather than ticking: a strip that counts up
 * by itself would have every screen redrawing once a minute to move a number
 * nobody is watching.
 */
export function SyncMeta() {
  const at = useData(lastSync)
  const fleet = useData(fleetStanding)
  const since = at ? `SYNC ${sinceLabel(at)}` : 'SIN REGISTROS'
  return (
    <StripMeta dot={color.okBright}>
      {fleet ? `${since} · ${fleet.total} UNIDADES` : since}
    </StripMeta>
  )
}

/**
 * The area between the strip and whatever bar the screen stands on: the part
 * of a screen that is actually its own. Every screen has one, so its offsets
 * are stated once here rather than retyped on each of them.
 */
export function ScreenBody({
  children,
  top,
  /** Clear of the tab bar by default; screens with a footer say 96, and the
      ones with neither say 0. */
  bottom = layout.navHeight,
  /**
   * Whether to draw a visible scroll region. Even without it, what does not
   * fit can be reached: the phone frame's 874 px were a guarantee the real
   * viewport does not give, and "simply cut off" became unreachable content
   * the moment the app filled screens shorter than the design.
   */
  scroll = false,
  style,
}: {
  children: ReactNode
  top?: number
  bottom?: number
  scroll?: boolean
  style?: CSSProperties
}) {
  return (
    <div className={scroll ? s.bodyScroll : s.body} style={{ top, bottom, ...style }}>
      {children}
    </div>
  )
}

/**
 * The chevron a screen carries when it was opened from another one.
 *
 * A real button, so it can be reached with the keyboard like every other
 * action. Without a handler it is a picture — the gallery draws every screen
 * out of context, with nothing behind it to go back to — and a disabled button
 * is neither focusable nor announced.
 */
export function BackChevron({ onClick }: { onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      // Without a handler it is decoration, so it says nothing and is not
      // announced — a screen reader has no business offering it.
      aria-label={onClick ? 'Volver' : undefined}
      aria-hidden={onClick ? undefined : true}
      className={`fh-focus-ring ${s.back}`}
      style={{ cursor: onClick ? 'pointer' : undefined }}
    >
      <ChevronLeft size={15} color={color.inkOn} />
    </button>
  )
}

/** Uppercase monospace caption that introduces a group. */
export function SectionLabel({
  children,
  className,
  style,
}: {
  children: ReactNode
  className?: string
  style?: CSSProperties
}) {
  return (
    <div className={className ? `${s.sectionLabel} ${className}` : s.sectionLabel} style={style}>
      {children}
    </div>
  )
}

/** Bordered container the design uses for every grouped list. */
export function Card({
  children,
  className,
  style,
  background = color.surface,
}: {
  children: ReactNode
  className?: string
  style?: CSSProperties
  background?: string
}) {
  return (
    <div className={className ? `${s.card} ${className}` : s.card} style={{ background, ...style }}>
      {children}
    </div>
  )
}

type BtnVariant = 'accent' | 'inkOutline' | 'ink' | 'ghostDark' | 'dangerOutline' | 'disabled'

/** Each variant's own look, and the class carrying its hover. */
const BTN: Record<BtnVariant, string> = {
  accent: `${s.accent} fh-btn-accent`,
  inkOutline: `${s.inkOutline} fh-btn-ink`,
  ink: `${s.ink} fh-btn-ink-accent`,
  ghostDark: `${s.ghostDark} fh-btn-ghost-dark`,
  dangerOutline: `${s.dangerOutline} fh-btn-danger`,
  disabled: s.disabled,
}

export function Btn({
  variant = 'accent',
  children,
  className,
  style,
  onClick,
}: {
  variant?: BtnVariant
  children: ReactNode
  className?: string
  style?: CSSProperties
  onClick?: () => void
}) {
  return (
    <button
      className={`${s.btn} ${BTN[variant]}${className ? ` ${className}` : ''}`}
      onClick={onClick}
      style={style}
    >
      {children}
    </button>
  )
}

/**
 * Square-knob switch. The design only ever draws it "on"; the off state reuses
 * the muted grey it uses for inactive controls elsewhere.
 */
export function Toggle({
  on = true,
  onChange,
  label,
  disabled = false,
}: {
  on?: boolean
  /** Omit to render a decorative switch, as the static screens do. */
  onChange?: (next: boolean) => void
  label?: string
  /**
   * Un interruptor que dice un estado y no lo cambia.
   *
   * Distinto del decorativo de arriba: éste se sigue anunciando como switch y
   * sigue diciendo si está encendido, porque eso es justo lo que informa —
   * si el navegador dio los permisos, si hay modo sin conexión. Lo que no
   * hace es dejarse pulsar ni recibir el foco, y se ve apagado para que no
   * invite a intentarlo. Un control que se deja tocar y no obedece es peor
   * que uno que se ve claramente fuera de servicio.
   */
  disabled?: boolean
}) {
  const interactive = Boolean(onChange) && !disabled
  return (
    <div
      onClick={interactive ? () => onChange?.(!on) : undefined}
      onKeyDown={(e) => {
        if (interactive && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onChange?.(!on)
        }
      }}
      role={interactive || disabled ? 'switch' : undefined}
      aria-checked={interactive || disabled ? on : undefined}
      aria-disabled={disabled ? true : undefined}
      aria-label={label}
      tabIndex={interactive ? 0 : undefined}
      className={disabled ? `${s.toggle} ${s.toggleOff}` : s.toggle}
      style={{
        background: on ? color.ok : color.mutedSoft,
        justifyContent: on ? 'flex-end' : 'flex-start',
      }}
    >
      <div className={s.knob} />
    </div>
  )
}

/** Dark footer holding a cancel/confirm pair. */
export function ActionBar({ children }: { children: ReactNode }) {
  return (
    <div className={s.actionBar}>{children}</div>
  )
}

function NavItem({
  icon,
  label,
  active,
  badge,
  gap,
  onClick,
}: {
  icon: ReactNode
  label: string
  active?: boolean
  badge?: number
  gap: number
  onClick?: () => void
}) {
  return (
    <div
      {...pressable(onClick)}
      aria-label={onClick ? label : undefined}
      className={s.navItem}
      style={{
        gap,
        color: active ? color.accent : color.muted,
        position: badge ? 'relative' : undefined,
      }}
    >
      {icon}
      <span className={s.navLabel}>{label}</span>
      {badge && <span className={s.badge}>{badge}</span>}
    </div>
  )
}

function NavBar({ children, paddingTop }: { children: ReactNode; paddingTop: number }) {
  return (
    <div className={s.navBar} style={{ padding: `${paddingTop}px 8px 0` }}>
      {children}
    </div>
  )
}

export type OperatorTab = 'mapa' | 'flota' | 'escanear' | 'alertas' | 'perfil'

/** Operator tab bar, with the scan action raised out of the bar. */
export function OperatorNav({
  active,
  onSelect,
  canScan = true,
  alerts = 2,
}: {
  active?: OperatorTab
  /** Omit for the static screens, which have nowhere to go yet. */
  onSelect?: (tab: OperatorTab) => void
  /**
   * Cuántas alertas activas marca la campana. El 2 por defecto es el del
   * diseño, para la galería; la app pasa la cuenta de verdad, y con cero la
   * campana no marca nada.
   */
  alerts?: number
  /**
   * Whether the raised scan key answers. Someone who may not scan keeps the
   * bar the design drew — five slots, the key in its place — with the key in
   * the grey the bar uses for what is off, rather than losing a tab or being
   * promised something that turns them away.
   */
  canScan?: boolean
}) {
  const go = (tab: OperatorTab) => (onSelect ? () => onSelect(tab) : undefined)
  const scanning = Boolean(onSelect) && canScan
  return (
    <NavBar paddingTop={10}>
      <NavItem gap={5} icon={<MapIcon size={21} />} label="MAPA" active={active === 'mapa'} onClick={go('mapa')} />
      <NavItem gap={5} icon={<Truck size={21} />} label="FLOTA" active={active === 'flota'} onClick={go('flota')} />
      <div
        onClick={scanning ? go('escanear') : undefined}
        role={scanning ? 'button' : undefined}
        aria-label={scanning ? 'ESCANEAR' : undefined}
        className={canScan ? s.scanTab : `${s.scanTab} ${s.scanTabOff}`}
      >
        <div className={canScan ? s.scanKey : `${s.scanKey} ${s.scanKeyOff}`}>
          <Scan size={24} color={canScan ? '#fff' : color.inkOnMuted} />
        </div>
        <span className={canScan ? s.scanLabel : `${s.scanLabel} ${s.scanLabelOff}`}>
          ESCANEAR
        </span>
      </div>
      <NavItem
        gap={5}
        icon={<Bell size={21} />}
        label="ALERTAS"
        active={active === 'alertas'}
        badge={alerts || undefined}
        onClick={go('alertas')}
      />
      <NavItem gap={5} icon={<User size={21} />} label="PERFIL" active={active === 'perfil'} onClick={go('perfil')} />
    </NavBar>
  )
}

export type AdminTab = 'resumen' | 'unidades' | 'usuarios' | 'reportes'

export function AdminNav({
  active,
  onSelect,
}: {
  active: AdminTab
  /** Omit for the static screens, which have nowhere to go yet. */
  onSelect?: (tab: AdminTab) => void
}) {
  const go = (tab: AdminTab) => (onSelect ? () => onSelect(tab) : undefined)
  return (
    <NavBar paddingTop={12}>
      <NavItem
        gap={6}
        icon={<Grid size={20} />}
        label="RESUMEN"
        active={active === 'resumen'}
        onClick={go('resumen')}
      />
      <NavItem
        gap={6}
        icon={<TruckPlain size={20} />}
        label="UNIDADES"
        active={active === 'unidades'}
        onClick={go('unidades')}
      />
      <NavItem
        gap={6}
        icon={<Users size={20} />}
        label="USUARIOS"
        active={active === 'usuarios'}
        onClick={go('usuarios')}
      />
      <NavItem
        gap={6}
        icon={<FileText size={20} />}
        label="REPORTES"
        active={active === 'reportes'}
        onClick={go('reportes')}
      />
    </NavBar>
  )
}
