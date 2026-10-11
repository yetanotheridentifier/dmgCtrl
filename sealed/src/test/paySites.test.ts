import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Where the engine pays a cost and where it asks whether one can be paid, checked from the source.
 *
 * **A cost has one door**, `pay` in `payment.ts`, and one question, `canPay` (or `payable`, the number
 * behind it). That door is what lets a Credit token or a unit that pays as a resource cover part of
 * any cost: the dispatcher measures what an action asks `pay` for and raises the paying step first.
 * A site that exhausts resources itself, or reads the ready count to decide what is affordable, pays
 * with resources only and silently: the play is legal in the printed game and missing from the moves.
 *
 * A new direct payment fails the first test outright. A new direct read of the ready resources fails
 * the second until whoever adds it either asks `canPay`/`payable` or adds it to the list below with
 * the reason it is not a question about affording a cost.
 */

const DIR = 'src/engine'
const DIRECT_PAY = /\b(payCost|canAfford)\(/g
const READY_READ = /readyResourceCount\(|!\s*r\.exhausted/g

/** Every direct read of the ready resources outside the door, named. */
const EXPECTED_READS: Record<string, number> = {
  // The count itself (two), and `canAfford` and `payCost` reading it.
  'resources.ts': 4,
  // `payable` counts them, `pay` in a dry run exhausts what there is, and the step's Done reads what is left.
  'payment.ts': 3,
  // Greater Sarlacc's step picks ready resources, so its terms count them, and a card's own Credit
  // step (Jabba the Hutt) has only ready resources left to finish with.
  'legalMoves.ts': 2,
  // Resources defeated or exhausted by an effect, which is not a payment: the ready count kept when
  // resources are defeated (three reads) and the one ready resource an effect exhausts.
  'effects.ts': 4,
  // Effects that exhaust a resource, look for one to exhaust or to move, or count the ready ones as a
  // number in their text ("exhaust an enemy resource", "equal to the number of ready resources you
  // control", "if an opponent controls no ready resources"), none of them a cost.
  'cardDefinitions.ts': 6,
}

const sources = readdirSync(join(process.cwd(), DIR))
  .filter(f => f.endsWith('.ts'))
  .map(f => ({ f, text: readFileSync(join(process.cwd(), DIR, f), 'utf8') }))

const count = (pattern: RegExp) => Object.fromEntries(sources.flatMap(({ f, text }) => {
  const n = text.match(pattern)?.length ?? 0
  return n > 0 ? [[f, n]] : []
}))

describe('pay sites', () => {
  it('finds the door, so a silent pass is impossible', () => {
    const door = sources.find(s => s.f === 'payment.ts')?.text ?? ''
    expect(door).toContain('export function pay(')
    expect(door).toContain('export function canPay(')
    expect(door).toContain('export function payable(')
  })

  it('exhausts resources for a cost, and asks whether resources cover one, only inside the door', () => {
    const perFile = count(DIRECT_PAY)
    expect(Object.keys(perFile).sort()).toEqual(['payment.ts', 'resources.ts'])
  })

  it('reads the ready resources directly only at the known sites (every other read asks payable)', () => {
    expect(count(READY_READ)).toEqual(EXPECTED_READS)
  })
})
