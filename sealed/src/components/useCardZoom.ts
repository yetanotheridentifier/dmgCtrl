import { useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react'
import { useModifierKeys } from './modifierKeys'

/** How long a touch/pen press must be held before it zooms rather than taps. */
const LONG_PRESS_MS = 350

/**
 * Roll-over zoom (#321). Returns handlers to spread on a card's wrapper:
 * - **mouse** zooms only while **Shift** is held and the pointer is over the card
 *   (so plain hovering doesn't obscure the board mid-play);
 * - **touch/pen** long-press zooms and, on release, suppresses the click so a
 *   long-press doesn't also play/attack the card. A quick tap is unaffected.
 *
 * No keyboard/focus zoom: focus persists on a card until a blur, which left the
 * zoom stuck on for long-lived cards (leaders/bases) — see the removed focusZoom.
 */
export function useCardZoom() {
  const { shift } = useModifierKeys()
  const [hovering, setHovering] = useState(false)
  const [pressZoom, setPressZoom] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressed = useRef(false)

  const clear = () => {
    if (timer.current != null) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }

  const bind = {
    onPointerEnter: (e: ReactPointerEvent) => {
      if (e.pointerType === 'mouse') setHovering(true)
    },
    onPointerLeave: () => {
      clear()
      setHovering(false)
      setPressZoom(false)
    },
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.pointerType !== 'mouse') {
        longPressed.current = false
        timer.current = setTimeout(() => {
          longPressed.current = true
          setPressZoom(true)
        }, LONG_PRESS_MS)
      }
    },
    onPointerUp: (e: ReactPointerEvent) => {
      if (e.pointerType !== 'mouse') {
        clear()
        setPressZoom(false)
      }
    },
    onPointerCancel: () => {
      clear()
      setHovering(false)
      setPressZoom(false)
    },
    onClickCapture: (e: ReactMouseEvent) => {
      if (longPressed.current) {
        e.preventDefault()
        e.stopPropagation()
        longPressed.current = false
      }
    },
  }

  const zoomed = (hovering && shift) || pressZoom
  return { zoomed, bind }
}
