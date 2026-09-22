/**
 * Player actions (CR 1.15). Scope notes:
 *  - each card type has its own play action: playUnit, playUpgrade, playEvent.
 *  - resourceCard/skipResource are the regroup-phase choice (CR 5.5), not
 *    action-phase actions.
 */

import type { PlayerId } from './types'

export type AttackTarget = { kind: 'base' } | { kind: 'unit'; instanceId: string }

export type Action =
  | { type: 'playUnit'; handIndex: number }
  // Play an upgrade card, attaching it to a unit in play. Any unit is a valid
  // target by default; a card narrows that with its `attachRestriction`.
  | { type: 'playUpgrade'; handIndex: number; targetInstanceId: string }
  // Play a Fortify upgrade: it attaches to the player's own base, never a unit, so it names no target.
  | { type: 'playBaseUpgrade'; handIndex: number }
  // Play an event: it never enters play — pay its cost, put it in the discard, then resolve it.
  | { type: 'playEvent'; handIndex: number }
  // Take a `DiscardPlayGrant`: "for this phase, you may play that card from <a> discard pile". A play
  // action rather than a choice answer, because the permission stands until the phase ends and the
  // player takes it on a turn of their own. `grantIndex` addresses it in `state.discardPlayGrants`,
  // and `targetInstanceId` supplies the host when the granted card is an upgrade.
  | { type: 'playFromDiscard'; grantIndex: number; targetInstanceId?: string }
  // `choiceId` is set when this attack is how a pending choice is ANSWERED (Ambush, Support,
  // "you may attack"). Without it the resolver had to guess which choice the attack belonged to,
  // and guessed the queue head, consuming the wrong one when several were outstanding.
  | { type: 'attack'; attackerId: string; target: AttackTarget; choiceId?: string }
  | { type: 'deployLeader' }
  // Use a unit's activated "Action:" ability. `cardId`+`index` address the
  // ability among the unit's own and its upgrades' action abilities.
  | { type: 'useAbility'; instanceId: string; cardId: string; index: number }
  // Use an undeployed leader's activated "Action:" ability; `index` addresses it,
  // `targetInstanceId` supplies the chosen target unit when the ability needs one.
  | { type: 'useLeaderAbility'; index: number; targetInstanceId?: string }
  // Use the "Epic Action" printed on your own base: once each game, and it picks nothing
  // itself — an ability with a target raises a choice. With `cardId` + `index` it is instead an
  // "Action:" the base has from an upgrade attached to it (Heavy Ion Cannon, Bacta Tank).
  | { type: 'useBaseAbility'; cardId?: string; index?: number }
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
  | { type: 'acceptChoice'; choiceId: string; targetInstanceId?: string; deckIndex?: number; optionIndex?: number; baseTarget?: PlayerId; handIndex?: number; cardName?: string; traitName?: string }
  | { type: 'resourceCard'; handIndex: number }
  | { type: 'skipResource' }
  // Setup phase (CR 5.2.1e–f): each player may mulligan once (initiative holder
  // first), then each resources two cards, one pick at a time. (Physically
  // simultaneous; modelled sequentially — resources are facedown so no
  // information leaks either way.)
  | { type: 'mulligan' }
  | { type: 'keepHand' }
  | { type: 'setupResource'; handIndex: number }
