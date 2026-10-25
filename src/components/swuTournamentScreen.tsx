import { useState } from 'react'
import type { Base } from '../hooks/useBases'
import { useBases } from '../hooks/useBases'
import type { TournamentState } from '../hooks/useTournament'
import { useUserSettings } from '../hooks/useUserSettings'
import { onTournamentDropped, onTournamentEnded } from '../services/analytics'
import { playerPortalUrl } from '../utils/meleeUrl'
import SwuTournamentScreenView from './swuTournamentScreenView'

interface Props {
  tournament: TournamentState
  matchInProgress: boolean
  isComplete: boolean
  totals: { won: number; lost: number; drawn: number }
  points: number
  hasPlayedGameInCurrentMatch: boolean
  startMatch: () => void
  dropTournament: () => void
  onGoToGame: (playMode: 'bo1' | 'bo3', newBase?: Base) => void
  onDrop: () => void
  onBack: () => void
  onHelp: () => void
  onSettings?: () => void
}

// Between rounds: the record, the rounds, and the next one a tap away. The tournament itself is
// started from the start sheet on SWU setup.
export default function SwuTournamentScreen({
  tournament,
  matchInProgress,
  isComplete,
  totals,
  points,
  hasPlayedGameInCurrentMatch,
  startMatch,
  dropTournament,
  onGoToGame,
  onDrop,
  onBack,
  onHelp,
  onSettings,
}: Props) {
  const { meleePlayerGuid } = useUserSettings()
  const { bases } = useBases()
  const [candidateBase, setCandidateBase] = useState<Base | null>(null)

  // In Limited best of 3 the base can change between games of a match, not between matches.
  // hasPlayedGameInCurrentMatch is set by App when the player presses Back mid-match, because
  // round scores are 0-0 until the full match completes and cannot be used here.
  const canChangeBase = tournament.format === 'limited'
    && tournament.playMode === 'bo3'
    && matchInProgress
    && hasPlayedGameInCurrentMatch
    && !isComplete

  // A Limited pool is one set: the base changes to another of that set.
  const changeBaseOptions = bases.filter(b => b.set === tournament.base.set)

  const handleNext = () => {
    if (!matchInProgress) {
      // A new match: game 1 is always on the registered base.
      startMatch()
      setCandidateBase(null)
      onGoToGame(tournament.playMode, tournament.base)
      return
    }
    if (candidateBase) onGoToGame(tournament.playMode, candidateBase)
    else onGoToGame(tournament.playMode)
  }

  const handleDrop = () => {
    const roundsCompleted = tournament.rounds.filter(r => r.result !== null).length
    void onTournamentDropped(roundsCompleted, tournament.format, tournament.playMode)
    dropTournament()
    onDrop()
  }

  const handleFinish = () => {
    void onTournamentEnded(tournament.totalRounds, totals.won, totals.lost, totals.drawn, points, tournament.format, tournament.playMode)
    dropTournament()
    onDrop()
  }

  const handlePlayerPortal = () => {
    if (meleePlayerGuid) window.open(playerPortalUrl(meleePlayerGuid), '_blank')
    else onSettings?.()
  }

  return (
    <SwuTournamentScreenView
      tournament={tournament}
      displayBase={candidateBase ?? tournament.base}
      baseChanged={candidateBase !== null}
      matchInProgress={matchInProgress}
      isComplete={isComplete}
      totals={totals}
      points={points}
      onNext={handleNext}
      onDrop={handleDrop}
      onFinish={handleFinish}
      onBack={onBack}
      onHelp={onHelp}
      onSettings={onSettings}
      canChangeBase={canChangeBase}
      changeBaseOptions={changeBaseOptions}
      onChangeBase={setCandidateBase}
      hasPlayerId={Boolean(meleePlayerGuid)}
      onPlayerPortal={handlePlayerPortal}
    />
  )
}
