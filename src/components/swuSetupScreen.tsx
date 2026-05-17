import { useState, useEffect } from 'react'
import { Base } from '../hooks/useBases'
import { useSwuSetup, InitialSelection } from '../hooks/useSwuSetup'
import { useBaseArt, getFirstGameImageUrl } from '../hooks/useBaseArt'
import SwuSetupScreenView from './swuSetupScreenView'
import { useUserSettings } from '../hooks/useUserSettings'
import { useFavourites } from '../hooks/useFavourites'
import { normaliseSwudbUrl, isValidSwudbUrl, fetchSwudbDeck } from '../utils/swudbUrl'
import { onFavouriteAdded, onFavouriteRemoved, onDeckImportSuccess, onDeckImportFailure } from '../services/analytics'
import { isBaseValidForFormat, isSetValidForFormat, formatValidationError } from '../utils/formatFilter'
import { SetupMode } from '../utils/playMode'
import type { Format } from '../utils/formatFilter'

export type SelectionMode = 'base-selector' | 'swudb-import' | 'favourites'

interface Props {
  onConfirm: (base: Base, mode: SetupMode, format: Format) => void
  onHelp: () => void
  onSettings?: () => void
  initialSelection?: InitialSelection | null
}

function SwuSetupScreen({ onConfirm, onHelp, onSettings, initialSelection }: Props) {
  const { useHyperspace, enableFavourites, enableCompetitiveMode } = useUserSettings()
  const { favourites, addFavourite, removeFavourite } = useFavourites()
  const setup = useSwuSetup(onConfirm, initialSelection)
  const art = useBaseArt(setup.selectedBase, useHyperspace)

  useEffect(() => {
    const url = getFirstGameImageUrl(setup.selectedBase, useHyperspace)
    if (!url) return
    const img = new Image()
    img.src = url
  }, [setup.selectedBase, useHyperspace])

  const [selectionMode, setSelectionMode] = useState<SelectionMode>(() => {
    const saved = localStorage.getItem('pref_selection_mode')
    if (saved === 'swudb-import') return 'swudb-import'
    if (saved === 'favourites' && enableFavourites && favourites.length > 0) return 'favourites'
    return 'base-selector'
  })

  const handleModeChange = (mode: SelectionMode) => {
    if (mode === 'swudb-import') {
      setup.handleSetChange('')
      setSwudbDeckName(null)
      setSwudbError(null)
    } else if (mode === 'favourites' && (!setup.selectedKey || !favourites.some(f => f.key === setup.selectedKey))) {
      setup.handleSetChange('')
    }
    setSelectionMode(mode)
    localStorage.setItem('pref_selection_mode', mode)
  }

  useEffect(() => {
    if (selectionMode === 'favourites' && (!enableFavourites || favourites.length === 0)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectionMode('base-selector')
    }
  }, [selectionMode, enableFavourites, favourites])

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
        void onDeckImportFailure('base_not_recognised')
      } else {
        void onDeckImportSuccess(baseKey, baseKey.split('-')[0])
      }
    } catch {
      setSwudbError('Deck not accessible')
      void onDeckImportFailure('deck_not_accessible')
    } finally {
      setSwudbLoading(false)
    }
  }

  // Derived: format error for a loaded SWUDB deck — re-evaluated whenever format or base changes,
  // so switching to a valid format immediately clears the error without re-fetching.
  const swudbFormatError = swudbDeckName !== null && setup.selectedBase && !swudbError
    ? isBaseValidForFormat(setup.selectedFormat, setup.selectedBase)
      ? null
      : formatValidationError(setup.selectedFormat, setup.selectedBase)
    : null

  const validFavourites = favourites.filter(f => isSetValidForFormat(f.set, setup.selectedFormat))

  const selectedBaseKey = setup.selectedBase
    ? `${setup.selectedBase.set}-${setup.selectedBase.number}`
    : null
  const isFavourited = selectedBaseKey
    ? favourites.some(f => f.key === selectedBaseKey)
    : false

  const handleFavouriteToggle = () => {
    if (!setup.selectedBase || !selectedBaseKey) return
    if (isFavourited) {
      removeFavourite(selectedBaseKey)
      void onFavouriteRemoved(selectedBaseKey, setup.selectedBase.set)
    } else {
      const aspect = setup.selectedBase.aspects.length === 0 ? 'None' : setup.selectedAspect
      addFavourite({
        key: selectedBaseKey,
        set: setup.selectedBase.set,
        name: setup.selectedBase.name,
        hp: setup.selectedBase.hp,
        aspect,
        cardNumber: parseInt(setup.selectedBase.number, 10),
      })
      void onFavouriteAdded(selectedBaseKey, setup.selectedBase.set)
    }
  }

  const handleSubmit = () => setup.handleSubmit()

  return (
    <SwuSetupScreenView
      loading={setup.loading}
      error={setup.error}
      selectedFormat={setup.selectedFormat}
      onFormatChange={setup.handleFormatChange}
      enableCompetitiveMode={enableCompetitiveMode}
      selectedSetupMode={setup.selectedMode}
      onSetupModeChange={setup.handleModeChange}
      availableSets={setup.validSets}
      availableAspects={setup.availableAspects}
      filteredBases={setup.filteredBases}
      selectedSet={setup.selectedSet}
      selectedAspect={setup.selectedAspect}
      selectedKey={setup.selectedKey}
      selectedBase={setup.selectedBase}
      useHyperspace={useHyperspace}
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
      onSubmit={handleSubmit}
      onHelp={onHelp}
      onSettings={onSettings}
      selectionMode={selectionMode}
      onModeChange={handleModeChange}
      swudbUrl={swudbUrl}
      swudbError={swudbError}
      swudbFormatError={swudbFormatError}
      swudbDeckName={swudbDeckName}
      swudbLoading={swudbLoading}
      onSwudbChange={handleSwudbChange}
      onSwudbFocus={handleSwudbFocus}
      onSwudbLoad={handleSwudbLoad}
      enableFavourites={enableFavourites}
      favourites={validFavourites}
      isFavourited={isFavourited}
      onFavouriteToggle={handleFavouriteToggle}
      onFavouriteKeyChange={setup.selectBaseByKey}
    />
  )
}

export default SwuSetupScreen
