import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { runTrigger, stampChoiceSource } from '../engine/abilities'
import '../engine/cardDefinitions'
import { choiceSourceRef } from '../utils/describeChoice'
import { buildCoverageDecks } from '../bench/coverageDecks'
import { buildCardDb } from '../engine/cardDb'
import { initGame } from '../engine/initGame'
import { seededShuffle, nextSeed } from '../engine/rng'
import { randomAi } from '../ai/randomAi'
import { setupAi } from '../ai/setupAi'
import ashSet from './fixtures/ashSet.json'
import { state, player, unit, card, CARDS } from './helpers/engineFixtures'
import type { SwuCard } from '../data/cards'
import type { GameState, PendingChoice } from '../engine/types'

/**
 * #374: a prompt should be able to say WHY the player is being asked something, which matters most
 * when the choice was raised by the opponent's card. 44 of the 71 choice kinds carried no reference
 * to their source, and hand-threading one through ~185 `pushChoice` call sites was never going to
 * hold. Instead the ability dispatcher stamps it: there are only five places an ability effect is
 * invoked, and each already knows its card.
 */
describe('stampChoiceSource', () => {
  const src = { cardId: 'TST_U1', controller: 'player' as const }
  const withChoices = (...choices: PendingChoice[]) => state({ pendingChoices: choices })
  const bare = (id: string): PendingChoice => ({ kind: 'mayGiveAdvantage', id, controller: 'player', targets: ['u1'] })

  it('stamps a choice the effect raised', () => {
    const after = stampChoiceSource(state(), withChoices(bare('a')), src)
    expect(after.pendingChoices![0].source).toEqual(src)
  })

  it('leaves a choice that already names its own source', () => {
    const own = { ...bare('a'), source: { cardId: 'OTHER', controller: 'opponent' as const } }
    const after = stampChoiceSource(state(), withChoices(own), src)
    expect(after.pendingChoices![0].source).toEqual({ cardId: 'OTHER', controller: 'opponent' })
  })

  it('leaves choices that were already pending before the effect ran', () => {
    const before = withChoices(bare('a'))
    const after = stampChoiceSource(before, withChoices(bare('a'), bare('b')), src)
    expect(after.pendingChoices![0].source).toBeUndefined() // pre-existing, not this effect's doing
    expect(after.pendingChoices![1].source).toEqual(src)
  })

  it('returns the same state object when nothing needed stamping', () => {
    const after = state()
    expect(stampChoiceSource(state(), after, src)).toBe(after)
  })

  /** Effects remove choices as well as add them, so a length diff would misattribute. */
  it('stamps correctly even when the effect also removed a choice', () => {
    const before = withChoices(bare('gone'), bare('kept'))
    const after = stampChoiceSource(before, withChoices(bare('kept'), bare('new')), src)
    expect(after.pendingChoices!.find(c => c.id === 'kept')!.source).toBeUndefined()
    expect(after.pendingChoices!.find(c => c.id === 'new')!.source).toEqual(src)
  })
})

describe('the dispatcher attributes a choice to the card that raised it', () => {
  it('stamps a choice raised by a triggered ability', () => {
    // Morgan Elsbeth's When Defeated raises `mayLastingBuff` with no source field of its own.
    const s = state({
      cards: { ...CARDS, ASH_050: card({ id: 'ASH_050', name: 'Morgan Elsbeth', type: 'unit', arena: 'ground', power: 3, hp: 4 }) },
      players: { player: player({ units: [unit('m', 'ASH_050', { arena: 'ground' })] }), opponent: player() },
    })
    const fired = runTrigger(s, 'whenDefeated', { owner: 'player', cardId: 'ASH_050', sourceInstanceId: 'm' })
    expect(fired.pendingChoices?.[0]).toMatchObject({ kind: 'mayLastingBuff', source: { cardId: 'ASH_050', controller: 'player' } })
  })
})

/**
 * The guarantee. A hand-written list of kinds would rot the moment a card is added, so this plays
 * real games across the coverage decks (which between them touch every card in the set) and asserts
 * that EVERY choice any of them raises can name its source.
 */
describe('every choice raised in real games can name its source (#374)', () => {
  const POOL = ashSet as unknown as SwuCard[]

  it('holds across a seeded sweep of coverage decks', () => {
    // The whole coverage set: between them these decks touch every card in the pool, which is the
    // only way this guarantee cannot rot as cards are added.
    const decks = buildCoverageDecks(POOL, 1).decks
    const cardDb = buildCardDb(POOL)
    const unnamed = new Map<string, string>()
    const kindsSeen = new Set<string>()

    /**
     * Kinds the rules raise rather than a card.
     *
     * `chooseTriggerOrder` asks which PLAYER resolves first (CR 7.6.10). It exists because two cards
     * triggered at once, so naming one of them would be arbitrary and misleading: the question is not
     * "why is this card asking" but "whose batch goes first". Its overlay lists the waiting triggers
     * with their own sources, which is the answer to "why am I being asked this".
     *
     * Deliberately a list of ONE, and it should stay short. Anything a card raised must name that card.
     */
    const ruleLevel = new Set(['chooseTriggerOrder'])

    decks.forEach((deck, d) => {
      const seed = nextSeed(1000 + d)
      const shuffleSeed = { v: seed }
      const shuffle = <T,>(arr: T[]): T[] => { shuffleSeed.v = nextSeed(shuffleSeed.v); return seededShuffle(arr, shuffleSeed.v) }
      let s: GameState = initGame(deck, deck, cardDb, { firstPlayer: 'player', shuffle, rngSeed: seed })

      for (let i = 0; i < 5000 && s.winner === null; i++) {
        for (const choice of s.pendingChoices ?? []) {
          kindsSeen.add(choice.kind)
          if (ruleLevel.has(choice.kind)) continue
          if (choiceSourceRef(s, choice).length === 0) unnamed.set(choice.kind, JSON.stringify(choice))
        }
        const action = setupAi(s) ?? randomAi(s)
        if (!action) break
        s = resolve(s, action)
      }
    })

    expect(kindsSeen.size, 'the sweep must actually exercise a broad set of choice kinds').toBeGreaterThan(15)
    expect([...unnamed.values()], 'these choice kinds reached a player with no card to explain them').toEqual([])
  })
})
