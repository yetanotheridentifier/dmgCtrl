import { useState } from 'react'
import { Base } from '../hooks/useBases'
import { useSwuSetup, InitialSelection } from '../hooks/useSwuSetup'
import { useBaseArt } from '../hooks/useBaseArt'
import SwuSetupScreenView from './swuSetupScreenView'
import { FEATURE_USER_SETTINGS } from '../flags'
import { normaliseSwudbUrl, isValidSwudbUrl, fetchSwudbDeck } from '../utils/swudbUrl'

export type SelectionMode = 'base-selector' | 'swudb-import'

interface Props {
  onConfirm: (base: Base, useHyperspace: boolean) => void
  onHelp: () => void
  onSettings?: () => void
  initialSelection?: InitialSelection | null
}

function SwuSetupScreen({ onConfirm, onHelp, onSettings, initialSelection }: Props) {
  const setup = useSwuSetup(onConfirm, initialSelection)
  const art = useBaseArt(setup.selectedBase, setup.useHyperspace)

  const [selectionMode, setSelectionMode] = useState<SelectionMode>(() => {
    const saved = localStorage.getItem('pref_selection_mode')
    return saved === 'swudb-import' ? 'swudb-import' : 'base-selector'
  })

  const handleModeChange = (mode: SelectionMode) => {
    setSelectionMode(mode)
    localStorage.setItem('pref_selection_mode', mode)
  }

  const [swudbUrl, setSwudbUrl] = useState('')
  const [swudbError, setSwudbError] = useState<string | null>(null)
  const [swudbDeckName, setSwudbDeckName] = useState<string | null>(null)
  const [swudbLoading, setSwudbLoading] = useState(false)

  const handleSwudbChange = (text: string) => {
    setSwudbUrl(text)
    const valid = isValidSwudbUrl(normaliseSwudbUrl(text))
    setSwudbError(valid ? null : 'Invalid deck URL')
    setSwudbDeckName(null)
  }

  const handleSwudbFocus = () => {
    setSwudbError(null)
  }

  const handleSwudbLoad = async () => {
    const normalised = normaliseSwudbUrl(swudbUrl)
    if (!isValidSwudbUrl(normalised)) {
      setSwudbError('Invalid deck URL')
      return
    }
    const deckId = normalised.replace('https://swudb.com/deck/', '')
    setSwudbLoading(true)
    setSwudbError(null)
    setSwudbDeckName(null)
    try {
      const { deckName, baseKey } = await fetchSwudbDeck(deckId)
      setSwudbDeckName(deckName)
      const found = setup.selectBaseByKey(baseKey)
      if (!found) {
        setSwudbError('Base not recognised')
      }
    } catch {
      setSwudbError('Deck not accessible')
    } finally {
      setSwudbLoading(false)
    }
  }

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
      onSettings={FEATURE_USER_SETTINGS ? onSettings : undefined}
      selectionMode={selectionMode}
      onModeChange={handleModeChange}
      swudbUrl={swudbUrl}
      swudbError={swudbError}
      swudbDeckName={swudbDeckName}
      swudbLoading={swudbLoading}
      onSwudbChange={handleSwudbChange}
      onSwudbFocus={handleSwudbFocus}
      onSwudbLoad={handleSwudbLoad}
    />
  )
}

export default SwuSetupScreen