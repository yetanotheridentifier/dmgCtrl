import { useState } from 'react'
import type { Base } from '../hooks/useBases'
import type { TournamentState } from '../hooks/useTournament'
import type { Format } from '../utils/formatFilter'
import SwuTournamentScreenView from './swuTournamentScreenView'

interface Props {
  base: Base
  format: Format
  tournament: TournamentState | null
  matchInProgress: boolean
  isComplete: boolean
  totals: { won: number; lost: number; drawn: number }
  points: number
  startTournament: (base: Base, format: Format, tournamentId: string, playMode: 'bo1' | 'bo3', totalRounds: number) => void
  startMatch: () => void
  dropTournament: () => void
  setTournamentId: (id: string) => void
  onGoToGame: (playMode: 'bo1' | 'bo3') => void
  onDrop: () => void
  onBack: () => void
  onHelp: () => void
  onSettings?: () => void
}

export default function SwuTournamentScreen({
  base,
  format,
  tournament,
  matchInProgress,
  isComplete,
  totals,
  points,
  startTournament,
  startMatch,
  dropTournament,
  onGoToGame,
  onDrop,
  onBack,
  onHelp,
  onSettings,
}: Props) {
  const [localTournamentId, setLocalTournamentId] = useState('')
  const [localPlayMode, setLocalPlayMode] = useState<'bo1' | 'bo3'>('bo3')
  const [localTotalRounds, setLocalTotalRounds] = useState(5)
  const [showDropConfirm, setShowDropConfirm] = useState(false)

  const handleActionButton = () => {
    setShowDropConfirm(false)
    if (!tournament) {
      startTournament(base, format, localTournamentId, localPlayMode, localTotalRounds)
      startMatch()
      onGoToGame(localPlayMode)
      return
    }
    if (!matchInProgress) {
      startMatch()
    }
    onGoToGame(tournament.playMode)
  }

  const handleDropClick = () => {
    if (isComplete) {
      dropTournament()
      onDrop()
      return
    }
    if (!showDropConfirm) {
      setShowDropConfirm(true)
      return
    }
    dropTournament()
    onDrop()
  }

  const handleDropCancel = () => setShowDropConfirm(false)

  return (
    <SwuTournamentScreenView
      tournament={tournament}
      matchInProgress={matchInProgress}
      isComplete={isComplete}
      totals={totals}
      points={points}
      localTournamentId={localTournamentId}
      localPlayMode={localPlayMode}
      localTotalRounds={localTotalRounds}
      onLocalTournamentIdChange={setLocalTournamentId}
      onLocalPlayModeChange={setLocalPlayMode}
      onLocalTotalRoundsChange={setLocalTotalRounds}
      showDropConfirm={showDropConfirm}
      onActionButton={handleActionButton}
      onDropClick={handleDropClick}
      onDropCancel={handleDropCancel}
      onBack={onBack}
      onHelp={onHelp}
      onSettings={onSettings}
    />
  )
}
