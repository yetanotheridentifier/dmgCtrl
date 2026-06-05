import { useXwingSetup } from '../hooks/useXwingSetup'
import XwingSetupScreenView from './xwingSetupScreenView'

interface Props {
  onStart: (playerDeficit: number, opponentDeficit: number) => void
  onBack: () => void
  onHelp: () => void
  onSettings?: () => void
}

export default function XwingSetupScreen({ onStart, onBack, onHelp, onSettings }: Props) {
  const setup = useXwingSetup()

  const handleStart = () => {
    onStart(setup.playerDeficit, setup.opponentDeficit)
  }

  return (
    <XwingSetupScreenView
      ruleset={setup.ruleset}
      onRulesetChange={setup.setRuleset}
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
      onStart={handleStart}
      onBack={onBack}
      onHelp={onHelp}
      onSettings={onSettings}
    />
  )
}
