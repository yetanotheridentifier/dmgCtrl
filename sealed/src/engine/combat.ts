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
export function applyUnitDamage(state: GameState, owner: PlayerId, damaged: Map<string, number>): GameState {
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

  // Defeated card-upgrades return to their OWNER's discard, which may differ from
  // the unit's controller when an upgrade was attached to an enemy unit (#308).
  // Token upgrades (type `token`) simply cease to exist. Collect per owner.
  const defeatedUpgrades = defeated
    .flatMap(u => u.upgrades)
    .filter(a => state.cards[a.cardId]?.type !== 'token')

  // Non-leader defeated units go to their owner's discard pile (CR 1.5.5c); token
  // units cease to exist instead (#342).
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

  // A defeated Leader Unit returns to the base zone, exhausted, undeployed;
  // its epic action stays used so it cannot redeploy (CR 3.4.5).
  if (defeated.some(u => u.isLeader)) {
    const owner2 = result.players[owner]
    result = updatePlayer(result, owner, {
      leader: { ...owner2.leader, deployed: false, exhausted: true },
    })
  }

  // "When Defeated" abilities fire after the unit has left play, in the order the
  // units were defeated. The captured unit is passed so its (and its upgrades')
  // abilities can still reference it even though it is no longer on the board.
  for (const dead of defeated) {
    result = recordUnitDefeated(result, owner, dead.cardId) // "defeated this phase" tracking (#347)
    result = runUnitTrigger(result, 'whenDefeated', dead, owner, { defeatedUnit: dead })
  }

  return result
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
