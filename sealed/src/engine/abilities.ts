import type { GameState, PlayerId } from './types'

/**
 * Card ability framework (#303 spike — see sealed/docs/ability-framework.md).
 *
 * Design: GameState must stay pure JSON (game records replay through the
 * resolver), so ability CODE cannot live in state. Instead, a module-level
 * registry maps cardId → ability definitions; the resolver consults it at
 * fixed trigger points. Cards with no entry play vanilla — existing behaviour
 * is untouched and per-card behaviour rolls out incrementally.
 *
 * Effects are pure `(state, ctx) => state` functions, composed from the
 * primitives library as it grows (#305–#309). Replays are deterministic for a
 * given app version; records already carry that implicit dependency.
 */

/** Timing hooks the resolver fires. Extended as #305/#306 land more of CR 7.6. */
export type TriggerPoint =
  | 'whenPlayed'
  | 'onAttack'
  | 'whenDefeated'
  | 'onDefense'

export interface EffectContext {
  /** Controller of the ability's source card. */
  owner: PlayerId
  /** The card whose ability is firing. */
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

const registry = new Map<string, AbilityDef[]>()

export function registerAbility(cardId: string, def: AbilityDef): void {
  registry.set(cardId, [...(registry.get(cardId) ?? []), def])
}

export function unregisterAbility(cardId: string): void {
  registry.delete(cardId)
}

export function getAbilities(cardId: string): AbilityDef[] {
  return registry.get(cardId) ?? []
}

/**
 * Fire every ability on `ctx.cardId` registered for `point`, in registration
 * order. Returns the input state unchanged (same reference) when nothing fires.
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
