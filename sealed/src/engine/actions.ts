/**
 * Player actions (CR 1.15). Scope notes:
 *  - playCard covers unit cards only; upgrades have their own action, and events are not
 *    modelled — they stay in hand (still resourceable in regroup).
 *  - resourceCard/skipResource are the regroup-phase choice (CR 5.5), not
 *    action-phase actions.
 */

import type { PlayerId } from './types'

export type AttackTarget = { kind: 'base' } | { kind: 'unit'; instanceId: string }

export type Action =
  | { type: 'playCard'; handIndex: number }
  // Play an upgrade card, attaching it to a unit in play. Any unit is a valid
  // target by default; a card narrows that with its `attachRestriction`.
  | { type: 'playUpgrade'; handIndex: number; targetInstanceId: string }
  | { type: 'attack'; attackerId: string; target: AttackTarget }
  | { type: 'deployLeader' }
  // Use a unit's activated "Action:" ability. `cardId`+`index` address the
  // ability among the unit's own and its upgrades' action abilities.
  | { type: 'useAbility'; instanceId: string; cardId: string; index: number }
  // Use an undeployed leader's activated "Action:" ability; `index` addresses it,
  // `targetInstanceId` supplies the chosen target unit when the ability needs one.
  | { type: 'useLeaderAbility'; index: number; targetInstanceId?: string }
  | { type: 'takeInitiative' }
  | { type: 'pass' }
  // Decline a pending choice (Ambush/Support/pay-or-exhaust/may-play …). With no
  // `choiceId` it declines the head; a `choiceId` declines that specific one when
  // several are pending simultaneously.
  | { type: 'skipTrigger'; choiceId?: string }
  // Accept a pending "may…" choice by id — pay the cost / play the card / take the
  // action. `targetInstanceId` supplies a unit target when the choice needs one (an
  // upgrade's attach target, a damage victim); `deckIndex` picks a revealed card in a
  // search; `optionIndex` picks a choose-one/modal option; `baseTarget` picks a
  // player's base as the target of a damage choice; `handIndex` picks a hand card to play.
  | { type: 'acceptChoice'; choiceId: string; targetInstanceId?: string; deckIndex?: number; optionIndex?: number; baseTarget?: PlayerId; handIndex?: number; cardName?: string }
  | { type: 'resourceCard'; handIndex: number }
  | { type: 'skipResource' }
  // Setup phase (CR 5.2.1e–f): each player may mulligan once (initiative holder
  // first), then each resources two cards, one pick at a time. (Physically
  // simultaneous; modelled sequentially — resources are facedown so no
  // information leaks either way.)
  | { type: 'mulligan' }
  | { type: 'keepHand' }
  | { type: 'setupResource'; handIndex: number }
