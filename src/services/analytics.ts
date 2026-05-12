import { version as APP_VERSION } from '../../package.json'

const SESSION_ID = Math.random().toString(36).slice(2, 10)
const SESSION_START_TIME = Date.now()

async function sendEvent(event: string, data: Record<string, unknown>): Promise<void> {
  const url = import.meta.env.VITE_ANALYTICS_URL ?? 'https://worker.dmgctrl.app/analytics'
  const env = import.meta.env.MODE
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, data: { ...data, env, sessionId: SESSION_ID } }),
    })
  } catch {
    // fire-and-forget: errors are silently discarded
  }
}

export function onAppStart(): Promise<void> {
  return sendEvent('app_started', { version: APP_VERSION })
}

export function onGameStart(baseKey: string, baseSet: string, hyperspace: boolean): Promise<void> {
  return sendEvent('game_started', { baseKey, baseSet, hyperspace })
}

export function onGameEnd(baseKey: string, baseSet: string, hyperspace: boolean, durationSeconds: number): Promise<void> {
  return sendEvent('game_ended', { baseKey, baseSet, hyperspace, durationSeconds })
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
