import { useState } from 'react'
import type { Base } from '../hooks/useBases'
import { filterBases, baseKey } from '../hooks/useSwuSetup'
import { useOrientation } from '../hooks/useOrientation'
import { CheckIcon, SearchIcon } from './icons'
import { Button, Sheet } from './shared/controls'
import { FIELD_STYLE } from '../styles/field'
import { FILTER_ASPECTS, aspectIconSrc, baseAspect, baseMeta } from '../utils/baseAspect'
import { sectionLabelStyle, mutedStyle } from '../styles/sectionLabel'

export interface SwudbImport {
  url: string
  error: string | null
  deckName: string | null
  // The deck's base, once loaded, found in the card data and allowed here.
  base: Base | null
  loading: boolean
}

export interface SwudbImportControls {
  state: SwudbImport
  onChange: (text: string) => void
  onFocus: () => void
  onLoad: () => void
}

interface Props {
  open: boolean
  onClose: () => void
  // Every base that may be chosen here: in a tournament, only those legal in its format.
  bases: Base[]
  favouriteBases: Base[]
  recentBases: Base[]
  // What the recent bases are: your own, or those used for other players.
  recentLabel?: string
  currentKey: string | null
  onChoose: (b: Base) => void
  // Without it the sheet is search only.
  swudb?: SwudbImportControls
}

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

// Mounted only while the sheet is open, so it opens afresh each time: no search, no filter, on the search view.
function BaseSheetBody({ bases, favouriteBases, recentBases, recentLabel = 'Recent', currentKey, onChoose, swudb }: Omit<Props, 'open' | 'onClose'>) {
  const { isPortrait } = useOrientation()
  const [query, setQuery] = useState('')
  const [aspect, setAspect] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const columns = isPortrait ? 2 : 3

  const tileGrid = (label: string, list: Base[]) => (
    <div role="group" aria-label={label} style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: '8px' }}>
      {list.map(b => <BaseTile key={baseKey(b)} base={b} selected={baseKey(b) === currentKey} onClick={() => onChoose(b)} />)}
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

  const pasteLink = swudb && <Button onClick={() => setImporting(true)} style={{ flexShrink: 0 }}>Paste SWUDB link</Button>

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
            style={{ ...FIELD_STYLE, width: '100%', paddingLeft: '42px' }}
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
          {recentOnly.length > 0 && section(recentLabel, recentOnly)}
          {favouriteBases.length === 0 && recentOnly.length === 0 && section('All bases', filterBases(bases, '', null))}
        </>
      )}
      {isPortrait && pasteLink && (
        <div style={{ marginTop: 'auto', paddingTop: '4px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ ...mutedStyle, flex: 1 }}>Building from a deck? Its base comes with the link.</div>
          {pasteLink}
        </div>
      )}
    </>
  )

  if (!importing || !swudb) return searchView

  const deck = swudb.state
  const canLoad = deck.url !== '' && deck.error === null && !deck.loading

  return (
    <>
      <label htmlFor="swudb-link" style={sectionLabelStyle()}>SWUDB deck link</label>
      <div style={{ display: 'flex', gap: '8px' }}>
        <input
          id="swudb-link"
          type="url"
          placeholder="https://swudb.com/deck/…"
          value={deck.url}
          onChange={e => swudb.onChange(e.target.value)}
          onFocus={swudb.onFocus}
          style={{ ...FIELD_STYLE, flex: 1, ...(deck.error ? { border: '2px solid var(--color-error)' } : {}) }}
        />
        <Button onClick={swudb.onLoad} disabled={!canLoad}>{deck.loading ? '...' : 'Load'}</Button>
      </div>
      {deck.error && <div role="alert" style={{ fontSize: '0.85rem', color: 'var(--color-error)' }}>{deck.error}</div>}
      {deck.deckName !== null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', borderRadius: '12px', background: 'var(--color-surface)' }}>
          {deck.base && <span style={{ width: '22px', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-success)' }}><CheckIcon /></span>}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontSize: '0.95rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{deck.deckName}</span>
            {deck.base && <span style={mutedStyle}>Deck found · its base:</span>}
          </div>
        </div>
      )}
      {deck.base && tileGrid('Deck base', [deck.base])}
      <div style={mutedStyle}>The deck must be unlisted or public on swudb.com.</div>
      <div style={{ marginTop: 'auto', paddingTop: '4px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px' }}>
        <Button onClick={() => setImporting(false)}>Search instead</Button>
        {deck.base && <Button variant="primary" onClick={() => onChoose(deck.base!)} style={{ minHeight: '52px', padding: '0 24px' }}>Use this base</Button>}
      </div>
    </>
  )
}

// The base sheet: favourites, recent bases and a search over every base, and an SWUDB deck link.
// The same sheet chooses their base in 2 players and opponents' bases in Twin Suns, under its own
// title, with an optional header action (Remove base).
export default function SwuBaseSheet({ open, onClose, title = 'Choose your base', action, ...body }: Props & { title?: string; action?: React.ReactNode }) {
  return (
    <Sheet open={open} title={title} onClose={onClose} wide action={action}>
      <BaseSheetBody {...body} />
    </Sheet>
  )
}
