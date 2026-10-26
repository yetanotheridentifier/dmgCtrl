import type { StartScreen } from '../hooks/useUserSettings'

export type Game = 'swu' | 'xwing'
export type LaunchScreen = 'tournament' | 'setup' | 'xwingSetup' | 'gameSelect'

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
  route: Game | null
  startScreen: StartScreen
  lastGame: Game | null
}

// Where the app opens: the first of these that applies.
export function launchScreen({ tournamentInProgress, route, startScreen, lastGame }: LaunchInputs): LaunchScreen {
  if (tournamentInProgress) return 'tournament'
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
