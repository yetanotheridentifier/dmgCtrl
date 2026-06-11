import { useXwingSetup, XWING_NAMED_SCENARIOS } from '../hooks/useXwingSetup'
import type { XwingScenario } from '../hooks/useXwingSetup'
import XwingSetupScreenView from './xwingSetupScreenView'

interface Props {
  onStart: (playerDeficit: number, opponentDeficit: number, scenario: XwingScenario) => void
  onBack: () => void
  onHelp: () => void
  onSettings?: () => void
}

export default function XwingSetupScreen({ onStart, onBack, onHelp, onSettings }: Props) {
  const setup = useXwingSetup()

  const handleStart = () => {
    onStart(setup.playerDeficit, setup.opponentDeficit, setup.scenario)
  }

  const handleScenarioRandom = () => {
    const idx = Math.floor(Math.random() * XWING_NAMED_SCENARIOS.length)
    setup.setScenario(XWING_NAMED_SCENARIOS[idx])
  }

  return (
    <XwingSetupScreenView
      matchType={setup.matchType}
      onMatchTypeChange={setup.setMatchType}
      rounds={setup.rounds}
      onRoundsChange={setup.setRounds}
      listImport={setup.listImport}
      onListImportChange={setup.setListImport}
      playerDeficit={setup.playerDeficit}
      onPlayerDeficitChange={setup.setPlayerDeficit}
      opponentDeficit={setup.opponentDeficit}
      onOpponentDeficitChange={setup.setOpponentDeficit}
      scenario={setup.scenario}
      onScenarioChange={setup.setScenario}
      onScenarioRandom={handleScenarioRandom}
      onStart={handleStart}
      onBack={onBack}
      onHelp={onHelp}
      onSettings={onSettings}
    />
  )
}
