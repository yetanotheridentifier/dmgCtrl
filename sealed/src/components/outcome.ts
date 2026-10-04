import type { PlayerId } from '../engine/types'

/**
 * Title + tone class for the game-over banner, from the terminal outcome. A conceded game carries a
 * `detail` line saying who conceded, since no base fell to explain the result.
 */
export function outcomeBanner(winner: PlayerId | 'draw', concededBy?: PlayerId): { title: string; tone: string; detail?: string } {
  const detail = concededBy === undefined ? undefined : concededBy === 'player' ? 'You conceded' : 'Your opponent conceded'
  if (winner === 'draw') return { title: 'Draw', tone: 'text-amber' }
  if (winner === 'player') return { title: 'You won', tone: 'text-green', detail }
  return { title: 'You lost', tone: 'text-red', detail }
}
