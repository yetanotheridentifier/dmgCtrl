import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { normaliseCard } from '../engine/cardDb'
import { poolFor } from '../bench/setPools'
import { defeatUnit } from '../engine/combat'
import { friendlyCreditTokens } from '../engine/effects'
import { TOKEN_EXPERIENCE } from '../engine/tokenUpgrades'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit, ready, CARDS } from './helpers/engineFixtures'
import type { EngineCard, GameState, PendingChoice } from '../engine/types'
import type { Action } from '../engine/actions'

/**
 * The 20 Credit-token cards (#602) that need nothing beyond the token and its standing payment
 * rule: straightforward creates, defeats and one take-control. See `creditTokens.test.ts` for the
 * primitive and the payment path itself.
 */

const POOL = poolFor(['LAW'])
const real = (id: string): EngineCard => {
  const [set, number] = id.split('_')
  const row = POOL.find(c => c.Set === set && String(c.Number) === number)
  if (!row) throw new Error(`${id} is not in the ${set} fixture`)
  return normaliseCard(row)
}

const IDS = [
  'LAW_262', 'LAW_232', 'LAW_121', 'LAW_244', 'LAW_248', 'LAW_071', 'LAW_116', 'LAW_134', 'LAW_155',
  'LAW_258', 'LAW_236', 'LAW_247', 'LAW_032', 'LAW_106', 'LAW_221', 'LAW_191', 'LAW_040', 'LAW_161',
  'LAW_252', 'LAW_238',
]
const F: Record<string, EngineCard> = { ...CARDS, ...Object.fromEntries(IDS.map(id => [id, real(id)])) }

const choice = (s: GameState): PendingChoice => {
  const c = s.pendingChoices?.[0]
  if (!c) throw new Error('no pending choice')
  return c
}
const noChoice = (s: GameState): boolean => (s.pendingChoices?.length ?? 0) === 0
// Playing a UNIT while holding a Credit token also offers Credit's own payment discount (#602) at
// step 3 of Play a Card, before the card's own When Played fires. These tests are about the card's
// own ability, not the payment path (covered in `creditTokens.test.ts`), so decline the discount
// first where a test's fixture happens to hold a Credit — paying full price, keeping the token for
// the ability that follows.
const skipCreditExploit = (s: GameState): GameState =>
  s.pendingChoices?.[0]?.kind === 'exploit' && s.pendingChoices[0].credit ? resolve(s, { type: 'skipTrigger', choiceId: s.pendingChoices[0].id }) : s
const answers = (s: GameState) => legalMoves(s).filter(m => m.type === 'acceptChoice' || m.type === 'skipTrigger') as Action[]
const canDecline = (s: GameState) => answers(s).some(m => m.type === 'skipTrigger')
const accept = (s: GameState, extra: Partial<Extract<Action, { type: 'acceptChoice' }>> = {}) =>
  resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, ...extra })
const decline = (s: GameState) => resolve(s, { type: 'skipTrigger', choiceId: choice(s).id })
const playUnit = (s: GameState, handIndex = 0) => resolve(s, { type: 'playUnit', handIndex })
const playEvent = (s: GameState, handIndex = 0) => resolve(s, { type: 'playEvent', handIndex })
const attackBase = (s: GameState, attackerId: string) => resolve(s, { type: 'attack', attackerId, target: { kind: 'base' } })
const attackUnit = (s: GameState, attackerId: string, targetId: string) =>
  resolve(s, { type: 'attack', attackerId, target: { kind: 'unit', instanceId: targetId } })
const expTokens = (s: GameState, cardId: string) => {
  const u = s.players.player.units.find(u => u.cardId === cardId)
  return u?.upgrades.filter(t => t.cardId === TOKEN_EXPERIENCE).length ?? 0
}

const board = (overrides: { player?: Parameters<typeof player>[0]; opponent?: Parameters<typeof player>[0] } = {}): GameState => state({
  cards: F,
  players: {
    player: player({ resources: ready(10), deck: [], ...overrides.player }),
    opponent: player({ resources: ready(10), deck: [], ...overrides.opponent }),
  },
})

describe('LAW_262 Bank Job Fugitives / LAW_232 Champion\'s KT9 Podracer: When Played, create a Credit token', () => {
  for (const id of ['LAW_262', 'LAW_232']) {
    it(`${id} creates one Credit token when played`, () => {
      const s = playUnit(board({ player: { hand: [id] } }))
      expect(friendlyCreditTokens(s, 'player')).toBe(1)
    })
  }
})

describe('LAW_244 Unmarked Credits / LAW_248 Windfall: events that create Credit tokens', () => {
  it('LAW_244 creates one', () => {
    const s = playEvent(board({ player: { hand: ['LAW_244'] } }))
    expect(friendlyCreditTokens(s, 'player')).toBe(1)
    expect(s.players.player.discard).toContain('LAW_244')
  })
  it('LAW_248 creates three', () => {
    const s = playEvent(board({ player: { hand: ['LAW_248'] } }))
    expect(friendlyCreditTokens(s, 'player')).toBe(3)
  })
})

describe('LAW_134 Bib Fortuna: conditional on controlling another Underworld unit', () => {
  it('creates a token when another Underworld unit is in play', () => {
    const s = playUnit(board({ player: { hand: ['LAW_134'], units: [unit('u0', 'LAW_262')] } })) // Bank Job Fugitives is Underworld
    expect(friendlyCreditTokens(s, 'player')).toBe(1)
  })
  it('creates nothing without one', () => {
    const s = playUnit(board({ player: { hand: ['LAW_134'] } }))
    expect(friendlyCreditTokens(s, 'player')).toBe(0)
  })
})

describe('LAW_161 Partisan U-Wing: conditional on a friendly unit defeated this phase', () => {
  it('creates a token when a friendly unit was defeated this phase', () => {
    let s = board({ player: { hand: ['LAW_161'], units: [unit('u0', 'TST_U1')] } })
    s = defeatUnit(s, 'u0')
    s = playUnit(s)
    expect(friendlyCreditTokens(s, 'player')).toBe(1)
  })
  it('creates nothing otherwise', () => {
    const s = playUnit(board({ player: { hand: ['LAW_161'] } }))
    expect(friendlyCreditTokens(s, 'player')).toBe(0)
  })
})

describe('LAW_155 Getaway Freighter: conditional on controlling a ground unit', () => {
  it('creates a token on attack while controlling a ground unit', () => {
    let s = board({ player: { hand: [], units: [unit('u0', 'LAW_155', { exhausted: false }), unit('u1', 'TST_U1', { exhausted: false, arena: 'ground' })] } })
    s = attackBase(s, 'u0')
    expect(friendlyCreditTokens(s, 'player')).toBe(1)
  })
})

describe('LAW_258 Criminal Contact: On Attack, may pay 2 to create a Credit token', () => {
  it('offers the choice and creates one on accept', () => {
    let s = board({ player: { units: [unit('u0', 'LAW_258', { exhausted: false })] } })
    s = attackBase(s, 'u0')
    expect(choice(s)).toMatchObject({ kind: 'mayPayThen', cost: 2 })
    s = accept(s)
    expect(friendlyCreditTokens(s, 'player')).toBe(1)
  })
  it('creates nothing on decline', () => {
    let s = board({ player: { units: [unit('u0', 'LAW_258', { exhausted: false })] } })
    s = attackBase(s, 'u0')
    s = decline(s)
    expect(friendlyCreditTokens(s, 'player')).toBe(0)
  })
})

describe('LAW_236 Bix Caleen: When Played/On Attack, may discard a card to create a Credit token', () => {
  it('fires when played', () => {
    let s = playUnit(board({ player: { hand: ['LAW_236', 'TST_E1'] } }))
    expect(choice(s)).toMatchObject({ kind: 'selectDiscard' })
    s = accept(s, { handIndex: 0 }) // discard the remaining hand card (TST_E1, now at index 0)
    expect(friendlyCreditTokens(s, 'player')).toBe(1)
  })
  it('fires again on attack', () => {
    let s = board({ player: { units: [unit('u0', 'LAW_236', { exhausted: false })], hand: ['TST_E1'] } })
    s = attackBase(s, 'u0')
    expect(choice(s)).toMatchObject({ kind: 'selectDiscard' })
    s = accept(s, { handIndex: 0 })
    expect(friendlyCreditTokens(s, 'player')).toBe(1)
  })
})

describe('LAW_121 Canto Bight Security: On Defense, create a Credit token', () => {
  it('creates one when attacked', () => {
    let s = board({
      player: { units: [unit('a0', 'TST_U1', { exhausted: false })] },
      opponent: { units: [unit('d0', 'LAW_121', { exhausted: false })] },
    })
    s = attackUnit(s, 'a0', 'd0')
    expect(friendlyCreditTokens(s, 'opponent')).toBe(1)
  })
})

describe('LAW_071 The Max Rebo Band: when the regroup phase starts, create a Credit token', () => {
  it('creates one as regroup begins', () => {
    let s = board({ player: { units: [unit('u0', 'LAW_071', { exhausted: false })] } })
    s = resolve(resolve(s, { type: 'pass' }), { type: 'pass' })
    expect(s.phase).toBe('regroup')
    expect(friendlyCreditTokens(s, 'player')).toBe(1)
  })
})

describe('LAW_116 Rodian Bondsman: When Defeated, each player creates a Credit token', () => {
  it('creates one for each player', () => {
    let s = board({ player: { units: [unit('u0', 'LAW_116', { exhausted: false })] } })
    s = defeatUnit(s, 'u0')
    expect(friendlyCreditTokens(s, 'player')).toBe(1)
    expect(friendlyCreditTokens(s, 'opponent')).toBe(1)
  })
})

describe('LAW_252 Fett\'s Firespray: When Attack Ends, if the defending unit was defeated, create a Credit token', () => {
  it('creates one when the defender is defeated', () => {
    let s = board({
      player: { units: [unit('u0', 'LAW_252', { exhausted: false })] }, // 4 power
      opponent: { units: [unit('d0', 'TST_U1', { exhausted: false, damage: 3 })] }, // 4 hp, 1 left
    })
    s = attackUnit(s, 'u0', 'd0')
    expect(friendlyCreditTokens(s, 'player')).toBe(1)
  })
  it('creates nothing when the defender survives', () => {
    let s = board({
      player: { units: [unit('u0', 'LAW_252', { exhausted: false })] },
      opponent: { units: [unit('d0', 'TST_U4', { exhausted: false })] }, // 9 hp: survives 4 damage
    })
    s = attackUnit(s, 'u0', 'd0')
    expect(friendlyCreditTokens(s, 'player')).toBe(0)
  })
})

describe('LAW_247 Backed by the Hutts: create a Credit token, then may deal damage equal to friendly Credit tokens', () => {
  it('counts the token it just created (1)', () => {
    let s = playEvent(board({ player: { hand: ['LAW_247'] }, opponent: { units: [unit('e0', 'TST_U1')] } }))
    expect(choice(s)).toMatchObject({ kind: 'selectDamageTarget', amount: 1, optional: true })
    expect(friendlyCreditTokens(s, 'player')).toBe(1)
  })
  it('counts tokens already held too', () => {
    let s = skipCreditExploit(playEvent(board({ player: { hand: ['LAW_247'], creditTokens: 2 }, opponent: { units: [unit('e0', 'TST_U1')] } })))
    expect(choice(s)).toMatchObject({ kind: 'selectDamageTarget', amount: 3 })
  })
})

describe('LAW_106 Defiant Scrapper: When Played, may defeat an enemy Credit token', () => {
  it('is offered and defeats one when the opponent holds any', () => {
    let s = playUnit(board({ player: { hand: ['LAW_106'] }, opponent: { creditTokens: 1 } }))
    expect(choice(s)).toMatchObject({ kind: 'mayPayThen', cost: 0 })
    s = accept(s)
    expect(friendlyCreditTokens(s, 'opponent')).toBe(0)
  })
  it('is not offered when the opponent holds none', () => {
    const s = playUnit(board({ player: { hand: ['LAW_106'] } }))
    expect(noChoice(s)).toBe(true)
  })
})

describe('LAW_221 Lieutenant Gorn: On Attack, take control of an enemy Credit token', () => {
  it('moves one from the opponent to the controller', () => {
    let s = board({ player: { units: [unit('u0', 'LAW_221', { exhausted: false })] }, opponent: { creditTokens: 1 } })
    s = attackBase(s, 'u0')
    expect(friendlyCreditTokens(s, 'player')).toBe(1)
    expect(friendlyCreditTokens(s, 'opponent')).toBe(0)
  })
  it('is a no-op when the opponent holds none', () => {
    let s = board({ player: { units: [unit('u0', 'LAW_221', { exhausted: false })] } })
    s = attackBase(s, 'u0')
    expect(friendlyCreditTokens(s, 'player')).toBe(0)
  })
})

describe('LAW_032 Cad Bane: On Attack, defeat any number of friendly Credit tokens for that many Experience tokens', () => {
  it('offers 0..held, and gives that many Experience tokens on the source unit', () => {
    let s = board({ player: { units: [unit('u0', 'LAW_032', { exhausted: false })], creditTokens: 3 } })
    s = attackBase(s, 'u0')
    expect(choice(s)).toMatchObject({ kind: 'chooseNumber', max: 3 })
    s = accept(s, { optionIndex: 2 })
    expect(friendlyCreditTokens(s, 'player')).toBe(1)
    expect(expTokens(s, 'LAW_032')).toBe(2)
  })
  it('is not offered holding none', () => {
    let s = board({ player: { units: [unit('u0', 'LAW_032', { exhausted: false })] } })
    s = attackBase(s, 'u0')
    expect(noChoice(s)).toBe(true)
  })
})

describe('LAW_191 Arvel Skeen: When Played/On Attack, may defeat a Credit token belonging to any player, dealing 1 damage', () => {
  it('offers a choice of player when both hold one, then deals damage', () => {
    let s = skipCreditExploit(playUnit(board({ player: { hand: ['LAW_191'], creditTokens: 1 }, opponent: { creditTokens: 1, units: [unit('e0', 'TST_U1')] } })))
    expect(choice(s)).toMatchObject({ kind: 'choosePlayerThen', optional: true })
    s = accept(s, { optionIndex: 0 }) // the opponent's Credit
    expect(choice(s)).toMatchObject({ kind: 'selectDamageTarget', amount: 1 })
    s = accept(s, { targetInstanceId: 'e0' })
    expect(friendlyCreditTokens(s, 'opponent')).toBe(0)
  })
  it('restricts the choice to whoever actually holds one', () => {
    const s = skipCreditExploit(playUnit(board({ player: { hand: ['LAW_191'], creditTokens: 1 } })))
    expect(choice(s)).toMatchObject({ kind: 'choosePlayerThen', candidates: ['player'] })
  })
  it('is not offered when nobody holds one', () => {
    const s = playUnit(board({ player: { hand: ['LAW_191'] } }))
    expect(noChoice(s)).toBe(true)
  })
  it('fires again on attack too', () => {
    let s = board({ player: { units: [unit('u0', 'LAW_191', { exhausted: false })], creditTokens: 1 } })
    s = attackBase(s, 'u0')
    expect(choice(s)).toMatchObject({ kind: 'choosePlayerThen' })
  })
})

describe('LAW_040 Taramyn Barcona: When Played, may defeat a Credit token belonging to any player, giving Experience to itself and another friendly unit', () => {
  it('gives to itself and the other friendly unit chosen', () => {
    let s = skipCreditExploit(playUnit(board({ player: { hand: ['LAW_040'], units: [unit('u0', 'TST_U1')], creditTokens: 1 } })))
    s = accept(s, { optionIndex: 1 }) // the controller's own Credit
    expect(expTokens(s, 'LAW_040')).toBe(1)
    expect(choice(s)).toMatchObject({ kind: 'mayGiveTokens' })
    s = accept(s, { targetInstanceId: 'u0' })
    expect(expTokens(s, 'TST_U1')).toBe(1)
  })
})

describe('LAW_238 Scavenging Sandcrawler: On Attack, may put a discard-pile card on the bottom of the deck to create a Credit token', () => {
  it('moves the card and creates a token', () => {
    let s = board({ player: { units: [unit('u0', 'LAW_238', { exhausted: false })], discard: ['TST_E1'], deck: ['TST_U1'] } })
    s = attackBase(s, 'u0')
    expect(choice(s)).toMatchObject({ kind: 'selectFromDiscard', candidates: ['TST_E1'] })
    s = accept(s, { optionIndex: 0 })
    expect(s.players.player.discard).not.toContain('TST_E1')
    expect(s.players.player.deck[s.players.player.deck.length - 1]).toBe('TST_E1')
    expect(friendlyCreditTokens(s, 'player')).toBe(1)
  })
  it('is not offered with an empty discard pile', () => {
    let s = board({ player: { units: [unit('u0', 'LAW_238', { exhausted: false })] } })
    s = attackBase(s, 'u0')
    expect(noChoice(s)).toBe(true)
  })
})
