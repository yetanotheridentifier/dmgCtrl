import type { XwingPilot } from './parseXwsText'

export type ShipState = 'alive' | 'half' | 'destroyed'

export interface ShipEntry {
  pilot: XwingPilot
  state: ShipState
}

export function halfPoints(pts: number): number { return Math.floor(pts / 2) }
export function remainingPoints(pts: number): number { return Math.ceil(pts / 2) }

export function initShips(pilots: XwingPilot[]): ShipEntry[] {
  return pilots.map(pilot => ({ pilot, state: 'alive' }))
}
