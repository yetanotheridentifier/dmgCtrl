import { useXwingSetup, XWING_NAMED_SCENARIOS } from '../hooks/useXwingSetup'
import type { XwingScenario, XwingPlayerChoice } from '../hooks/useXwingSetup'
import { useXwingLists } from '../hooks/useXwingLists'
import type { XwingList } from '../hooks/useXwingLists'
import { listPoints } from '../utils/xwingListInfo'
import XwingSetupScreenView from './xwingSetupScreenView'
import type { ResolvedChoice } from './xwingSetupScreenView'
import type { XwingPilot } from '../utils/parseXwsText'

interface Props {
  onStart: (playerDeficit: number, opponentDeficit: number, scenario: XwingScenario, playerPilots: XwingPilot[], opponentPilots: XwingPilot[]) => void
  onBack: () => void
  onHelp: () => void
  onSettings?: () => void
  onLists?: () => void
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

export default function XwingSetupScreen({ onStart, onBack, onHelp, onSettings, onLists }: Props) {
  const setup = useXwingSetup()
  const { lists } = useXwingLists()

  const playerChoice = resolve(setup.playerChoice, lists)
  const opponentChoice = resolve(setup.opponentChoice, lists)
  // Last game's opponent is offered only while that list still exists.
  const lastOpponentList = lists.find(l => l.id === setup.lastOpponentListId) ?? null

  const handleScenarioRandom = () => {
    const idx = Math.floor(Math.random() * XWING_NAMED_SCENARIOS.length)
    setup.setScenario(XWING_NAMED_SCENARIOS[idx])
  }

  const handleStart = () => {
    if (!playerChoice || !opponentChoice) return
    const [pDeficit, pPilots] = deficitAndPilots(playerChoice, setup.playerDeficit)
    const [oDeficit, oPilots] = deficitAndPilots(opponentChoice, setup.opponentDeficit)
    onStart(pDeficit, oDeficit, setup.scenario, pPilots, oPilots)
  }

  return (
    <XwingSetupScreenView
      matchType={setup.matchType}
      onMatchTypeChange={setup.setMatchType}
      rounds={setup.rounds}
      onRoundsChange={setup.setRounds}
      scenario={setup.scenario}
      onScenarioChange={setup.setScenario}
      onScenarioRandom={handleScenarioRandom}
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
      onBack={onBack}
      onHelp={onHelp}
      onSettings={onSettings}
      onLists={onLists}
    />
  )
}
