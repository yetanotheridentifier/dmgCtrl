import { Fragment } from 'react'
import type { Base } from '../hooks/useBases'
import { TWIN_SUNS_SEATS } from '../hooks/useSwuSetup'
import { aspectIconSrc, baseAspect, baseMeta } from '../utils/baseAspect'
import { PlusIcon, StarIcon } from './icons'
import { useBaseArt } from '../hooks/useBaseArt'
import { useUserSettings } from '../hooks/useUserSettings'
import { CARD_ASPECT_RATIO, cardBorder, cardGlow, rotatedArt } from './swuGameStyles'
import { baseMetaStyle, baseNameStyle } from '../styles/sectionLabel'

interface Props {
  base: Base | null
  isFavourite: boolean
  onFavouriteToggle: () => void
  // Opponents' bases by seat, TWIN_SUNS_SEATS order, null for an empty seat.
  seats: (Base | null)[]
  onOpenYours: () => void
  onOpenSeat: (seat: number) => void
  compact: boolean
}

const cellStyle: React.CSSProperties = {
  minHeight: 0,
  minWidth: 0,
  boxSizing: 'border-box',
  borderRadius: '14px',
  fontFamily: 'inherit',
  cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent',
}

const labelStyle = (color: string): React.CSSProperties => ({ fontSize: '11px', letterSpacing: '0.14em', textTransform: 'uppercase', color })

function BaseCell({ b, label, labelColor, ariaLabel, border, onClick }: {
  b: Base
  label: string
  labelColor: string
  ariaLabel: string
  border: string
  onClick: () => void
}) {
  const aspect = baseAspect(b)
  // The whole card, fitted between the label and the name (cropped to the cell, its own title bar and
  // rules text would show behind them), in a frame of its own shape as large as that space allows. The
  // art is the one the other modes show: hyperspace when that setting is on, falling back on failure.
  const { useHyperspace } = useUserSettings()
  const art = useBaseArt(b, useHyperspace)
  const fitted: React.CSSProperties = art.rotationDeg
    ? rotatedArt(art.rotationDeg, 'contain')
    : { display: 'block', width: '100%', height: '100%', objectFit: 'contain' }
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      style={{ ...cellStyle, width: '100%', height: '100%', border, background: 'var(--color-surface)', color: 'var(--color-text-primary)', padding: '10px', display: 'flex', flexDirection: 'column', gap: '6px', textAlign: 'left' }}
    >
      <span style={{ ...labelStyle(labelColor), lineHeight: '20px' }}>{label}</span>
      <span style={{ flex: 1, minHeight: 0, containerType: 'size', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {art.src && (
          <span
            data-testid="card-frame"
            style={{ position: 'relative', display: 'block', width: `min(100cqw, 100cqh * ${CARD_ASPECT_RATIO})`, aspectRatio: `${CARD_ASPECT_RATIO}`, boxSizing: 'border-box', overflow: 'hidden', borderRadius: '8px', ...cardBorder(), boxShadow: cardGlow() }}
          >
            <img data-card src={art.src} alt="" onLoad={art.onLoad} onError={art.onError} style={fitted} />
          </span>
        )}
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
        {aspect && <img src={aspectIconSrc(aspect)} alt="" style={{ width: '24px', height: '24px', flexShrink: 0 }} />}
        <span style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
          <span style={baseNameStyle}>{b.name}</span>
          <span style={baseMetaStyle}>{baseMeta(b)}</span>
        </span>
      </span>
    </button>
  )
}

function AddCell({ ariaLabel, text, compact, onClick }: { ariaLabel: string; text: string; compact: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      style={{ ...cellStyle, border: '2px dashed var(--color-accent)', background: 'rgba(var(--color-accent-rgb), 0.06)', color: 'var(--color-text-primary)', fontSize: compact ? '14px' : '15px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
    >
      <span style={{ color: 'var(--color-accent)', display: 'flex' }}><PlusIcon /></span>
      {text}
    </button>
  )
}

// The grid's cells in reading order, each the index of its seat in TWIN_SUNS_SEATS, or yours.
const READING_ORDER = (['top left', 'top right', 'bottom left', 'bottom right'] as const)
  .map(where => (TWIN_SUNS_SEATS as readonly string[]).indexOf(where))

// Twin Suns seating: a 2x2 grid, the table seen from where you hold the phone, with your base bottom
// right and each opponent's base in the cell where they sit. A base never moves once placed; an empty
// cell is Add base.
export default function SwuTwinSunsGrid({ base, isFavourite, onFavouriteToggle, seats, onOpenYours, onOpenSeat, compact }: Props) {
  const yours = base ? (
    // The star sits over the cell, beside its button rather than inside it: a button can't hold another.
    <div style={{ position: 'relative', minHeight: 0, minWidth: 0 }}>
      <BaseCell b={base} label="Your base" labelColor="var(--color-accent)" ariaLabel={`Your base: ${base.name}`} border="2px solid var(--color-accent)" onClick={onOpenYours} />
      <button
        type="button"
        aria-label="Favourite"
        aria-pressed={isFavourite}
        onClick={onFavouriteToggle}
        style={{ position: 'absolute', top: '2px', right: '2px', width: '40px', height: '40px', border: 'none', background: 'transparent', color: isFavourite ? 'var(--color-epic)' : 'var(--color-text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
      >
        <StarIcon filled={isFavourite} />
      </button>
    </div>
  ) : <AddCell ariaLabel="Choose your base" text="Choose your base" compact={compact} onClick={onOpenYours} />

  return (
    <div role="group" aria-label="Bases" style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: compact ? '8px' : '10px' }}>
      {READING_ORDER.map(i => {
        if (i < 0) return <Fragment key="yours">{yours}</Fragment>
        const where = TWIN_SUNS_SEATS[i]
        const b = seats[i] ?? null
        return b
          ? <BaseCell key={where} b={b} label="Opponent" labelColor="var(--color-text-muted)" ariaLabel={`Opponent, ${where}: ${b.name}`} border="none" onClick={() => onOpenSeat(i)} />
          : <AddCell key={where} ariaLabel={`Add base, ${where}`} text="Add base" compact={compact} onClick={() => onOpenSeat(i)} />
      })}
    </div>
  )
}
