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
  | { type: 'attack'; attackerId: string; target: AttackTarget }
  | { type: 'deployLeader' }
  | { type: 'takeInitiative' }
  | { type: 'pass' }
  | { type: 'resourceCard'; handIndex: number }
  | { type: 'skipResource' }
