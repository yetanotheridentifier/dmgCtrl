import type { Action } from '../engine/actions'
import type { GameState } from '../engine/types'
import type { Ai } from '../ai/types'
import { driverAction } from '../ai/concession'
import { opponentAi } from '../config'
import { logger } from '../data/log'
import type { OpponentReply, OpponentRequest } from './opponentWorker'

/**
 * Where `useGame` gets the opponent's next step from: a Web Worker for the shipped opponent, so its
 * search never blocks the page, or directly on the main thread for an AI handed in as a function
 * (tests, and anywhere `Worker` does not exist).
 *
 * At most one request is out at a time. A new request supersedes the one before it, and `cancel` drops
 * it, so a reply the game has moved past (an undo, a new game, leaving) is never handed on.
 */
export interface OpponentChooser {
  /** Ask for the opponent's step in `state`. `reply` is called once with it, unless cancelled first. */
  choose(state: GameState, reply: (action: Action | null) => void): void
  /** Drop the request in flight: its reply, when it comes, is discarded. */
  cancel(): void
  /** Drop the request in flight and end the chooser, terminating its worker. */
  close(): void
}

/** The part of a `Worker` the chooser uses, so a test can stand one in. */
export interface WorkerLike {
  onmessage: ((event: { data: OpponentReply }) => void) | null
  onerror: ((event: never) => void) | null
  postMessage(request: OpponentRequest): void
  terminate(): void
}

/** Choose on the calling thread: `reply` is called before `choose` returns. */
export function directChooser(ai: Ai): OpponentChooser {
  return {
    choose: (state, reply) => reply(driverAction(state, ai)),
    cancel: () => {},
    close: () => {},
  }
}

/**
 * Choose in `worker`. If the worker fails to start (its script would not load), every request from
 * then on, the one in flight included, is answered on the main thread instead: slower, but a game.
 */
export function workerChooser(worker: WorkerLike): OpponentChooser {
  let nextId = 0
  let pending: { id: number; state: GameState; reply: (action: Action | null) => void } | null = null
  let fallback: OpponentChooser | null = null

  worker.onmessage = ({ data }) => {
    if (!pending || data.id !== pending.id) return
    const { reply } = pending
    pending = null
    if ('error' in data) {
      logger.error('opponent search failed', { detail: data.error })
      return reply(null)
    }
    reply(data.action)
  }
  worker.onerror = () => {
    logger.warn('opponent worker failed to start: choosing on the main thread')
    worker.terminate()
    fallback = directChooser(opponentAi)
    const waiting = pending
    pending = null
    if (waiting) fallback.choose(waiting.state, waiting.reply)
  }

  return {
    choose(state, reply) {
      if (fallback) return fallback.choose(state, reply)
      pending = { id: ++nextId, state, reply }
      worker.postMessage({ id: pending.id, state })
    },
    cancel() {
      pending = null
    },
    close() {
      pending = null
      worker.terminate()
    },
  }
}

/** The chooser for one game: `ai` on the main thread when one is handed in, else the shipped opponent in a worker. */
export function opponentChooser(ai?: Ai): OpponentChooser {
  if (ai || typeof Worker === 'undefined') return directChooser(ai ?? opponentAi)
  return workerChooser(new Worker(new URL('./opponentWorker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike)
}
