import { useSyncExternalStore } from 'react'

// A single shared source of truth for Shift/Alt, so every card doesn't attach
// its own keyboard listeners. Bit 1 = Shift, bit 2 = Alt.
let state = 0
const listeners = new Set<() => void>()
let attached = false

function set(shift: boolean, alt: boolean) {
  const next = (shift ? 1 : 0) | (alt ? 2 : 0)
  if (next !== state) {
    state = next
    listeners.forEach(l => l())
  }
}

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

function onKey(e: KeyboardEvent) {
  // A lone Alt press focuses the browser menu bar, stealing keyboard focus from
  // the page — so the next Shift press wasn't received and Shift-to-zoom broke
  // until the next click. Suppress that default (never inside a text field).
  if (e.key === 'Alt' && !isEditable(e.target)) e.preventDefault()
  set(e.shiftKey, e.altKey)
}
function onBlur() { set(false, false) } // window lost focus → modifiers can't be held

function subscribe(cb: () => void): () => void {
  if (!attached) {
    attached = true
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    window.addEventListener('blur', onBlur)
  }
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

const getSnapshot = () => state

/** Live Shift / Alt state, shared across all callers via one set of listeners. */
export function useModifierKeys(): { shift: boolean; alt: boolean } {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { shift: (s & 1) !== 0, alt: (s & 2) !== 0 }
}
