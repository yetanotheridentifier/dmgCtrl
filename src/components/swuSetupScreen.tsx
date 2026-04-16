import { Base } from '../hooks/useBases'
import { useSwuSetup } from '../hooks/useSwuSetup'
import SwuSetupScreenView from './swuSetupScreenView'

interface Props {
  onConfirm: (base: Base, useHyperspace: boolean) => void
  onHelp: () => void
}

function SwuSetupScreen({ onConfirm, onHelp }: Props) {
  const setup = useSwuSetup(onConfirm)

  return (
    <SwuSetupScreenView
      loading={setup.loading}
      error={setup.error}
      availableSets={setup.availableSets}
      availableAspects={setup.availableAspects}
      filteredBases={setup.filteredBases}
      selectedSet={setup.selectedSet}
      selectedAspect={setup.selectedAspect}
      selectedKey={setup.selectedKey}
      selectedBase={setup.selectedBase}
      useHyperspace={setup.useHyperspace}
      showHyperspaceToggle={setup.showHyperspaceToggle}
      onSetChange={setup.handleSetChange}
      onAspectChange={setup.handleAspectChange}
      onKeyChange={setup.handleKeyChange}
      onHyperspaceToggle={setup.handleHyperspaceToggle}
      onSubmit={setup.handleSubmit}
      onHelp={onHelp}
      onNormalImageFailed={setup.handleNormalImageFailed}
      onHyperspaceImageFailed={setup.handleHyperspaceImageFailed}
    />
  )
}

export default SwuSetupScreen