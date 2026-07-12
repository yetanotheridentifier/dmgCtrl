import type { GameState, PlayerId } from './types'

/**
 * Effect primitives (#340): pure `(state, …) => state` building blocks that card
 * abilities compose. Card-type-agnostic and reused across units/leaders/events/
 * upgrades. Grown as cards need them.
 */

function patchUnit(state: GameState, owner: PlayerId, instanceId: string, patch: (u: GameState['players'][PlayerId]['units'][number]) => GameState['players'][PlayerId]['units'][number]): GameState {
  const p = state.players[owner]
  return {
    ...state,
    players: {
      ...state.players,
      [owner]: { ...p, units: p.units.map(u => (u.instanceId === instanceId ? patch(u) : u)) },
    },
  }
}

/** Attach a token upgrade (Shield/Experience/Advantage) to a unit. */
export function giveToken(state: GameState, owner: PlayerId, instanceId: string, tokenId: string): GameState {
  return patchUnit(state, owner, instanceId, u => ({ ...u, upgrades: [...u.upgrades, { cardId: tokenId, owner }] }))
}

/** Exhaust a unit (no-op if already exhausted). */
export function exhaustUnit(state: GameState, owner: PlayerId, instanceId: string): GameState {
  const u = state.players[owner].units.find(x => x.instanceId === instanceId)
  return u && !u.exhausted ? patchUnit(state, owner, instanceId, x => ({ ...x, exhausted: true })) : state
}

/** Draw `n` cards for a player. Missing cards (empty deck) are handled by the
 *  regroup draw path elsewhere; ability draws take what's there. */
export function drawCards(state: GameState, owner: PlayerId, n: number): GameState {
  const p = state.players[owner]
  const drawn = p.deck.slice(0, n)
  if (drawn.length === 0) return state
  return {
    ...state,
    players: { ...state.players, [owner]: { ...p, hand: [...p.hand, ...drawn], deck: p.deck.slice(drawn.length) } },
  }
}
