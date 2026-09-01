import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { SettingsProvider, useSettings } from '../hooks/useSettings'
import { defaultSettings, loadSettings, STORAGE_KEY } from '../data/settingsStore'

const wrapper = ({ children }: { children: ReactNode }) => <SettingsProvider>{children}</SettingsProvider>

describe('useSettings', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('exposes the defaults when nothing is stored', () => {
    const { result } = renderHook(() => useSettings(), { wrapper })
    expect(result.current.settings).toEqual(defaultSettings())
  })

  it('exposes what was already stored', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...defaultSettings(), baseHealthDisplay: 'remaining' }))
    const { result } = renderHook(() => useSettings(), { wrapper })
    expect(result.current.settings.baseHealthDisplay).toBe('remaining')
  })

  it('update changes the live value and persists it', () => {
    const { result } = renderHook(() => useSettings(), { wrapper })
    act(() => result.current.update({ allowUndo: true }))

    expect(result.current.settings.allowUndo).toBe(true)
    expect(loadSettings().allowUndo).toBe(true)
  })

  /** A patch is partial: setting one field must not reset the others to their defaults. */
  it('update leaves the fields it does not name alone', () => {
    const { result } = renderHook(() => useSettings(), { wrapper })
    act(() => result.current.update({ baseHealthDisplay: 'remaining' }))
    act(() => result.current.update({ allowUndo: true }))

    expect(result.current.settings).toEqual({ ...defaultSettings(), allowUndo: true, baseHealthDisplay: 'remaining' })
    expect(loadSettings()).toEqual({ ...defaultSettings(), allowUndo: true, baseHealthDisplay: 'remaining' })
  })

  it('throws when used outside the provider, rather than silently serving defaults', () => {
    expect(() => renderHook(() => useSettings())).toThrow(/SettingsProvider/)
  })
})
