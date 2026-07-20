import type { GameState, PlayerId, UnitState } from './types'
import { opponentOf, updatePlayer, recordUnitDefeated } from './types'
import { effectiveHp } from './stats'
import { TOKEN_SHIELD, removeFirst, hasToken } from './tokenUpgrades'
import { isTokenCard } from './tokenUnits'
import { runUnitTrigger, getCardDefinition } from './abilities'

/** Product of the damage multipliers the unit's card and upgrades contribute (#342). */
function damageMultiplier(state: GameState, unit: UnitState): number {
  let m = 1
  for (const cardId of [unit.cardId, ...unit.upgrades.map(u => u.cardId)]) {
    m *= getCardDefinition(cardId)?.damageMultiplier?.(state, unit) ?? 1
  }
  return m
}

/**
 * Combat resolution and damage-dealing (#342). Extracted from `resolve.ts` so
 * that card abilities can deal damage (via `dealDamageToUnit`) without importing
 * the whole resolver — breaking what would otherwise be an `effects`/`cardDefinitions`
 * ↔ `resolve` import cycle.
 */

/**
 * Apply damage to a player's units, defeating any with damage ≥ HP (CR 1.9.6).
 * Fires each defeated unit's (and its upgrades') `whenDefeated` abilities after
 * the unit has left play (#342).
 */
export function applyUnitDamage(state: GameState, owner: PlayerId, damaged: Map<string, number>, byCombat = false): GameState {
  const p = state.players[owner]
  const survivors: UnitState[] = []
  const defeated: UnitState[] = []

  for (const u of p.units) {
    let extra = damaged.get(u.instanceId) ?? 0
    // Damage-taken multipliers (e.g. Deadly Vulnerability ×2) scale the instance (#342).
    if (extra > 0) extra *= damageMultiplier(state, u)
    let upgrades = u.upgrades
    // A shield token prevents one instance of incoming damage, then is removed (#308).
    if (extra > 0 && hasToken(upgrades, TOKEN_SHIELD)) {
      upgrades = removeFirst(upgrades, a => a.cardId === TOKEN_SHIELD)
      extra = 0
    }
    const total = u.damage + extra
    const next = extra > 0 || upgrades !== u.upgrades ? { ...u, damage: total, upgrades } : u
    if (total >= effectiveHp(state, next)) {
      defeated.push(next)
    } else {
      survivors.push(next)
    }
  }

  return finishDefeats(state, owner, survivors, defeated, byCombat)
}

/**
 * Remove `defeated` units belonging to `owner` and settle the consequences (#342): non-leader
 * cards to the owner's discard (tokens cease to exist); attached card-upgrades to their own owner's
 * discard; a defeated leader unit back to the base zone exhausted (CR 3.4.5); then fire each unit's
 * `whenDefeated`. Shared by combat damage and direct defeats (`defeatUnit`).
 */
function finishDefeats(state: GameState, owner: PlayerId, survivors: UnitState[], defeated: UnitState[], byCombat = false): GameState {
  // Always write `survivors` back — they carry the damage just applied (defeated may be empty).
  const p = state.players[owner]
  const defeatedUpgrades = defeated.flatMap(u => u.upgrades).filter(a => state.cards[a.cardId]?.type !== 'token')

  let result = updatePlayer(state, owner, {
    units: survivors,
    discard: [
      ...p.discard,
      ...defeated.filter(u => !u.isLeader && !isTokenCard(u.cardId)).map(u => u.cardId),
      ...defeatedUpgrades.filter(a => a.owner === owner).map(a => a.cardId),
    ],
  })

  const other = opponentOf(owner)
  const othersUpgrades = defeatedUpgrades.filter(a => a.owner === other).map(a => a.cardId)
  if (othersUpgrades.length > 0) {
    result = updatePlayer(result, other, { discard: [...result.players[other].discard, ...othersUpgrades] })
  }

  if (defeated.some(u => u.isLeader)) {
    const owner2 = result.players[owner]
    result = updatePlayer(result, owner, { leader: { ...owner2.leader, deployed: false, exhausted: true } })
  }

  for (const dead of defeated) {
    result = recordUnitDefeated(result, owner, dead.cardId) // "defeated this phase" tracking (#347)
    result = runUnitTrigger(result, 'whenDefeated', dead, owner, { defeatedUnit: dead, defeatedByCombat: byCombat })
    // "When another friendly unit is defeated" (#357, The Twins) — the controller's surviving units
    // react. Re-found each step in case an earlier reactor changed the board.
    for (const id of result.players[owner].units.map(u => u.instanceId)) {
      const reactor = result.players[owner].units.find(u => u.instanceId === id)
      if (reactor) result = runUnitTrigger(result, 'whenFriendlyUnitDefeated', reactor, owner, { defeatedUnit: dead })
    }
  }
  return result
}

/** Defeat a unit outright (#348) — a targeted "defeat" (Thrawn), which bypasses Shields (those
 *  prevent damage, not defeat). No-op if the unit isn't in play. */
export function defeatUnit(state: GameState, instanceId: string): GameState {
  for (const owner of ['player', 'opponent'] as PlayerId[]) {
    const target = state.players[owner].units.find(u => u.instanceId === instanceId)
    if (target) return finishDefeats(state, owner, state.players[owner].units.filter(u => u.instanceId !== instanceId), [target])
  }
  return state
}

/**
 * Deal `amount` damage to a single unit, wherever it is (#342). A thin wrapper over
 * `applyUnitDamage` so abilities can deal damage outside the attack flow; honours
 * Shield tokens and fires `whenDefeated`. A no-op if the unit is not in play.
 */
export function dealDamageToUnit(state: GameState, instanceId: string, amount: number): GameState {
  for (const owner of ['player', 'opponent'] as PlayerId[]) {
    if (state.players[owner].units.some(u => u.instanceId === instanceId)) {
      return applyUnitDamage(state, owner, new Map([[instanceId, amount]]))
    }
  }
  return state
}
