import React, { useState, useRef } from 'react'
import { distanceUp, useFrameTurn } from './useFrameTurn'

type Point = { clientX: number; clientY: number }

// How far a pointer moved up the screen as its player sees it: along the turned frame's up, and the
// other way on a half turned round to face the far player.
function useUpFrom(flipped: boolean) {
  const turn = useFrameTurn() + (flipped ? 180 : 0)
  return (start: Point, now: Point) => distanceUp(turn, now.clientX - start.clientX, now.clientY - start.clientY)
}

const DEAD_ZONE = 15
const PX_PER_STEP = 14
const MAX_VALUE = 20

export type DragIndicator = {
  type: '+' | '-'
  value: number
  clientX: number
  clientY: number
}

export function useDragScrubber(
  onIncrement: (n: number) => void,
  onDecrement: (n: number) => void,
  maxIncrement: number,
  maxDecrement: number,
  enabled = true,
  // Turned round (the far half of a shared phone): up for its player is down the screen.
  flipped = false,
) {
  const upFrom = useUpFrom(flipped)
  const dragRef = useRef<{ type: '+' | '-'; start: Point; value: number; active: boolean } | null>(null)
  const [indicator, setIndicator] = useState<DragIndicator | null>(null)
  const dragApplied = useRef(false)

  const clearDrag = () => {
    dragRef.current = null
    setIndicator(null)
  }

  const handlePointerDown = (type: '+' | '-') => (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!enabled) return
    const max = type === '+' ? maxIncrement : maxDecrement
    if (max < 2) return
    if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { type, start: { clientX: e.clientX, clientY: e.clientY }, value: 1, active: false }
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const dr = dragRef.current
    if (!dr) return
    const delta = upFrom(dr.start, e)
    if (delta < DEAD_ZONE) {
      dr.value = 1
      dr.active = false
      if (indicator !== null) setIndicator(null)
      return
    }
    const max = dr.type === '+' ? maxIncrement : maxDecrement
    const cap = Math.min(max, MAX_VALUE)
    const value = Math.min(cap, Math.round((delta - DEAD_ZONE) / PX_PER_STEP) + 2)
    dr.value = value
    dr.active = true
    setIndicator({ type: dr.type, value, clientX: e.clientX, clientY: e.clientY })
  }

  const handlePointerUp = () => {
    const dr = dragRef.current
    if (dr?.active) {
      dragApplied.current = true
      const fn = dr.type === '+' ? onIncrement : onDecrement
      fn(dr.value)
    }
    clearDrag()
  }

  const handleClick = (type: '+' | '-') => () => {
    if (dragApplied.current) {
      dragApplied.current = false
      return
    }
    if (type === '+') onIncrement(1)
    else onDecrement(1)
  }

  return {
    dragIndicator: indicator,
    handleClick,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel: clearDrag,
  }
}

// One surface for both directions: a tap is +1, dragging up adds and dragging down removes, from 1
// just past the dead zone, capped at what can be added or removed. Shares the buttons' dead zone and step.
export function useCardDrag(
  onTap: () => void,
  onIncrement: (n: number) => void,
  onDecrement: (n: number) => void,
  maxIncrement: number,
  maxDecrement: number,
  enabled: boolean,
  flipped = false,
) {
  const upFrom = useUpFrom(flipped)
  const dragRef = useRef<{ start: Point; type: '+' | '-' | null; value: number } | null>(null)
  const [amount, setAmount] = useState<{ type: '+' | '-'; value: number } | null>(null)
  const dragApplied = useRef(false)

  const clearDrag = () => {
    dragRef.current = null
    setAmount(null)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (!enabled) return
    if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { start: { clientX: e.clientX, clientY: e.clientY }, type: null, value: 0 }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const dr = dragRef.current
    if (!dr) return
    const delta = upFrom(dr.start, e)
    if (Math.abs(delta) < DEAD_ZONE) {
      dr.type = null
      if (amount !== null) setAmount(null)
      return
    }
    const type = delta > 0 ? '+' : '-'
    const max = type === '+' ? maxIncrement : maxDecrement
    const value = Math.min(max, Math.round((Math.abs(delta) - DEAD_ZONE) / PX_PER_STEP) + 1)
    dr.type = type
    dr.value = value
    setAmount(value > 0 ? { type, value } : null)
  }

  const onPointerUp = () => {
    const dr = dragRef.current
    if (dr?.type) {
      dragApplied.current = true
      if (dr.value > 0) (dr.type === '+' ? onIncrement : onDecrement)(dr.value)
    }
    clearDrag()
  }

  const onClick = () => {
    if (dragApplied.current) {
      dragApplied.current = false
      return
    }
    onTap()
  }

  return { amount, onClick, onPointerDown, onPointerMove, onPointerUp, onPointerCancel: clearDrag }
}
