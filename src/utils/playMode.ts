export type PlayMode = 'casual' | 'bo1' | 'bo3'

export const PLAY_MODE_LABELS: Record<PlayMode, string> = {
  casual: 'Casual',
  bo1: 'Best of 1',
  bo3: 'Best of 3',
}

export const PLAY_MODES: PlayMode[] = ['casual', 'bo1', 'bo3']
