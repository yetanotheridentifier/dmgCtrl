import ashSet from '../fixtures/ashSet.json'
import minefieldArenaChoice from '../fixtures/reports/minefieldArenaChoice.json'
import { buildCardDb } from '../../engine/cardDb'
import { resolve } from '../../engine/resolve'
import '../../engine/cardDefinitions' // side-effect: registers every implemented card
import type { SwuCard } from '../../data/cards'
import type { GameState, PlayerId, CardDb } from '../../engine/types'
import type { Action } from '../../engine/actions'

/**
 * Replaying a filed bug report (#373).
 *
 * A report carries `initialState` plus every move, which re-resolve to the exact same game because
 * the AI draws from `state.rngSeed` (#366). That makes a ticket a runnable fixture: drop its JSON
 * in `fixtures/reports/`, replay it here, and inspect any point in the game. Both #365 and the
 * Grogu initiative hang showed the visible symptom appearing several moves after the actual
 * divergence, which is exactly what stepping through a replay finds and a screenshot cannot.
 */

/** The shape of the `<details>` payload in a report. `cards` is stripped when a report is filed. */
export interface Report {
  initialState: Omit<GameState, 'cards'> & { cards?: CardDb }
  moves: { by: PlayerId; action: Action }[]
}

const ashCards = ashSet as SwuCard[]

/**
 * Filed reports, keyed by name. Imported rather than read from disk so they are typechecked and
 * bundled the same way the other fixtures are; add an entry when a new report is worth keeping.
 */
const REPORTS: Record<string, unknown> = { minefieldArenaChoice }

/** Every card id a report's starting position refers to. */
function referencedIds(state: Report['initialState']): string[] {
  const ids = new Set<string>()
  for (const side of ['player', 'opponent'] as PlayerId[]) {
    const p = state.players[side]
    ids.add(p.leader.cardId)
    ids.add(p.base.cardId)
    for (const id of [...p.hand, ...p.deck, ...p.discard]) ids.add(id)
    for (const u of p.units) ids.add(u.cardId)
  }
  return [...ids]
}

/**
 * Rebuild the card database the report omitted. `extra` supplies cards from outside ASH: reports
 * from mixed-set pools reference them, and the bundled fixture only covers ASH.
 *
 * Throws naming the missing ids rather than failing later in an unrelated place.
 */
export function hydrate(report: Report, extra: SwuCard[] = []): GameState {
  const cards = buildCardDb([...ashCards, ...extra])
  const missing = referencedIds(report.initialState).filter(id => !cards[id])
  if (missing.length > 0) {
    throw new Error(
      `replayReport: no card data for ${missing.join(', ')}. `
      + 'The bundled fixture is ASH only; pass the other sets\' cards as `extra`.',
    )
  }
  return { ...report.initialState, cards } as GameState
}

/**
 * Every state in order: index 0 is the starting position, index n is the state after move n-1. Use
 * this to step through and find where the game first goes wrong.
 */
export function replaySteps(report: Report, extra: SwuCard[] = []): GameState[] {
  const states = [hydrate(report, extra)]
  for (const move of report.moves) {
    states.push(resolve(states[states.length - 1], move.action))
  }
  return states
}

/** The state a report ends in, which is the board the reporter was looking at. */
export function replay(report: Report, extra: SwuCard[] = []): GameState {
  const states = replaySteps(report, extra)
  return states[states.length - 1]
}

/** A report filed under `fixtures/reports/`, by name. */
export function loadReport(name: keyof typeof REPORTS | string): Report {
  const report = REPORTS[name]
  if (!report) throw new Error(`replayReport: no fixture named "${name}" (have: ${Object.keys(REPORTS).join(', ')})`)
  return report as Report
}
