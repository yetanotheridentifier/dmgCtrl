import { createContext, useContext, useState, createElement } from 'react'
import type { ReactNode } from 'react'

const STORAGE_KEY = 'user_settings'

type ForceTokenDisplay = 'always-on' | 'lof-only' | 'always-off'

interface UserSettings {
  useHyperspace: boolean
  forceTokenDisplay: ForceTokenDisplay
  enableEpicActions: boolean
  enableWakeLock: boolean
  enableFavourites: boolean
  enableLongPress: boolean
  enableActionLog: boolean
  enableCompetitiveMode: boolean
  bo1TimerMinutes: number
  bo3TimerMinutes: number
}

const VALID_FORCE_TOKEN_DISPLAY: ForceTokenDisplay[] = ['always-on', 'lof-only', 'always-off']

const DEFAULTS: UserSettings = {
  useHyperspace: true,
  forceTokenDisplay: 'lof-only',
  enableEpicActions: true,
  enableWakeLock: true,
  enableFavourites: true,
  enableLongPress: true,
  enableActionLog: true,
  enableCompetitiveMode: false,
  bo1TimerMinutes: 25,
  bo3TimerMinutes: 55,
}

function migrateForceTokenDisplay(parsed: Record<string, unknown>): ForceTokenDisplay {
  if ('forceTokenDisplay' in parsed) {
    const v = parsed.forceTokenDisplay
    if (VALID_FORCE_TOKEN_DISPLAY.includes(v as ForceTokenDisplay)) return v as ForceTokenDisplay
    return DEFAULTS.forceTokenDisplay
  }
  if ('enableForceToken' in parsed) {
    return parsed.enableForceToken === false ? 'always-off' : 'lof-only'
  }
  return DEFAULTS.forceTokenDisplay
}

function load(): UserSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      useHyperspace: (parsed.useHyperspace as boolean) ?? DEFAULTS.useHyperspace,
      forceTokenDisplay: migrateForceTokenDisplay(parsed),
      enableEpicActions: (parsed.enableEpicActions as boolean) ?? DEFAULTS.enableEpicActions,
      enableWakeLock: (parsed.enableWakeLock as boolean) ?? DEFAULTS.enableWakeLock,
      enableFavourites: (parsed.enableFavourites as boolean) ?? DEFAULTS.enableFavourites,
      enableLongPress: (parsed.enableLongPress as boolean) ?? DEFAULTS.enableLongPress,
      enableActionLog: (parsed.enableActionLog as boolean) ?? DEFAULTS.enableActionLog,
      enableCompetitiveMode: (parsed.enableCompetitiveMode as boolean) ?? DEFAULTS.enableCompetitiveMode,
      bo1TimerMinutes: (parsed.bo1TimerMinutes as number) ?? DEFAULTS.bo1TimerMinutes,
      bo3TimerMinutes: (parsed.bo3TimerMinutes as number) ?? DEFAULTS.bo3TimerMinutes,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

function save(settings: UserSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

type UserSettingsValue = UserSettings & {
  setUseHyperspace: (v: boolean) => void
  setForceTokenDisplay: (v: ForceTokenDisplay) => void
  setEnableEpicActions: (v: boolean) => void
  setEnableWakeLock: (v: boolean) => void
  setEnableFavourites: (v: boolean) => void
  setEnableLongPress: (v: boolean) => void
  setEnableActionLog: (v: boolean) => void
  setEnableCompetitiveMode: (v: boolean) => void
  setBo1TimerMinutes: (v: number) => void
  setBo3TimerMinutes: (v: number) => void
}

const UserSettingsContext = createContext<UserSettingsValue | null>(null)

export function UserSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<UserSettings>(load)

  function update(patch: Partial<UserSettings>) {
    setSettings(prev => {
      const next = { ...prev, ...patch }
      save(next)
      return next
    })
  }

  const value: UserSettingsValue = {
    useHyperspace: settings.useHyperspace,
    forceTokenDisplay: settings.forceTokenDisplay,
    enableEpicActions: settings.enableEpicActions,
    enableWakeLock: settings.enableWakeLock,
    enableFavourites: settings.enableFavourites,
    enableLongPress: settings.enableLongPress,
    enableActionLog: settings.enableActionLog,
    enableCompetitiveMode: settings.enableCompetitiveMode,
    bo1TimerMinutes: settings.bo1TimerMinutes,
    bo3TimerMinutes: settings.bo3TimerMinutes,
    setUseHyperspace: (v) => update({ useHyperspace: v }),
    setForceTokenDisplay: (v) => update({ forceTokenDisplay: v }),
    setEnableEpicActions: (v) => update({ enableEpicActions: v }),
    setEnableWakeLock: (v) => update({ enableWakeLock: v }),
    setEnableFavourites: (v) => update({ enableFavourites: v }),
    setEnableLongPress: (v) => update({ enableLongPress: v }),
    setEnableActionLog: (v) => update({ enableActionLog: v }),
    setEnableCompetitiveMode: (v) => update({ enableCompetitiveMode: v }),
    setBo1TimerMinutes: (v) => update({ bo1TimerMinutes: v }),
    setBo3TimerMinutes: (v) => update({ bo3TimerMinutes: v }),
  }

  return createElement(UserSettingsContext.Provider, { value }, children)
}

export function useUserSettings(): UserSettingsValue {
  const ctx = useContext(UserSettingsContext)
  if (!ctx) throw new Error('useUserSettings must be used within UserSettingsProvider')
  return ctx
}
