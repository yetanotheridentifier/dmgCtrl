import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import '../engine/cardDefinitions'
import { describeChoiceParts, choiceSourceRef } from '../utils/describeChoice'
import { describeAction } from '../utils/describeAction'
import { replayUpTo, loadReport } from './helpers/replayReport'
import { buildCoverageDecks } from '../bench/coverageDecks'
import { buildCardDb } from '../engine/cardDb'
import { initGame } from '../engine/initGame'
import { seededShuffle, nextSeed } from '../engine/rng'
import { greedyAi } from '../ai/greedyAi'
import { setupAi } from '../ai/setupAi'
import ashSet from './fixtures/ashSet.json'
import type { SwuCard } from '../data/cards'
import type { GameState } from '../engine/types'
import type { DescribePart } from '../utils/describeAction'

/**
 * Every choice says WHAT it is asking, not just who asked (#422).
 *
 * #374 guaranteed each choice can NAME the card that raised it. That turned out to be half the job:
 * `mayPreventDamage` had no prompt of its own, so it fell through to the generic
 * "choose a target on the board" and rendered as "Battered Haulcraft: choose a target on the board".
 * For a damage-PREVENTION offer that reads as "pick something to hit", and the reporter reasonably
 * concluded the opponent's decision had been handed to them. 46 of the 71 kinds were in that state.
 *
 * `choiceBody` is now an exhaustive switch, so the compiler rejects a new kind with no prompt. These
 * tests cover what the compiler cannot: that the fallback text never actually reaches a player, and
 * that prompts render as real sentences in real games.
 */
const FALLBACK = 'choose a target on the board'

const render = (parts: DescribePart[]): string =>
  parts.map(p => (typeof p === 'string' ? p : p.text)).join('')

describe('the reported prevention prompt (#422)', () => {
  it('says it is a prevention, not a targeting', () => {
    // Move 27 is the opponent choosing Battered Haulcraft's damage target, which raises the
    // player's prevention offer.
    const s = replayUpTo(loadReport('haulcraftPrompt'), 27)
    const prevent = s.pendingChoices?.find(c => c.kind === 'mayPreventDamage')
    expect(prevent, 'the report ends on the prevention offer').toBeTruthy()
    expect(prevent!.controller, 'it is genuinely the player’s to answer').toBe('player')

    const text = render(describeChoiceParts(s, prevent!))
    expect(text).not.toContain(FALLBACK)
    expect(text).toContain('prevent')
    // Still leads with the card that caused it, which is #374's guarantee.
    expect(text).toContain('Battered Haulcraft')
  })

  /** The other half of the ticket's title: "overlay prompt AND action". */
  it('labels the buttons with what they do, not a bare Accept/Decline', () => {
    const s = replayUpTo(loadReport('haulcraftPrompt'), 27)
    const prevent = s.pendingChoices!.find(c => c.kind === 'mayPreventDamage')!
    const labels = legalMoves(s).map(m => describeAction(s, 'player', m))
    expect(labels).toContain(`Prevent ${(prevent as { amount: number }).amount}`)
    expect(labels).toContain('Take the damage')
  })

  /** The opponent's half was already right, and must stay attributed to them. */
  it('leaves the damage choice itself with the opponent', () => {
    const s = replayUpTo(loadReport('haulcraftPrompt'), 26)
    const damage = s.pendingChoices?.find(c => c.kind === 'mayDamage')
    expect(damage?.controller).toBe('opponent')
  })
})

/**
 * The Mandalorian's leader prompt, the secondary defect on the same report as #421: "Mando leader
 * overlay prompt also poorly phrased". `mayPayToDraw` had no prompt of its own, so a
 * pay-a-resource-to-draw decision rendered as "choose a target on the board" with no board target
 * anywhere in it.
 */
describe('the leader draw prompt (#421 secondary)', () => {
  it('states the cost and what it buys', () => {
    const s = replayUpTo(loadReport('exhaustedLeaderDraw'), 17)
    const draw = s.pendingChoices?.find(c => c.kind === 'mayPayToDraw')
    expect(draw, 'taking the initiative raises the draw offer').toBeTruthy()

    const text = render(describeChoiceParts(s, draw!))
    expect(text).not.toContain(FALLBACK)
    expect(text).toContain('pay 1')
    expect(text).toContain('draw a card')
    expect(text).toContain('The Mandalorian')
  })
})

/**
 * The guarantee. A hand-written list of kinds would rot the moment a card is added, so this plays
 * real games across the coverage decks and asserts no prompt any of them raises is the fallback.
 */
describe('no choice raised in real games falls back to the generic prompt', () => {
  const POOL = ashSet as unknown as SwuCard[]

  it('holds across a seeded sweep of coverage decks', () => {
    const decks = buildCoverageDecks(POOL, 1).decks
    const cardDb = buildCardDb(POOL)
    const offenders = new Map<string, string>()
    const kindsSeen = new Set<string>()

    decks.forEach((deck, d) => {
      const seed = nextSeed(2200 + d)
      const ss = { v: seed }
      const shuffle = <T,>(arr: T[]): T[] => { ss.v = nextSeed(ss.v); return seededShuffle(arr, ss.v) }
      let s: GameState = initGame(deck, deck, cardDb, { firstPlayer: 'player', shuffle, rngSeed: seed })

      for (let i = 0; i < 4000 && s.winner === null; i++) {
        if (legalMoves(s).length === 0) break
        for (const choice of s.pendingChoices ?? []) {
          kindsSeen.add(choice.kind)
          const text = render(describeChoiceParts(s, choice))
          if (text.includes(FALLBACK) || text.trim().length === 0) offenders.set(choice.kind, text)
        }
        const action = setupAi(s) ?? greedyAi(s)
        if (!action) break
        s = resolve(s, action)
      }
    })

    expect(kindsSeen.size, 'the sweep must exercise a broad set of choice kinds').toBeGreaterThan(20)
    expect([...offenders.entries()], 'these kinds reached a player with no real instruction').toEqual([])
    // Plays all 44 coverage decks to a finish, so the runtime tracks whatever else the parallel suite
    // is doing: measured at 28s alone, 61s under a full run and 83s with a bench alongside. The
    // assertion is about prompt coverage, not speed, so the budget is generous rather than tight. A
    // tight one here fails on load and teaches nothing about the thing under test.
  }, 180_000)

  /**
   * Both halves together, which is the outcome #374 actually asked for: the prompt reads
   * "<the card that caused this>: <what you must do>". The source half alone was not enough, because
   * a named card followed by "choose a target on the board" still leaves the player guessing.
   */
  it('renders a source AND an instruction for every choice raised', () => {
    const decks = buildCoverageDecks(POOL, 1).decks.slice(0, 12)
    const cardDb = buildCardDb(POOL)
    const bad = new Map<string, string>()

    decks.forEach((deck, d) => {
      const seed = nextSeed(3300 + d)
      const ss = { v: seed }
      const shuffle = <T,>(arr: T[]): T[] => { ss.v = nextSeed(ss.v); return seededShuffle(arr, ss.v) }
      let s: GameState = initGame(deck, deck, cardDb, { firstPlayer: 'player', shuffle, rngSeed: seed })

      for (let i = 0; i < 4000 && s.winner === null; i++) {
        if (legalMoves(s).length === 0) break
        for (const choice of s.pendingChoices ?? []) {
          // The two trigger-ordering questions are raised by the RULES, not by a card, precisely
          // because more than one card triggered at once: naming one of them would be arbitrary. Their
          // instruction half still has to read, which the check below the exemption covers.
          if (choice.kind === 'chooseTriggerOrder' || choice.kind === 'chooseNextTrigger') {
            if (render(describeChoiceParts(s, choice)).length === 0) bad.set(choice.kind, '(no instruction)')
            continue
          }
          const source = render(choiceSourceRef(s, choice))
          const whole = render(describeChoiceParts(s, choice))
          const instruction = whole.slice(source.length).replace(/^[:\s]+/, '')
          if (source.length === 0 || instruction.length === 0) bad.set(choice.kind, whole)
        }
        const action = setupAi(s) ?? greedyAi(s)
        if (!action) break
        s = resolve(s, action)
      }
    })

    expect([...bad.entries()], 'a prompt must name its card AND say what is being asked').toEqual([])
  }, 60_000)
})
