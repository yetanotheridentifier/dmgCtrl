import type { XwingPilot } from './parseXwsText'
import { resolveXwsName } from './resolveXwsName'
import { pilotNames } from './xwaNames'

// Points as exported in the XWS — the list's cost when it was built, not today's.
export function listPoints(pilots: XwingPilot[]): number {
  return pilots.reduce((sum, p) => sum + p.points, 0)
}

const FACTION_NAMES: Record<string, string> = {
  rebelalliance: 'Rebel Alliance',
  galacticempire: 'Galactic Empire',
  scumandvillainy: 'Scum and Villainy',
  resistance: 'Resistance',
  firstorder: 'First Order',
  galacticrepublic: 'Galactic Republic',
  separatistalliance: 'Separatist Alliance',
}

export function factionName(xws: string | undefined): string | undefined {
  if (xws === undefined) return undefined
  return FACTION_NAMES[xws] ?? xws
}

// The "49 pts · Rebel Alliance" line shown for a list on Squad Lists and setup.
export function listMeta(pilots: XwingPilot[], faction: string | undefined): string {
  const fName = factionName(faction)
  return fName ? `${listPoints(pilots)} pts · ${fName}` : `${listPoints(pilots)} pts`
}

// The pilots line on a setup card: display names in list order, a repeated pilot counted where it
// first appears ("3 × Academy Pilot"), so a full list fits on one or two lines.
export function pilotSummary(pilots: XwingPilot[]): string {
  const counts = new Map<string, number>()
  for (const p of pilots) {
    const name = resolveXwsName(p.name.split('-')[0], pilotNames)
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return [...counts].map(([name, n]) => (n > 1 ? `${n} × ${name}` : name)).join(', ')
}
