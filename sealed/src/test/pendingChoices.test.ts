import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import type { EngineCard } from '../engine/types'

/**
 * The pending-choice queue for optional "may…" abilities (#342 group B). Conflict
 * Within grants "When this unit readies: you may pay 3, else exhaust this unit",
 * which pauses the round-start readying for the controller to decide.
 */
const readyCount = (p: { resources: { exhausted: boolean }[] }) => p.resources.filter(r => !r.exhausted).length

/** Drive a regroup state through both players' resource step into the next round. */
function intoNextRound(s: ReturnType<typeof state>) {
  return resolve(resolve(s, { type: 'skipResource' }), { type: 'skipResource' })
}

function regroupWith(units088: string[], resources = ready(5)) {
  return state({
    cards: { ...CARDS, ASH_088: card({ id: 'ASH_088', type: 'upgrade', power: 0, hp: 0 }) },
    phase: 'regroup',
    initiative: 'player',
    activePlayer: 'player',
    regroupResourced: { player: false, opponent: false },
    players: {
      player: player({
        resources,
        units: units088.map((id, i) => unit(`u${i + 1}`, 'TST_U1', { exhausted: true, upgrades: [{ cardId: id, owner: 'player' }] })),
      }),
      opponent: player(),
    },
  })
}

describe('The Conflict Within (ASH_088) — whenReadies pay-or-exhaust (#342)', () => {
  it('raises a pay-or-exhaust choice for the readied unit at the start of the next round', () => {
    const next = intoNextRound(regroupWith(['ASH_088']))
    expect(next.phase).toBe('action')
    expect(next.pendingChoices?.[0]).toMatchObject({ kind: 'payOrExhaust', unitId: 'u1', cost: 3 })
    expect(next.activePlayer).toBe('player')
    // Only accept (affordable) + skip are legal while the choice is pending.
    const types = legalMoves(next).map(a => a.type).sort()
    expect(types).toEqual(['acceptChoice', 'skipTrigger'])
  })

  it('paying 3 keeps the unit ready and resumes the action phase with the initiative holder', () => {
    const next = intoNextRound(regroupWith(['ASH_088']))
    const paid = resolve(next, { type: 'acceptChoice', choiceId: 'u1' })
    expect(paid.pendingChoices).toBeUndefined()
    expect(paid.players.player.units[0].exhausted).toBe(false) // stayed ready
    expect(readyCount(paid.players.player)).toBe(2) // 5 − 3 paid
    expect(paid.activePlayer).toBe('player')
    expect(paid.phase).toBe('action')
  })

  it('declining exhausts the unit', () => {
    const next = intoNextRound(regroupWith(['ASH_088']))
    const declined = resolve(next, { type: 'skipTrigger', choiceId: 'u1' })
    expect(declined.pendingChoices).toBeUndefined()
    expect(declined.players.player.units[0].exhausted).toBe(true)
    expect(declined.activePlayer).toBe('player')
  })

  it('only offers the pay option when the player can afford 3', () => {
    const next = intoNextRound(regroupWith(['ASH_088'], ready(2))) // only 2 resources
    expect(legalMoves(next).map(a => a.type)).toEqual(['skipTrigger']) // can't pay → must exhaust
  })

  it('lets the active player resolve several simultaneous ready choices in any order', () => {
    const next = intoNextRound(regroupWith(['ASH_088', 'ASH_088'], ready(10)))
    // Two pending choices, both addressable now (active player orders them).
    const ids = legalMoves(next).filter(a => a.type === 'acceptChoice').map(a => a.choiceId).sort()
    expect(ids).toEqual(['u1', 'u2'])
    // Resolve u2 first, then u1 — order is the player's to pick.
    let s = resolve(next, { type: 'skipTrigger', choiceId: 'u2' })
    expect(s.players.player.units.find(u => u.instanceId === 'u2')!.exhausted).toBe(true)
    expect(s.pendingChoices?.map(c => c.id)).toEqual(['u1']) // u1 still pending
    s = resolve(s, { type: 'acceptChoice', choiceId: 'u1' })
    expect(s.pendingChoices).toBeUndefined()
    expect(s.players.player.units.find(u => u.instanceId === 'u1')!.exhausted).toBe(false)
  })
})

describe('Camtono (ASH_229) — onAttackEnd may play top card free (#342)', () => {
  function camtonoBoard(top: Partial<EngineCard> & { id: string }) {
    return state({
      cards: { ...CARDS, ASH_229: card({ id: 'ASH_229', type: 'upgrade', power: 0, hp: 0 }), [top.id]: card(top) },
      players: {
        player: player({ deck: [top.id, 'TST_U1'], units: [unit('u1', 'TST_U1', { upgrades: [{ cardId: 'ASH_229', owner: 'player' }] })] }),
        opponent: player(),
      },
    })
  }
  const attackBase = { type: 'attack', attackerId: 'u1', target: { kind: 'base' } } as const

  it('offers to play a ≤2-cost top card and holds the turn', () => {
    const next = resolve(camtonoBoard({ id: 'TOPU', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 2 }), attackBase)
    expect(next.pendingChoices?.[0]).toMatchObject({ kind: 'mayPlayTopFree', cardId: 'TOPU' })
    expect(next.activePlayer).toBe('player')
  })

  it('does not offer when the top card costs more than 2', () => {
    const next = resolve(camtonoBoard({ id: 'TOPBIG', type: 'unit', arena: 'ground', cost: 3, power: 2, hp: 2 }), attackBase)
    expect(next.pendingChoices).toBeUndefined()
    expect(next.activePlayer).toBe('opponent') // normal turn pass
  })

  it('playing a unit free brings it into play and passes the turn', () => {
    const next = resolve(camtonoBoard({ id: 'TOPU', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 2 }), attackBase)
    const played = resolve(next, { type: 'acceptChoice', choiceId: next.pendingChoices![0].id })
    expect(played.players.player.units.some(u => u.cardId === 'TOPU')).toBe(true)
    expect(played.players.player.deck).toEqual(['TST_U1']) // top consumed
    expect(played.pendingChoices).toBeUndefined()
    expect(played.activePlayer).toBe('opponent')
  })

  it('playing an upgrade free attaches it to the chosen target', () => {
    const next = resolve(camtonoBoard({ id: 'TOPUP', type: 'upgrade', cost: 1, power: 1, hp: 1 }), attackBase)
    // choiceMoves offers an accept per valid attach target.
    const accepts = legalMoves(next).filter(a => a.type === 'acceptChoice')
    expect(accepts.some(a => a.targetInstanceId === 'u1')).toBe(true)
    const played = resolve(next, { type: 'acceptChoice', choiceId: next.pendingChoices![0].id, targetInstanceId: 'u1' })
    expect(played.players.player.units.find(u => u.instanceId === 'u1')!.upgrades.some(a => a.cardId === 'TOPUP')).toBe(true)
    expect(played.players.player.deck).toEqual(['TST_U1'])
  })

  it('playing an event free discards it with no effect (temporary rule)', () => {
    const next = resolve(camtonoBoard({ id: 'TOPEV', type: 'event', cost: 2 }), attackBase)
    const played = resolve(next, { type: 'acceptChoice', choiceId: next.pendingChoices![0].id })
    expect(played.players.player.discard).toContain('TOPEV')
    expect(played.players.player.deck).toEqual(['TST_U1'])
  })

  it('declining leaves the card on top of the deck', () => {
    const next = resolve(camtonoBoard({ id: 'TOPU', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 2 }), attackBase)
    const declined = resolve(next, { type: 'skipTrigger', choiceId: next.pendingChoices![0].id })
    expect(declined.players.player.deck[0]).toBe('TOPU') // untouched
    expect(declined.activePlayer).toBe('opponent')
  })
})
