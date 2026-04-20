import { Base } from '../hooks/useBases'
import { useSwuSetup, InitialSelection } from '../hooks/useSwuSetup'
import { useBaseArt } from '../hooks/useBaseArt'
import SwuSetupScreenView from './swuSetupScreenView'

interface Props {
  onConfirm: (base: Base, useHyperspace: boolean) => void
  onHelp: () => void
  initialSelection?: InitialSelection | null
}

function SwuSetupScreen({ onConfirm, onHelp, initialSelection }: Props) {
  const setup = useSwuSetup(onConfirm, initialSelection)
  const art = useBaseArt(setup.selectedBase, setup.useHyperspace)

  const hasHyperspace = !!(
    setup.selectedBase?.hyperspaceArtHiRes || setup.selectedBase?.hyperspaceArt
  )
  const showHyperspaceToggle = hasHyperspace && !art.normalFailed && !art.hyperspaceFailed && art.imageLoaded

  const handleSubmit = () => {
    const effectiveHyperspace = setup.useHyperspace || art.normalFailed
    setup.handleSubmit(effectiveHyperspace)
  }

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
      showHyperspaceToggle={showHyperspaceToggle}
      artSrc={art.src}
      artIsHyperspace={art.isHyperspace}
      artAllFailed={art.allFailed}
      artImageLoaded={art.imageLoaded}
      artRotationDeg={art.rotationDeg}
      onArtLoad={art.onLoad}
      onArtError={art.onError}
      onSetChange={setup.handleSetChange}
      onAspectChange={setup.handleAspectChange}
      onKeyChange={setup.handleKeyChange}
      onHyperspaceToggle={setup.handleHyperspaceToggle}
      onSubmit={handleSubmit}
      onHelp={onHelp}
    />
  )
}

export default SwuSetupScreen