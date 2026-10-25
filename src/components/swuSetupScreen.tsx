import { useState, useEffect, useMemo } from 'react'
import { Base } from '../hooks/useBases'
import { useSwuSetup, baseKey } from '../hooks/useSwuSetup'
import { useBaseArt, getFirstGameImageUrl } from '../hooks/useBaseArt'
import SwuSetupScreenView from './swuSetupScreenView'
import type { SwudbImport } from './swuSetupScreenView'
import InstallBanner from './installBanner'
import { useUserSettings } from '../hooks/useUserSettings'
import { useFavourites } from '../hooks/useFavourites'
import { useInstallPrompt } from '../hooks/useInstallPrompt'
import { normaliseSwudbUrl, isValidSwudbUrl, fetchSwudbDeck } from '../utils/swudbUrl'
import { onFavouriteAdded, onFavouriteRemoved, onDeckImportSuccess, onDeckImportFailure } from '../services/analytics'
import { SetupMode } from '../utils/playMode'

interface Props {
  onConfirm: (base: Base, mode: SetupMode) => void
  onHelp: () => void
  onBack?: () => void
  onSettings?: () => void
}

const NO_DECK: SwudbImport = { url: '', error: null, deckName: null, base: null, loading: false }

function SwuSetupScreen({ onConfirm, onHelp, onBack, onSettings }: Props) {
  const { useHyperspace } = useUserSettings()
  const { favourites, addFavourite, removeFavourite } = useFavourites()
  const setup = useSwuSetup(onConfirm)
  const art = useBaseArt(setup.base, useHyperspace)
  const { showBanner, platform, onInstall, onDismiss } = useInstallPrompt()

  // Warm the cache with the art the game screen will show first.
  useEffect(() => {
    const url = getFirstGameImageUrl(setup.base, useHyperspace)
    if (!url) return
    const img = new Image()
    img.src = url
  }, [setup.base, useHyperspace])

  // Favourites are stored as records; a favourite no longer in the card data is left out.
  const favouriteBases = useMemo(() => {
    const byKey = new Map(setup.bases.map(b => [baseKey(b), b]))
    return favourites.map(f => byKey.get(f.key)).filter((b): b is Base => b !== undefined)
  }, [favourites, setup.bases])

  const [swudb, setSwudb] = useState<SwudbImport>(NO_DECK)

  const handleSwudbChange = (text: string) => {
    const valid = isValidSwudbUrl(normaliseSwudbUrl(text))
    setSwudb({ ...NO_DECK, url: text, error: valid ? null : 'Invalid deck URL' })
  }

  const handleSwudbFocus = () => setSwudb(s => ({ ...s, error: null }))

  const handleSwudbLoad = async () => {
    const normalised = normaliseSwudbUrl(swudb.url)
    if (!isValidSwudbUrl(normalised)) {
      setSwudb(s => ({ ...s, error: 'Invalid deck URL' }))
      return
    }
    const deckId = normalised.replace('https://swudb.com/deck/', '')
    setSwudb(s => ({ ...s, loading: true, error: null, deckName: null, base: null }))
    try {
      const { deckName, baseKey: key } = await fetchSwudbDeck(deckId)
      const found = setup.bases.find(b => baseKey(b) === key) ?? null
      setSwudb(s => ({ ...s, loading: false, deckName, base: found, error: found ? null : 'Base not recognised' }))
      if (found) void onDeckImportSuccess(key, key.split('-')[0])
      else void onDeckImportFailure('base_not_recognised')
    } catch {
      setSwudb(s => ({ ...s, loading: false, error: 'Deck not accessible' }))
      void onDeckImportFailure('deck_not_accessible')
    }
  }

  const currentKey = setup.base ? baseKey(setup.base) : null
  const isFavourite = currentKey !== null && favourites.some(f => f.key === currentKey)

  const handleFavouriteToggle = () => {
    const base = setup.base
    if (!base || !currentKey) return
    if (isFavourite) {
      removeFavourite(currentKey)
      void onFavouriteRemoved(currentKey, base.set)
    } else {
      addFavourite({
        key: currentKey,
        set: base.set,
        name: base.name,
        hp: base.hp,
        aspect: base.aspects[0] ?? 'None',
        cardNumber: parseInt(base.number, 10),
      })
      void onFavouriteAdded(currentKey, base.set)
    }
  }

  return (
    <>
      <SwuSetupScreenView
        error={setup.error}
        base={setup.base}
        art={art}
        useHyperspace={useHyperspace}
        isFavourite={isFavourite}
        onFavouriteToggle={handleFavouriteToggle}
        matchType={setup.matchType}
        onMatchTypeChange={setup.setMatchType}
        onStart={setup.handleSubmit}
        bases={setup.bases}
        favouriteBases={favouriteBases}
        recentBases={setup.recentBases}
        onChooseBase={setup.chooseBase}
        swudb={swudb}
        onSwudbChange={handleSwudbChange}
        onSwudbFocus={handleSwudbFocus}
        onSwudbLoad={handleSwudbLoad}
        onBack={onBack}
        onHelp={onHelp}
        onSettings={onSettings}
      />
      {showBanner && platform && (
        <InstallBanner platform={platform} onInstall={onInstall} onDismiss={onDismiss} />
      )}
    </>
  )
}

export default SwuSetupScreen
