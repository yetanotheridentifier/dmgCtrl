import { rollScenario, useXwingSetup } from '../hooks/useXwingSetup'
import type { XwingMatchType, XwingScenario, XwingPlayerChoice } from '../hooks/useXwingSetup'
import { useXwingLists } from '../hooks/useXwingLists'
import type { XwingList } from '../hooks/useXwingLists'
import { listPoints } from '../utils/xwingListInfo'
import XwingSetupScreenView from './xwingSetupScreenView'
import type { ResolvedChoice, Side } from './xwingSetupScreenView'
import XwingListBuilder from './xwingListBuilder'
import { useState } from 'react'
import type { XwingPilot } from '../utils/parseXwsText'
import type { XwingTournamentList } from '../hooks/useXwingTournament'

interface Props {
  onStart: (playerDeficit: number, opponentDeficit: number, scenario: XwingScenario, playerPilots: XwingPilot[], opponentPilots: XwingPilot[], matchType: XwingMatchType) => void
  onBack: () => void
  onHelp: () => void
  onSettings?: () => void
  onLists?: () => void
  // Squad Lists opened at the paste box.
  onImport?: () => void
  tournamentInProgress?: boolean
  onStartTournament?: (totalRounds: number, scenario: XwingScenario, player: XwingTournamentList, opponent: XwingTournamentList) => void
  onGoToTournament?: () => void
}

// A chosen list deleted on Squad Lists resolves to no choice, so the player picks again.
function resolve(choice: XwingPlayerChoice | null, lists: XwingList[]): ResolvedChoice | null {
  if (choice === null || choice.kind === 'none') return choice
  const list = lists.find(l => l.id === choice.listId)
  return list ? { kind: 'list', list } : null
}

function deficitAndPilots(choice: ResolvedChoice, manualDeficit: number): [number, XwingPilot[]] {
  if (choice.kind === 'none') return [manualDeficit, []]
  return [Math.max(0, 50 - listPoints(choice.list.pilots)), choice.list.pilots]
}

// A tournament keeps a copy of each list, so it survives the list being deleted from Squad lists.
function tournamentList(choice: ResolvedChoice, manualDeficit: number): XwingTournamentList {
  const [deficit, pilots] = deficitAndPilots(choice, manualDeficit)
  return { name: choice.kind === 'list' ? choice.list.name : 'No list', pilots, deficit }
}

export default function XwingSetupScreen({ onStart, onBack, onHelp, onSettings, onLists, onImport, tournamentInProgress = false, onStartTournament, onGoToTournament }: Props) {
  const setup = useXwingSetup()
  const { lists } = useXwingLists()
  // The side a list is being built for, from its list sheet's Build a list.
  const [building, setBuilding] = useState<Side | null>(null)

  if (building !== null) {
    const choose = building === 'player' ? setup.setPlayerChoice : setup.setOpponentChoice
    return (
      <XwingListBuilder
        side={building}
        onBack={() => setBuilding(null)}
        onSaved={listId => { choose({ kind: 'list', listId }); setBuilding(null) }}
        onImport={onImport && (() => { setBuilding(null); onImport() })}
      />
    )
  }

  const playerChoice = resolve(setup.playerChoice, lists)
  const opponentChoice = resolve(setup.opponentChoice, lists)
  // Last game's opponent is offered only while that list still exists.
  const lastOpponentList = lists.find(l => l.id === setup.lastOpponentListId) ?? null

  const handleStart = () => {
    if (!playerChoice || !opponentChoice) return
    const [pDeficit, pPilots] = deficitAndPilots(playerChoice, setup.playerDeficit)
    const [oDeficit, oPilots] = deficitAndPilots(opponentChoice, setup.opponentDeficit)
    onStart(pDeficit, oDeficit, setup.scenario, pPilots, oPilots, setup.matchType)
  }

  const handleStartTournament = () => {
    if (!playerChoice || !opponentChoice) return
    onStartTournament?.(setup.rounds, setup.scenario, tournamentList(playerChoice, setup.playerDeficit), tournamentList(opponentChoice, setup.opponentDeficit))
  }

  return (
    <XwingSetupScreenView
      matchType={setup.matchType}
      onMatchTypeChange={setup.setMatchType}
      rounds={setup.rounds}
      onRoundsChange={setup.setRounds}
      scenario={setup.scenario}
      onScenarioChange={setup.setScenario}
      onScenarioRandom={() => setup.setScenario(rollScenario())}
      lists={lists}
      playerChoice={playerChoice}
      onPlayerChoose={setup.setPlayerChoice}
      opponentChoice={opponentChoice}
      onOpponentChoose={setup.setOpponentChoice}
      lastOpponentList={lastOpponentList}
      playerDeficit={setup.playerDeficit}
      onPlayerDeficitChange={setup.setPlayerDeficit}
      opponentDeficit={setup.opponentDeficit}
      onOpponentDeficitChange={setup.setOpponentDeficit}
      canStart={playerChoice !== null && opponentChoice !== null}
      onStart={handleStart}
      tournamentInProgress={tournamentInProgress}
      onStartTournament={handleStartTournament}
      onGoToTournament={onGoToTournament}
      onBack={onBack}
      onHelp={onHelp}
      onSettings={onSettings}
      onLists={onLists}
      onImport={onImport}
      onBuild={setBuilding}
    />
  )
}
