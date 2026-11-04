import { createContext, useCallback, useContext, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react'
import { useModifierKeys } from './modifierKeys'

/** A card to see full size: a card by id, and the unit it is in play as, when it is one. */
export interface InspectTarget {
  cardId: string
  instanceId?: string
}

/**
 * Where a held card goes on a phone: the game screen's full-size view of it (`CardDetail`), which
 * stays open until closed. Absent on the desktop, where a long press shows the popover while held.
 */
export const CardInspect = createContext<((target: InspectTarget) => void) | null>(null)

/** How long a touch/pen press must be held before it zooms rather than taps. */
const LONG_PRESS_MS = 350

/**
 * Roll-over zoom. Returns handlers to spread on a card's wrapper:
 * - **mouse** zooms only while **Shift** is held and the pointer is over the card
 *   (so plain hovering doesn't obscure the board mid-play);
 * - **touch/pen** long-press zooms and, on release, suppresses the click so a
 *   long-press doesn't also play/attack the card. A quick tap is unaffected. Under a
 *   `CardInspect` (a phone), a long press on a card given its `target` opens the
 *   full-size view instead, which stays open once the finger lifts.
 *
 * No keyboard/focus zoom: focus persists on a card until a blur, which left the
 * zoom stuck on for long-lived cards (leaders/bases) — see the removed focusZoom.
 *
 * `anchorRef` is attached to the card's wrapper and handed to `CardZoomPopover`, which
 * centres the (portalled) zoom over it and clamps it to the viewport.
 */
export function useCardZoom(target?: InspectTarget) {
  const { shift } = useModifierKeys()
  const inspect = useContext(CardInspect)
  const [hovering, setHovering] = useState(false)
  const [pressZoom, setPressZoom] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressed = useRef(false)
  const anchorRef = useRef<HTMLElement | null>(null)

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
          if (inspect && target) inspect(target)
          else setPressZoom(true)
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
  /**
   * Callback ref for the card's wrapper element — attach with `ref={setAnchor}`.
   *
   * Must stay referentially stable: React re-invokes a callback ref whose identity changed,
   * detaching it (`current = null`) before the commit and re-attaching bottom-up. Most cards
   * render the popover *inside* this wrapper, so an unstable ref left `anchorRef.current` null
   * when the popover's layout effect measured it, and it never became visible.
   */
  const setAnchor = useCallback((el: HTMLElement | null) => { anchorRef.current = el }, [])
  return { zoomed, bind, anchorRef, setAnchor }
}
