// Interactive form controls, styled to the design's field treatment:
// square, 1px border, accent outline while focused, danger outline when invalid.

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { color, font } from '../design/tokens'
import { ChevronDown } from './icons'
import { digitsOf, toHex } from '../lib/auth'
import { FIELD_PAD, useCountryMenu } from './menu'
import s from './form.module.css'

export function FieldLabel({ children, style }: { children: string; style?: CSSProperties }) {
  return (
    <div className={s.label} style={style}>
      {children}
    </div>
  )
}

/** Small monospace caption under a field. */
export function FieldNote({ children, tone }: { children: string; tone: 'muted' | 'danger' }) {
  return (
    <div className={s.note} style={{ color: tone === 'danger' ? color.danger : color.muted }}>
      {children}
    </div>
  )
}

function borderFor(invalid: boolean, focused: boolean) {
  if (invalid) return `1.5px solid ${color.danger}`
  if (focused) return `1.5px solid ${color.accent}`
  return `1px solid ${color.border}`
}

export function TextField({
  label,
  value,
  onChange,
  onBlur,
  error,
  focused,
  onFocus,
  mono,
  prefix,
  trailing,
  expansion,
  type,
  placeholder,
  inputMode,
  autoComplete,
  style,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  onBlur: () => void
  onFocus: () => void
  error?: string
  focused: boolean
  /** Identifiers (email, phone) are set in mono; prose in the sans face. */
  mono?: boolean
  /** Adornment (e.g. a dialling-code picker) that is never part of the value. */
  prefix?: ReactNode
  /** Adornment after the input, inside the box (e.g. a reveal toggle). */
  trailing?: ReactNode
  /** Panel rendered below the box, in flow — it pushes the form down. */
  expansion?: ReactNode
  type?: 'text' | 'password'
  placeholder?: string
  inputMode?: 'text' | 'email' | 'tel'
  autoComplete?: string
  style?: CSSProperties
}) {
  const invalid = Boolean(error)
  return (
    <div style={style}>
      <FieldLabel>{label}</FieldLabel>
      <div
        // Marked so an adornment can measure the field it lives in.
        data-field
        className={s.box}
        style={{
          border: borderFor(invalid, focused),
          padding: `${FIELD_PAD.y}px ${FIELD_PAD.x}px`,
        }}
      >
        {prefix && <span className={s.prefix}>{prefix}</span>}
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
          placeholder={placeholder}
          inputMode={inputMode}
          autoComplete={autoComplete}
          // The label above is a sibling, so without this the field has no
          // accessible name of its own.
          aria-label={label}
          className={s.input}
          style={{
            fontFamily: mono ? font.mono : font.sans,
            fontSize: mono ? 13 : 15,
            fontWeight: mono ? 400 : 600,
          }}
        />
        {trailing}
      </div>
      {expansion}
      {error && <FieldNote tone="danger">{error}</FieldNote>}
    </div>
  )
}

/**
 * Phone number with the dialling-code picker in front of it.
 *
 * A compound control rather than a TextField with an adornment: the picker's
 * panel is laid out below the field box, in flow, so opening it pushes the rest
 * of the form down instead of covering it. That means the box and the panel
 * have to be rendered together.
 */
export function PhoneField({
  label,
  value,
  onChange,
  onFocus,
  onBlur,
  error,
  focused,
  placeholder,
  country,
  onCountryChange,
  style,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  onFocus: () => void
  onBlur: () => void
  error?: string
  focused: boolean
  placeholder?: string
  country: string
  onCountryChange: (iso: string) => void
  style?: CSSProperties
}) {
  const { root, current, triggerProps, panel } = useCountryMenu({
    country,
    onCountryChange,
    rowSelector: '[data-field]',
  })

  const triggerButton = (
    <span className={s.dial}>
      <button {...triggerProps} className={s.dialTrigger}>
        <span className={s.dialCode}>+{current.dial}</span>
        <ChevronDown size={12} color={color.muted} style={{ marginLeft: 4 }} />
      </button>
    </span>
  )

  return (
    <div ref={root} style={style}>
      <TextField
        label={label}
        value={value}
        onChange={onChange}
        onFocus={onFocus}
        onBlur={onBlur}
        error={error}
        focused={focused}
        placeholder={placeholder}
        inputMode="tel"
        autoComplete="tel"
        mono
        prefix={triggerButton}
        expansion={panel}
      />
    </div>
  )
}

/**
 * A row of single-character boxes. Typing advances, Backspace on an empty box
 * steps back, and pasting a whole code fills the row at once.
 */
export function CodeInput({
  value,
  onChange,
  onComplete,
  invalid,
  locked,
  mode = 'hex',
  autoFocus,
  length = 6,
  height = 52,
  fontSize = 20,
}: {
  value: string
  onChange: (value: string) => void
  /** Fired when the last box is filled, so the caller can validate eagerly. */
  onComplete?: (value: string) => void
  invalid?: boolean
  /** Issued rather than typed — shown, but not editable. */
  locked?: boolean
  /** Company codes are hex; one-time codes are digits only. */
  mode?: 'hex' | 'numeric'
  /** Put the caret in the first box on arrival — the boxes are the only input. */
  autoFocus?: boolean
  length?: number
  height?: number
  fontSize?: number
}) {
  const boxes = useRef<(HTMLInputElement | null)[]>([])
  const chars = Array.from({ length }, (_, i) => value[i] ?? '')

  useEffect(() => {
    if (autoFocus && !locked) boxes.current[0]?.focus()
  }, [autoFocus, locked])

  const commit = (next: string) => {
    onChange(next)
    if (next.length === length) onComplete?.(next)
  }

  const focusBox = (i: number) => boxes.current[Math.max(0, Math.min(length - 1, i))]?.focus()

  const clean = (raw: string) => (mode === 'hex' ? toHex(raw) : digitsOf(raw))

  const handleInput = (i: number, raw: string) => {
    if (locked) return
    const accepted = clean(raw)
    if (!accepted) return
    // A multi-character value means a paste; spread it from this box onwards.
    const chunk = accepted.slice(0, length - i)
    const next = (value.slice(0, i) + chunk + value.slice(i + chunk.length)).slice(0, length)
    commit(next)
    focusBox(i + chunk.length)
  }

  const handleKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (locked) return
    if (e.key === 'Backspace') {
      e.preventDefault()
      if (chars[i]) {
        commit(value.slice(0, i) + value.slice(i + 1))
        return
      }
      if (i > 0) {
        commit(value.slice(0, i - 1) + value.slice(i))
        focusBox(i - 1)
      }
    } else if (e.key === 'ArrowLeft') {
      focusBox(i - 1)
    } else if (e.key === 'ArrowRight') {
      focusBox(i + 1)
    }
  }

  return (
    <div className={s.code}>
      {chars.map((ch, i) => (
        <input
          key={i}
          ref={(el) => {
            boxes.current[i] = el
          }}
          value={ch}
          onChange={(e) => handleInput(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onFocus={(e) => !locked && e.target.select()}
          readOnly={locked}
          tabIndex={locked ? -1 : undefined}
          inputMode={mode === 'numeric' ? 'numeric' : 'text'}
          autoComplete="off"
          aria-label={`Dígito ${i + 1} del código`}
          className={s.codeBox}
          style={{
            height,
            border: invalid
              ? `1.5px solid ${color.danger}`
              : ch
                ? `1.5px solid ${color.accent}`
                : `1px solid ${color.border}`,
            // A locked code sits on the page background, the same cue the
            // design uses for admin-owned fields on screen 05b.
            background: locked ? color.bg : color.surface,
            fontSize,
            cursor: locked ? 'default' : undefined,
          }}
        />
      ))}
    </div>
  )
}
