import { Base } from '../hooks/useBases'

const CARD_W = 1560
const CARD_H = 1120

interface ImagePreviewProps {
  base: Base
  src: string | null
  isHyperspace: boolean
  allFailed: boolean
  imageLoaded: boolean
  rotationDeg: number
  useHyperspace: boolean
  onLoad: () => void
  onError: () => void
}

const wrapperStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  aspectRatio: `${CARD_W} / ${CARD_H}`,
  position: 'relative',
  overflow: 'hidden',
  borderRadius: '12px',
  border: '2px solid var(--color-accent)',
  boxShadow: '0 0 20px rgba(var(--color-accent-rgb), 0.3)',
}

const imgStyleNormal: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
}

// A portrait image (CARD_H × CARD_W) rotated 90° must fill a landscape box (CARD_W × CARD_H).
// We size the layout box as (CARD_H/CARD_W × 100%) wide and (CARD_W/CARD_H × 100%) tall
// — those are container-height-relative and container-width-relative percentages —
// then center and rotate so the visual result is (100% × 100%) landscape fill.
const imgStyleRotated: React.CSSProperties = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  width: `${100 * CARD_H / CARD_W}%`,
  height: `${100 * CARD_W / CARD_H}%`,
  objectFit: 'cover',
  transform: 'translate(-50%, -50%) rotate(90deg)',
}

const messageStyle: React.CSSProperties = {
  color: 'var(--color-text-muted)',
  fontWeight: '300',
  fontSize: 'clamp(0.6rem, 1.8vw, 0.75rem)',
  margin: 0,
  textAlign: 'center',
  textShadow: '0 1px 4px rgba(0,0,0,0.9)',
}

const errorStyle: React.CSSProperties = {
  color: 'var(--color-error)',
  fontWeight: '300',
  fontSize: 'clamp(0.6rem, 1.8vw, 0.75rem)',
  margin: 0,
  textAlign: 'center',
  textShadow: '0 1px 4px rgba(0,0,0,0.9)',
}

function ImagePreview({ base, src, isHyperspace, allFailed, imageLoaded, rotationDeg, useHyperspace, onLoad, onError }: ImagePreviewProps) {
  if (allFailed || !src) {
    return (
      <div style={{
        border: '2px solid var(--color-accent)',
        borderRadius: '12px',
        boxSizing: 'border-box',
        boxShadow: '0 0 20px rgba(var(--color-accent-rgb), 0.3)',
        height: 'max(44px, 8vh)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <p style={errorStyle}>No base images found</p>
      </div>
    )
  }

  const message = imageLoaded && ((!useHyperspace && isHyperspace)
    ? 'Only hyperspace image available'
    : (useHyperspace && !isHyperspace)
      ? 'Hyperspace variant not found'
      : null)

  const imageWrapperStyle: React.CSSProperties = {
    ...wrapperStyle,
    visibility: imageLoaded ? 'visible' : 'hidden',
    ...(message ? {
      borderBottomLeftRadius: 0,
      borderBottomRightRadius: 0,
    } : {}),
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={imageWrapperStyle}>
        <img
          src={src}
          alt={base.name}
          onLoad={onLoad}
          onError={onError}
          style={rotationDeg ? imgStyleRotated : imgStyleNormal}
        />
      </div>
      {message && (
        <div style={{
          borderLeft: '2px solid var(--color-accent)',
          borderRight: '2px solid var(--color-accent)',
          borderBottom: '2px solid var(--color-accent)',
          borderRadius: '0 0 12px 12px',
          padding: '0.5vh 1.5vw 0.6vh',
          boxShadow: '0 4px 12px rgba(var(--color-accent-rgb), 0.2)',
        }}>
          <p style={messageStyle}>{message}</p>
        </div>
      )}
    </div>
  )
}

export default ImagePreview
