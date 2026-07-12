import type { EngineCard, GameState, PlayerState, UnitState } from '../../engine/types'
import { TOKEN_CARDS } from '../../engine/tokenUpgrades'

export function card(partial: Partial<EngineCard> & { id: string }): EngineCard {
  return {
    name: partial.id,
    type: 'unit',
    cost: 0,
    power: 1,
    hp: 1,
    aspects: [],
    traits: [],
    keywords: [],
    unique: false,
    ...partial,
  }
}

/** Small fixed card pool shared by engine tests (incl. built-in token upgrades). */
export const CARDS = {
  ...TOKEN_CARDS,
  TST_L: card({ id: 'TST_L', type: 'leader', cost: 5, power: 4, hp: 7, aspects: ['Command', 'Heroism'] }),
  TST_B: card({ id: 'TST_B', type: 'base', hp: 30, aspects: ['Vigilance'] }),
  TST_U1: card({ id: 'TST_U1', type: 'unit', arena: 'ground', cost: 2, power: 3, hp: 4, aspects: ['Command'] }),
  TST_U2: card({ id: 'TST_U2', type: 'unit', arena: 'space', cost: 2, power: 2, hp: 2, aspects: ['Heroism'] }),
  TST_U3: card({ id: 'TST_U3', type: 'unit', arena: 'ground', cost: 2, power: 5, hp: 1, aspects: ['Aggression'] }),
  TST_U4: card({ id: 'TST_U4', type: 'unit', arena: 'ground', cost: 2, power: 1, hp: 9, aspects: ['Command', 'Command'] }),
  TST_E1: card({ id: 'TST_E1', type: 'event', cost: 1, aspects: ['Command'] }),
}

export function unit(instanceId: string, cardId: string, overrides: Partial<UnitState> = {}): UnitState {
  return {
    instanceId,
    cardId,
    arena: (CARDS as Record<string, EngineCard>)[cardId]?.arena ?? 'ground',
    damage: 0,
    exhausted: false,
    isLeader: false,
    upgrades: [],
    ...overrides,
  }
}

export function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    leader: { cardId: 'TST_L', deployed: false, epicActionUsed: false, exhausted: false },
    base: { cardId: 'TST_B', damage: 0 },
    hand: [],
    deck: ['TST_U1', 'TST_U1', 'TST_U1'],
    discard: [],
    resources: [],
    units: [],
    ...overrides,
  }
}

export function state(overrides: Partial<GameState> = {}): GameState {
  return {
    cards: CARDS,
    players: { player: player(), opponent: player() },
    initiative: 'player',
    initiativeTakenBy: null,
    activePlayer: 'player',
    phase: 'action',
    round: 2,
    consecutivePasses: 0,
    regroupResourced: { player: false, opponent: false },
    instanceCounter: 10,
    rngSeed: 42,
    setupStage: 'resource',
    winner: null,
    ...overrides,
  }
}

export function ready(n: number) {
  return Array.from({ length: n }, (_, i) => ({ cardId: `R${i}`, exhausted: false }))
}
