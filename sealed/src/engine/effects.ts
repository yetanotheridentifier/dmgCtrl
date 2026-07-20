import type { GameState, NextUnitGrant, PlayerId, UnitState } from './types'
import { updatePlayer, pushChoice } from './types'
import { TOKEN_SHIELD } from './tokenUpgrades'
import { isTokenCard } from './tokenUnits'
import { getCardDefinition, runUnitTrigger } from './abilities'

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
  const next = patchUnit(state, found.owner, instanceId, u => ({ ...u, upgrades: [...u.upgrades, { cardId: tokenId, owner: found.owner }] }))
  return fireUpgradeAttached(next, instanceId)
}

/**
 * Fire "when 1 or more upgrades attach to this unit" (#357, Sabine Wren) on the receiving unit.
 * Called from every attach site: token grants (here), `playUpgrade`, and a Shielded entry.
 * Note: granting N tokens one-at-a-time fires it N times — fine for the current card, which is a
 * "may", but a future "exactly once per attach event" card would need batching.
 */
export function fireUpgradeAttached(state: GameState, instanceId: string): GameState {
  const found = findUnit(state, instanceId)
  return found ? runUnitTrigger(state, 'whenUpgradeAttached', found.unit, found.owner, {}) : state
}

/**
 * Queue a "your next unit …" grant for `owner` this phase (#348/#355). The grant (keywords, a cost
 * delta, and/or enters-ready, with an optional trait/power filter) is consumed by the next unit that
 * matches its filter — cost in `effectiveCost`, the rest in `enterUnit`; cleared at regroup. Generic:
 * Sabine (Shielded), Mouse Droid (−1 to the next Imperial), Neel (next ≤1-power unit enters ready).
 */
export function grantNextUnit(state: GameState, owner: PlayerId, grant: NextUnitGrant): GameState {
  return updatePlayer(state, owner, { nextUnitGrants: [...(state.players[owner].nextUnitGrants ?? []), grant] })
}

/** Deal `amount` damage to a player's base (#309). The caller runs the win check. */
export function dealDamageToBase(state: GameState, player: PlayerId, amount: number): GameState {
  const p = state.players[player]
  const dealt = baseDamageAfterPrevention(state, player, amount)
  if (dealt <= 0) return state
  return { ...state, players: { ...state.players, [player]: { ...p, base: { ...p.base, damage: p.base.damage + dealt } } } }
}

/**
 * How much of `amount` actually lands on `player`'s base after their own units' prevention effects
 * (#357, At Attin Safety Droid caps an instance at 4). Exposed separately so callers that report the
 * damage dealt (When Attack Ends → Hera Syndulla) quote the post-prevention figure.
 */
export function baseDamageAfterPrevention(state: GameState, player: PlayerId, amount: number): number {
  let out = amount
  for (const u of state.players[player].units) {
    for (const cid of [u.cardId, ...u.upgrades.map(x => x.cardId)]) {
      const hook = getCardDefinition(cid)?.preventBaseDamage
      if (hook) out = hook(state, u, out)
    }
  }
  return Math.max(0, out)
}

/** Heal `amount` damage from a unit — remove that much damage, never below 0 (#348). No-op if absent. */
export function healUnit(state: GameState, instanceId: string, amount: number): GameState {
  const found = findUnit(state, instanceId)
  if (!found || found.unit.damage === 0) return state
  return patchUnit(state, found.owner, instanceId, u => ({ ...u, damage: Math.max(0, u.damage - amount) }))
}

/** Resource the top card of a player's deck (#348): move deck[0] into resources, ready. No-op if empty. */
export function resourceTopOfDeck(state: GameState, owner: PlayerId): GameState {
  const p = state.players[owner]
  if (p.deck.length === 0) return state
  return { ...state, players: { ...state.players, [owner]: { ...p, resources: [...p.resources, { cardId: p.deck[0], exhausted: false }], deck: p.deck.slice(1) } } }
}

/** Heal `amount` damage from a player's base — never below 0 (#348). */
export function healBase(state: GameState, player: PlayerId, amount: number): GameState {
  const p = state.players[player]
  if (p.base.damage === 0) return state
  return { ...state, players: { ...state.players, [player]: { ...p, base: { ...p.base, damage: Math.max(0, p.base.damage - amount) } } } }
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
/**
 * Create `count` token units, then offer any "double the tokens" replacement (#357, Moff Jerjerrod).
 *
 * The card reads "if you would create N tokens, you may defeat this unit to create 2N instead". Rather
 * than pause mid-effect for that choice (which would need a resumable pipeline), we lean on the
 * equivalence **2N ≡ N then N more**: create the N, then offer a yes/no to defeat the replacer and top
 * up by another N. Same end state, no interrupt. The batch `count` is why this API exists — creating
 * one at a time would only ever let it add +1.
 */
export function createTokenUnits(state: GameState, owner: PlayerId, tokenCardId: string, count: number): GameState {
  let next = state
  for (let i = 0; i < count; i++) next = createTokenUnit(next, owner, tokenCardId)
  if (count <= 0) return next
  const replacer = next.players[owner].units.find(u =>
    [u.cardId, ...u.upgrades.map(x => x.cardId)].some(id => getCardDefinition(id)?.doublesTokenCreation?.(next, u) ?? false),
  )
  return replacer
    ? pushChoice(next, { kind: 'mayDoubleTokens', id: `${replacer.instanceId}-double`, controller: owner, unitId: replacer.instanceId, token: tokenCardId, count })
    : next
}

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
 * Return a unit from the board to its owner's hand (#356, Purrgil Ultra). The unit's card goes to
 * hand (a token unit can't return — it ceases to exist); its card-upgrades go to their owners'
 * discards; token upgrades vanish. No-op if the unit isn't in play.
 */
export function returnUnitToHand(state: GameState, instanceId: string): GameState {
  for (const owner of ['player', 'opponent'] as PlayerId[]) {
    const u = state.players[owner].units.find(x => x.instanceId === instanceId)
    if (!u) continue
    let next = updatePlayer(state, owner, {
      units: state.players[owner].units.filter(x => x.instanceId !== instanceId),
      hand: isTokenCard(u.cardId) ? state.players[owner].hand : [...state.players[owner].hand, u.cardId],
    })
    for (const up of u.upgrades) {
      if (state.cards[up.cardId]?.type === 'token') continue // token upgrades cease to exist
      next = updatePlayer(next, up.owner, { discard: [...next.players[up.owner].discard, up.cardId] })
    }
    return next
  }
  return state
}

/** Exhaust one ready resource of `owner` (#356, Mandalorian Scout). No-op if none is ready. */
export function exhaustReadyResource(state: GameState, owner: PlayerId): GameState {
  const p = state.players[owner]
  const idx = p.resources.findIndex(r => !r.exhausted)
  if (idx === -1) return state
  return { ...state, players: { ...state.players, [owner]: { ...p, resources: p.resources.map((r, i) => (i === idx ? { ...r, exhausted: true } : r)) } } }
}

/** Ready a unit (clear its exhausted flag) wherever it is (#356, Grand Admiral Thrawn). No-op if not in play. */
export function readyUnit(state: GameState, instanceId: string): GameState {
  for (const owner of ['player', 'opponent'] as PlayerId[]) {
    if (state.players[owner].units.some(u => u.instanceId === instanceId)) {
      return updatePlayer(state, owner, { units: state.players[owner].units.map(u => (u.instanceId === instanceId ? { ...u, exhausted: false } : u)) })
    }
  }
  return state
}

/** Ready one exhausted resource of `owner` (#356, Emperor's Messenger). No-op if none is exhausted. */
export function readyResource(state: GameState, owner: PlayerId): GameState {
  const p = state.players[owner]
  const idx = p.resources.findIndex(r => r.exhausted)
  if (idx === -1) return state
  return { ...state, players: { ...state.players, [owner]: { ...p, resources: p.resources.map((r, i) => (i === idx ? { ...r, exhausted: false } : r)) } } }
}

/** Move the top `n` cards of a player's deck to the bottom, preserving order (#355, Clan Wren Loyalist). */
export function bottomTopCards(state: GameState, owner: PlayerId, n: number): GameState {
  const p = state.players[owner]
  const top = p.deck.slice(0, n)
  if (top.length === 0) return state
  return { ...state, players: { ...state.players, [owner]: { ...p, deck: [...p.deck.slice(top.length), ...top] } } }
}

/** Discard the card at `handIndex` from a player's hand to their discard pile (#355). No-op if out of range. */
export function discardFromHand(state: GameState, owner: PlayerId, handIndex: number): GameState {
  const p = state.players[owner]
  const cardId = p.hand[handIndex]
  if (cardId === undefined) return state
  return {
    ...state,
    players: { ...state.players, [owner]: { ...p, hand: p.hand.filter((_, i) => i !== handIndex), discard: [...p.discard, cardId] } },
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
 * Defeat the upgrade at position `index` on a unit (#348) — the precise-instance form of
 * `defeatUpgrade`, so a chosen upgrade (e.g. one of two identical Advantage tokens) is removed
 * exactly. A card-upgrade goes to its owner's discard; a token ceases to exist. No-op if the
 * unit or index is gone.
 */
export function defeatUpgradeAt(state: GameState, instanceId: string, index: number): GameState {
  const found = findUnit(state, instanceId)
  const removed = found?.unit.upgrades[index]
  if (!found || !removed) return state
  let next = patchUnit(state, found.owner, instanceId, u => ({ ...u, upgrades: u.upgrades.filter((_, i) => i !== index) }))
  if (state.cards[removed.cardId]?.type !== 'token') {
    const op = next.players[removed.owner]
    next = { ...next, players: { ...next.players, [removed.owner]: { ...op, discard: [...op.discard, removed.cardId] } } }
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
