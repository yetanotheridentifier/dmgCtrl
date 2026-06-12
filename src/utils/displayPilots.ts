import type { XwingPilot } from './parseXwsText'
import { resolveXwsName } from './resolveXwsName'
import { xwsPilotNames } from '../data/xwsPilotNames'
import { xwsShipNames } from '../data/xwsShipNames'

export interface DisplayPilot {
  displayName: string
  ship: string
  points: number
}

// Takes slug before the first hyphen as the lookup key for pilot name. Numbers
// any duplicates within the list so generics (e.g. academypilot x3) can be
// distinguished. Unique names are never suffixed.
export function displayPilots(pilots: XwingPilot[]): DisplayPilot[] {
  const baseKey = (p: XwingPilot) => p.name.split('-')[0]
  const displayName = (p: XwingPilot) => resolveXwsName(baseKey(p), xwsPilotNames)

  const counts: Record<string, number> = {}
  for (const p of pilots) counts[displayName(p)] = (counts[displayName(p)] ?? 0) + 1

  const seen: Record<string, number> = {}
  return pilots.map(p => {
    const name = displayName(p)
    const ship = resolveXwsName(p.ship, xwsShipNames)
    if (counts[name] > 1) {
      seen[name] = (seen[name] ?? 0) + 1
      return { displayName: `${name} ${seen[name]}`, ship, points: p.points }
    }
    return { displayName: name, ship, points: p.points }
  })
}
