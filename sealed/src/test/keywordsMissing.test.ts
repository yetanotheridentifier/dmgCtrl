import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { normaliseCard } from '../engine/cardDb'
import { legalMoves } from '../engine/legalMoves'
import { state, player, card, unit, ready, CARDS } from './helpers/engineFixtures'
import { TOKEN_SHIELD } from '../engine/tokenUpgrades'

const hasShield = (u: { upgrades: { cardId: string }[] }) => u.upgrades.some(a => a.cardId === TOKEN_SHIELD)

describe('keyword name trimming', () => {
  it('trims stray whitespace so hasKeyword matches (Shielded variants)', () => {
    const c = normaliseCard({ Set: 'TST', Number: '1', Name: 'X', Type: 'Unit', Keywords: ['Shielded '] })
    expect(c.keywords).toEqual([{ name: 'Shielded' }])
  })
})

describe('Shielded keyword', () => {
  it('a played Shielded unit enters play with a shield token', () => {
    const s = state({
      cards: { ...CARDS, TST_SH: card({ id: 'TST_SH', type: 'unit', arena: 'ground', cost: 0, power: 2, hp: 2, keywords: [{ name: 'Shielded' }] }) },
      players: {
        player: player({ hand: ['TST_SH'] }),
        opponent: player(),
      },
    })
    const next = resolve(s, { type: 'playUnit', handIndex: 0 })
    expect(hasShield(next.players.player.units[0])).toBe(true)
  })

  it('a played unit without Shielded gets no shield token', () => {
    const s = state({
      players: { player: player({ hand: ['TST_U3'], resources: ready(5) }), opponent: player() }, // TST_U3: no keywords
    })
    const next = resolve(s, { type: 'playUnit', handIndex: 0 })
    expect(hasShield(next.players.player.units[0])).toBe(false)
  })

  it('the shield then absorbs one instance of combat damage', () => {
    // Shielded 3/3 attacked by a 5/1 → shield prevents the damage, unit survives.
    const s = state({
      cards: { ...CARDS, TST_SH: card({ id: 'TST_SH', type: 'unit', arena: 'ground', power: 3, hp: 3, keywords: [{ name: 'Shielded' }] }) },
      players: {
        player: player({ units: [unit('u1', 'TST_U3')] }), // 5/1
        opponent: player({ units: [{ ...unit('e1', 'TST_SH'), upgrades: [{ cardId: TOKEN_SHIELD, owner: 'opponent' as const }] }] }),
      },
    })
    const next = resolve(s, { type: 'attack', attackerId: 'u1', target: { kind: 'unit', instanceId: 'e1' } })
    const e1 = next.players.opponent.units.find(u => u.instanceId === 'e1')
    expect(e1).toBeDefined()
    expect(hasShield(e1!)).toBe(false) // shield consumed
  })
})

describe('Hidden keyword', () => {
  const hiddenCards = {
    ...CARDS,
    TST_HID: card({ id: 'TST_HID', type: 'unit', arena: 'ground', power: 2, hp: 3, keywords: [{ name: 'Hidden' }] }),
    TST_HSENT: card({ id: 'TST_HSENT', type: 'unit', arena: 'ground', power: 2, hp: 3, keywords: [{ name: 'Hidden' }, { name: 'Sentinel' }] }),
  }

  it('a played Hidden unit enters the hidden state', () => {
    const s = state({
      cards: hiddenCards,
      players: { player: player({ hand: ['TST_HID'], resources: ready(6) }), opponent: player() },
    })
    const next = resolve(s, { type: 'playUnit', handIndex: 0 })
    expect(next.players.player.units[0].hidden).toBe(true)
  })

  it('a hidden enemy unit is not a legal attack target', () => {
    const s = state({
      cards: hiddenCards,
      players: {
        player: player({ units: [unit('u1', 'TST_U1')] }), // ready 3/4 ground
        opponent: player({ units: [unit('e1', 'TST_HID', { hidden: true })] }),
      },
    })
    const attacks = legalMoves(s).filter(a => a.type === 'attack')
    expect(attacks).not.toContainEqual({ type: 'attack', attackerId: 'u1', target: { kind: 'unit', instanceId: 'e1' } })
    expect(attacks).toContainEqual({ type: 'attack', attackerId: 'u1', target: { kind: 'base' } }) // base still open
  })

  it('a hidden unit with Sentinel IS attackable (Sentinel overrides Hidden)', () => {
    const s = state({
      cards: hiddenCards,
      players: {
        player: player({ units: [unit('u1', 'TST_U1')] }),
        opponent: player({ units: [unit('e1', 'TST_HSENT', { hidden: true })] }),
      },
    })
    const attacks = legalMoves(s).filter(a => a.type === 'attack')
    expect(attacks).toContainEqual({ type: 'attack', attackerId: 'u1', target: { kind: 'unit', instanceId: 'e1' } })
    // Sentinel locks: the base is no longer a legal target.
    expect(attacks).not.toContainEqual({ type: 'attack', attackerId: 'u1', target: { kind: 'base' } })
  })

  it('the hidden state clears when the phase changes (regroup)', () => {
    // Both players pass → action phase ends → regroup begins → hidden cleared.
    const s = state({
      cards: hiddenCards,
      consecutivePasses: 1,
      players: {
        player: player({ units: [unit('u1', 'TST_HID', { hidden: true })] }),
        opponent: player(),
      },
    })
    const next = resolve(s, { type: 'pass' }) // second consecutive pass → regroup
    expect(next.phase).toBe('regroup')
    expect(next.players.player.units[0].hidden).toBe(false)
  })
})

describe('Ambush keyword', () => {
  const ambushCards = {
    ...CARDS,
    TST_AMB: card({ id: 'TST_AMB', type: 'unit', arena: 'ground', cost: 0, power: 3, hp: 3, keywords: [{ name: 'Ambush' }] }),
  }
  // A game where the player is about to play an Ambush unit into an arena with an enemy.
  function beforePlay(enemyUnits = [unit('e1', 'TST_U1')]) {
    return state({
      cards: ambushCards,
      players: { player: player({ hand: ['TST_AMB'] }), opponent: player({ units: enemyUnits }) },
    })
  }

  it('playing an Ambush unit with a target enters a pending ambush and readies the unit', () => {
    const next = resolve(beforePlay(), { type: 'playUnit', handIndex: 0 })
    expect(next.pendingChoices?.[0]).toMatchObject({ kind: 'ambush', controller: 'player', unitId: expect.any(String) })
    const amb = next.players.player.units.find(u => u.cardId === 'TST_AMB')!
    expect(amb.exhausted).toBe(false) // readied for the ambush attack
    expect(next.activePlayer).toBe('player') // turn does NOT pass yet
  })

  it('during the ambush, only the ambush attack (enemy unit) and skip are legal — no base, no other plays', () => {
    const s = resolve(beforePlay(), { type: 'playUnit', handIndex: 0 })
    const types = legalMoves(s).map(a => a.type)
    expect(types).toContain('attack')
    expect(types).toContain('skipTrigger')
    expect(types).not.toContain('playUnit')
    const attacks = legalMoves(s).filter(a => a.type === 'attack')
    expect(attacks.every(a => a.target.kind === 'unit')).toBe(true) // never the base
  })

  it('resolving the ambush attack fights the enemy unit, clears the pending trigger, and passes the turn', () => {
    const s = resolve(beforePlay(), { type: 'playUnit', handIndex: 0 })
    const ambush = s.pendingChoices![0]
    const ambId = ambush.kind === 'ambush' ? ambush.unitId : ''
    const next = resolve(s, { type: 'attack', attackerId: ambId, target: { kind: 'unit', instanceId: 'e1' } })
    expect(next.pendingChoices).toBeUndefined()
    expect(next.activePlayer).toBe('opponent')
    // 3/3 ambusher vs 3/4 defender: defender took 3 (survives at 3 dmg), ambusher took 3 (survives)
    expect(next.players.opponent.units.find(u => u.instanceId === 'e1')!.damage).toBe(3)
  })

  it('skipping the ambush exhausts the unit and passes the turn', () => {
    const s = resolve(beforePlay(), { type: 'playUnit', handIndex: 0 })
    const next = resolve(s, { type: 'skipTrigger' })
    expect(next.pendingChoices).toBeUndefined()
    expect(next.players.player.units.find(u => u.cardId === 'TST_AMB')!.exhausted).toBe(true)
    expect(next.activePlayer).toBe('opponent')
  })

  it('an Ambush unit with no valid target just enters play (no pending trigger, exhausted)', () => {
    const next = resolve(beforePlay([]), { type: 'playUnit', handIndex: 0 }) // no enemy units
    expect(next.pendingChoices).toBeUndefined()
    expect(next.players.player.units.find(u => u.cardId === 'TST_AMB')!.exhausted).toBe(true)
    expect(next.activePlayer).toBe('opponent')
  })
})

describe('Support keyword', () => {
  const supportCards = {
    ...CARDS,
    // Support + Overwhelm: the chosen attacker should GAIN Overwhelm for the attack.
    TST_SUP: card({ id: 'TST_SUP', type: 'unit', arena: 'ground', cost: 0, power: 2, hp: 2, keywords: [{ name: 'Support' }, { name: 'Overwhelm' }] }),
    TST_ATK: card({ id: 'TST_ATK', type: 'unit', arena: 'ground', power: 5, hp: 5 }), // no keywords of its own
    TST_WEAK: card({ id: 'TST_WEAK', type: 'unit', arena: 'ground', power: 0, hp: 1 }),
  }
  function beforePlay(playerUnits = [unit('u1', 'TST_ATK')], enemyUnits = [unit('e1', 'TST_WEAK')]) {
    return state({
      cards: supportCards,
      players: { player: player({ hand: ['TST_SUP'], units: playerUnits }), opponent: player({ units: enemyUnits }) },
    })
  }

  it('playing a Support unit with another ready unit opens a pending support attack', () => {
    const next = resolve(beforePlay(), { type: 'playUnit', handIndex: 0 })
    expect(next.pendingChoices?.[0]).toMatchObject({ kind: 'support', controller: 'player', unitId: expect.any(String) })
    expect(next.activePlayer).toBe('player') // resolve the support before passing
  })

  it('offers attacks with the OTHER ready unit (not the support unit), plus skip', () => {
    const s = resolve(beforePlay(), { type: 'playUnit', handIndex: 0 })
    const attacks = legalMoves(s).filter(a => a.type === 'attack')
    expect(attacks.every(a => a.attackerId === 'u1')).toBe(true) // only the other ready unit attacks
    expect(legalMoves(s).map(a => a.type)).toContain('skipTrigger')
  })

  it('the support attacker gains the support unit’s keywords for the attack (Overwhelm → base)', () => {
    const s = resolve(beforePlay(), { type: 'playUnit', handIndex: 0 })
    const next = resolve(s, { type: 'attack', attackerId: 'u1', target: { kind: 'unit', instanceId: 'e1' } })
    expect(next.pendingChoices).toBeUndefined()
    // 5 power vs a 1-HP unit → 4 excess trampled to the base via GRANTED Overwhelm.
    expect(next.players.opponent.base.damage).toBe(4)
    // The grant is transient — not left on the attacker afterward.
    const u1 = next.players.player.units.find(u => u.instanceId === 'u1')
    expect(u1?.grantedKeywords).toBeUndefined()
  })

  it('skipping the support leaves the board and passes the turn', () => {
    const s = resolve(beforePlay(), { type: 'playUnit', handIndex: 0 })
    const next = resolve(s, { type: 'skipTrigger' })
    expect(next.pendingChoices).toBeUndefined()
    expect(next.activePlayer).toBe('opponent')
  })

  it('a Support unit with no other ready unit just enters play (no pending trigger)', () => {
    const next = resolve(beforePlay([]), { type: 'playUnit', handIndex: 0 }) // no other friendly units
    expect(next.pendingChoices).toBeUndefined()
    expect(next.activePlayer).toBe('opponent')
  })
})

describe('Support on deploy — leaders', () => {
  // The Mandalorian (ASH_014) has Support; its deployed side has "On Attack: if initiative, may draw".
  const cards = { ...CARDS, ASH_014: card({ id: 'ASH_014', type: 'leader', power: 4, hp: 6, keywords: [{ name: 'Support' }] }) }
  const undeployed = { cardId: 'ASH_014', deployed: false, epicActionUsed: false, exhausted: false }

  it('deploying a Support leader with another ready unit opens a support attack (holds the turn)', () => {
    const s = state({
      cards,
      players: { player: player({ leader: undeployed, units: [unit('u1', 'TST_U3')] }), opponent: player({ units: [unit('e1', 'TST_U1')] }) },
    })
    const deployed = resolve(s, { type: 'deployLeader' })
    expect(deployed.pendingChoices?.[0]).toMatchObject({ kind: 'support', controller: 'player' })
    expect(deployed.activePlayer).toBe('player')
  })

  it('the support attacker gains the source leader’s TRIGGERED abilities, not just keywords', () => {
    const s = state({
      cards,
      initiative: 'player',
      players: { player: player({ leader: undeployed, units: [unit('u1', 'TST_U3')], deck: ['TST_U1'] }), opponent: player() },
    })
    const deployed = resolve(s, { type: 'deployLeader' })
    // u1 attacks under Support → it gains the Mandalorian's "On Attack: may draw" for this attack.
    const attacked = resolve(deployed, { type: 'attack', attackerId: 'u1', target: { kind: 'base' } })
    expect(attacked.pendingChoices?.[0]).toMatchObject({ kind: 'mayPayToDraw', cost: 0 })
  })

  it('deploying a Support leader with no other ready unit just deploys (no support attack)', () => {
    const s = state({
      cards,
      players: { player: player({ leader: undeployed, units: [unit('u1', 'TST_U3', { exhausted: true })] }), opponent: player() },
    })
    const deployed = resolve(s, { type: 'deployLeader' })
    expect(deployed.pendingChoices).toBeUndefined()
    expect(deployed.activePlayer).toBe('opponent')
  })
})
