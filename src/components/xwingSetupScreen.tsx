import { useState } from 'react'
import { useXwingSetup, XWING_NAMED_SCENARIOS } from '../hooks/useXwingSetup'
import type { XwingScenario, XwingListImport } from '../hooks/useXwingSetup'
import { useSquadSlot } from '../hooks/useSquadSlot'
import XwingSetupScreenView from './xwingSetupScreenView'
import type { XwingPilot } from '../utils/parseXwsText'

interface Props {
  onStart: (playerDeficit: number, opponentDeficit: number, scenario: XwingScenario, playerPilots: XwingPilot[], opponentPilots: XwingPilot[]) => void
  onBack: () => void
  onHelp: () => void
  onSettings?: () => void
}

export default function XwingSetupScreen({ onStart, onBack, onHelp, onSettings }: Props) {
  const setup = useXwingSetup()
  const playerSlot = useSquadSlot()
  const opponentSlot = useSquadSlot()

  const [playerListImport, setPlayerListImportState] = useState<XwingListImport>(setup.playerListImport)
  const [opponentListImport, setOpponentListImportState] = useState<XwingListImport>(setup.opponentListImport)

  const handlePlayerListImportChange = (v: XwingListImport) => {
    setPlayerListImportState(v)
    setup.setPlayerListImport(v)
    playerSlot.edit()
  }

  const handleOpponentListImportChange = (v: XwingListImport) => {
    setOpponentListImportState(v)
    opponentSlot.edit()
  }

  const handleScenarioRandom = () => {
    const idx = Math.floor(Math.random() * XWING_NAMED_SCENARIOS.length)
    setup.setScenario(XWING_NAMED_SCENARIOS[idx])
  }

  const handleStart = () => {
    const pTotal = playerSlot.pilots.reduce((sum, p) => sum + p.points, 0)
    const oTotal = opponentSlot.pilots.reduce((sum, p) => sum + p.points, 0)
    const pDeficit = playerListImport === 'XWA' ? Math.max(0, 50 - pTotal) : setup.playerDeficit
    const oDeficit = opponentListImport === 'XWA' ? Math.max(0, 50 - oTotal) : setup.opponentDeficit
    onStart(pDeficit, oDeficit, setup.scenario, playerSlot.pilots, opponentSlot.pilots)
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
      playerConfirmed={playerSlot.confirmed}
      onPlayerConfirm={() => playerSlot.confirm(playerListImport)}
      onPlayerEdit={playerSlot.edit}
      opponentConfirmed={opponentSlot.confirmed}
      onOpponentConfirm={() => opponentSlot.confirm(opponentListImport)}
      onOpponentEdit={opponentSlot.edit}
      playerText={playerSlot.text}
      onPlayerTextChange={playerSlot.setText}
      opponentText={opponentSlot.text}
      onOpponentTextChange={opponentSlot.setText}
      playerError={playerSlot.error}
      opponentError={opponentSlot.error}
      playerPilots={playerSlot.pilots}
      opponentPilots={opponentSlot.pilots}
      scenario={setup.scenario}
      onScenarioChange={setup.setScenario}
      onScenarioRandom={handleScenarioRandom}
      canStart={playerSlot.confirmed && opponentSlot.confirmed}
      onStart={handleStart}
      onBack={onBack}
      onHelp={onHelp}
      onSettings={onSettings}
    />
  )
}
