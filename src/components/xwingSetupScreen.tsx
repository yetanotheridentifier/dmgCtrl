import { useState } from 'react'
import { useXwingSetup, XWING_NAMED_SCENARIOS } from '../hooks/useXwingSetup'
import type { XwingScenario, XwingListImport } from '../hooks/useXwingSetup'
import { useSquadSlot } from '../hooks/useSquadSlot'
import { useXwingFavourites } from '../hooks/useXwingFavourites'
import XwingSetupScreenView from './xwingSetupScreenView'
import type { XwingPilot } from '../utils/parseXwsText'
import type { XwingSquadFavourite } from '../hooks/useXwingFavourites'

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
  const { favourites, addFavourite, removeFavourite } = useXwingFavourites()

  const [playerListImport, setPlayerListImportState] = useState<XwingListImport>(setup.playerListImport)
  const [opponentListImport, setOpponentListImportState] = useState<XwingListImport>(setup.opponentListImport)
  const [playerManualSaved, setPlayerManualSaved] = useState(false)
  const [opponentManualSaved, setOpponentManualSaved] = useState(false)

  const handlePlayerListImportChange = (v: XwingListImport) => {
    setPlayerListImportState(v)
    setup.setPlayerListImport(v)
    playerSlot.edit()
    setPlayerManualSaved(false)
  }

  const handleOpponentListImportChange = (v: XwingListImport) => {
    setOpponentListImportState(v)
    opponentSlot.edit()
    setOpponentManualSaved(false)
  }

  const handlePlayerEdit = () => {
    playerSlot.edit()
    setPlayerManualSaved(false)
  }

  const handleOpponentEdit = () => {
    opponentSlot.edit()
    setOpponentManualSaved(false)
  }

  const handlePlayerLoadFavourite = (fav: XwingSquadFavourite) => {
    playerSlot.confirmFromFavourite(fav)
  }

  const handleOpponentLoadFavourite = (fav: XwingSquadFavourite) => {
    opponentSlot.confirmFromFavourite(fav)
  }

  const handlePlayerSave = (name: string) => {
    const existing = favourites.find(f => f.name === name)
    if (existing) removeFavourite(existing.id)
    addFavourite(name, playerSlot.pilots)
    setPlayerManualSaved(true)
  }

  const handlePlayerUnsave = () => {
    const existing = favourites.find(f => f.name === playerSlot.squadName)
    if (existing) removeFavourite(existing.id)
    playerSlot.markUnsaved()
    setPlayerManualSaved(false)
  }

  const handleOpponentSave = (name: string) => {
    const existing = favourites.find(f => f.name === name)
    if (existing) removeFavourite(existing.id)
    addFavourite(name, opponentSlot.pilots)
    setOpponentManualSaved(true)
  }

  const handleOpponentUnsave = () => {
    const existing = favourites.find(f => f.name === opponentSlot.squadName)
    if (existing) removeFavourite(existing.id)
    opponentSlot.markUnsaved()
    setOpponentManualSaved(false)
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
      onPlayerEdit={handlePlayerEdit}
      opponentConfirmed={opponentSlot.confirmed}
      onOpponentConfirm={() => opponentSlot.confirm(opponentListImport)}
      onOpponentEdit={handleOpponentEdit}
      playerText={playerSlot.text}
      onPlayerTextChange={playerSlot.setText}
      opponentText={opponentSlot.text}
      onOpponentTextChange={opponentSlot.setText}
      playerError={playerSlot.error}
      opponentError={opponentSlot.error}
      playerPilots={playerSlot.pilots}
      opponentPilots={opponentSlot.pilots}
      playerSquadName={playerSlot.squadName}
      opponentSquadName={opponentSlot.squadName}
      playerStarFilled={playerSlot.isFromFavourite || playerManualSaved}
      opponentStarFilled={opponentSlot.isFromFavourite || opponentManualSaved}
      favourites={favourites}
      onPlayerLoadFavourite={handlePlayerLoadFavourite}
      onOpponentLoadFavourite={handleOpponentLoadFavourite}
      onPlayerSave={handlePlayerSave}
      onOpponentSave={handleOpponentSave}
      onPlayerUnsave={handlePlayerUnsave}
      onOpponentUnsave={handleOpponentUnsave}
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
