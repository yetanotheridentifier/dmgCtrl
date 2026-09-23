/**
 * Minimal type definitions required for the Bounty keyword tests.
 *
 * The real project contains many more fields; only the ones used
 * in the tests are defined here to keep the example focused.
 */

export interface Unit {
  owner: number;
  bounty?: number;
  isDefeated?: boolean;
  isCaptured?: boolean;
}

export interface Game {
  getOpponent(owner: number): MockPlayer;
}

export interface Event {
  type: string;
  unit: Unit;
}

export interface MockPlayer {
  reward: number;
  addReward(amount: number): void;
}
