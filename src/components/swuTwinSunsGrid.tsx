import type { Base } from '../hooks/useBases'
import { TWIN_SUNS_SEATS } from '../hooks/useSwuSetup'
import { aspectIconSrc, baseAspect, baseMeta } from '../utils/baseAspect'
import { PlusIcon, StarIcon } from './icons'

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

function BaseCell({ b, label, labelColor, ariaLabel, border, compact, onClick }: {
  b: Base
  label: string
  labelColor: string
  ariaLabel: string
  border: string
  compact: boolean
  onClick: () => void
}) {
  const aspect = baseAspect(b)
  // The base's art behind its name, darkened at the head and foot so the label and name read over the
  // card's own text; the plain surface shows through when the art can't load.
  const art = b.frontArtLowRes ?? b.frontArt
  const background = `linear-gradient(rgba(0, 0, 0, 0.8), rgba(0, 0, 0, 0.35) 40%, rgba(0, 0, 0, 0.9)),${art ? `url("${art}") center / cover no-repeat, ` : ''}var(--color-surface)`
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      style={{ ...cellStyle, width: '100%', height: '100%', border, background, color: 'var(--color-text-primary)', padding: '10px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', textAlign: 'left' }}
    >
      <span style={labelStyle(labelColor)}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
        {aspect && <img src={aspectIconSrc(aspect)} alt="" style={{ width: '24px', height: '24px', flexShrink: 0 }} />}
        <span style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
          {/* Two lines at most: a portrait cell is too narrow for most names on one. */}
          <span style={{ fontSize: compact ? '16px' : '17px', lineHeight: 1.2, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{b.name}</span>
          <span style={{ fontSize: '12px', color: 'var(--color-text-body)' }}>{baseMeta(b)}</span>
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

// Twin Suns seating: a 2x2 grid with your base top left and each opponent's base in the cell where
// they sit. A base never moves once placed; an empty cell is Add base.
export default function SwuTwinSunsGrid({ base, isFavourite, onFavouriteToggle, seats, onOpenYours, onOpenSeat, compact }: Props) {
  const yours = base ? (
    // The star sits over the cell, beside its button rather than inside it: a button can't hold another.
    <div style={{ position: 'relative', minHeight: 0, minWidth: 0 }}>
      <BaseCell b={base} label="Your base" labelColor="var(--color-accent)" ariaLabel={`Your base: ${base.name}`} border="2px solid var(--color-accent)" compact={compact} onClick={onOpenYours} />
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
      {yours}
      {TWIN_SUNS_SEATS.map((where, i) => {
        const b = seats[i] ?? null
        return b
          ? <BaseCell key={where} b={b} label="Opponent" labelColor="var(--color-text-muted)" ariaLabel={`Opponent, ${where}: ${b.name}`} border="none" compact={compact} onClick={() => onOpenSeat(i)} />
          : <AddCell key={where} ariaLabel={`Add base, ${where}`} text="Add base" compact={compact} onClick={() => onOpenSeat(i)} />
      })}
    </div>
  )
}
