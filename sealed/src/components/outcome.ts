import type { PlayerId } from '../engine/types'

/** Title + tone class for the game-over banner, from the terminal outcome (#323). */
export function outcomeBanner(winner: PlayerId | 'draw'): { title: string; tone: string } {
  if (winner === 'draw') return { title: 'Draw', tone: 'text-amber' }
  if (winner === 'player') return { title: 'You won', tone: 'text-green' }
  return { title: 'You lost', tone: 'text-red' }
}
