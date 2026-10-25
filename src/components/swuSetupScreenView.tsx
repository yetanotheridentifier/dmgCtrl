import { useState } from 'react'
import { Base } from '../hooks/useBases'
import { filterBases, baseKey } from '../hooks/useSwuSetup'
import type { useBaseArt } from '../hooks/useBaseArt'
import AppScreenLayout from './layout/appScreenLayout'
import ImagePreview from './imagePreview'
import { useOrientation } from '../hooks/useOrientation'
import { BackIcon, CheckIcon, DotsIcon, PlusIcon, SearchIcon, StarIcon } from './icons'
import { Button, IconButton, SegmentedControl, Sheet } from './shared/controls'
import type { SetupMode } from '../utils/playMode'

export interface SwudbImport {
  url: string
  error: string | null
  deckName: string | null
  // The deck's base, once loaded and found in the card data.
  base: Base | null
  loading: boolean
}

interface Props {
  error: string | null
  base: Base | null
  art: ReturnType<typeof useBaseArt>
  useHyperspace: boolean
  isFavourite: boolean
  onFavouriteToggle: () => void
  matchType: SetupMode
  onMatchTypeChange: (v: SetupMode) => void
  onStart: () => void
  bases: Base[]
  favouriteBases: Base[]
  recentBases: Base[]
  onChooseBase: (b: Base) => void
  swudb: SwudbImport
  onSwudbChange: (text: string) => void
  onSwudbFocus: () => void
  onSwudbLoad: () => void
  onBack?: () => void
  onHelp: () => void
  onSettings?: () => void
}

type OpenSheet = null | 'more' | 'base'

const FILTER_ASPECTS = ['Vigilance', 'Command', 'Aggression', 'Cunning']
const ICON_ASPECTS = [...FILTER_ASPECTS, 'Heroism', 'Villainy']

const TOURNAMENT_NOTE = 'Best of 1 or 3 and the rounds are set on the tournament screen.'

const aspectIconSrc = (aspect: string) => `${import.meta.env.BASE_URL}${aspect.toLowerCase()}.png`

function baseAspect(base: Base): string | null {
  return ICON_ASPECTS.find(a => base.aspects.includes(a)) ?? null
}

const baseMeta = (base: Base) => `${base.set} · ${base.hp} HP`

const sectionLabelStyle = (color = 'var(--color-text-muted)'): React.CSSProperties => ({
  fontSize: '0.75rem',
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color,
})

const mutedStyle: React.CSSProperties = { fontSize: '0.8rem', lineHeight: 1.45, color: 'var(--color-text-muted)' }

function BaseTile({ base, selected, onClick }: { base: Base; selected: boolean; onClick: () => void }) {
  const aspect = baseAspect(base)
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      style={{
        minHeight: '52px',
        minWidth: 0,
        padding: '0 10px',
        border: 'none',
        borderRadius: '12px',
        background: selected ? 'var(--color-tonal)' : 'var(--color-surface-raised)',
        color: 'var(--color-text-primary)',
        fontFamily: 'inherit',
        textAlign: 'left',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {aspect && <img src={aspectIconSrc(aspect)} alt="" style={{ width: '24px', height: '24px', flexShrink: 0 }} />}
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <span style={{ fontSize: '0.875rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{base.name}</span>
        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{baseMeta(base)}</span>
      </span>
      {selected && <span style={{ width: '20px', height: '20px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-accent)' }}><CheckIcon /></span>}
    </button>
  )
}

export default function SwuSetupScreenView({
  error,
  base,
  art,
  useHyperspace,
  isFavourite,
  onFavouriteToggle,
  matchType,
  onMatchTypeChange,
  onStart,
  bases,
  favouriteBases,
  recentBases,
  onChooseBase,
  swudb,
  onSwudbChange,
  onSwudbFocus,
  onSwudbLoad,
  onBack,
  onHelp,
  onSettings,
}: Props) {
  const { isPortrait } = useOrientation()
  const [openSheet, setOpenSheet] = useState<OpenSheet>(null)
  const [query, setQuery] = useState('')
  const [aspect, setAspect] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  const close = () => setOpenSheet(null)
  // Sheet actions close the sheet first, so it isn't left open behind the next screen.
  const closeThen = (fn?: () => void) => () => { close(); fn?.() }

  // The base sheet opens afresh each time: no search, no filter, on the search view.
  const openBaseSheet = () => {
    setQuery('')
    setAspect(null)
    setImporting(false)
    setOpenSheet('base')
  }

  const choose = (b: Base) => { onChooseBase(b); close() }
  const currentKey = base ? baseKey(base) : null
  const columns = isPortrait ? 2 : 3

  const tileGrid = (label: string, list: Base[]) => (
    <div role="group" aria-label={label} style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: '8px' }}>
      {list.map(b => <BaseTile key={baseKey(b)} base={b} selected={baseKey(b) === currentKey} onClick={() => choose(b)} />)}
    </div>
  )

  const section = (label: string, list: Base[]) => (
    <>
      <div style={sectionLabelStyle()}>{label}</div>
      {tileGrid(label, list)}
    </>
  )

  const searching = query.trim() !== '' || aspect !== null
  const results = searching ? filterBases(bases, query, aspect) : []
  const resultsLabel = [
    `${results.length} ${results.length === 1 ? 'base' : 'bases'}`,
    ...(aspect ? [aspect] : []),
    ...(query.trim() ? [`“${query.trim()}”`] : []),
  ].join(' · ')

  const favouriteKeys = new Set(favouriteBases.map(baseKey))
  const recentOnly = recentBases.filter(b => !favouriteKeys.has(baseKey(b)))

  const pasteLink = <Button onClick={() => setImporting(true)} style={{ flexShrink: 0 }}>Paste SWUDB link</Button>

  const searchView = (
    <>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: isPortrait ? 'wrap' : 'nowrap' }}>
        <div style={{ position: 'relative', flex: '1 1 200px', minWidth: 0 }}>
          <span style={{ position: 'absolute', left: '14px', top: '13px', color: 'var(--color-text-muted)', display: 'flex' }}><SearchIcon /></span>
          <input
            type="search"
            aria-label="Search bases"
            placeholder="Search bases"
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{ width: '100%', height: '44px', boxSizing: 'border-box', border: 'none', borderRadius: '12px', background: 'var(--color-surface-raised)', color: 'var(--color-text-primary)', fontSize: '0.95rem', fontFamily: 'inherit', padding: '0 14px 0 42px', outline: 'none' }}
          />
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {FILTER_ASPECTS.map(a => (
            <button
              key={a}
              type="button"
              aria-label={a}
              aria-pressed={aspect === a}
              onClick={() => setAspect(aspect === a ? null : a)}
              style={{ width: '44px', height: '44px', border: 'none', borderRadius: '12px', background: aspect === a ? 'var(--color-tonal)' : 'var(--color-surface)', opacity: aspect === a ? 1 : 0.75, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
            >
              <img src={aspectIconSrc(a)} alt="" style={{ width: '26px', height: '26px' }} />
            </button>
          ))}
        </div>
        {/* In landscape the link sits up here, so favourites and six recent bases fit at 390px high. */}
        {!isPortrait && pasteLink}
      </div>
      {searching ? (
        <>
          <div style={sectionLabelStyle()}>{resultsLabel}</div>
          {tileGrid('Results', results)}
          {aspect && <div style={mutedStyle}>Tap an aspect again to clear it.</div>}
        </>
      ) : (
        <>
          {favouriteBases.length > 0 && section('Favourites', favouriteBases)}
          {recentOnly.length > 0 && section('Recent', recentOnly)}
          {favouriteBases.length === 0 && recentOnly.length === 0 && section('All bases', filterBases(bases, '', null))}
        </>
      )}
      {isPortrait && (
        <div style={{ marginTop: 'auto', paddingTop: '4px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ ...mutedStyle, flex: 1 }}>Building from a deck? Its base comes with the link.</div>
          {pasteLink}
        </div>
      )}
    </>
  )

  const canLoad = swudb.url !== '' && swudb.error === null && !swudb.loading

  const importView = (
    <>
      <label htmlFor="swudb-link" style={sectionLabelStyle()}>SWUDB deck link</label>
      <div style={{ display: 'flex', gap: '8px' }}>
        <input
          id="swudb-link"
          type="url"
          placeholder="https://swudb.com/deck/…"
          value={swudb.url}
          onChange={e => onSwudbChange(e.target.value)}
          onFocus={onSwudbFocus}
          style={{ flex: 1, minWidth: 0, height: '44px', boxSizing: 'border-box', border: swudb.error ? '2px solid var(--color-error)' : 'none', borderRadius: '12px', background: 'var(--color-surface-raised)', color: 'var(--color-text-primary)', fontSize: '0.95rem', fontFamily: 'inherit', padding: '0 14px', outline: 'none' }}
        />
        <Button onClick={onSwudbLoad} disabled={!canLoad}>{swudb.loading ? '...' : 'Load'}</Button>
      </div>
      {swudb.error && <div role="alert" style={{ fontSize: '0.85rem', color: 'var(--color-error)' }}>{swudb.error}</div>}
      {swudb.deckName !== null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', borderRadius: '12px', background: 'var(--color-surface)' }}>
          {swudb.base && <span style={{ width: '22px', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-success)' }}><CheckIcon /></span>}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontSize: '0.95rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{swudb.deckName}</span>
            {swudb.base && <span style={mutedStyle}>Deck found · its base:</span>}
          </div>
        </div>
      )}
      {swudb.base && tileGrid('Deck base', [swudb.base])}
      <div style={mutedStyle}>The deck must be unlisted or public on swudb.com.</div>
      <div style={{ marginTop: 'auto', paddingTop: '4px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px' }}>
        <Button onClick={() => setImporting(false)}>Search instead</Button>
        {swudb.base && <Button variant="primary" onClick={() => choose(swudb.base!)} style={{ minHeight: '52px', padding: '0 24px' }}>Use this base</Button>}
      </div>
    </>
  )

  const topBar = (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
      {onBack && <IconButton label="Back" onClick={onBack}><BackIcon /></IconButton>}
      <img src={`${import.meta.env.BASE_URL}dmgCtrl-icon-transparent-192.png`} alt="" style={{ width: '30px', height: '30px', flexShrink: 0 }} />
      <h1 style={{
        flex: 1,
        minWidth: 0,
        margin: 0,
        fontSize: isPortrait ? '17px' : '22px',
        fontWeight: 300,
        letterSpacing: isPortrait ? '0.06em' : '0.12em',
        whiteSpace: 'nowrap',
        color: 'var(--color-text-primary)',
      }}>
        Star Wars: Unlimited
      </h1>
      <IconButton label="More" onClick={() => setOpenSheet('more')}><DotsIcon /></IconButton>
    </div>
  )

  const aspect0 = base ? baseAspect(base) : null
  // Under the art rather than over it: the art is the whole card, with its own text.
  const baseInfo = base && (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
      {aspect0 && <img src={aspectIconSrc(aspect0)} alt="" style={{ width: '28px', height: '28px', flexShrink: 0 }} />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
        <span style={{ fontSize: '1.1rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{base.name}</span>
        <span style={{ fontSize: '0.8rem', color: 'var(--color-text-body)' }}>{baseMeta(base)}</span>
      </div>
    </div>
  )

  const favouriteToggle = (
    <button
      type="button"
      aria-pressed={isFavourite}
      onClick={onFavouriteToggle}
      style={{
        height: '32px',
        padding: '0 10px',
        border: 'none',
        borderRadius: '10px',
        background: 'var(--color-tonal)',
        color: isFavourite ? 'var(--color-epic)' : 'var(--color-tonal-text)',
        fontFamily: 'inherit',
        fontSize: '0.8rem',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <StarIcon filled={isFavourite} />Favourite
    </button>
  )

  const baseCard = (
    <div data-testid="base-card" style={{ flex: isPortrait && !base ? 1 : undefined, minHeight: 0, minWidth: 0, background: 'var(--color-surface)', borderRadius: '16px', padding: '12px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', minHeight: '32px' }}>
        <div style={sectionLabelStyle('var(--color-accent)')}>Your base</div>
        {base && favouriteToggle}
      </div>
      {base ? (
        <>
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <ImagePreview
              base={base}
              src={art.src}
              isHyperspace={art.isHyperspace}
              allFailed={art.allFailed}
              imageLoaded={art.imageLoaded}
              rotationDeg={art.rotationDeg}
              useHyperspace={useHyperspace}
              fill={isPortrait ? 'width' : 'height'}
              centred
              onLoad={art.onLoad}
              onError={art.onError}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {baseInfo}
            <Button onClick={openBaseSheet} style={{ flexShrink: 0 }}>Change base</Button>
          </div>
        </>
      ) : (
        <>
          {error && <div role="alert" style={{ fontSize: '0.85rem', color: 'var(--color-error)' }}>{error}</div>}
          <button
            type="button"
            onClick={openBaseSheet}
            style={{ flex: 1, minHeight: '120px', border: 'none', borderRadius: '12px', background: 'var(--color-tonal)', color: 'var(--color-tonal-text)', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
          >
            <span style={{ color: 'var(--color-accent)', display: 'flex' }}><PlusIcon /></span>
            <span style={{ fontSize: '1.1rem', fontWeight: 500 }}>Choose your base</span>
            <span style={{ fontSize: '0.8rem', color: 'var(--color-tonal-text)', opacity: 0.8 }}>Search by name, or paste an SWUDB deck link</span>
          </button>
        </>
      )}
    </div>
  )

  const matchSection = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={sectionLabelStyle()}>Match</div>
      <SegmentedControl
        label="Match"
        options={[{ value: 'casual', label: 'Casual' }, { value: 'tournament', label: 'Tournament' }]}
        value={matchType}
        onChange={onMatchTypeChange}
      />
      {matchType === 'tournament' && <div style={mutedStyle}>{TOURNAMENT_NOTE}</div>}
    </div>
  )

  const primary = (
    <Button variant="primary" onClick={onStart} disabled={!base} style={{ minHeight: '52px', flexShrink: 0 }}>
      {matchType === 'tournament' ? 'Go to tournament' : 'Go to game'}
    </Button>
  )

  const sheets = (
    <>
      <Sheet open={openSheet === 'more'} title="More" onClose={close}>
        <Button onClick={closeThen(onHelp)}>Help</Button>
        {onSettings && <Button onClick={closeThen(onSettings)}>Settings</Button>}
      </Sheet>
      <Sheet open={openSheet === 'base'} title="Choose your base" onClose={close} wide>
        {importing ? importView : searchView}
      </Sheet>
    </>
  )

  if (isPortrait) {
    return (
      <AppScreenLayout>
        <div data-testid="swu-setup" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '14px', padding: '16px 16px 24px', overflowY: 'auto', color: 'var(--color-text-primary)' }}>
          {topBar}
          {baseCard}
          {base && <div style={{ flex: 1 }} />}
          {matchSection}
          {primary}
        </div>
        {sheets}
      </AppScreenLayout>
    )
  }

  return (
    <AppScreenLayout>
      <div data-testid="swu-setup" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '14px', padding: '16px', overflow: 'hidden', color: 'var(--color-text-primary)' }}>
        {topBar}
        <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 400px) minmax(0, 1fr)', gap: '16px' }}>
          {baseCard}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', minHeight: 0 }}>
            {matchSection}
            <div style={{ flex: 1 }} />
            {primary}
          </div>
        </div>
      </div>
      {sheets}
    </AppScreenLayout>
  )
}
