import { xwaPilots, xwaShips } from '../data/xwaCards'
import type { XwingPilot } from './parseXwsText'
import { factionName, listPoints } from './xwingListInfo'

// What makes an XWA list legal for scoring. One copy, used by the builder and by Import XWS.

export const POINTS_MIN = 46
export const POINTS_MAX = 50
export const SHIPS_MIN = 3
export const SHIPS_MAX = 8

const RANGE = `(${POINTS_MIN}–${POINTS_MAX})`

// A unique is a character, not a card: "Han Solo" and "Han Solo (BoY)" are the same Han.
const character = (id: string) => xwaPilots[id].name.split(' (')[0]

export const pilotName = (id: string) => xwaPilots[id]?.name ?? id

// How many of this pilot one list may hold: 1 for a unique, else its per-squad limit if it has one.
export function pilotLimit(id: string): number | undefined {
  const pilot = xwaPilots[id]
  if (!pilot) return undefined
  return pilot.unique ? 1 : pilot.limit
}

export type AddBlock = 'unique' | 'limit' | 'ships'

// Why this pilot can't go into the list as it stands, or null if it can.
export function addBlock(pilots: XwingPilot[], id: string): AddBlock | null {
  if (pilots.length >= SHIPS_MAX) return 'ships'
  const pilot = xwaPilots[id]
  if (!pilot) return null
  if (pilot.unique) {
    const name = character(id)
    return pilots.some(p => xwaPilots[p.name]?.unique && character(p.name) === name) ? 'unique' : null
  }
  const limit = pilot.limit
  return limit !== undefined && pilots.filter(p => p.name === id).length >= limit ? 'limit' : null
}

// Uniques twice and generics over their limit. Pilots missing from the table aren't judged.
export function pilotProblems(pilots: XwingPilot[]): string[] {
  const problems: string[] = []
  const uniques = new Map<string, number>()
  const generics = new Map<string, number>()
  for (const p of pilots) {
    const pilot = xwaPilots[p.name]
    if (!pilot) continue
    if (pilot.unique) uniques.set(character(p.name), (uniques.get(character(p.name)) ?? 0) + 1)
    else generics.set(p.name, (generics.get(p.name) ?? 0) + 1)
  }
  for (const [name, n] of uniques) if (n > 1) problems.push(`${name} is unique: only one per list.`)
  for (const [id, n] of generics) {
    const limit = xwaPilots[id].limit
    if (limit !== undefined && n > limit) problems.push(`${xwaPilots[id].name}: limit ${limit} per list, this list has ${n}.`)
  }
  return problems
}

// Every reason the list can't be saved, ships and points first.
export function listProblems(pilots: XwingPilot[]): string[] {
  const problems: string[] = []
  if (pilots.length < SHIPS_MIN || pilots.length > SHIPS_MAX) problems.push(`${SHIPS_MIN} to ${SHIPS_MAX} ships: this list has ${pilots.length}.`)
  const total = listPoints(pilots)
  if (total < POINTS_MIN || total > POINTS_MAX) problems.push(`${total} pts: lists are ${POINTS_MIN}–${POINTS_MAX}.`)
  return [...problems, ...pilotProblems(pilots)]
}

// The builder's one line under the total: what stands between the list and Save.
export function saveStatus(pilots: XwingPilot[]): { ready: boolean; message: string } {
  if (pilots.length < SHIPS_MIN) return { ready: false, message: `Add at least ${SHIPS_MIN} ships` }
  const [problem] = pilotProblems(pilots)
  if (problem) return { ready: false, message: problem }
  const total = listPoints(pilots)
  if (total < POINTS_MIN) return { ready: false, message: `${POINTS_MIN - total} more points to save ${RANGE}` }
  if (total > POINTS_MAX) return { ready: false, message: `${total - POINTS_MAX} points over ${RANGE}` }
  return { ready: true, message: 'Ready to save' }
}

export interface FactionShip {
  ship: string
  name: string
  // XWS pilot ids, cheapest first.
  pilots: string[]
}

// A faction's ships A to Z, each with its pilots.
export function factionShips(faction: string): FactionShip[] {
  const byShip = new Map<string, string[]>()
  for (const [id, pilot] of Object.entries(xwaPilots)) {
    if (pilot.faction !== faction) continue
    byShip.set(pilot.ship, [...(byShip.get(pilot.ship) ?? []), id])
  }
  return [...byShip]
    .map(([ship, ids]) => ({
      ship,
      name: xwaShips[ship] ?? ship,
      pilots: ids.sort((a, b) => xwaPilots[a].points - xwaPilots[b].points || xwaPilots[a].name.localeCompare(xwaPilots[b].name)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// A saved list opened for editing is priced at today's costs; a pilot the table doesn't know keeps
// the points it was saved with.
export function atCurrentCost(pilots: XwingPilot[]): XwingPilot[] {
  return pilots.map(p => (xwaPilots[p.name] ? { ...p, points: xwaPilots[p.name].points } : p))
}

// "<Faction> list N", N the lowest number no saved list uses; "List N" with no faction.
export function defaultListName(faction: string | undefined, names: string[]): string {
  const prefix = faction ? `${factionName(faction)} list` : 'List'
  const used = new Set(names)
  let n = 1
  while (used.has(`${prefix} ${n}`)) n++
  return `${prefix} ${n}`
}
