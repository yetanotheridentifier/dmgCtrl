/**
 * Player actions (CR 1.15). MVP scope notes:
 *  - playCard covers unit cards only; events/upgrades have no vanilla effect
 *    without ability support and stay in hand (still resourceable in regroup).
 *  - "Use an Action Ability" is out of MVP scope except leader deployment,
 *    modelled as its own action.
 *  - resourceCard/skipResource are the regroup-phase choice (CR 5.5), not
 *    action-phase actions.
 */

export type AttackTarget = { kind: 'base' } | { kind: 'unit'; instanceId: string }

export type Action =
  | { type: 'playCard'; handIndex: number }
  // Play an upgrade card, attaching it to a unit in play. Any unit is a valid
  // target by default; card-specific restrictions are #337 (#308).
  | { type: 'playUpgrade'; handIndex: number; targetInstanceId: string }
  | { type: 'attack'; attackerId: string; target: AttackTarget }
  | { type: 'deployLeader' }
  | { type: 'takeInitiative' }
  | { type: 'pass' }
  // Decline a pending on-play trigger (Ambush/Support) offered after a unit enters
  // play — the optional attack is not taken (#334).
  | { type: 'skipTrigger' }
  | { type: 'resourceCard'; handIndex: number }
  | { type: 'skipResource' }
  // Setup phase (CR 5.2.1e–f): each player may mulligan once (initiative holder
  // first), then each resources two cards, one pick at a time. (Physically
  // simultaneous; modelled sequentially — resources are facedown so no
  // information leaks either way.)
  | { type: 'mulligan' }
  | { type: 'keepHand' }
  | { type: 'setupResource'; handIndex: number }
