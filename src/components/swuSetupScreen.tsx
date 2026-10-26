import { useState, useEffect, useMemo } from 'react'
import { Base } from '../hooks/useBases'
import { useSwuSetup, baseKey } from '../hooks/useSwuSetup'
import { useBaseArt, getFirstGameImageUrl } from '../hooks/useBaseArt'
import SwuSetupScreenView from './swuSetupScreenView'
import type { SwudbImport } from './swuSetupScreenView'
import { useUserSettings } from '../hooks/useUserSettings'
import { useFavourites } from '../hooks/useFavourites'
import { normaliseSwudbUrl, isValidSwudbUrl, fetchSwudbDeck } from '../utils/swudbUrl'
import { onFavouriteAdded, onFavouriteRemoved, onDeckImportSuccess, onDeckImportFailure } from '../services/analytics'
import { SetupMode } from '../utils/playMode'
import { formatValidationError, isBaseValidForFormat } from '../utils/formatFilter'
import type { TournamentSettings } from '../hooks/useSwuSetup'

interface Props {
  // Casual: go to the game. Tournament: go back to the one under way. Their base comes only in 2 players.
  onConfirm: (base: Base, mode: SetupMode, theirBase?: Base) => void
  onStartTournament?: (base: Base, settings: TournamentSettings, theirBase?: Base) => void
  tournamentInProgress?: boolean
  onHelp: () => void
  onBack?: () => void
  onSettings?: () => void
}

const NO_DECK: SwudbImport = { url: '', error: null, deckName: null, base: null, loading: false }

function SwuSetupScreen({ onConfirm, onStartTournament, tournamentInProgress = false, onHelp, onBack, onSettings }: Props) {
  const { useHyperspace } = useUserSettings()
  const { favourites, addFavourite, removeFavourite } = useFavourites()
  const setup = useSwuSetup(onConfirm, onStartTournament)
  const art = useBaseArt(setup.base, useHyperspace)
  const theirArt = useBaseArt(setup.mode === '2p' ? setup.theirBase : null, useHyperspace)

  // Warm the cache with the art the game screen will show first.
  useEffect(() => {
    const url = getFirstGameImageUrl(setup.base, useHyperspace)
    if (!url) return
    const img = new Image()
    img.src = url
  }, [setup.base, useHyperspace])

  // In a tournament the base sheet offers only the bases legal in its format.
  const inTournament = setup.matchType === 'tournament'
  const allowed = useMemo(
    () => (b: Base) => !inTournament || isBaseValidForFormat(setup.format, b),
    [inTournament, setup.format],
  )

  // Favourites are stored as records; a favourite no longer in the card data is left out.
  const favouriteBases = useMemo(() => {
    const byKey = new Map(setup.bases.map(b => [baseKey(b), b]))
    return favourites.map(f => byKey.get(f.key)).filter((b): b is Base => b !== undefined).filter(allowed)
  }, [favourites, setup.bases, allowed])
  const sheetBases = useMemo(() => setup.bases.filter(allowed), [setup.bases, allowed])
  const recentBases = useMemo(() => setup.recentBases.filter(allowed), [setup.recentBases, allowed])

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

  // A deck's base that the tournament's format does not allow is reported rather than offered.
  const swudbShown: SwudbImport = swudb.base && !allowed(swudb.base)
    ? { ...swudb, base: null, error: formatValidationError(setup.format, swudb.base) }
    : swudb

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
      <SwuSetupScreenView
        error={setup.error}
        base={setup.base}
        art={art}
        useHyperspace={useHyperspace}
        isFavourite={isFavourite}
        onFavouriteToggle={handleFavouriteToggle}
        matchType={setup.matchType}
        onMatchTypeChange={setup.setMatchType}
        tournamentInProgress={tournamentInProgress}
        format={setup.format}
        onFormatChange={setup.setFormat}
        onStart={setup.handleSubmit}
        onStartTournament={setup.handleStartTournament}
        sheetBases={sheetBases}
        favouriteBases={favouriteBases}
        recentBases={recentBases}
        onChooseBase={setup.chooseBase}
        mode={setup.mode}
        onModeChange={setup.setMode}
        theirBase={setup.theirBase}
        theirArt={theirArt}
        theirBaseFromLastGame={setup.theirBaseFromLastGame}
        onChooseTheirBase={setup.chooseTheirBase}
        ready={setup.ready}
        swudb={{ state: swudbShown, onChange: handleSwudbChange, onFocus: handleSwudbFocus, onLoad: handleSwudbLoad }}
        onBack={onBack}
        onHelp={onHelp}
        onSettings={onSettings}
      />
  )
}

export default SwuSetupScreen
