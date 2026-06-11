import { useState } from 'react'
import { useXwingSetup, XWING_NAMED_SCENARIOS } from '../hooks/useXwingSetup'
import type { XwingScenario, XwingListImport } from '../hooks/useXwingSetup'
import XwingSetupScreenView from './xwingSetupScreenView'
import { parseXwsText } from '../utils/parseXwsText'
import type { XwingPilot } from '../utils/parseXwsText'

interface Props {
  onStart: (playerDeficit: number, opponentDeficit: number, scenario: XwingScenario, playerPilots: XwingPilot[], opponentPilots: XwingPilot[]) => void
  onBack: () => void
  onHelp: () => void
  onSettings?: () => void
}

export default function XwingSetupScreen({ onStart, onBack, onHelp, onSettings }: Props) {
  const setup = useXwingSetup()

  const [playerListImport, setPlayerListImportState] = useState<XwingListImport>(setup.playerListImport)
  const [opponentListImport, setOpponentListImportState] = useState<XwingListImport>(setup.opponentListImport)
  const [playerConfirmed, setPlayerConfirmed] = useState(false)
  const [opponentConfirmed, setOpponentConfirmed] = useState(false)
  const [playerText, setPlayerText] = useState('')
  const [opponentText, setOpponentText] = useState('')
  const [playerError, setPlayerError] = useState<string | null>(null)
  const [opponentError, setOpponentError] = useState<string | null>(null)
  const [playerPilots, setPlayerPilots] = useState<XwingPilot[]>([])
  const [opponentPilots, setOpponentPilots] = useState<XwingPilot[]>([])

  const handlePlayerListImportChange = (v: XwingListImport) => {
    setPlayerListImportState(v)
    setup.setPlayerListImport(v)
    setPlayerError(null)
  }

  const handleOpponentListImportChange = (v: XwingListImport) => {
    setOpponentListImportState(v)
    setOpponentError(null)
  }

  const handlePlayerConfirm = () => {
    if (playerListImport === 'XWA') {
      const result = parseXwsText(playerText)
      if (!result.ok) {
        setPlayerError(result.error)
        return
      }
      setPlayerPilots(result.pilots)
    }
    setPlayerError(null)
    setPlayerConfirmed(true)
  }

  const handleOpponentConfirm = () => {
    if (opponentListImport === 'XWA') {
      const result = parseXwsText(opponentText)
      if (!result.ok) {
        setOpponentError(result.error)
        return
      }
      setOpponentPilots(result.pilots)
    }
    setOpponentError(null)
    setOpponentConfirmed(true)
  }

  const handlePlayerEdit = () => {
    setPlayerConfirmed(false)
    setPlayerError(null)
  }

  const handleOpponentEdit = () => {
    setOpponentConfirmed(false)
    setOpponentError(null)
  }

  const handleScenarioRandom = () => {
    const idx = Math.floor(Math.random() * XWING_NAMED_SCENARIOS.length)
    setup.setScenario(XWING_NAMED_SCENARIOS[idx])
  }

  const handleStart = () => {
    const pTotal = playerPilots.reduce((sum, p) => sum + p.points, 0)
    const oTotal = opponentPilots.reduce((sum, p) => sum + p.points, 0)
    const pDeficit = playerListImport === 'XWA' ? Math.max(0, 50 - pTotal) : setup.playerDeficit
    const oDeficit = opponentListImport === 'XWA' ? Math.max(0, 50 - oTotal) : setup.opponentDeficit
    onStart(pDeficit, oDeficit, setup.scenario, playerPilots, opponentPilots)
  }

  return (
    <XwingSetupScreenView
      matchType={setup.matchType}
      onMatchTypeChange={setup.setMatchType}
      rounds={setup.rounds}
      onRoundsChange={setup.setRounds}
      playerListImport={playerListImport}
      onPlayerListImportChange={handlePlayerListImportChange}
      opponentListImport={opponentListImport}
      onOpponentListImportChange={handleOpponentListImportChange}
      playerDeficit={setup.playerDeficit}
      onPlayerDeficitChange={setup.setPlayerDeficit}
      opponentDeficit={setup.opponentDeficit}
      onOpponentDeficitChange={setup.setOpponentDeficit}
      playerConfirmed={playerConfirmed}
      onPlayerConfirm={handlePlayerConfirm}
      onPlayerEdit={handlePlayerEdit}
      opponentConfirmed={opponentConfirmed}
      onOpponentConfirm={handleOpponentConfirm}
      onOpponentEdit={handleOpponentEdit}
      playerText={playerText}
      onPlayerTextChange={setPlayerText}
      opponentText={opponentText}
      onOpponentTextChange={setOpponentText}
      playerError={playerError}
      opponentError={opponentError}
      playerPilots={playerPilots}
      opponentPilots={opponentPilots}
      scenario={setup.scenario}
      onScenarioChange={setup.setScenario}
      onScenarioRandom={handleScenarioRandom}
      canStart={playerConfirmed && opponentConfirmed}
      onStart={handleStart}
      onBack={onBack}
      onHelp={onHelp}
      onSettings={onSettings}
    />
  )
}
