import { describe, it, expect, afterEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { useModifierKeys } from '../components/modifierKeys'

// Mount a subscriber so the shared store attaches its window listeners.
function Probe() {
  useModifierKeys()
  return null
}

afterEach(() => fireEvent.keyUp(window, { key: 'Shift', shiftKey: false, altKey: false }))

describe('modifierKeys (#321)', () => {
  it('suppresses the default for a lone Alt press (which stole page focus and broke Shift-to-zoom)', () => {
    render(<Probe />)
    const alt = new KeyboardEvent('keydown', { key: 'Alt', altKey: true, cancelable: true })
    window.dispatchEvent(alt)
    expect(alt.defaultPrevented).toBe(true)
  })

  it('does not suppress Shift or other keys', () => {
    render(<Probe />)
    const shift = new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true, cancelable: true })
    window.dispatchEvent(shift)
    expect(shift.defaultPrevented).toBe(false)
  })

  it('does not suppress Alt while typing in a text field', () => {
    const { container } = render(<><Probe /><input data-testid="in" /></>)
    const input = container.querySelector('input')!
    const alt = new KeyboardEvent('keydown', { key: 'Alt', altKey: true, cancelable: true, bubbles: true })
    input.dispatchEvent(alt)
    expect(alt.defaultPrevented).toBe(false)
  })
})
