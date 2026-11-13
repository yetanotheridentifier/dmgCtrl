import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { mayApplyUpdate, useAppUpdate } from '../hooks/useAppUpdate'
import { holdUpdate } from '../components/shared/updateHold'

/** Stands in for the plugin's registration: whether a new worker is waiting, the reload, and the
 *  registration it hands over once the worker is registered. */
const sw = vi.hoisted(() => ({
  waiting: false,
  apply: vi.fn(async () => {}),
  check: vi.fn(async () => {}),
}))
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: (options?: { onRegisteredSW?: (url: string, reg: unknown) => void }) => {
    options?.onRegisteredSW?.('/sw.js', { update: sw.check })
    return {
      needRefresh: [sw.waiting, () => {}],
      offlineReady: [false, () => {}],
      updateServiceWorker: sw.apply,
    }
  },
}))

function setVisibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  sw.waiting = false
  sw.apply.mockClear()
  sw.check.mockClear()
})

afterEach(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})

describe('mayApplyUpdate', () => {

  it('applies a waiting update when nothing holds it', () => {
    expect(mayApplyUpdate(true, false)).toBe(true)
  })

  /** Something on screen is held only in memory, and a reload would lose it. */
  it('waits while anything holds it', () => {
    expect(mayApplyUpdate(true, true)).toBe(false)
  })

  it('has nothing to apply when no update is waiting', () => {
    expect(mayApplyUpdate(false, false)).toBe(false)
    expect(mayApplyUpdate(false, true)).toBe(false)
  })

})

describe('useAppUpdate', () => {

  it('applies a waiting update at once when nothing holds it, saving the screen first', () => {
    sw.waiting = true
    const order: string[] = []
    sw.apply.mockImplementationOnce(async () => { order.push('apply') })
    renderHook(() => useAppUpdate(() => order.push('save')))
    expect(sw.apply).toHaveBeenCalledWith(true)
    expect(order).toEqual(['save', 'apply'])
  })

  it('waits while held, and applies the moment the last hold goes', () => {
    sw.waiting = true
    const release = holdUpdate()
    const save = vi.fn()
    renderHook(() => useAppUpdate(save))
    expect(sw.apply).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
    act(() => release())
    expect(save).toHaveBeenCalledTimes(1)
    expect(sw.apply).toHaveBeenCalledWith(true)
  })

  it('does nothing when no update is waiting', () => {
    const save = vi.fn()
    renderHook(() => useAppUpdate(save))
    expect(save).not.toHaveBeenCalled()
    expect(sw.apply).not.toHaveBeenCalled()
  })

  /** A home-screen app is resumed far more often than it is launched, and a resume is no
   *  navigation, so the browser would not look for a new version by itself. */
  it('looks for a new version when the app comes back to the foreground', () => {
    renderHook(() => useAppUpdate(() => {}))
    expect(sw.check).not.toHaveBeenCalled()
    setVisibility('hidden')
    expect(sw.check).not.toHaveBeenCalled()
    setVisibility('visible')
    expect(sw.check).toHaveBeenCalledTimes(1)
  })

  it('a failed check (offline, say) is not an error', async () => {
    sw.check.mockRejectedValueOnce(new Error('offline'))
    renderHook(() => useAppUpdate(() => {}))
    setVisibility('hidden')
    setVisibility('visible')
    await Promise.resolve()
    expect(sw.check).toHaveBeenCalledTimes(1)
  })

  it('stops looking once unmounted', () => {
    const { unmount } = renderHook(() => useAppUpdate(() => {}))
    unmount()
    setVisibility('hidden')
    setVisibility('visible')
    expect(sw.check).not.toHaveBeenCalled()
  })

})
