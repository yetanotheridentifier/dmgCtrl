import { xwaPilots } from '../data/xwaCards'
import type { XwingPilot } from './parseXwsText'

// A pilot missing from the data counts as unique, so it keeps a row of its own where it can.
const isUnique = (p: XwingPilot) => xwaPilots[p.name]?.unique ?? true

// The ship column's rows, as indices into the list. Up to 4 ships get a full-width row each. From
// the 5th, rows hold two and the column keeps 4 rows (8 ships fill it); non-unique pilots pair
// before unique ones, so the uniques keep the full-width rows that are left.
export function shipRows(pilots: XwingPilot[]): number[][] {
  const n = pilots.length
  if (n <= 4) return pilots.map((_, i) => [i])
  const rows = Math.max(4, Math.ceil(n / 2))
  const singles = 2 * rows - n
  const indices = pilots.map((_, i) => i)
  const order = [...indices.filter(i => isUnique(pilots[i])), ...indices.filter(i => !isUnique(pilots[i]))]
  const result: number[][] = order.slice(0, singles).map(i => [i])
  for (let i = singles; i < n; i += 2) result.push(order.slice(i, i + 2))
  return result
}
