import { useState } from 'react'

export const XWING_PHASES = ['Planning', 'System', 'Activation', 'Engagement', 'End'] as const

export function usePhaseTracker(phases: readonly string[]) {
  const [phaseIndex, setPhaseIndex] = useState(0)
  return {
    phase: phases[phaseIndex],
    phaseIndex,
    isLastPhase: phaseIndex === phases.length - 1,
    advance: () => setPhaseIndex(i => i + 1),
    reset: () => setPhaseIndex(0),
    restore: (index: number) => setPhaseIndex(index),
  }
}
