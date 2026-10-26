import { POINTS_MAX, POINTS_MIN, SHIPS_MAX, SHIPS_MIN } from './xwingListRules'

export interface XwingPilot {
  name: string
  ship: string
  points: number
}

export type ParseResult =
  | { ok: true; pilots: XwingPilot[]; total: number; name: string | undefined; faction: string | undefined }
  | { ok: false; error: 'invalid-format' | 'too-few-ships' | 'too-many-ships' | 'invalid-total' }

export function parseXwsText(text: string): ParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, error: 'invalid-format' }
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, error: 'invalid-format' }
  }

  const obj = parsed as Record<string, unknown>

  if (!Array.isArray(obj.pilots) || typeof obj.points !== 'number') {
    return { ok: false, error: 'invalid-format' }
  }

  const pilots: XwingPilot[] = []
  for (const entry of obj.pilots) {
    if (
      typeof entry !== 'object' || entry === null ||
      typeof (entry as Record<string, unknown>).name !== 'string' ||
      typeof (entry as Record<string, unknown>).ship !== 'string' ||
      typeof (entry as Record<string, unknown>).points !== 'number'
    ) {
      return { ok: false, error: 'invalid-format' }
    }
    const e = entry as Record<string, unknown>
    pilots.push({ name: e.name as string, ship: e.ship as string, points: e.points as number })
  }

  if (pilots.length < SHIPS_MIN) return { ok: false, error: 'too-few-ships' }
  if (pilots.length > SHIPS_MAX) return { ok: false, error: 'too-many-ships' }

  const total = obj.points as number
  if (total < POINTS_MIN || total > POINTS_MAX) return { ok: false, error: 'invalid-total' }

  const name = typeof obj.name === 'string' ? obj.name : undefined
  const faction = typeof obj.faction === 'string' ? obj.faction : undefined
  return { ok: true, pilots, total, name, faction }
}
