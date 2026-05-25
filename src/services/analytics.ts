import { version as APP_VERSION } from '../../package.json'

const SESSION_ID = Math.random().toString(36).slice(2, 10)
const SESSION_START_TIME = Date.now()

const QUEUE_KEY = 'analytics_queue'
const QUEUE_MAX = 200

interface QueuedEvent {
  event_id: string
  name: string
  data: Record<string, unknown>
  queued_at: string
}

export function enqueue(name: string, data: Record<string, unknown>): void {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    const queue: QueuedEvent[] = raw ? JSON.parse(raw) : []
    queue.push({
      event_id: crypto.randomUUID(),
      name,
      data,
      queued_at: new Date().toISOString(),
    })
    if (queue.length > QUEUE_MAX) queue.splice(0, queue.length - QUEUE_MAX)
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
  } catch {
    // fail silently — never affect app functionality
  }
}

export async function flush(): Promise<void> {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    if (!raw) return
    const queue: QueuedEvent[] = JSON.parse(raw)
    if (queue.length === 0) return
    const base = import.meta.env.VITE_ANALYTICS_URL ?? 'https://worker.dmgctrl.app/analytics'
    const response = await fetch(`${base}/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: queue }),
    })
    if (response.ok) localStorage.removeItem(QUEUE_KEY)
  } catch {
    // offline or network error — preserve queue for next attempt
  }
}

window.addEventListener('online', () => { void flush() })

async function sendEvent(event: string, data: Record<string, unknown>): Promise<void> {
  const env = import.meta.env.MODE
  enqueue(event, { ...data, env, sessionId: SESSION_ID })
  await flush()
}

export function onAppStart(): Promise<void> {
  return sendEvent('app_started', { version: APP_VERSION })
}

export function onGameStart(baseKey: string, baseSet: string, hyperspace: boolean, playMode: string): Promise<void> {
  return sendEvent('game_started', { baseKey, baseSet, hyperspace, playMode })
}

export function onGameEnd(baseKey: string, baseSet: string, hyperspace: boolean, durationSeconds: number, playMode: string): Promise<void> {
  return sendEvent('game_ended', { baseKey, baseSet, hyperspace, durationSeconds, playMode })
}

export function onMatchCompleted(playMode: string, matchResult: string, playerScore: number, opponentScore: number): Promise<void> {
  return sendEvent('match_completed', { playMode, matchResult, playerScore, opponentScore })
}

export function onAppInstall(platform: string): Promise<void> {
  return sendEvent('app_installed', { platform })
}

export function onAppResume(): Promise<void> {
  const sessionDurationSoFarSeconds = Math.floor((Date.now() - SESSION_START_TIME) / 1000)
  return sendEvent('app_resumed', { sessionDurationSoFarSeconds })
}

export function onDamageDealt(baseKey: string, baseSet: string, amount: number): Promise<void> {
  return sendEvent('damage_dealt', { baseKey, baseSet, amount })
}

export function onDamageHealed(baseKey: string, baseSet: string, amount: number): Promise<void> {
  return sendEvent('damage_healed', { baseKey, baseSet, amount })
}

export function onRoundIncremented(baseKey: string, baseSet: string, round: number): Promise<void> {
  return sendEvent('round_incremented', { baseKey, baseSet, round })
}

export function onUndoUsed(baseKey: string, baseSet: string, undoneAction: string): Promise<void> {
  return sendEvent('undo_used', { baseKey, baseSet, undoneAction })
}

export function onEpicActionUsed(baseKey: string, baseSet: string): Promise<void> {
  return sendEvent('epic_action_used', { baseKey, baseSet })
}

export function onForceGained(baseKey: string, baseSet: string): Promise<void> {
  return sendEvent('force_gained', { baseKey, baseSet })
}

export function onForceUsed(baseKey: string, baseSet: string): Promise<void> {
  return sendEvent('force_used', { baseKey, baseSet })
}

export function onFavouriteAdded(baseKey: string, baseSet: string): Promise<void> {
  return sendEvent('favourite_added', { baseKey, baseSet })
}

export function onFavouriteRemoved(baseKey: string, baseSet: string): Promise<void> {
  return sendEvent('favourite_removed', { baseKey, baseSet })
}

export function onFavouritesCleared(): Promise<void> {
  return sendEvent('favourites_cleared', {})
}

export function onSettingChanged(setting: string, value: unknown): Promise<void> {
  return sendEvent('setting_changed', { setting, value })
}

export function onDeckImportSuccess(baseKey: string, baseSet: string): Promise<void> {
  return sendEvent('deck_import_success', { baseKey, baseSet })
}

export function onDeckImportFailure(reason: string): Promise<void> {
  return sendEvent('deck_import_failure', { reason })
}

export function onImageLoadFailed(baseKey: string, baseSet: string, url: string): Promise<void> {
  return sendEvent('image_load_failed', { baseKey, baseSet, url })
}

export function onBasesLoadFailed(): Promise<void> {
  return sendEvent('bases_load_failed', {})
}

export function onBasesLoadStale(): Promise<void> {
  return sendEvent('bases_load_stale', {})
}

export function onWakeLockFailed(reason: string): Promise<void> {
  return sendEvent('wake_lock_failed', { reason })
}

export function onTournamentStarted(format: string, playMode: string, totalRounds: number): Promise<void> {
  return sendEvent('tournament_started', { format, playMode, totalRounds })
}

export function onTournamentRoundCompleted(roundNumber: number, result: string, playerScore: number, opponentScore: number, format: string, playMode: string): Promise<void> {
  return sendEvent('tournament_round_completed', { roundNumber, result, playerScore, opponentScore, format, playMode })
}

export function onTournamentDropped(roundsCompleted: number, format: string, playMode: string): Promise<void> {
  return sendEvent('tournament_dropped', { roundsCompleted, format, playMode })
}

export function onTournamentEnded(totalRounds: number, won: number, lost: number, drawn: number, points: number, format: string, playMode: string): Promise<void> {
  return sendEvent('tournament_ended', { totalRounds, won, lost, drawn, points, format, playMode })
}

export interface XwingGameEndedPayload {
  final_round: number
  player_score: number
  opponent_score: number
  player_deficit: number
  opponent_deficit: number
  result: 'win' | 'loss' | 'draw' | null
  elapsed_seconds: number
  timer_expired: boolean
}

export function onXwingGameStarted(playerDeficit: number, opponentDeficit: number): Promise<void> {
  return sendEvent('xwing_game_started', { player_deficit: playerDeficit, opponent_deficit: opponentDeficit })
}

export function onXwingGameEnded(payload: XwingGameEndedPayload): Promise<void> {
  return sendEvent('xwing_game_ended', payload as unknown as Record<string, unknown>)
}

export function onXwingRoundAdvanced(fromRound: number, toRound: number): Promise<void> {
  return sendEvent('xwing_round_advanced', { from_round: fromRound, to_round: toRound })
}
