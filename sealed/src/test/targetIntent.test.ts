import { describe, it, expect } from 'vitest'
import { BOARD_TARGET_KINDS } from '../utils/describeChoice'
import { pushChoice } from '../engine/types'
import type { PendingChoice, TargetIntent } from '../engine/types'
import { getAbilities, getCardDefinition, registeredCardIds } from '../engine/abilities'
import { TOKEN_SHIELD, TOKEN_WEAKNESS, TOKEN_EXPERIENCE } from '../engine/tokenUpgrades'
import { state, player, unit } from './helpers/engineFixtures'
import '../engine/cardDefinitions'

/**
 * Every board-target choice says what it does to the thing picked, so the board can colour the
 * highlight by effect (help, harm, cunning, attach) rather than painting every target red. The engine
 * stamps it when the choice is raised: a kind whose effect follows from its payload is stamped by
 * `pushChoice`, and the generic `selectUnitThen` must be given one by the code that raises it.
 */

const raised = (choice: PendingChoice): TargetIntent | undefined => pushChoice(state(), choice).pendingChoices?.[0]?.intent

const base = { id: 'c', controller: 'player' as const }

/** A raisable example of every board-target kind. */
const SAMPLE: Record<(typeof BOARD_TARGET_KINDS)[number], PendingChoice> = {
  mayDamage: { ...base, kind: 'mayDamage', unitId: 'u1', targets: ['u2'], amount: 2 },
  mayAdvantageEach: { ...base, kind: 'mayAdvantageEach', unitId: 'u1', targets: ['u2'] },
  mayDamageExhaust: { ...base, kind: 'mayDamageExhaust', unitId: 'u1', arena: 'ground' },
  mayLastingBuff: { ...base, kind: 'mayLastingBuff', targets: ['u1'], power: 2, hp: 2 },
  mayGiveAdvantage: { ...base, kind: 'mayGiveAdvantage', targets: ['u1'] },
  mayExhaustLeaderGiveAdvantage: { ...base, kind: 'mayExhaustLeaderGiveAdvantage', targets: ['u1'] },
  mayExhaustLeaderExhaustUnit: { ...base, kind: 'mayExhaustLeaderExhaustUnit', targets: ['u2'] },
  mayExhaustUnit: { ...base, kind: 'mayExhaustUnit', targets: ['u2'] },
  selectDamageTarget: { ...base, kind: 'selectDamageTarget', amount: 2, unitTargets: ['u2'], baseTargets: [] },
  selectHealTarget: { ...base, kind: 'selectHealTarget', amount: 2, unitTargets: ['u1'], baseTargets: [] },
  selectUnitToExhaust: { ...base, kind: 'selectUnitToExhaust', targets: ['u2'], then: { cardId: 'X', discount: 0 } } as unknown as PendingChoice,
  selectUnitToDefeat: { ...base, kind: 'selectUnitToDefeat', targets: ['u2'] },
  selectUniqueUnitToDefeat: { ...base, kind: 'selectUniqueUnitToDefeat', cardId: 'X', candidates: ['u1'] },
  opponentGivesAdvantage: { ...base, kind: 'opponentGivesAdvantage', count: 1, targets: ['u1'] },
  mayGiveTokens: { ...base, kind: 'mayGiveTokens', token: TOKEN_SHIELD, count: 1, targets: ['u1'] },
  multiPick: { ...base, kind: 'multiPick', targets: ['u1'], spec: { mode: 'giveAdvantage', remaining: 2 } },
  distributeDamage: { ...base, kind: 'distributeDamage', remaining: 2, total: 2, targets: ['u2'] },
  distributeTokens: { ...base, kind: 'distributeTokens', token: TOKEN_EXPERIENCE, remaining: 2, total: 2, targets: ['u1'] },
  variableStrike: { ...base, kind: 'variableStrike', targets: ['u2'], undamagedAmount: 1, damagedAmount: 3 },
  healForAdvantage: { ...base, kind: 'healForAdvantage', targets: ['u1'], maxHeal: 2 },
  returnFriendlyUnit: { ...base, kind: 'returnFriendlyUnit', targets: ['u1'] },
  selectPair: { ...base, kind: 'selectPair', friendlyTargets: ['u1'], enemyTargets: ['u2'], mode: 'exhaust' },
  exploit: { ...base, kind: 'exploit', cardId: 'X', handIndex: 0, picks: [], limit: 2, discount: 2 },
  selectUnitThen: { ...base, kind: 'selectUnitThen', targets: ['u2'], text: 'capture an enemy unit', intent: 'cunning', then: { cardId: 'X', owner: 'player' } },
  selectUnitToReady: { ...base, kind: 'selectUnitToReady', targets: ['u1'] },
  selectUnitToReturn: { ...base, kind: 'selectUnitToReturn', targets: ['u2'] },
  selectUnitToSteal: { ...base, kind: 'selectUnitToSteal', targets: ['u2'] },
  selectFriendlyUnit: { ...base, kind: 'selectFriendlyUnit', targets: ['u1'], then: 'hotshotManeuver' },
  selectDistributeSource: { ...base, kind: 'selectDistributeSource', targets: ['u1'] },
  attachPlayedCard: { ...base, kind: 'attachPlayedCard', zone: 'hand', index: 0, cardId: 'X', targets: ['u1'] },
  mayPlayUpgradeFree: { ...base, kind: 'mayPlayUpgradeFree', cardId: 'X', targets: ['u1'] },
  distributeHealing: { ...base, kind: 'distributeHealing', remaining: 2, healed: 0, unitTargets: ['u1'], baseTargets: ['player'] },
  distributeIndirectDamage: { ...base, kind: 'distributeIndirectDamage', targetPlayer: 'opponent', remaining: 2, total: 2, unitTargets: ['u2'], source: { cardId: 'X', controller: 'player' } },
  damageAnyBases: { ...base, kind: 'damageAnyBases', remaining: ['player', 'opponent'], amount: 1 },
  enterAsCopy: { ...base, kind: 'enterAsCopy', cardId: 'X', targets: ['u2'], play: { resourcesPaid: 0, how: { from: 'hand' } } },
}

describe('target intent', () => {
  it('stamps an intent on every board-target kind when it is raised', () => {
    for (const kind of BOARD_TARGET_KINDS) expect(raised(SAMPLE[kind]), kind).toMatch(/^(help|harm|cunning|attach)$/)
  })

  it('makes the raiser of a selectUnitThen say what it does', () => {
    // @ts-expect-error a selectUnitThen without an intent does not type-check
    const bare: PendingChoice = { ...base, kind: 'selectUnitThen', targets: ['u2'], text: 'x', then: { cardId: 'X', owner: 'player' } }
    expect(bare.kind).toBe('selectUnitThen')
    expect(raised(SAMPLE.selectUnitThen)).toBe('cunning')
  })

  it('does not overwrite an intent the raiser gave', () => {
    expect(raised({ ...SAMPLE.mayDamage, intent: 'cunning' })).toBe('cunning')
  })

  it('reads the effect from the payload where one kind does opposite things', () => {
    expect(raised({ ...base, kind: 'mayLastingBuff', targets: ['u1'], power: 2, hp: 2 }), 'Baylan Skoll +2/+2').toBe('help')
    expect(raised({ ...base, kind: 'mayLastingBuff', targets: ['u1'], power: -3, hp: 0 }), 'Ezra Bridger -3/-0').toBe('harm')
    expect(raised({ ...base, kind: 'mayLastingBuff', targets: ['u1'], keywords: [{ name: 'Sentinel' }] }), 'a keyword').toBe('help')
    expect(raised({ ...base, kind: 'mayGiveTokens', token: TOKEN_SHIELD, count: 1, targets: ['u1'] })).toBe('help')
    expect(raised({ ...base, kind: 'mayGiveTokens', token: TOKEN_WEAKNESS, count: 1, targets: ['u1'] })).toBe('harm')
    expect(raised({ ...base, kind: 'distributeTokens', token: TOKEN_WEAKNESS, remaining: 1, total: 1, targets: ['u1'] })).toBe('harm')
    expect(raised({ ...base, kind: 'selectPair', friendlyTargets: [], enemyTargets: [], mode: 'defeat' })).toBe('harm')
    expect(raised({ ...base, kind: 'selectPair', friendlyTargets: [], enemyTargets: [], mode: 'exhaust' })).toBe('cunning')
    expect(raised({ ...base, kind: 'multiPick', targets: [], spec: { mode: 'exhaust', remaining: 2 } })).toBe('cunning')
    expect(raised({ ...base, kind: 'multiPick', targets: [], spec: { mode: 'defeat', remaining: 2 } })).toBe('harm')
    expect(raised({ ...base, kind: 'multiPick', targets: [], spec: { mode: 'giveAdvantage', remaining: 2 } })).toBe('help')
    expect(raised({ ...base, kind: 'damageAnyBases', remaining: ['player'], amount: 1, heal: true })).toBe('help')
    expect(raised({ ...base, kind: 'damageAnyBases', remaining: ['player'], amount: 1 })).toBe('harm')
  })

  it('colours each family the way the scheme says', () => {
    expect(raised(SAMPLE.selectHealTarget), 'heal is good for the target').toBe('help')
    expect(raised(SAMPLE.distributeHealing)).toBe('help')
    expect(raised(SAMPLE.selectDamageTarget)).toBe('harm')
    expect(raised(SAMPLE.selectUnitToDefeat)).toBe('harm')
    expect(raised(SAMPLE.mayExhaustUnit)).toBe('cunning')
    expect(raised(SAMPLE.selectUnitToReturn)).toBe('cunning')
    expect(raised(SAMPLE.selectUnitToSteal)).toBe('cunning')
    expect(raised(SAMPLE.attachPlayedCard)).toBe('attach')
    expect(raised(SAMPLE.mayPlayUpgradeFree)).toBe('attach')
  })

  it('stamps real selectUnitThen cards by what they do', () => {
    // A damaged friendly ground unit, and an enemy ground and space unit, each damaged.
    const board = state({
      players: {
        player: player({ units: [unit('u1', 'TST_U1', { damage: 1 })] }),
        opponent: player({ units: [unit('u2', 'TST_U1', { damage: 1 }), unit('u3', 'TST_U2', { damage: 1 })] }),
      },
    })
    /** The intent of the board pick a card's When Played ability raises. */
    const intentOf = (cardId: string): TargetIntent | undefined => {
      const ability = getAbilities(cardId).find(a => a.trigger === 'whenPlayed')
      const after = ability!.effect(board, { owner: 'player', cardId, sourceInstanceId: 'u1' })
      const choice = after.pendingChoices?.find(c => c.kind === 'selectUnitThen')
      expect(choice, cardId).toBeDefined()
      return choice!.intent
    }
    expect(intentOf('SHD_120'), 'Discerning Veteran: capture').toBe('cunning')
    expect(intentOf('LAW_075'), 'Interrogation Droid: exhaust').toBe('cunning')
    expect(intentOf('JTL_176'), 'Shoot Down: damage').toBe('harm')
    expect(intentOf('LAW_133'), 'Lost and Forgotten: defeat').toBe('harm')
    expect(intentOf('SEC_074'), 'Relief Request: heal').toBe('help')
  })

  it('gives every targeted leader action an intent', () => {
    const missing: string[] = []
    for (const id of registeredCardIds())
      for (const a of getCardDefinition(id)?.leaderAbilities?.actions ?? []) if (a.targets && !a.intent) missing.push(`${id}: ${a.description}`)
    expect(missing).toEqual([])
  })
})
