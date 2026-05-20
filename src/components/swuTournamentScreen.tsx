import { useState } from 'react'
import type { Base } from '../hooks/useBases'
import { useBases } from '../hooks/useBases'
import type { TournamentState } from '../hooks/useTournament'
import type { Format } from '../utils/formatFilter'
import { useBaseArt } from '../hooks/useBaseArt'
import { useUserSettings } from '../hooks/useUserSettings'
import { onTournamentStarted, onTournamentDropped, onTournamentEnded } from '../services/analytics'
import SwuTournamentScreenView from './swuTournamentScreenView'

interface Props {
  base: Base
  format: Format
  tournament: TournamentState | null
  matchInProgress: boolean
  isComplete: boolean
  totals: { won: number; lost: number; drawn: number }
  points: number
  hasPlayedGameInCurrentMatch: boolean
  startTournament: (base: Base, format: Format, tournamentId: string, playMode: 'bo1' | 'bo3', totalRounds: number) => void
  startMatch: () => void
  dropTournament: () => void
  setTournamentId: (id: string) => void
  onGoToGame: (playMode: 'bo1' | 'bo3', newBase?: Base) => void
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
  hasPlayedGameInCurrentMatch,
  startTournament,
  startMatch,
  dropTournament,
  onGoToGame,
  onDrop,
  onBack,
  onHelp,
  onSettings,
}: Props) {
  const { useHyperspace } = useUserSettings()
  const { bases } = useBases()

  const [localTournamentId, setLocalTournamentId] = useState('')
  const [localPlayMode, setLocalPlayMode] = useState<'bo1' | 'bo3'>('bo3')
  const [localTotalRounds, setLocalTotalRounds] = useState(5)
  const [showDropConfirm, setShowDropConfirm] = useState(false)
  const [changingBase, setChangingBase] = useState(false)
  const [candidateAspect, setCandidateAspect] = useState<string | null>(null)
  const [candidateBase, setCandidateBase] = useState<Base | null>(null)

  // Change base is only available between games within an ongoing match (not between matches).
  // hasPlayedGameInCurrentMatch is set by App when the player presses Back mid-match,
  // because round scores are 0-0 until the full match completes and cannot be used here.
  const canChangeBase = tournament !== null
    && tournament.format === 'limited'
    && tournament.playMode === 'bo3'
    && matchInProgress
    && hasPlayedGameInCurrentMatch
    && !isComplete

  const tournamentSet = tournament?.base.set ?? null
  const setFilteredBases = tournamentSet ? bases.filter(b => b.set === tournamentSet) : bases
  const availableAspects = [...new Set(setFilteredBases.flatMap(b => b.aspects))].sort()
  const availableBasesForAspect = setFilteredBases.filter(b => !candidateAspect || b.aspects.includes(candidateAspect))

  const displayBase = candidateBase ?? base
  const art = useBaseArt(displayBase, useHyperspace)

  const handleActionButton = () => {
    setShowDropConfirm(false)
    if (!tournament) {
      // Starting a new tournament — game 1 always uses the registered base
      void onTournamentStarted(format, localPlayMode, localTotalRounds)
      startTournament(base, format, localTournamentId, localPlayMode, localTotalRounds)
      startMatch()
      onGoToGame(localPlayMode, base)
      return
    }
    if (!matchInProgress) {
      // Starting a new match — game 1 must revert to the registered base
      startMatch()
      setCandidateBase(null)
      setCandidateAspect(null)
      onGoToGame(tournament.playMode, base)
      return
    }
    // Continuing within a match (games 2 or 3)
    if (candidateBase) {
      onGoToGame(tournament.playMode, candidateBase)
    } else {
      onGoToGame(tournament.playMode)
    }
  }

  const handleDropClick = () => {
    if (isComplete) {
      void onTournamentEnded(
        tournament!.totalRounds,
        totals.won, totals.lost, totals.drawn,
        points,
        tournament!.format,
        tournament!.playMode,
      )
      dropTournament()
      onDrop()
      return
    }
    if (!showDropConfirm) {
      setShowDropConfirm(true)
      return
    }
    const roundsCompleted = tournament?.rounds.filter(r => r.result !== null).length ?? 0
    void onTournamentDropped(roundsCompleted, tournament!.format, tournament!.playMode)
    dropTournament()
    onDrop()
  }

  const handleDropCancel = () => setShowDropConfirm(false)

  const handleChangeBaseClick = () => setChangingBase(true)
  const handleAspectChange = (aspect: string) => setCandidateAspect(aspect || null)
  const handleBaseSelect = (baseKey: string) => {
    if (!baseKey) return
    const found = bases.find(b => `${b.set}-${b.number}` === baseKey)
    if (found) {
      setCandidateBase(found)
      setChangingBase(false)
    }
  }
  const handleChangeBaseCancel = () => setChangingBase(false)

  return (
    <SwuTournamentScreenView
      displayBase={displayBase}
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
      useHyperspace={useHyperspace}
      artSrc={art.src}
      artIsHyperspace={art.isHyperspace}
      artAllFailed={art.allFailed}
      artImageLoaded={art.imageLoaded}
      artRotationDeg={art.rotationDeg}
      onArtLoad={art.onLoad}
      onArtError={art.onError}
      canChangeBase={canChangeBase}
      changingBase={changingBase}
      availableAspects={availableAspects}
      candidateAspect={candidateAspect}
      availableBasesForAspect={availableBasesForAspect}
      onChangeBaseClick={handleChangeBaseClick}
      onAspectChange={handleAspectChange}
      onBaseSelect={handleBaseSelect}
      onChangeBaseCancel={handleChangeBaseCancel}
    />
  )
}
