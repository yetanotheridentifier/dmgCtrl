import { createContext, useContext, useState, useCallback, createElement } from 'react'
import type { ReactNode } from 'react'
import { loadSettings, saveSettings } from '../data/settingsStore'
import type { Settings } from '../data/settingsStore'

interface SettingsValue {
  settings: Settings
  /**
   * Apply a partial change. One function rather than a setter per field: adding a setting then
   * costs a line in `Settings` and a row in the overlay, with nothing to wire up in between.
   */
  update: (patch: Partial<Settings>) => void
}

const SettingsContext = createContext<SettingsValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadSettings)

  // Persist inside the updater so the write always matches the state that was stored, even
  // if two patches land in the same render.
  const update = useCallback((patch: Partial<Settings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch }
      saveSettings(next)
      return next
    })
  }, [])

  return createElement(SettingsContext.Provider, { value: { settings, update } }, children)
}

/**
 * Throws outside a provider rather than serving defaults: a component reading settings that
 * silently never change is a defect that looks like a preference not sticking.
 */
export function useSettings(): SettingsValue {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used within a SettingsProvider')
  return ctx
}
