import '../engine/cardDefinitions' // side effect: registers every implemented card ability, in this thread
import type { Action } from '../engine/actions'
import type { GameState } from '../engine/types'
import { driverAction } from '../ai/concession'
import { opponentAi } from '../config'

/**
 * The shipped opponent's side of the Web Worker its search runs in (`opponentChooser.ts` is the page's
 * side). A thin wrapper: the AI itself is the same pure function the bench and the tests call directly.
 *
 * What the search needs crosses with the state or is built here:
 *
 * - **The card database** is the state's own `cards`, so the structured clone of the state delivers it.
 *   Nothing is fetched or rebuilt in the worker.
 * - **The ability registry** is module state, and a worker shares no modules with the page, so it is
 *   filled by importing `cardDefinitions` above. `opponentWorker.test.ts` pins that this module does it
 *   on its own.
 */

export interface OpponentRequest {
  /** Matches the reply to its request, so a reply the game has moved past is recognised and dropped. */
  id: number
  state: GameState
}

export type OpponentReply =
  | { id: number; action: Action | null }
  /** The search threw. The message crosses rather than the error, which keeps the reply plain data. */
  | { id: number; error: string }

/** The worker's answer to one request: the step the app's turn driver takes for the opponent. */
export function answer({ id, state }: OpponentRequest): OpponentReply {
  try {
    return { id, action: driverAction(state, opponentAi) }
  } catch (err) {
    return { id, error: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err) }
  }
}

/** The worker's global scope, typed only as far as it is used (the app's lib is the DOM's). */
interface WorkerScope {
  onmessage: ((event: MessageEvent<OpponentRequest>) => void) | null
  postMessage(reply: OpponentReply): void
}

// Listening only when this module is a worker's entry: the page and the tests import it for `answer`.
if ('WorkerGlobalScope' in globalThis) {
  const scope = globalThis as unknown as WorkerScope
  scope.onmessage = event => scope.postMessage(answer(event.data))
}
