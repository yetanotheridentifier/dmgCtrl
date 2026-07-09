import { db } from './db'
import type { Action } from '../engine/actions'
import type { GameState, PlayerId } from '../engine/types'

/**
 * Completed-game record (T2.7, written by T4.5). `initialState` + `moves`
 * deterministically replay the whole game through the pure resolver, which is
 * exactly the substrate the Epic 7 training pipeline needs later.
 */
export interface GameRecord {
  id: string
  playerDeckName: string
  opponentDeckName: string
  winner: PlayerId | 'draw'
  startedAt: number
  endedAt: number
  initialState: GameState
  moves: { by: PlayerId; action: Action }[]
  finalState: GameState
}

export async function saveGameRecord(record: Omit<GameRecord, 'id'>): Promise<GameRecord> {
  const saved: GameRecord = { ...record, id: crypto.randomUUID() }
  await db.games.put(saved)
  return saved
}

/** Newest first. */
export async function listGameRecords(): Promise<GameRecord[]> {
  return db.games.orderBy('endedAt').reverse().toArray()
}
