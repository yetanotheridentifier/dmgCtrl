import type { DamageSource, GameState, NextUnitGrant, PlayerId, UnitState } from './types'
import { updatePlayer, pushChoice, recordBaseDamaged, recordUpgradeDefeated, recordUnitLeftPlay } from './types'
import { TOKEN_SHIELD } from './tokenUpgrades'
import { isTokenCard } from './tokenUnits'
import type { EffectContext, TriggerPoint } from './abilities'
import { getCardDefinition, runUnitTrigger } from './abilities'

/**
 * How many cards a search by `unit` looks at: the base count times every
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
 * Effect primitives: pure `(state, …) => state` building blocks that card
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
 * Fire "when 1 or more upgrades attach to this unit" (Sabine Wren) on the receiving unit.
 * Called from every attach site: token grants (here), `playUpgrade`, and a Shielded entry.
 * Note: granting N tokens one-at-a-time fires it N times — fine for the current card, which is a
 * "may", but a future "exactly once per attach event" card would need batching.
 */
export function fireUpgradeAttached(state: GameState, instanceId: string, upgradePlayed = false): GameState {
  const found = findUnit(state, instanceId)
  return found ? runUnitTrigger(state, 'whenUpgradeAttached', found.unit, found.owner, { upgradePlayed }) : state
}

/**
 * Queue a "your next unit …" grant for `owner` this phase. The grant (keywords, a cost
 * delta, and/or enters-ready, with an optional trait/power filter) is consumed by the next unit that
 * matches its filter — cost in `effectiveCost`, the rest in `enterUnit`; cleared at regroup. Generic:
 * Sabine (Shielded), Mouse Droid (−1 to the next Imperial), Neel (next ≤1-power unit enters ready).
 */
export function grantNextUnit(state: GameState, owner: PlayerId, grant: NextUnitGrant): GameState {
  return updatePlayer(state, owner, { nextUnitGrants: [...(state.players[owner].nextUnitGrants ?? []), grant] })
}

/** Deal `amount` damage to a player's base. The caller runs the win check. */
export function dealDamageToBase(state: GameState, player: PlayerId, amount: number, source?: DamageSource): GameState {
  const p = state.players[player]
  const dealt = baseDamageAfterPrevention(state, player, amount, source)
  if (dealt <= 0) return state
  let next: GameState = { ...state, players: { ...state.players, [player]: { ...p, base: { ...p.base, damage: p.base.damage + dealt } } } }
  next = recordBaseDamaged(next, player) // "an enemy base was damaged this phase" (Baylan Skoll)
  // "When your base is dealt damage" (Blade Three) — the base owner's units react.
  return fireUnitsTrigger(next, 'whenOwnBaseDamaged', player)
}

/**
 * Defeat the upgrades that were attached to units leaving play, firing "when a friendly upgrade is
 * defeated" for each affected owner (Zeb Orrelios / Baylan Skoll). Fired once per owner, not
 * per upgrade — a unit dying with three upgrades is one reaction per controller.
 */
export function fireUpgradesDefeated(state: GameState, owners: PlayerId[]): GameState {
  let next = state
  for (const owner of [...new Set(owners)]) {
    next = recordUpgradeDefeated(next, owner)
    next = fireUnitsTrigger(next, 'whenFriendlyUpgradeDefeated', owner)
  }
  return next
}

/**
 * How much of `amount` actually lands on `player`'s base after their own units' prevention effects
 * (At Attin Safety Droid caps an instance at 4). Exposed separately so callers that report the
 * damage dealt (When Attack Ends → Hera Syndulla) quote the post-prevention figure.
 */
export function baseDamageAfterPrevention(state: GameState, player: PlayerId, amount: number, source?: DamageSource): number {
  if (damageIsUnpreventable(state, source)) return amount
  let out = amount
  for (const u of state.players[player].units) {
    for (const cid of [u.cardId, ...u.upgrades.map(x => x.cardId)]) {
      const hook = getCardDefinition(cid)?.preventBaseDamage
      if (hook) out = hook(state, u, out)
    }
  }
  return Math.max(0, out)
}

/**
 * True if this instance of damage ignores Shields and base-damage prevention (Gorian Shard's
 * Corsair). Asked of every unit in play belonging to the damage's controller.
 */
export function damageIsUnpreventable(state: GameState, source?: DamageSource): boolean {
  if (!source) return false
  return state.players[source.controller].units.some(u =>
    [u.cardId, ...u.upgrades.map(x => x.cardId)].some(id => getCardDefinition(id)?.makesDamageUnpreventable?.(state, u, source) ?? false),
  )
}

/** Heal `amount` damage from a unit — remove that much damage, never below 0. No-op if absent. */
export function healUnit(state: GameState, instanceId: string, amount: number): GameState {
  const found = findUnit(state, instanceId)
  if (!found || found.unit.damage === 0) return state
  return patchUnit(state, found.owner, instanceId, u => ({ ...u, damage: Math.max(0, u.damage - amount) }))
}

/** Resource the top card of a player's deck: move deck[0] into resources, ready. No-op if empty. */
export function resourceTopOfDeck(state: GameState, owner: PlayerId): GameState {
  const p = state.players[owner]
  if (p.deck.length === 0) return state
  return { ...state, players: { ...state.players, [owner]: { ...p, resources: [...p.resources, { cardId: p.deck[0], exhausted: false }], deck: p.deck.slice(1) } } }
}

/** Heal `amount` damage from a player's base — never below 0. */
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
 * Create a token unit for `owner` — a fresh in-play unit from a built-in
 * token card (e.g. the Mandalorian). A Shielded token enters play with a shield
 * token, per its keyword. Consumes one instance id.
 */
/**
 * Create `count` token units, then offer any "double the tokens" replacement (Moff Jerjerrod).
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
  if (drawn.length === 0) return state // nothing drawn → not a draw event
  const next: GameState = {
    ...state,
    players: { ...state.players, [owner]: { ...p, hand: [...p.hand, ...drawn], deck: p.deck.slice(drawn.length) } },
  }
  // "When you draw 1 or more cards" (Axe Woves) — once per event, however many cards.
  return fireUnitsTrigger(next, 'whenDrawCards', owner)
}

/**
 * Fire `point` on every unit `owner` controls, re-finding each one as we go so an earlier
 * reactor leaving play (or changing the board) can't resurrect a stale unit.
 */
export function fireUnitsTrigger(state: GameState, point: TriggerPoint, owner: PlayerId, extra?: Partial<EffectContext>): GameState {
  let next = state
  for (const id of next.players[owner].units.map(u => u.instanceId)) {
    const reactor = next.players[owner].units.find(u => u.instanceId === id)
    if (reactor) next = runUnitTrigger(next, point, reactor, owner, extra)
  }
  return next
}

/**
 * Return a unit from the board to its owner's hand (Purrgil Ultra). The unit's card goes to
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
    next = recordUnitLeftPlay(next, owner, u.cardId, u.isLeader)
    // Leaving play releases whatever it had captured.
    return releaseCaptured(next, owner, u.captured ?? [])
  }
  return state
}

/**
 * Release the cards a unit had captured (Bothan-5): each returns to PLAY under its owner's
 * control, exhausted, in its own arena. It is not being *played*, so nothing that keys off playing
 * or entering play happens: no "When Played" (or play/create) trigger, no Shielded shield token, no
 * Ambush attack, and no cost. Token cards can't come back — they ceased to exist when captured.
 */
export function releaseCaptured(state: GameState, owner: PlayerId, cardIds: string[]): GameState {
  let next = state
  for (const cardId of cardIds) {
    if (isTokenCard(cardId)) continue
    const card = next.cards[cardId]
    next = {
      ...next,
      instanceCounter: next.instanceCounter + 1,
      players: {
        ...next.players,
        [owner]: {
          ...next.players[owner],
          units: [...next.players[owner].units, {
            instanceId: `u${next.instanceCounter}`,
            cardId,
            arena: card?.arena ?? 'ground',
            damage: 0,
            exhausted: true, // rescued units arrive exhausted
            isLeader: false,
            upgrades: [],
          }],
        },
      },
    }
  }
  return next
}

/** Exhaust one ready resource of `owner` (Mandalorian Scout). No-op if none is ready. */
export function exhaustReadyResource(state: GameState, owner: PlayerId): GameState {
  const p = state.players[owner]
  const idx = p.resources.findIndex(r => !r.exhausted)
  if (idx === -1) return state
  return { ...state, players: { ...state.players, [owner]: { ...p, resources: p.resources.map((r, i) => (i === idx ? { ...r, exhausted: true } : r)) } } }
}

/** Ready a unit (clear its exhausted flag) wherever it is (Grand Admiral Thrawn). No-op if not in play. */
export function readyUnit(state: GameState, instanceId: string): GameState {
  for (const owner of ['player', 'opponent'] as PlayerId[]) {
    if (state.players[owner].units.some(u => u.instanceId === instanceId)) {
      return updatePlayer(state, owner, { units: state.players[owner].units.map(u => (u.instanceId === instanceId ? { ...u, exhausted: false } : u)) })
    }
  }
  return state
}

/** Ready one exhausted resource of `owner` (Emperor's Messenger). No-op if none is exhausted. */
export function readyResource(state: GameState, owner: PlayerId): GameState {
  const p = state.players[owner]
  const idx = p.resources.findIndex(r => r.exhausted)
  if (idx === -1) return state
  return { ...state, players: { ...state.players, [owner]: { ...p, resources: p.resources.map((r, i) => (i === idx ? { ...r, exhausted: false } : r)) } } }
}

/** Move the top `n` cards of a player's deck to the bottom, preserving order (Clan Wren Loyalist). */
export function bottomTopCards(state: GameState, owner: PlayerId, n: number): GameState {
  const p = state.players[owner]
  const top = p.deck.slice(0, n)
  if (top.length === 0) return state
  return { ...state, players: { ...state.players, [owner]: { ...p, deck: [...p.deck.slice(top.length), ...top] } } }
}

/** Discard the card at `handIndex` from a player's hand to their discard pile. No-op if out of range. */
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
 * Defeat the first upgrade with `cardId` on a unit: remove it from the unit;
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
  return fireUpgradesDefeated(next, [removed.owner])
}

/**
 * Defeat the upgrade at position `index` on a unit — the precise-instance form of
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
  return fireUpgradesDefeated(next, [removed.owner])
}

/**
 * Return the upgrade at `index` to **its owner's** hand (Jabba the Hutt) — which may not be
 * the host unit's controller. Token upgrades can't go to a hand, so they simply cease to exist.
 * Fires "a friendly upgrade was defeated"? No — returning is not defeating, so no trigger.
 */
export function returnUpgradeToHand(state: GameState, instanceId: string, index: number): GameState {
  const found = findUnit(state, instanceId)
  const removed = found?.unit.upgrades[index]
  if (!found || !removed) return state
  const next = patchUnit(state, found.owner, instanceId, u => ({ ...u, upgrades: u.upgrades.filter((_, i) => i !== index) }))
  if (state.cards[removed.cardId]?.type === 'token') return next
  const op = next.players[removed.owner]
  return { ...next, players: { ...next.players, [removed.owner]: { ...op, hand: [...op.hand, removed.cardId] } } }
}

/**
 * Move one copy of `cardId` from a player's discard pile to their hand.
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
 * OWNER's hand — each upgrade routes to the player who owns it.
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
