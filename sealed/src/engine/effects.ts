import type { GameState, PlayerId, UnitState } from './types'
import { TOKEN_SHIELD } from './tokenUpgrades'
import { getCardDefinition } from './abilities'

/**
 * How many cards a search by `unit` looks at (#343): the base count times every
 * `searchModifier` its card and upgrades contribute (Arcana Star Map ×2). Kept here
 * so any future search effect sizes consistently.
 */
export function searchCount(state: GameState, unit: UnitState, baseCount: number): number {
  let n = baseCount
  for (const cardId of [unit.cardId, ...unit.upgrades.map(u => u.cardId)]) {
    n *= getCardDefinition(cardId)?.searchModifier?.(state, unit) ?? 1
  }
  return n
}

/**
 * Effect primitives (#340): pure `(state, …) => state` building blocks that card
 * abilities compose. Card-type-agnostic and reused across units/leaders/events/
 * upgrades. Unit-targeting primitives take an instance id and find it on either
 * side, so an ability doesn't need to know who controls the unit. Grown as needed.
 */

/** Find a unit by instance id on either side. */
export function findUnit(state: GameState, instanceId: string): { owner: PlayerId; unit: UnitState } | undefined {
  for (const owner of ['player', 'opponent'] as PlayerId[]) {
    const unit = state.players[owner].units.find(u => u.instanceId === instanceId)
    if (unit) return { owner, unit }
  }
  return undefined
}

function patchUnit(state: GameState, owner: PlayerId, instanceId: string, patch: (u: UnitState) => UnitState): GameState {
  const p = state.players[owner]
  return {
    ...state,
    players: { ...state.players, [owner]: { ...p, units: p.units.map(u => (u.instanceId === instanceId ? patch(u) : u)) } },
  }
}

/** Attach a token upgrade (Shield/Experience/Advantage) to a unit, owned by its controller. */
export function giveToken(state: GameState, instanceId: string, tokenId: string): GameState {
  const found = findUnit(state, instanceId)
  if (!found) return state
  return patchUnit(state, found.owner, instanceId, u => ({ ...u, upgrades: [...u.upgrades, { cardId: tokenId, owner: found.owner }] }))
}

/** Deal `amount` damage to a player's base (#309). The caller runs the win check. */
export function dealDamageToBase(state: GameState, player: PlayerId, amount: number): GameState {
  const p = state.players[player]
  return { ...state, players: { ...state.players, [player]: { ...p, base: { ...p.base, damage: p.base.damage + amount } } } }
}

/** The first non-token (card) upgrade on a unit, if any — used by "defeat a friendly upgrade" costs (#309). */
export function firstCardUpgrade(state: GameState, unit: UnitState): string | undefined {
  return unit.upgrades.find(a => state.cards[a.cardId]?.type !== 'token')?.cardId
}

/** Exhaust a unit (no-op if already exhausted or absent). */
export function exhaustUnit(state: GameState, instanceId: string): GameState {
  const found = findUnit(state, instanceId)
  if (!found || found.unit.exhausted) return state
  return patchUnit(state, found.owner, instanceId, u => ({ ...u, exhausted: true }))
}

/**
 * Create a token unit for `owner` (#342) — a fresh in-play unit from a built-in
 * token card (e.g. the Mandalorian). A Shielded token enters play with a shield
 * token, per its keyword. Consumes one instance id.
 */
export function createTokenUnit(state: GameState, owner: PlayerId, tokenCardId: string): GameState {
  const tokenCard = state.cards[tokenCardId]
  const shielded = (tokenCard?.keywords ?? []).some(k => k.name === 'Shielded')
  const token: UnitState = {
    instanceId: `u${state.instanceCounter}`,
    cardId: tokenCardId,
    arena: tokenCard?.arena ?? 'ground',
    damage: 0,
    exhausted: true, // created units enter exhausted (CR 1.5.4b) unless an ability says otherwise
    isLeader: false,
    upgrades: shielded ? [{ cardId: TOKEN_SHIELD, owner }] : [],
  }
  const p = state.players[owner]
  return {
    ...state,
    instanceCounter: state.instanceCounter + 1,
    players: { ...state.players, [owner]: { ...p, units: [...p.units, token] } },
  }
}

/** Draw `n` cards for a player (takes what's there if the deck is short). */
export function drawCards(state: GameState, owner: PlayerId, n: number): GameState {
  const p = state.players[owner]
  const drawn = p.deck.slice(0, n)
  if (drawn.length === 0) return state
  return {
    ...state,
    players: { ...state.players, [owner]: { ...p, hand: [...p.hand, ...drawn], deck: p.deck.slice(drawn.length) } },
  }
}

/**
 * Defeat the first upgrade with `cardId` on a unit (#342): remove it from the unit;
 * a card-upgrade goes to its OWNER's discard, a token simply ceases to exist. A no-op
 * if the unit or upgrade is gone (e.g. the host was already defeated). Used by
 * self-sacrificing upgrades like Grav Charge.
 */
export function defeatUpgrade(state: GameState, instanceId: string, cardId: string): GameState {
  const found = findUnit(state, instanceId)
  if (!found) return state
  const idx = found.unit.upgrades.findIndex(a => a.cardId === cardId)
  if (idx === -1) return state
  const removed = found.unit.upgrades[idx]

  let next = patchUnit(state, found.owner, instanceId, u => ({ ...u, upgrades: u.upgrades.filter((_, i) => i !== idx) }))
  if (state.cards[cardId]?.type !== 'token') {
    const op = next.players[removed.owner]
    next = { ...next, players: { ...next.players, [removed.owner]: { ...op, discard: [...op.discard, cardId] } } }
  }
  return next
}

/**
 * Move one copy of `cardId` from a player's discard pile to their hand (#342).
 * A no-op if it isn't there. Used by Blade of Talzin's self-return.
 */
export function returnUpgradeFromDiscardToHand(state: GameState, owner: PlayerId, cardId: string): GameState {
  const p = state.players[owner]
  const idx = p.discard.indexOf(cardId)
  if (idx === -1) return state
  return {
    ...state,
    players: { ...state.players, [owner]: { ...p, discard: p.discard.filter((_, i) => i !== idx), hand: [...p.hand, cardId] } },
  }
}

/**
 * Return every card-upgrade on a unit (except `exceptCardId` and tokens) to its
 * OWNER's hand — each upgrade routes to the player who owns it (#340).
 */
export function returnOtherUpgradesToHand(state: GameState, instanceId: string, exceptCardId: string): GameState {
  const found = findUnit(state, instanceId)
  if (!found) return state
  const returned = found.unit.upgrades.filter(u => u.cardId !== exceptCardId && state.cards[u.cardId]?.type !== 'token')
  if (returned.length === 0) return state

  let next = patchUnit(state, found.owner, instanceId, u => ({
    ...u,
    upgrades: u.upgrades.filter(a => !returned.includes(a)),
  }))
  for (const up of returned) {
    const op = next.players[up.owner]
    next = { ...next, players: { ...next.players, [up.owner]: { ...op, hand: [...op.hand, up.cardId] } } }
  }
  return next
}
