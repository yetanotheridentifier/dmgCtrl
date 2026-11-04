// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { mayApplyUpdate, useUpdateOnDeckScreen } from '../hooks/useUpdateOnDeckScreen'

/** Stands in for the plugin's registration: whether a new worker is waiting, and the reload. */
const sw = vi.hoisted(() => ({ waiting: false, update: vi.fn(async () => {}) }))
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [sw.waiting, () => {}],
    offlineReady: [false, () => {}],
    updateServiceWorker: sw.update,
  }),
}))

describe('mayApplyUpdate', () => {
  it('applies a waiting update on the deck screen', () => {
    expect(mayApplyUpdate(true, false)).toBe(true)
  })

  /** A game lives only in memory, so a reload mid-game loses it. */
  it('holds a waiting update while a game is open', () => {
    expect(mayApplyUpdate(true, true)).toBe(false)
  })

  it('has nothing to apply when no update is waiting', () => {
    expect(mayApplyUpdate(false, false)).toBe(false)
    expect(mayApplyUpdate(false, true)).toBe(false)
  })
})

describe('useUpdateOnDeckScreen', () => {
  beforeEach(() => {
    sw.waiting = false
    sw.update.mockClear()
  })

  it('does not reload while a game is open, and does once the deck screen shows', () => {
    sw.waiting = true
    const { rerender } = renderHook(({ gameOpen }) => useUpdateOnDeckScreen(gameOpen), {
      initialProps: { gameOpen: true },
    })
    expect(sw.update).not.toHaveBeenCalled()
    rerender({ gameOpen: false })
    expect(sw.update).toHaveBeenCalledTimes(1)
  })

  it('reloads straight away when the update arrives on the deck screen', () => {
    sw.waiting = true
    renderHook(() => useUpdateOnDeckScreen(false))
    expect(sw.update).toHaveBeenCalledTimes(1)
  })

  it('leaves the page alone when no update is waiting', () => {
    const { rerender } = renderHook(({ gameOpen }) => useUpdateOnDeckScreen(gameOpen), {
      initialProps: { gameOpen: true },
    })
    rerender({ gameOpen: false })
    expect(sw.update).not.toHaveBeenCalled()
  })
})
