import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import '../engine/cardDefinitions' // side-effect: registers every implemented card
import { state, player, card, CARDS, unit, ready } from './helpers/engineFixtures'
import { loadReport, replayUpTo } from './helpers/replayReport'
import hmwSet from './fixtures/hmwSet.json'
import type { SwuCard } from '../data/cards'
import type { GameState } from '../engine/types'

/**
 * Declining an Ambush leaves the unit as it would have entered play without one. Ambush readies the
 * unit so it can attack at once; a unit that normally enters exhausted goes back to exhausted on a
 * decline, but one that enters ready on its own (a deployed leader, CR 3.4.4, or an enters-ready
 * grant) stays ready.
 */

const choiceOf = (s: GameState) => (s.pendingChoices ?? []).find(c => c.kind === 'ambush')

describe('declining a deployed leader\'s Ambush (The Warrior report)', () => {
  const report = loadReport('warriorAmbushDecline')
  // The report's last two moves: the player deploys The Warrior, then declines the Ambush.
  const deployIndex = report.moves.findIndex(m => m.by === 'player' && m.action.type === 'deployLeader')
  const extra = hmwSet as SwuCard[]

  it('offers the Ambush with the leader ready', () => {
    const s = replayUpTo(report, deployIndex + 1, extra)
    const choice = choiceOf(s)
    expect(choice).toBeDefined()
    const warrior = s.players.player.units.find(u => u.cardId === 'HMW_018')!
    expect(warrior.exhausted).toBe(false)
  })

  it('leaves the leader ready after the decline', () => {
    const s = replayUpTo(report, deployIndex + 2, extra)
    expect(choiceOf(s)).toBeUndefined()
    const warrior = s.players.player.units.find(u => u.cardId === 'HMW_018')!
    expect(warrior.exhausted).toBe(false)
  })
})

describe('declining a played unit\'s Ambush', () => {
  const F = {
    ...CARDS,
    AMB: card({ id: 'AMB', name: 'Ambusher', type: 'unit', arena: 'ground', cost: 1, power: 1, hp: 3, keywords: [{ name: 'Ambush' }] }),
  }
  const board = (entersReady: boolean) => state({
    phase: 'action',
    activePlayer: 'player',
    cards: F,
    players: {
      player: player({ hand: ['AMB'], resources: ready(5), ...(entersReady ? { nextUnitGrants: [{ entersReady: true }] } : {}) }),
      opponent: player({ units: [unit('e1', 'TST_U4')] }),
    },
  })
  const declined = (entersReady: boolean) => {
    const played = resolve(board(entersReady), { type: 'playUnit', handIndex: 0 })
    const choice = choiceOf(played)
    expect(choice).toBeDefined()
    return resolve(played, { type: 'skipTrigger', choiceId: choice!.id })
  }
  const ambusher = (s: GameState) => s.players.player.units.find(u => u.cardId === 'AMB')!

  it('goes back to exhausted, as a played unit normally enters', () => {
    expect(ambusher(declined(false)).exhausted).toBe(true)
  })

  it('stays ready when something else made it enter ready', () => {
    expect(ambusher(declined(true)).exhausted).toBe(false)
  })

  it('with nothing to attack, still enters ready when something else made it', () => {
    const s = board(true)
    const empty = { ...s, players: { ...s.players, opponent: { ...s.players.opponent, units: [] } } }
    const played = resolve(empty, { type: 'playUnit', handIndex: 0 })
    expect(choiceOf(played)).toBeUndefined()
    expect(ambusher(played).exhausted).toBe(false)
  })
})
