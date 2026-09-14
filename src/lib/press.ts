// Lo tocable, tocable también sin ratón.
//
// Un div con onClick es un botón para quien ve el puntero y nada para quien
// navega con Tab: no se puede enfocar y Enter no hace nada. Esto devuelve el
// juego completo — foco, rol y las dos teclas que activan un botón — para que
// ningún sitio tenga que recordar las piezas por separado, ni pueda olvidar
// una. Sin handler devuelve nada: un dibujo no debe fingir que se pulsa.

import type { KeyboardEvent } from 'react'

export function pressable(onClick: (() => void) | undefined, role: 'button' | 'tab' = 'button') {
  if (!onClick) return {}
  return {
    role,
    tabIndex: 0,
    onClick,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onClick()
      }
    },
  }
}
