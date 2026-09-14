// The floor under every screen.
//
// A render that throws unmounts everything above it, and React's answer to an
// uncaught throw is a blank page — no message, no way out. This boundary is
// the only place that can catch it (there is still no hook for this), so the
// whole app sits on it. What it offers is deliberately dumb: say that a
// drawing failed, and offer the two exits that cannot themselves depend on
// drawing — reload, or reload at the front door.

import { Component, type ReactNode } from 'react'
import { color, font } from '../design/tokens'

type State = { broke: boolean }

export class Crash extends Component<{ children: ReactNode }, State> {
  state: State = { broke: false }

  static getDerivedStateFromError(): State {
    return { broke: true }
  }

  render() {
    if (!this.state.broke) return this.props.children
    return (
      <div
        style={{
          minHeight: '60vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 18,
          padding: 24,
          fontFamily: font.mono,
          color: color.ink,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 12, letterSpacing: 2 }}>ALGO FALLÓ AL DIBUJAR ESTA PANTALLA</div>
        <div style={{ fontSize: 10, letterSpacing: 1, color: color.muted, maxWidth: 420 }}>
          Lo guardado no se ha tocado: el fallo es del dibujo, no de las filas. Recargar vuelve a
          intentarlo donde estabas.
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => window.location.reload()}
            style={{
              fontFamily: font.mono,
              fontSize: 11,
              letterSpacing: 1.5,
              padding: '12px 22px',
              background: color.accent,
              color: color.inkOn,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            RECARGAR
          </button>
          <button
            onClick={() => {
              // Straight through the browser, not the router: the router is
              // part of what may have broken.
              window.location.hash = '/'
              window.location.reload()
            }}
            style={{
              fontFamily: font.mono,
              fontSize: 11,
              letterSpacing: 1.5,
              padding: '12px 22px',
              background: 'transparent',
              color: color.ink,
              border: `1.5px solid ${color.border}`,
              cursor: 'pointer',
            }}
          >
            IR AL INICIO
          </button>
        </div>
      </div>
    )
  }
}
