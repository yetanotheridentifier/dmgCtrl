import { describe, it, expect } from 'vitest';
import { bountyTrigger } from '../../src/keywords/bounty';
import type { Game, Unit, Event } from '../../src/types';

/**
 * Mock implementations for the game and unit used in the tests.
 */
class MockPlayer {
  public reward = 0;
  addReward(amount: number) {
    this.reward += amount;
  }
}

class MockGame implements Game {
  public players: MockPlayer[] = [new MockPlayer(), new MockPlayer()];
  getOpponent(owner: number): MockPlayer {
    return this.players[1 - owner];
  }
}

class MockUnit implements Unit {
  owner: number;
  bounty?: number;
  isDefeated = false;
  isCaptured = false;
  constructor(owner: number, bounty?: number) {
    this.owner = owner;
    this.bounty = bounty;
  }
}

describe('Bounty keyword', () => {
  it('gives reward on defeat', () => {
    const game = new MockGame();
    const unit = new MockUnit(0, 3);
    const event: Event = { type: 'defeat', unit };

    bountyTrigger(event, game);

    expect(game.getOpponent(unit.owner).reward).toBe(3);
  });

  it('gives reward on capture', () => {
    const game = new MockGame();
    const unit = new MockUnit(0, 5);
    const event: Event = { type: 'capture', unit };

    bountyTrigger(event, game);

    expect(game.getOpponent(unit.owner).reward).toBe(5);
  });

  it('does not give reward if unit has no bounty', () => {
    const game = new MockGame();
    const unit = new MockUnit(0);
    const event: Event = { type: 'defeat', unit };

    bountyTrigger(event, game);

    expect(game.getOpponent(unit.owner).reward).toBe(0);
  });

  it('ignores unrelated events', () => {
    const game = new MockGame();
    const unit = new MockUnit(0, 2);
    const event: Event = { type: 'attack', unit };

    bountyTrigger(event as any, game);

    expect(game.getOpponent(unit.owner).reward).toBe(0);
  });
});
