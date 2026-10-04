import { SET_PROGRESS } from './implementedCards'
import { GENERATED_DECK_ID } from '../deckgen/randomDeck'

export const STORAGE_KEY = 'sealed_setup'

/**
 * The setup screen's choices, as the player last left them.
 *
 * Kept apart from `Settings`: those are preferences the settings overlay edits, these are the last
 * state of one screen, and the two change for different reasons. The shape of loading and saving is
 * the same as `settingsStore`'s.
 */
export interface Setup {
  /** The set the player's generator builds from. */
  playerSet: string
  /** The set a generated opponent builds from, read only while `linkSets` is off. */
  opponentSet: string
  /** Whether a generated opponent builds from the set of the deck the player plays. */
  linkSets: boolean
  /** `generated`, `random`, or a saved deck's id. A deck deleted since is resolved by the screen. */
  opponentChoice: string
  /** A generated opponent's leader id, or the empty string for random. */
  opponentLeader: string
  /** A generated opponent's base aspect, or the empty string for random. */
  opponentAspect: string
}

const SET_CODES = SET_PROGRESS.map(s => s.code)

/**
 * The newest set is the one a player is most likely to want, and a sealed game is two decks from one
 * set, so both generators start there and linked.
 */
export function defaultSetup(): Setup {
  return {
    playerSet: SET_CODES[0],
    opponentSet: SET_CODES[0],
    linkSets: true,
    opponentChoice: GENERATED_DECK_ID,
    opponentLeader: '',
    opponentAspect: '',
  }
}

/**
 * Read the stored setup, validating each field against its own default, so a corrupt, partial or
 * wrongly typed blob costs only the fields it spoils. A set must still be in the manifest. Whether a
 * leader, an aspect or an opponent deck still exists depends on the cache and the deck list, so the
 * screen checks those when it reads them. This never writes.
 */
export function loadSetup(): Setup {
  const defaults = defaultSetup()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaults
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return defaults
    const stored = parsed as Record<string, unknown>
    const set = (v: unknown, d: string) => (typeof v === 'string' && SET_CODES.includes(v) ? v : d)
    const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d)
    return {
      playerSet: set(stored.playerSet, defaults.playerSet),
      opponentSet: set(stored.opponentSet, defaults.opponentSet),
      linkSets: typeof stored.linkSets === 'boolean' ? stored.linkSets : defaults.linkSets,
      opponentChoice: str(stored.opponentChoice, defaults.opponentChoice),
      opponentLeader: str(stored.opponentLeader, defaults.opponentLeader),
      opponentAspect: str(stored.opponentAspect, defaults.opponentAspect),
    }
  } catch {
    return defaults
  }
}

export function saveSetup(setup: Setup): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(setup))
}
