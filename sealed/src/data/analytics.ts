import { RELEASE } from '../buildIdentity'

/**
 * Anonymous usage events: the app opening, and each game's start and end. Sent for everyone, as the
 * PWA's are, and described in the Help section on sharing. Separate from the opt-in game record
 * (`collectionSend.ts`): these carry no cards, no decisions and no deck names.
 *
 * A COPY of the PWA's sender (`src/services/analytics.ts`: `enqueue`, `flush`, `sendEvent`), kept the
 * same shape, because Sealed imports nothing from the PWA. Two deliberate differences, each forced:
 *   - its own queue key. Sealed is served from `/sealed/` on the PWA's origin, so the two share
 *     localStorage, and one key would mix their unsent events;
 *   - under test it goes nowhere unless a test points it at an endpoint. The Worker writes whatever
 *     reaches it, and a test run is not a browser, so a stray event would land in production data.
 */

const SESSION_ID = Math.random().toString(36).slice(2, 10)

/** localStorage: events not yet delivered, oldest first. Not the PWA's `analytics_queue`. */
export const ANALYTICS_QUEUE_KEY = 'sealed_analytics_queue'
const QUEUE_MAX = 200

interface QueuedEvent {
  event_id: string
  name: string
  data: Record<string, unknown>
  queued_at: string
}

/** Where events go, or null for nowhere: a test run that has not set one. */
function endpoint(): string | null {
  const configured = import.meta.env.VITE_ANALYTICS_URL as string | undefined
  if (configured) return configured
  return import.meta.env.MODE === 'test' ? null : 'https://worker.dmgctrl.app/analytics'
}

function enqueue(name: string, data: Record<string, unknown>): void {
  try {
    const raw = localStorage.getItem(ANALYTICS_QUEUE_KEY)
    const queue: QueuedEvent[] = raw ? JSON.parse(raw) : []
    queue.push({ event_id: crypto.randomUUID(), name, data, queued_at: new Date().toISOString() })
    if (queue.length > QUEUE_MAX) queue.splice(0, queue.length - QUEUE_MAX)
    localStorage.setItem(ANALYTICS_QUEUE_KEY, JSON.stringify(queue))
  } catch {
    // Never affects play.
  }
}

async function flush(base: string): Promise<void> {
  try {
    const raw = localStorage.getItem(ANALYTICS_QUEUE_KEY)
    if (!raw) return
    const queue: QueuedEvent[] = JSON.parse(raw)
    if (queue.length === 0) return
    const response = await fetch(`${base}/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: queue }),
    })
    if (response.ok) localStorage.removeItem(ANALYTICS_QUEUE_KEY)
  } catch {
    // Offline or a network error: the queue waits for the next event.
  }
}

async function sendEvent(event: string, data: Record<string, unknown>): Promise<void> {
  const base = endpoint()
  if (!base) return
  enqueue(event, { ...data, game: 'sealed', env: import.meta.env.MODE, sessionId: SESSION_ID, version: RELEASE })
  await flush(base)
}

/** A game's two decks as dealt. Sets, leaders and bases are card ids' set codes and ids. */
export interface SealedGameStart {
  player_set: string
  opponent_set: string
  /** A deck built for this game, or one the player saved. "Any of my decks" is a saved deck. */
  player_deck: 'generated' | 'saved'
  opponent_deck: 'generated' | 'saved'
  rematch: boolean
  player_leader: string
  opponent_leader: string
  player_base: string
  opponent_base: string
  /** The base's aspect, or `none`. */
  player_aspect: string
  opponent_aspect: string
}

/**
 * A game's end, with its decks repeated from the start: nothing links a game's two events, so a
 * result by leader or set can only be read from this one.
 */
export interface SealedGameEnd extends SealedGameStart {
  /** For the player. */
  result: 'win' | 'loss' | 'draw'
  round: number
  durationSeconds: number
  undo_count: number
  /** `none` when nobody conceded, so the field exists from the first game, not the first concession. */
  conceded_by: 'player' | 'opponent' | 'none'
}

export function onAppStarted(): Promise<void> {
  return sendEvent('app_started', {})
}

export function onGameStarted(start: SealedGameStart): Promise<void> {
  return sendEvent('game_started', { ...start })
}

export function onGameEnded(end: SealedGameEnd): Promise<void> {
  return sendEvent('game_ended', { ...end })
}
