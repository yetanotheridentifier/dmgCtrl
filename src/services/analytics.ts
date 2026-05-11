import { version as APP_VERSION } from '../../package.json'

const SESSION_ID = Math.random().toString(36).slice(2, 10)

async function sendEvent(event: string, data: Record<string, unknown>): Promise<void> {
  const url = import.meta.env.VITE_ANALYTICS_URL ?? 'https://swu-proxy.dmgctrl.workers.dev/analytics'
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
