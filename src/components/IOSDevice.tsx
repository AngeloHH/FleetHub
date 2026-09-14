// iOS 26 device frame — ported from the design project's ios-frame.jsx.
//
// Only the frame and status bar are ported: FleetHub renders full-bleed screens
// and never passes `title`, `dark` or `keyboard`, so the kit's nav bar, grouped
// list, glass pill and keyboard would be dead code here.
//
// The frame is the positioning context: screens are `position:absolute; inset:0`
// children, which is why the content wrapper below must stay unpositioned.

import type { CSSProperties, ReactNode } from 'react'
import s from './IOSDevice.module.css'

function IOSStatusBar({ time = '9:41' }: { time?: string }) {
  const c = '#000'
  return (
    <div className={s.status}>
      <div className={s.clock}>
        <span className={s.time}>{time}</span>
      </div>
      <div className={s.indicators}>
        <svg width="19" height="12" viewBox="0 0 19 12">
          <rect x="0" y="7.5" width="3.2" height="4.5" rx="0.7" fill={c} />
          <rect x="4.8" y="5" width="3.2" height="7" rx="0.7" fill={c} />
          <rect x="9.6" y="2.5" width="3.2" height="9.5" rx="0.7" fill={c} />
          <rect x="14.4" y="0" width="3.2" height="12" rx="0.7" fill={c} />
        </svg>
        <svg width="17" height="12" viewBox="0 0 17 12">
          <path
            d="M8.5 3.2C10.8 3.2 12.9 4.1 14.4 5.6L15.5 4.5C13.7 2.7 11.2 1.5 8.5 1.5C5.8 1.5 3.3 2.7 1.5 4.5L2.6 5.6C4.1 4.1 6.2 3.2 8.5 3.2Z"
            fill={c}
          />
          <path
            d="M8.5 6.8C9.9 6.8 11.1 7.3 12 8.2L13.1 7.1C11.8 5.9 10.2 5.1 8.5 5.1C6.8 5.1 5.2 5.9 3.9 7.1L5 8.2C5.9 7.3 7.1 6.8 8.5 6.8Z"
            fill={c}
          />
          <circle cx="8.5" cy="10.5" r="1.5" fill={c} />
        </svg>
        <svg width="27" height="13" viewBox="0 0 27 13">
          <rect
            x="0.5"
            y="0.5"
            width="23"
            height="12"
            rx="3.5"
            stroke={c}
            strokeOpacity="0.35"
            fill="none"
          />
          <rect x="2" y="2" width="20" height="9" rx="2" fill={c} />
          <path d="M25 4.5V8.5C25.8 8.2 26.5 7.2 26.5 6.5C26.5 5.8 25.8 4.8 25 4.5Z" fill={c} fillOpacity="0.4" />
        </svg>
      </div>
    </div>
  )
}

export function IOSDevice({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      // Marks one phone, so the gallery can be counted without matching on
      // the frame's own styling.
      data-device=""
      className={s.frame}
      style={style}
    >
      {/* dynamic island */}
      <div className={s.island} />
      <div className={s.statusLayer}>
        <IOSStatusBar />
      </div>
      {/* Unpositioned on purpose — screens anchor to the frame, not to this. */}
      <div className={s.content}>
        <div className={s.contentInner}>{children}</div>
      </div>
      {/* home indicator — always on top */}
      <div className={s.homeLayer}>
        <div className={s.homeBar} />
      </div>
    </div>
  )
}
