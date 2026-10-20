import type { XwingPilot } from './parseXwsText'

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
