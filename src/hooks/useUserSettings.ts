import { createContext, useContext, useState, createElement } from 'react'
import type { ReactNode } from 'react'

const STORAGE_KEY = 'user_settings'

// Keys the app's other stores write. Any of them present means this is not a new install, even
// when no setting has ever been changed (settings are stored only once one is).
const OTHER_APP_KEYS = ['swu_setup', 'xwing_setup', 'xwing_favourites', 'favourites', 'tournament_state']

export type ForceTokenDisplay = 'always-on' | 'lof-only' | 'always-off'
export type StartScreen = 'gameSelect' | 'swu' | 'xwing'

// Stored settings may still carry keys for features that are now always on (epic actions, wake
// lock, action log, favourites, competitive mode, long-press) or that nothing read (game select).
// load() reads only the keys below, so those are ignored and dropped on the next save.
interface UserSettings {
  useHyperspace: boolean
  forceTokenDisplay: ForceTokenDisplay
  // Shown as Initiative: the bar in a 1-player game, a button each in 2 players.
  enableInitiativeBar: boolean
  enableXwingPhases: boolean
  enableXwingAlwaysIncDec: boolean
  // SWU game: − and + in the margins beside the card, as well as tapping and dragging the card.
  enableDamageButtons: boolean
  startScreen: StartScreen
  // Set on each game's timer before it starts, not in Settings.
  bo1TimerMinutes: number
  bo3TimerMinutes: number
  xwingTimerMinutes: number
  meleePlayerGuid: string
}

const VALID_FORCE_TOKEN_DISPLAY: ForceTokenDisplay[] = ['always-on', 'lof-only', 'always-off']

const VALID_START_SCREENS: StartScreen[] = ['gameSelect', 'swu', 'xwing']

const DEFAULTS: UserSettings = {
  useHyperspace: true,
  forceTokenDisplay: 'lof-only',
  enableInitiativeBar: true,
  // Off for a new install; an existing player keeps the phase tracker they had (see load()).
  enableXwingPhases: false,
  enableXwingAlwaysIncDec: false,
  enableDamageButtons: false,
  startScreen: 'gameSelect',
  bo1TimerMinutes: 25,
  bo3TimerMinutes: 55,
  xwingTimerMinutes: 75,
  meleePlayerGuid: '',
}

// The phase tracker was on by default before it defaulted to off, so that is what an existing
// player who never changed it has been playing with.
const EXISTING_PLAYER_PHASES = true

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

function fromStored(parsed: Record<string, unknown>): UserSettings {
  return {
    useHyperspace: (parsed.useHyperspace as boolean) ?? DEFAULTS.useHyperspace,
    forceTokenDisplay: migrateForceTokenDisplay(parsed),
    enableInitiativeBar: (parsed.enableInitiativeBar as boolean) ?? DEFAULTS.enableInitiativeBar,
    enableXwingPhases: (parsed.enableXwingPhases as boolean) ?? EXISTING_PLAYER_PHASES,
    enableXwingAlwaysIncDec: (parsed.enableXwingAlwaysIncDec as boolean) ?? DEFAULTS.enableXwingAlwaysIncDec,
    enableDamageButtons: (parsed.enableDamageButtons as boolean) ?? DEFAULTS.enableDamageButtons,
    startScreen: VALID_START_SCREENS.includes(parsed.startScreen as StartScreen)
      ? (parsed.startScreen as StartScreen)
      : DEFAULTS.startScreen,
    bo1TimerMinutes: (parsed.bo1TimerMinutes as number) ?? DEFAULTS.bo1TimerMinutes,
    bo3TimerMinutes: (parsed.bo3TimerMinutes as number) ?? DEFAULTS.bo3TimerMinutes,
    xwingTimerMinutes: (parsed.xwingTimerMinutes as number) ?? DEFAULTS.xwingTimerMinutes,
    meleePlayerGuid: (parsed.meleePlayerGuid as string) ?? DEFAULTS.meleePlayerGuid,
  }
}

function load(): UserSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return fromStored(JSON.parse(raw) as Record<string, unknown>)
    // Nothing stored yet: a new install, or a player who never changed a setting. Save the result
    // straight away, so the choice between the two is made once and not re-made on a later launch.
    const existing = OTHER_APP_KEYS.some(key => localStorage.getItem(key) !== null)
    const first = existing ? { ...DEFAULTS, enableXwingPhases: EXISTING_PLAYER_PHASES } : { ...DEFAULTS }
    save(first)
    return first
  } catch {
    return fromStored({})
  }
}

function save(settings: UserSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

type UserSettingsValue = UserSettings & {
  setUseHyperspace: (v: boolean) => void
  setForceTokenDisplay: (v: ForceTokenDisplay) => void
  setEnableInitiativeBar: (v: boolean) => void
  setEnableXwingPhases: (v: boolean) => void
  setEnableXwingAlwaysIncDec: (v: boolean) => void
  setEnableDamageButtons: (v: boolean) => void
  setStartScreen: (v: StartScreen) => void
  setBo1TimerMinutes: (v: number) => void
  setBo3TimerMinutes: (v: number) => void
  setXwingTimerMinutes: (v: number) => void
  setMeleePlayerGuid: (v: string) => void
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
    ...settings,
    setUseHyperspace: (v) => update({ useHyperspace: v }),
    setForceTokenDisplay: (v) => update({ forceTokenDisplay: v }),
    setEnableInitiativeBar: (v) => update({ enableInitiativeBar: v }),
    setEnableXwingPhases: (v) => update({ enableXwingPhases: v }),
    setEnableXwingAlwaysIncDec: (v) => update({ enableXwingAlwaysIncDec: v }),
    setEnableDamageButtons: (v) => update({ enableDamageButtons: v }),
    setStartScreen: (v) => update({ startScreen: v }),
    setBo1TimerMinutes: (v) => update({ bo1TimerMinutes: v }),
    setBo3TimerMinutes: (v) => update({ bo3TimerMinutes: v }),
    setXwingTimerMinutes: (v) => update({ xwingTimerMinutes: v }),
    setMeleePlayerGuid: (v) => update({ meleePlayerGuid: v }),
  }

  return createElement(UserSettingsContext.Provider, { value }, children)
}

export function useUserSettings(): UserSettingsValue {
  const ctx = useContext(UserSettingsContext)
  if (!ctx) throw new Error('useUserSettings must be used within UserSettingsProvider')
  return ctx
}
