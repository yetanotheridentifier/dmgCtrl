import React, { useState, useRef } from 'react'

const DEAD_ZONE = 15
const PX_PER_STEP = 24
const MAX_VALUE = 20

export type DragIndicator = {
  type: '+' | '-'
  value: number
  clientX: number
  clientY: number
}

export function useDragScrubber(onIncrement: () => void, onDecrement: () => void) {
  const dragRef = useRef<{ type: '+' | '-'; startY: number; value: number; active: boolean } | null>(null)
  const [indicator, setIndicator] = useState<DragIndicator | null>(null)
  const dragApplied = useRef(false)

  const clearDrag = () => {
    dragRef.current = null
    setIndicator(null)
  }

  const handlePointerDown = (type: '+' | '-') => (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { type, startY: e.clientY, value: 1, active: false }
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const dr = dragRef.current
    if (!dr) return
    const delta = dr.startY - e.clientY
    if (delta < DEAD_ZONE) {
      dr.value = 1
      dr.active = false
      if (indicator !== null) setIndicator(null)
      return
    }
    const value = Math.min(MAX_VALUE, Math.round((delta - DEAD_ZONE) / PX_PER_STEP) + 2)
    dr.value = value
    dr.active = true
    setIndicator({ type: dr.type, value, clientX: e.clientX, clientY: e.clientY })
  }

  const handlePointerUp = () => {
    const dr = dragRef.current
    if (dr?.active) {
      dragApplied.current = true
      const fn = dr.type === '+' ? onIncrement : onDecrement
      for (let i = 0; i < dr.value; i++) fn()
    }
    clearDrag()
  }

  const handleClick = (type: '+' | '-') => () => {
    if (dragApplied.current) {
      dragApplied.current = false
      return
    }
    if (type === '+') onIncrement()
    else onDecrement()
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
