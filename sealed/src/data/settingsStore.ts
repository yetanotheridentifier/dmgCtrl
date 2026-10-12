import { isDev } from '../env'

export const STORAGE_KEY = 'sealed_settings'

/** Base health overlay: damage taken counting up, or health remaining counting down. */
export type BaseHealthDisplay = 'damage' | 'remaining'

export interface Settings {
  /**
   * Whether the Undo button is offered. Undo is a playtesting tool: it can rewind past a
   * mulligan, a draw or a search, so replaying the same decision with the hidden information
   * already seen. Off in the shipped build, on while developing.
   */
  allowUndo: boolean
  baseHealthDisplay: BaseHealthDisplay
  /**
   * Whether the bug report button is offered in the game header. Developer chrome: filing a
   * report opens GitHub's new-issue page, which is not where a player belongs mid-game. On
   * while developing, off in the shipped build, and available to anyone who wants to report.
   */
  showBugReport: boolean
  /**
   * The least time, in milliseconds, between one opponent action being shown and the next. Zero
   * shows the opponent's whole reply at once. One of `OPPONENT_DELAYS_MS`.
   */
  opponentDelayMs: number
  /**
   * Whether finished games may be sent to train the bot. Opt-in, so only `yes` permits it:
   * `unasked` and `no` both mean nothing leaves the device, and differ only in whether the setup
   * screen still shows the notice. The one reader that acts on it is `data/collection.ts`.
   */
  shareGames: ShareGames
}

/** The player's answer about sharing games: not asked yet, opted in, or declined. */
export type ShareGames = 'unasked' | 'yes' | 'no'

const VALID_SHARE_GAMES: ShareGames[] = ['unasked', 'yes', 'no']

const VALID_BASE_HEALTH_DISPLAY: BaseHealthDisplay[] = ['damage', 'remaining']

/** The opponent paces on offer, fastest first. Zero is instant. */
export const OPPONENT_DELAYS_MS: readonly number[] = [0, 250, 500, 1000, 2000]

/**
 * A function rather than a constant: `allowUndo` reads the build, and `env.isDev` is mocked
 * per test. Evaluating it at module load would pin one answer for the whole file.
 */
export function defaultSettings(): Settings {
  return {
    allowUndo: isDev(),
    baseHealthDisplay: 'damage',
    showBugReport: isDev(),
    opponentDelayMs: 500,
    shareGames: 'unasked',
  }
}

/**
 * Read the stored settings, validating each field against its own default. A blob written by
 * another version (or by hand) can be corrupt, partial or wrongly typed, and none of those may
 * stop the app loading: an unusable value falls back to its default and the rest survives.
 *
 * This never writes. `allowUndo`'s default is build-dependent, so persisting a computed default
 * on first load would freeze one build's answer into storage.
 */
export function loadSettings(): Settings {
  const defaults = defaultSettings()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaults
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return defaults
    const stored = parsed as Record<string, unknown>
    return {
      allowUndo: typeof stored.allowUndo === 'boolean' ? stored.allowUndo : defaults.allowUndo,
      baseHealthDisplay: VALID_BASE_HEALTH_DISPLAY.includes(stored.baseHealthDisplay as BaseHealthDisplay)
        ? (stored.baseHealthDisplay as BaseHealthDisplay)
        : defaults.baseHealthDisplay,
      showBugReport: typeof stored.showBugReport === 'boolean' ? stored.showBugReport : defaults.showBugReport,
      opponentDelayMs: OPPONENT_DELAYS_MS.includes(stored.opponentDelayMs as number)
        ? (stored.opponentDelayMs as number)
        : defaults.opponentDelayMs,
      // Anything but one of the three answers reads as not asked, so a damaged blob opts nobody in.
      shareGames: VALID_SHARE_GAMES.includes(stored.shareGames as ShareGames)
        ? (stored.shareGames as ShareGames)
        : defaults.shareGames,
    }
  } catch {
    return defaults
  }
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}
