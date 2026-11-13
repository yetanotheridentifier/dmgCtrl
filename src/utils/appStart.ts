import type { StartScreen } from '../hooks/useUserSettings'

export type Game = 'swu' | 'xwing'
export type LaunchScreen = 'tournament' | 'xwingTournament' | 'setup' | 'xwingSetup' | 'gameSelect'
export type Screen = LaunchScreen | 'xwing' | 'xwingLists' | 'game' | 'help' | 'settings'

const SCREENS: Screen[] = ['gameSelect', 'xwingSetup', 'xwing', 'xwingLists', 'xwingTournament', 'setup', 'game', 'tournament', 'help', 'settings']
// A game lives only in memory and holds any update, so a reload never leaves one to come back to.
const GAME_SCREENS: Screen[] = ['game', 'xwing']
const UPDATE_RESUME_KEY = 'update_resume'

const GAMES: Game[] = ['swu', 'xwing']
const LAST_GAME_KEY = 'last_game'
const LAUNCHES_KEY = 'app_launches'

const SETUP: Record<Game, LaunchScreen> = { swu: 'setup', xwing: 'xwingSetup' }

// The game an address names: dmgctrl.app/swu and /xwing, with or without the trailing slash and
// the index.html the build writes there. Anything else names none.
export function gameFromPath(pathname: string, base: string): Game | null {
  if (!pathname.startsWith(base)) return null
  const first = pathname.slice(base.length).split('/')[0]
  return GAMES.includes(first as Game) ? (first as Game) : null
}

interface LaunchInputs {
  tournamentInProgress: boolean
  xwingTournamentInProgress?: boolean
  route: Game | null
  startScreen: StartScreen
  lastGame: Game | null
}

// Where the app opens: the first of these that applies.
export function launchScreen({ tournamentInProgress, xwingTournamentInProgress = false, route, startScreen, lastGame }: LaunchInputs): LaunchScreen {
  if (tournamentInProgress) return 'tournament'
  if (xwingTournamentInProgress) return 'xwingTournament'
  if (route) return SETUP[route]
  if (startScreen === 'lastGame') return lastGame ? SETUP[lastGame] : 'gameSelect'
  if (startScreen === 'swu' || startScreen === 'xwing') return SETUP[startScreen]
  return 'gameSelect'
}

// A game counts as played once its setup opens.
export function readLastGame(): Game | null {
  try {
    const v = localStorage.getItem(LAST_GAME_KEY)
    return GAMES.includes(v as Game) ? (v as Game) : null
  } catch {
    return null
  }
}

export function recordLastGame(game: Game): void {
  try {
    localStorage.setItem(LAST_GAME_KEY, game)
  } catch {
    // Storage refused: the app still opens, at game select.
  }
}

// Each start of the app counts once (main.tsx records it), so the install banner can wait for the second.
export function launchCount(): number {
  try {
    return Number(localStorage.getItem(LAUNCHES_KEY)) || 0
  } catch {
    return 0
  }
}

export function recordLaunch(): void {
  try {
    localStorage.setItem(LAUNCHES_KEY, String(launchCount() + 1))
  } catch {
    // Storage refused: the banner waits, which is the safe side.
  }
}

/** The screen showing, and the screens Back returns to from it. */
export interface UpdateResume {
  screen: Screen
  backStack: Screen[]
}

// Kept for the session only: a reload into a new version reopens where the player was, and a fresh
// launch opens as it always has.
export function saveForUpdate(resume: UpdateResume): void {
  try {
    sessionStorage.setItem(UPDATE_RESUME_KEY, JSON.stringify(resume))
  } catch {
    // Storage refused: the new version opens at the launch screen, losing nothing.
  }
}

/** The screen kept by saveForUpdate, once, if it can still be shown. */
export function takeForUpdate(open: { tournamentInProgress: boolean; xwingTournamentInProgress: boolean }): UpdateResume | null {
  let raw: string | null
  try {
    raw = sessionStorage.getItem(UPDATE_RESUME_KEY)
    sessionStorage.removeItem(UPDATE_RESUME_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const { screen, backStack } = (parsed ?? {}) as Partial<Record<keyof UpdateResume, unknown>>
  if (!Array.isArray(backStack)) return null
  const all = [screen, ...backStack]
  const shown = (s: unknown) => SCREENS.includes(s as Screen) && !GAME_SCREENS.includes(s as Screen)
    && (s !== 'tournament' || open.tournamentInProgress)
    && (s !== 'xwingTournament' || open.xwingTournamentInProgress)
  return all.every(shown) ? { screen: screen as Screen, backStack: backStack as Screen[] } : null
}
