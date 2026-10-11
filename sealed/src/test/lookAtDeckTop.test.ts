import { describe, it, expect } from 'vitest'
import { loadReport, replay, replaySteps, replayUpTo } from './helpers/replayReport'
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import { normaliseCard } from '../engine/cardDb'
import { cardId } from '../data/cards'
import { SET_CODES, poolFor } from '../bench/setPools'
import { getCardDefinition, mayLookAtDeckTop } from '../engine/abilities'
import { legalMoves } from '../engine/legalMoves'
import { resolve } from '../engine/resolve'
import '../engine/cardDefinitions' // side-effect: registers every implemented card
import { addLastingEffect } from '../engine/types'
import type { EngineCard, GameState, PlayerId } from '../engine/types'

/**
 * **"You may look at the top card of your deck at any time."**
 *
 * A standing permission, not an ability that resolves: nothing is raised, nothing is answered and the
 * board does not change. The engine only says who holds it (`mayLookAtDeckTop`), and the screen shows
 * that player's own top card when they ask. Because looking is never a move, there is nothing for it
 * to write to the log, nothing the other seat can read, and nothing a bot holding the card waits on.
 */

const ALL_CARDS = poolFor(SET_CODES)
const real = (id: string): EngineCard => {
  const row = ALL_CARDS.find(c => cardId(c.Set, c.Number) === id)
  if (!row) throw new Error(`${id} is not in a bundled set`)
  return normaliseCard(row)
}

const HONDO = 'LAW_094'
const AGENCY = 'HMW_205'
const F: Record<string, EngineCard> = {
  ...CARDS,
  [HONDO]: real(HONDO),
  [AGENCY]: real(AGENCY),
  SHD_072: real('SHD_072'), // Imprisoned: attached unit loses all abilities
  TOP: card({ id: 'TOP', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 2 }),
}
type Side = Parameters<typeof player>[0]
const board = (mine: Side = {}, theirs: Side = {}): GameState =>
  state({ cards: F, players: { player: player({ deck: ['TOP', 'TST_U1'], ...mine }), opponent: player({ deck: ['TST_U2', 'TOP'], ...theirs }) } })
const lookers = (s: GameState): PlayerId[] => (['player', 'opponent'] as const).filter(p => mayLookAtDeckTop(s, p))

describe('the reported game: Hondo Ohnaka played from hand', () => {
  const report = loadReport('hondoTopCard')
  /** Move 40 plays Hondo and move 41 finishes paying for him; the report was filed one move later. */
  const HONDO_PLAY = 40

  it('plays Hondo at move 40', () => {
    expect(report.moves[HONDO_PLAY]).toMatchObject({ by: 'player', action: { type: 'playUnit' } })
    const before = replayUpTo(report, HONDO_PLAY, ALL_CARDS)
    const after = replayUpTo(report, HONDO_PLAY + 2, ALL_CARDS)
    expect(before.players.player.units.some(u => u.cardId === HONDO)).toBe(false)
    expect(after.players.player.units.some(u => u.cardId === HONDO)).toBe(true)
  })

  it('asks the player nothing once he is in play: the look is not a choice waiting on an answer', () => {
    const after = replayUpTo(report, HONDO_PLAY + 2, ALL_CARDS)
    expect(after.pendingChoices ?? []).toEqual([])
  })

  it('lets the player, and only the player, look at the top card of their deck from then on', () => {
    const steps = replaySteps(report, ALL_CARDS)
    for (let i = 0; i <= HONDO_PLAY; i++) expect(lookers(steps[i]), `before move ${i}`).toEqual([])
    expect(lookers(steps[HONDO_PLAY + 2])).toEqual(['player'])
    expect(lookers(replay(report, ALL_CARDS)), 'on the board the report was filed from').toEqual(['player'])
  })
})

describe('Hondo Ohnaka (LAW_094): a unit that prints the permission', () => {
  it('gives it to the player who controls him', () => {
    expect(lookers(board())).toEqual([])
    expect(lookers(board({ units: [unit('hondo', HONDO)] }))).toEqual(['player'])
    expect(lookers(board({}, { units: [unit('hondo', HONDO)] }))).toEqual(['opponent'])
  })

  it('follows control: taken by the opponent, he shows them their own deck and nobody the other', () => {
    const taken = board({}, { units: [unit('hondo', HONDO, { owner: 'player' })] })
    expect(lookers(taken)).toEqual(['opponent'])
  })

  it('holds whether he is ready or exhausted, and with an empty deck there is simply nothing to see', () => {
    expect(lookers(board({ units: [unit('hondo', HONDO, { exhausted: true })] }))).toEqual(['player'])
    expect(lookers(board({ deck: [], units: [unit('hondo', HONDO)] }))).toEqual(['player'])
  })

  it('is lost with his abilities', () => {
    const imprisoned = board({ units: [unit('hondo', HONDO, { upgrades: [{ cardId: 'SHD_072', owner: 'opponent' }] })] })
    expect(lookers(imprisoned)).toEqual([])
    const blanked = addLastingEffect(board({ units: [unit('hondo', HONDO)] }), { targetInstanceId: 'hondo', losesAllAbilities: true })
    expect(lookers(blanked)).toEqual([])
  })
})

describe('Intelligence Agency (HMW_205): the permission given to a base', () => {
  const fortified = (side: PlayerId): GameState => {
    const base = { cardId: 'TST_B', damage: 0, upgrades: [{ cardId: AGENCY, owner: side }] }
    return side === 'player' ? board({ base }) : board({}, { base })
  }

  it('gives it to the player whose base it is attached to', () => {
    expect(lookers(fortified('player'))).toEqual(['player'])
    expect(lookers(fortified('opponent'))).toEqual(['opponent'])
  })
})

describe('looking is never a move', () => {
  /** A board where `side` has Hondo in hand, the turn, and the resources to play him, aspect penalty included. */
  const holding = (side: PlayerId): GameState => {
    const holder = { hand: [HONDO], resources: ready(9) }
    return { ...(side === 'player' ? board(holder) : board({}, holder)), activePlayer: side }
  }

  it.each(['player', 'opponent'] as const)('playing Hondo as the %s raises nothing to answer, so no seat is ever waited on for a look', side => {
    const s = holding(side)
    const played = resolve(s, legalMoves(s).find(m => m.type === 'playUnit')!)
    expect(played.players[side].units.some(u => u.cardId === HONDO)).toBe(true)
    expect(played.pendingChoices ?? []).toEqual([])
    expect(lookers(played)).toEqual([side])
  })

  it('offers no action for it: with the permission held, the legal moves are the ones without it', () => {
    const names = (s: GameState) => legalMoves(s).map(m => m.type).filter(t => t !== 'useAbility').sort()
    // Hondo's own Action (play the top card) is a `useAbility`; nothing else is added by holding him.
    const withHondo = board({ units: [unit('hondo', HONDO, { exhausted: true })] })
    const without = board({ units: [unit('hondo', 'TST_U1', { exhausted: true })] })
    expect(names(withHondo)).toEqual(names(without))
  })
})

describe('every bundled card that prints the permission is built', () => {
  const PERMISSION = /you may look at the top card of your deck at any time/i
  const printing = ALL_CARDS.filter(c => PERMISSION.test(`${c.FrontText ?? ''} ${c.BackText ?? ''}`))

  it('finds the cards', () => {
    expect(printing.map(c => cardId(c.Set, c.Number)).sort()).toEqual([AGENCY, HONDO].sort())
  })

  it.each(printing.map(c => [cardId(c.Set, c.Number), c.Name, c.Type] as const))('%s %s declares it', (id, _name, type) => {
    const def = getCardDefinition(id)
    // An upgrade that says "attached base gains" gives the ability to the base; a unit holds its own.
    const declared = type === 'Upgrade' ? def?.baseAbilities?.looksAtOwnDeckTop : def?.looksAtOwnDeckTop
    expect(declared).toBe(true)
  })
})
