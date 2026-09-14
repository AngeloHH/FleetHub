// The accordion menu shared by the controls that need one, and the field
// metrics those controls line up against.

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { color } from '../design/tokens'
import { Check } from './icons'
import { COUNTRIES, countryOf } from '../lib/auth'
import s from './menu.module.css'

/** Inner padding of a field box. Shared so an adornment can offset against it. */
export const FIELD_PAD = { y: 12, x: 13 }

/**
 * A trigger and an accordion panel that opens below it, in flow, so it pushes
 * what follows down instead of covering it.
 *
 * It hands back its pieces instead of a finished control because its callers
 * frame them differently — a bordered field box, a row of a card, a standalone
 * row. The panel cannot be left to the caller though: it has to sit in the same
 * subtree as the trigger for click-outside and focus to work, which is what the
 * returned root ref is for.
 *
 * The menu is hand-rolled rather than a native <select> because the browser
 * draws a native option list itself, so its padding and background cannot be
 * styled. Listbox semantics and keyboard behaviour are kept — arrows, Home/End,
 * Enter, Escape, click-outside.
 */
export function useListboxMenu<T>({
  items,
  isSelected,
  onPick,
  renderOption,
  listLabel,
  triggerLabel,
  rowSelector,
  panelStyle,
}: {
  items: T[]
  isSelected: (item: T) => boolean
  onPick: (item: T) => void
  /** The inside of one option row; the hook supplies the row itself. */
  renderOption: (item: T, selected: boolean) => ReactNode
  listLabel: string
  triggerLabel: string
  /** Element inside the root that the panel takes its row height from. */
  rowSelector: string
  /** How the panel meets its surroundings, which differ between callers. */
  panelStyle?: CSSProperties
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(() => Math.max(0, items.findIndex(isSelected)))
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const options = useRef<(HTMLButtonElement | null)[]>([])

  /**
   * Row height, taken from the caller's own row when the panel opens: options
   * match it exactly, so two and a half of them fill the panel and the third is
   * cut clean in half. Measured rather than restated so it cannot drift from
   * the padding and borders that live with the caller.
   */
  const [row, setRow] = useState(43)

  const measure = () => {
    const field = root.current?.querySelector(rowSelector)
    if (field) setRow(field.getBoundingClientRect().height)
  }

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  // Move real focus with the active option so screen readers follow along.
  useEffect(() => {
    if (open) options.current[active]?.focus()
  }, [open, active])

  const toggle = () => {
    if (open) {
      setOpen(false)
      return
    }
    // Measure before painting the panel so it never appears at the wrong size.
    measure()
    setOpen(true)
  }

  const close = (refocus = true) => {
    setOpen(false)
    if (refocus) trigger.current?.focus()
  }

  const pick = (item: T, i: number) => {
    onPick(item)
    setActive(i)
    close()
  }

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % items.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i - 1 + items.length) % items.length)
    } else if (e.key === 'Home') {
      e.preventDefault()
      setActive(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setActive(items.length - 1)
    } else if (e.key === 'Tab') {
      close(false)
    }
  }

  /** Spread onto the caller's own button, which supplies the styling. */
  const triggerProps = {
    ref: trigger,
    type: 'button' as const,
    onClick: toggle,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        if (!open) toggle()
      }
    },
    'aria-haspopup': 'listbox' as const,
    'aria-expanded': open,
    'aria-label': triggerLabel,
    className: 'fh-focus-ring',
  }

  const panel = (
    <div
      role="listbox"
      aria-label={listLabel}
      onKeyDown={onMenuKeyDown}
      className={`fh-no-scrollbar ${s.panel}`}
      style={{ height: row * 2.5, ...panelStyle }}
    >
      {items.map((item, i) => {
        const selected = isSelected(item)
        return (
          <button
            key={i}
            ref={(el) => {
              options.current[i] = el
            }}
            type="button"
            role="option"
            aria-selected={selected}
            onClick={() => pick(item, i)}
            onMouseEnter={() => setActive(i)}
            className={selected ? s.option : `fh-option ${s.option}`}
            style={{
              // One row per field-height, so 2.5 of them fill the panel and
              // the third is cut exactly in half.
              height: row,
              padding: `0 ${FIELD_PAD.x}px`,
              borderBottom: i === items.length - 1 ? 'none' : `1px solid ${color.borderSoft}`,
              background: selected ? color.accentSoft : undefined,
            }}
          >
            {renderOption(item, selected)}
          </button>
        )
      })}
    </div>
  )

  return { root, triggerProps, panel: open ? panel : null }
}

/**
 * The dialling-code picker: the shared menu, filled with countries. Used by the
 * registration field and by the phone row of the profile.
 */
export function useCountryMenu({
  country,
  onCountryChange,
  rowSelector,
  panelStyle,
}: {
  country: string
  onCountryChange: (iso: string) => void
  rowSelector: string
  panelStyle?: CSSProperties
}) {
  const current = countryOf(country)
  const menu = useListboxMenu({
    items: COUNTRIES,
    isSelected: (c) => c.iso === current.iso,
    onPick: (c) => onCountryChange(c.iso),
    listLabel: 'Código de país',
    triggerLabel: `Código de país: ${current.name}`,
    rowSelector,
    panelStyle,
    renderOption: (c, selected) => (
      <>
        <span className={s.dial} style={{ color: selected ? color.accent : color.ink }}>
          +{c.dial}
        </span>
        <span className={s.country}>{c.name}</span>
        {selected && <Check size={13} color={color.accent} />}
      </>
    ),
  })
  return { ...menu, current }
}
