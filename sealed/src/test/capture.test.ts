import { describe, it, expect } from 'vitest'
import { captureUnit, baseCapturesUnit, rescueCaptured, discardCaptured, releaseCaptured } from '../engine/effects'
import { defeatUnit } from '../engine/combat'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { registerCard } from '../engine/abilities'
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import { defeatedThisPhase, leftPlayThisPhase, enteredPlayThisPhase, upgradeDefeatedThisPhase } from '../engine/types'
import type { GameState } from '../engine/types'
import { TOKEN_UNIT_CARDS } from '../engine/tokenUnits'
import { TOKEN_SHIELD } from '../engine/tokenUpgrades'

/**
 * The general capture primitive (CR 33), built for #466: a unit or a base captures a unit on either
 * side, holding it face-down until it's rescued or its guardian leaves play. Not the same event as a
 * defeat — the captured unit is never "defeated" — and its upgrades ARE defeated on the way out, as
 * CR 33.1 says.
 */
const F = {
  ...CARDS,
  UPG: card({ id: 'UPG', type: 'upgrade', cost: 1, power: 1, hp: 1 }),
}
const U = (s: GameState, id: string) => [...s.players.player.units, ...s.players.opponent.units].find(u => u.instanceId === id)
const rich = (over: Parameters<typeof player>[0] = {}) => player({ resources: ready(20), ...over })

describe('captureUnit — CR 33', () => {
  it('moves the target out of play and under the capturing unit, face-down, still open information', () => {
    const s = state({ cards: F, players: {
      player: rich({ units: [unit('cap', 'TST_U1')] }),
      opponent: rich({ units: [unit('tgt', 'TST_U2', { damage: 1 })] }),
    } })
    const next = captureUnit(s, 'cap', 'tgt')
    expect(U(next, 'tgt')).toBeUndefined() // out of play
    expect(next.players.player.discard).not.toContain('TST_U2') // not defeated to a discard
    expect(U(next, 'cap')?.captured).toEqual([{ cardId: 'TST_U2', owner: 'opponent' }])
  })

  it('is a "leaves play" event, not a defeat: whenDefeated never sees it, but defeatedThisPhase/leftPlayThisPhase do', () => {
    const s = state({ cards: F, players: {
      player: rich({ units: [unit('cap', 'TST_U1')] }),
      opponent: rich({ units: [unit('tgt', 'TST_U2')] }),
    } })
    const next = captureUnit(s, 'cap', 'tgt')
    expect(defeatedThisPhase(next, 'opponent')).not.toContain('TST_U2')
    expect(leftPlayThisPhase(next, 'opponent')).toContain('TST_U2')
  })

  it('defeats the captured unit\'s card upgrades (to their own owner\'s discard) but not its token upgrades', () => {
    const s = state({ cards: F, players: {
      player: rich({ units: [unit('cap', 'TST_U1')] }),
      opponent: rich({ units: [unit('tgt', 'TST_U2', { upgrades: [{ cardId: 'UPG', owner: 'opponent' }, { cardId: TOKEN_SHIELD, owner: 'opponent' }] })] }),
    } })
    const next = captureUnit(s, 'cap', 'tgt')
    expect(next.players.opponent.discard).toContain('UPG')
    expect(next.players.opponent.discard).not.toContain(TOKEN_SHIELD) // a token upgrade ceases to exist
    expect(upgradeDefeatedThisPhase(next, 'opponent')).toBe(true)
  })

  it('removes all damage from the target (moot once out of play, confirmed on rescue)', () => {
    const s = state({ cards: F, players: {
      player: rich({ units: [unit('cap', 'TST_U1')] }),
      opponent: rich({ units: [unit('tgt', 'TST_U2', { damage: 1 })] }),
    } })
    const captured = captureUnit(s, 'cap', 'tgt')
    const rescued = rescueCaptured(captured, { kind: 'unit', instanceId: 'cap' }, 'TST_U2')
    expect(rescued.players.opponent.units.find(u => u.cardId === 'TST_U2')?.damage).toBe(0)
  })

  it('no-ops if the capturer has already left play (CR 33.1.a)', () => {
    const s = state({ cards: F, players: {
      player: rich({ units: [] }), // 'cap' not in play
      opponent: rich({ units: [unit('tgt', 'TST_U2')] }),
    } })
    const next = captureUnit(s, 'cap', 'tgt')
    expect(U(next, 'tgt')).toBeDefined() // untouched
  })

  it('no-ops if the target is not in play', () => {
    const s = state({ cards: F, players: { player: rich({ units: [unit('cap', 'TST_U1')] }), opponent: rich() } })
    expect(captureUnit(s, 'cap', 'nope')).toEqual(s)
  })

  it('a captured token is set aside (ceases to exist) rather than guarded, but still leaves play', () => {
    const tokenId = Object.keys(TOKEN_UNIT_CARDS)[0]
    const s = state({ cards: F, players: {
      player: rich({ units: [unit('cap', 'TST_U1')] }),
      opponent: rich({ units: [unit('tgt', tokenId)] }),
    } })
    const next = captureUnit(s, 'cap', 'tgt')
    expect(U(next, 'cap')?.captured ?? []).toHaveLength(0)
    expect(leftPlayThisPhase(next, 'opponent')).toContain(tokenId)
  })

  it('a guardian that was itself guarding units releases them when it is in turn captured (CR 33.4)', () => {
    const s = state({ cards: F, players: {
      player: rich({ units: [unit('cap', 'TST_U1')] }),
      opponent: rich({ units: [unit('mid', 'TST_U2', { captured: [{ cardId: 'TST_U1', owner: 'opponent' }] })] }),
    } })
    const next = captureUnit(s, 'cap', 'mid')
    const freed = next.players.opponent.units.find(u => u.cardId === 'TST_U1')
    expect(freed).toBeDefined()
    expect(freed?.exhausted).toBe(true)
  })

  it('a friendly unit may capture its own side\'s unit (Escape Pod, Lando Calrissian)', () => {
    const s = state({ cards: F, players: {
      player: rich({ units: [unit('cap', 'TST_U1'), unit('own', 'TST_U2')] }),
      opponent: rich(),
    } })
    const next = captureUnit(s, 'cap', 'own')
    expect(U(next, 'cap')?.captured).toEqual([{ cardId: 'TST_U2', owner: 'player' }])
  })

  it('releases a capture guardian\'s captives under each captive\'s OWN owner when the guardian is defeated', () => {
    // An enemy unit was captured (owner: 'opponent'), guarded by a 'player'-controlled unit.
    const s = state({ cards: F, players: {
      player: rich({ units: [unit('cap', 'TST_U1', { captured: [{ cardId: 'TST_U2', owner: 'opponent' }] })] }),
      opponent: rich(),
    } })
    const next = defeatUnit(s, 'cap')
    const freed = next.players.opponent.units.find(u => u.cardId === 'TST_U2')
    expect(freed).toBeDefined() // back under ITS OWN owner, not the guardian's controller
    expect(next.players.player.units.some(u => u.cardId === 'TST_U2')).toBe(false)
  })
})

describe('cannotBeCaptured — "can\'t be captured ... by enemy card abilities"', () => {
  const G = { ...F, TST_P: card({ id: 'TST_P', type: 'unit', cost: 2, power: 1, hp: 1 }) }
  // Registered directly as the target's own card id, so `abilityCardIds(target)` picks it up with no
  // separate upgrade or grant needed.
  registerCard('TST_P', { cannotBeCaptured: () => true })

  it('blocks a capture attempted by an enemy unit', () => {
    const s = state({ cards: G, players: {
      player: rich({ units: [unit('cap', 'TST_U1')] }),
      opponent: rich({ units: [unit('tgt', 'TST_P')] }),
    } })
    const next = captureUnit(s, 'cap', 'tgt')
    expect(U(next, 'tgt')).toBeDefined() // untouched
  })

  it('does not block a unit\'s own side from capturing it', () => {
    const s = state({ cards: G, players: {
      player: rich({ units: [unit('cap', 'TST_U1'), unit('own', 'TST_P')] }),
      opponent: rich(),
    } })
    const next = captureUnit(s, 'cap', 'own')
    expect(U(next, 'own')).toBeUndefined() // captured — protection only reads "by enemy card abilities"
  })
})

describe('captureReplacement — IG-11 style unconditional substitution', () => {
  const G = { ...F, TST_REPL: card({ id: 'TST_REPL', type: 'unit', cost: 2, power: 1, hp: 1 }) }
  registerCard('TST_REPL', { captureReplacement: s => ({ ...s, rngSeed: 999 }) }) // a marked stand-in effect

  it('runs instead of the capture, regardless of which side attempted it', () => {
    const s = state({ cards: G, players: {
      player: rich({ units: [unit('cap', 'TST_U1')] }),
      opponent: rich({ units: [unit('tgt', 'TST_REPL')] }),
    } })
    const next = captureUnit(s, 'cap', 'tgt')
    expect(next.rngSeed).toBe(999)
    expect(U(next, 'tgt')).toBeDefined() // never captured — the replacement ran instead
  })
})

describe('baseCapturesUnit — a base as guardian (Arrest)', () => {
  it('holds the captured card on the base, not on any unit', () => {
    const s = state({ cards: F, players: {
      player: rich(),
      opponent: rich({ units: [unit('tgt', 'TST_U2')] }),
    } })
    const next = baseCapturesUnit(s, 'player', 'tgt')
    expect(next.players.player.base.captured).toEqual([{ cardId: 'TST_U2', owner: 'opponent' }])
    expect(U(next, 'tgt')).toBeUndefined()
  })
})

describe('rescueCaptured and discardCaptured', () => {
  const held = (holder: Parameters<typeof unit>[2] = {}) => state({ cards: F, players: {
    player: rich({ units: [unit('cap', 'TST_U1', { captured: [{ cardId: 'TST_U2', owner: 'opponent' }], ...holder })] }),
    opponent: rich(),
  } })

  it('rescue flips it faceup, back to play exhausted under its own owner, not played', () => {
    const next = rescueCaptured(held(), { kind: 'unit', instanceId: 'cap' }, 'TST_U2')
    const rescued = next.players.opponent.units.find(u => u.cardId === 'TST_U2')
    expect(rescued).toBeDefined()
    expect(rescued?.exhausted).toBe(true)
    expect(U(next, 'cap')?.captured ?? []).toHaveLength(0)
    expect(enteredPlayThisPhase(next, 'opponent')).toContain(rescued!.instanceId)
    expect(next.pendingChoices ?? []).toHaveLength(0) // no When Played
  })

  it('discard sends it straight to its own owner\'s discard instead of back into play', () => {
    const next = discardCaptured(held(), { kind: 'unit', instanceId: 'cap' }, 'TST_U2')
    expect(next.players.opponent.discard).toContain('TST_U2')
    expect(next.players.opponent.units.some(u => u.cardId === 'TST_U2')).toBe(false)
    expect(U(next, 'cap')?.captured ?? []).toHaveLength(0)
  })

  it('is a no-op when the guardian is not holding that card', () => {
    const s = held()
    expect(rescueCaptured(s, { kind: 'unit', instanceId: 'cap' }, 'NOPE')).toEqual(s)
    expect(discardCaptured(s, { kind: 'unit', instanceId: 'cap' }, 'NOPE')).toEqual(s)
  })
})

describe('releaseCaptured — a guardian leaving play frees everything at once, each under its own owner', () => {
  it('releases a mix of friendly- and enemy-owned captives to their respective owners', () => {
    const next = releaseCaptured(state({ cards: F }), [{ cardId: 'TST_U1', owner: 'player' }, { cardId: 'TST_U2', owner: 'opponent' }])
    expect(next.players.player.units.some(u => u.cardId === 'TST_U1')).toBe(true)
    expect(next.players.opponent.units.some(u => u.cardId === 'TST_U2')).toBe(true)
  })
})
