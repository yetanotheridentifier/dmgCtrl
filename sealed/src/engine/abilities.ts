import type { GameState, KeywordInstance, PlayerId, UnitState } from './types'

/**
 * Card ability framework (#303 spike → #340). Card-type-agnostic: units, leaders,
 * events and upgrades all register through the same registry, so their mechanics
 * are reused across card types.
 *
 * GameState stays pure JSON (records replay through the resolver), so ability CODE
 * cannot live in state. A module-level registry maps cardId → a definition (its
 * triggered abilities plus static hooks); the engine consults it at fixed points.
 * Cards with no entry play vanilla — existing behaviour is untouched.
 *
 * Effects are pure `(state, ctx) => state` functions composed from the primitives
 * library (`effects.ts`). Replays are deterministic for a given app version.
 */

/** Timing hooks the resolver fires (#340 adds onAttackEnd / whenReadies / whenRegroupStarts). */
export type TriggerPoint =
  | 'whenPlayed'
  | 'onAttack'
  | 'onAttackEnd'
  | 'whenReadies'
  | 'whenRegroupStarts'
  | 'whenDefeated'
  | 'onDefense'

export interface EffectContext {
  /** Controller of the ability's source card. */
  owner: PlayerId
  /** The card whose ability is firing (the unit's card, or an attached upgrade). */
  cardId: string
  /** In-play instance the ability belongs to, when one exists. */
  sourceInstanceId?: string
}

export type EffectFn = (state: GameState, ctx: EffectContext) => GameState

export interface AbilityDef {
  trigger: TriggerPoint
  /** Human-readable rules text — used by the log and future UI. */
  description: string
  effect: EffectFn
}

/**
 * A card's full behaviour: its triggered abilities plus static hooks the engine
 * consults. All optional — a card supplies only what it needs (#340).
 */
export interface CardDefinition {
  abilities?: AbilityDef[]
  /** Upgrades only: may this card attach to `target`? Default (no hook) = any unit. */
  attachRestriction?: (state: GameState, target: UnitState) => boolean
  /** Cost delta when playing this card (upgrades: `target` is the attach target). */
  costModifier?: (state: GameState, playerId: PlayerId, target?: UnitState) => number
  /** Extra keywords this card grants a unit (e.g. an upgrade granting a conditional keyword). */
  conditionalKeywords?: (state: GameState, unit: UnitState) => KeywordInstance[]
}

const registry = new Map<string, CardDefinition>()

/** Register (merging) a card's definition — abilities append, static hooks overwrite. */
export function registerCard(cardId: string, def: CardDefinition): void {
  const existing = registry.get(cardId)
  registry.set(cardId, {
    ...existing,
    ...def,
    abilities: [...(existing?.abilities ?? []), ...(def.abilities ?? [])],
  })
}

/** Convenience: register a single triggered ability on a card. */
export function registerAbility(cardId: string, def: AbilityDef): void {
  registerCard(cardId, { abilities: [def] })
}

export function unregisterAbility(cardId: string): void {
  registry.delete(cardId)
}

export function getCardDefinition(cardId: string): CardDefinition | undefined {
  return registry.get(cardId)
}

export function getAbilities(cardId: string): AbilityDef[] {
  return registry.get(cardId)?.abilities ?? []
}

/**
 * Fire every ability on `ctx.cardId` registered for `point`, in registration order.
 * Returns the input state unchanged (same reference) when nothing fires.
 */
export function runTrigger(state: GameState, point: TriggerPoint, ctx: EffectContext): GameState {
  let next = state
  for (const ability of getAbilities(ctx.cardId)) {
    if (ability.trigger === point) {
      next = ability.effect(next, ctx)
    }
  }
  return next
}

/**
 * Fire a unit event at `point` (#340): the unit's own card abilities AND each
 * attached upgrade's abilities, so an upgrade's "When Attack Ends: …" fires when
 * the attached unit's attack ends. `owner` controls the unit.
 */
export function runUnitTrigger(state: GameState, point: TriggerPoint, unit: UnitState, owner: PlayerId): GameState {
  let next = state
  const cardIds = [unit.cardId, ...unit.upgrades.map(u => u.cardId)]
  for (const cardId of cardIds) {
    for (const ability of getAbilities(cardId)) {
      if (ability.trigger === point) {
        next = ability.effect(next, { owner, cardId, sourceInstanceId: unit.instanceId })
      }
    }
  }
  return next
}
