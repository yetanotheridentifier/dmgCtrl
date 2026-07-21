import { describe, it, expect } from 'vitest'
import { describeChoiceParts, BOARD_TARGET_KINDS } from '../utils/describeChoice'
import { partsText } from '../utils/describeAction'
import { state, player, card, CARDS, unit } from './helpers/engineFixtures'
import type { GameState, PendingChoice } from '../engine/types'

function board(): GameState {
  return state({
    cards: { ...CARDS, SRC: card({ id: 'SRC', name: 'Source Card', type: 'unit' }), SHIELD: card({ id: 'SHIELD', name: 'Shield', type: 'token' }) },
    players: {
      player: player({ units: [unit('u1', 'SRC')] }),
      opponent: player(),
    },
  })
}

const s = board()
const prompt = (choice: PendingChoice) => partsText(describeChoiceParts(s, choice))

/**
 * The prompt tells the player what a board highlight is asking of them (#370). Every kind that
 * highlights the board must produce a usable sentence — a blank or a raw kind name leaking to
 * the player is the failure this guards.
 */
describe('describeChoiceParts', () => {
  const sample: Record<string, PendingChoice> = {
    mayDamage: { kind: 'mayDamage', id: 'c', controller: 'player', unitId: 'u1', targets: ['u2'], amount: 2 },
    selectDamageTarget: { kind: 'selectDamageTarget', id: 'c', controller: 'player', amount: 3, unitTargets: ['u2'], baseTargets: [] },
    selectHealTarget: { kind: 'selectHealTarget', id: 'c', controller: 'player', amount: 2, unitTargets: ['u1'], baseTargets: [] },
    mayExhaustUnit: { kind: 'mayExhaustUnit', id: 'c', controller: 'player', targets: ['u2'] },
    selectUnitToDefeat: { kind: 'selectUnitToDefeat', id: 'c', controller: 'player', targets: ['u2'] },
    distributeDamage: { kind: 'distributeDamage', id: 'c', controller: 'player', remaining: 2, total: 3, targets: ['u2'] },
    distributeTokens: { kind: 'distributeTokens', id: 'c', controller: 'player', token: 'SHIELD', remaining: 1, total: 2, targets: ['u1'] },
    mayGiveTokens: { kind: 'mayGiveTokens', id: 'c', controller: 'player', token: 'SHIELD', count: 2, targets: ['u1'] },
    returnFriendlyUnit: { kind: 'returnFriendlyUnit', id: 'c', controller: 'player', targets: ['u1'] },
    healForAdvantage: { kind: 'healForAdvantage', id: 'c', controller: 'player', targets: ['u1'], maxHeal: 2 },
  }

  it('gives every board-target kind a prompt — never blank, never the raw kind name', () => {
    for (const kind of BOARD_TARGET_KINDS) {
      const choice = sample[kind] ?? ({ kind, id: 'c', controller: 'player', targets: ['u2'] } as unknown as PendingChoice)
      const text = prompt(choice)
      expect(text.length, kind).toBeGreaterThan(0)
      expect(text, kind).not.toContain(kind)
      expect(text[0], `${kind} should read as an instruction`).toBe(text[0].toUpperCase())
    }
  })

  it('states the amount for a damage choice', () => {
    expect(prompt(sample.mayDamage)).toMatch(/2 damage/i)
    expect(prompt(sample.selectDamageTarget)).toMatch(/3 damage/i)
  })

  it('names the token being handed out', () => {
    expect(prompt(sample.mayGiveTokens)).toMatch(/shield/i)
  })

  it('shows progress while distributing a pool', () => {
    // 3 total with 2 still to place → 1 allocated, matching the distribute HUD's reading.
    expect(prompt(sample.distributeDamage)).toMatch(/1 of 3/i)
  })

  it('names the instigating card when the choice records one', () => {
    // mayDamage carries unitId, so the prompt can say what raised it.
    const parts = describeChoiceParts(s, sample.mayDamage)
    expect(parts.some(p => typeof p !== 'string' && p.cardId === 'SRC')).toBe(true)
  })

  /** Menu-driven choices had no prompt at all, so a row of buttons appeared unexplained. */
  it('prompts for the menu-driven choices too, not just board targets', () => {
    expect(prompt({ kind: 'selectArenaToGrant', id: 'c', controller: 'player', grantCardId: 'GRANT_MINEFIELD' } as unknown as PendingChoice)).toMatch(/arena/i)
    expect(prompt({ kind: 'chooseMode', id: 'c', controller: 'player', modes: ['healBase'] } as unknown as PendingChoice)).toMatch(/choose/i)
    expect(prompt({ kind: 'chooseNumber', id: 'c', controller: 'player', max: 10 } as unknown as PendingChoice)).toMatch(/number/i)
    expect(prompt({ kind: 'mayPlayUnitFromDiscard', id: 'c', controller: 'player', candidates: [] } as unknown as PendingChoice)).toMatch(/discard/i)
    expect(prompt({ kind: 'selectUnitToSteal', id: 'c', controller: 'player', targets: ['u1'] } as unknown as PendingChoice)).toMatch(/control/i)
  })

  it('still reads sensibly when the choice records no source (see #374)', () => {
    // selectUnitToDefeat has no source field — the prompt must not imply one.
    const parts = describeChoiceParts(s, sample.selectUnitToDefeat)
    expect(parts.every(p => typeof p === 'string')).toBe(true)
    expect(partsText(parts)).toMatch(/choose/i)
  })
})
