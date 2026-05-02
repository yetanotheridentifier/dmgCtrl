import { useState } from 'react'

const STORAGE_KEY = 'user_settings'

interface UserSettings {
  useHyperspace: boolean
  enableForceToken: boolean
  enableEpicActions: boolean
  enableWakeLock: boolean
  enableFavourites: boolean
  enableLongPress: boolean
}

const DEFAULTS: UserSettings = {
  useHyperspace: true,
  enableForceToken: true,
  enableEpicActions: true,
  enableWakeLock: true,
  enableFavourites: true,
  enableLongPress: true,
}

function load(): UserSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw)
    return {
      useHyperspace: parsed.useHyperspace ?? DEFAULTS.useHyperspace,
      enableForceToken: parsed.enableForceToken ?? DEFAULTS.enableForceToken,
      enableEpicActions: parsed.enableEpicActions ?? DEFAULTS.enableEpicActions,
      enableWakeLock: parsed.enableWakeLock ?? DEFAULTS.enableWakeLock,
      enableFavourites: parsed.enableFavourites ?? DEFAULTS.enableFavourites,
      enableLongPress: parsed.enableLongPress ?? DEFAULTS.enableLongPress,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

function save(settings: UserSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

export function useUserSettings() {
  const [settings, setSettings] = useState<UserSettings>(load)

  function update(patch: Partial<UserSettings>) {
    setSettings(prev => {
      const next = { ...prev, ...patch }
      save(next)
      return next
    })
  }

  return {
    useHyperspace: settings.useHyperspace,
    enableForceToken: settings.enableForceToken,
    enableEpicActions: settings.enableEpicActions,
    enableWakeLock: settings.enableWakeLock,
    enableFavourites: settings.enableFavourites,
    enableLongPress: settings.enableLongPress,
    setUseHyperspace: (v: boolean) => update({ useHyperspace: v }),
    setEnableForceToken: (v: boolean) => update({ enableForceToken: v }),
    setEnableEpicActions: (v: boolean) => update({ enableEpicActions: v }),
    setEnableWakeLock: (v: boolean) => update({ enableWakeLock: v }),
    setEnableFavourites: (v: boolean) => update({ enableFavourites: v }),
    setEnableLongPress: (v: boolean) => update({ enableLongPress: v }),
  }
}
