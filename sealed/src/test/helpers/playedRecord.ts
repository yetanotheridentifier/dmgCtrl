import type { GameRecord } from '../../data/gameRecords'
import { playGame } from '../../bench/selfPlay'
import { benchInputs } from '../../bench/decks'
import { randomAi } from '../../ai/randomAi'
import { resolve } from '../../engine/resolve'

/**
 * A record as the app saves it, from a whole game between two bots. On the ASH bench deck unless
 * `inputs` names another deck and the card database it plays from.
 */
export function playedRecord(seed: number, inputs: ReturnType<typeof benchInputs> = benchInputs()): GameRecord {
  const game = playGame({
    deckPlayer: inputs.deck, deckOpponent: inputs.deck, cardDb: inputs.cardDb,
    aiPlayer: randomAi, aiOpponent: randomAi, firstPlayer: 'player', seed,
  })
  const initialState = game.initialState!
  const finalState = game.moves.reduce((s, m) => resolve(s, m.action), initialState)
  return {
    id: `game-${seed}`,
    playerDeckName: 'Mine',
    opponentDeckName: 'Theirs',
    winner: finalState.winner!,
    startedAt: 1_000,
    endedAt: 9_000,
    initialState,
    moves: game.moves,
    finalState,
    undoCount: 2,
    build: { release: '412', commitId: 'abc1234' },
    opponentAi: 'beam-reply',
    humanSeat: 'player',
  }
}
