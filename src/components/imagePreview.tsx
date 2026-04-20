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
  aspectRatio: `${CARD_W} / ${CARD_H}`,
  position: 'relative',
  overflow: 'hidden',
  borderRadius: '12px',
  border: '2px solid #4fc3f7',
  boxShadow: '0 0 20px rgba(79, 195, 247, 0.3)',
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
  width: `${100 * CARD_H / CARD_W}%`,   // layout portrait-width = container height
  height: `${100 * CARD_W / CARD_H}%`,  // layout portrait-height = container width
  objectFit: 'cover',
  transform: 'translate(-50%, -50%) rotate(90deg)',
}

const messageStyle: React.CSSProperties = {
  color: '#a8a8b3',
  fontWeight: '300',
  fontSize: 'clamp(0.7rem, 2.5vw, 1rem)',
  margin: 0,
  fontStyle: 'italic',
}

const errorStyle: React.CSSProperties = {
  color: '#ff6b6b',
  fontWeight: '300',
  fontSize: 'clamp(0.7rem, 2.5vw, 1rem)',
  margin: 0,
  fontStyle: 'italic',
}

function ImagePreview({ base, src, isHyperspace, allFailed, imageLoaded, rotationDeg, useHyperspace, onLoad, onError }: ImagePreviewProps) {
  if (allFailed || !src) {
    return <p style={errorStyle}>No base images found</p>
  }

  const message = imageLoaded && ((!useHyperspace && isHyperspace)
    ? 'Only hyperspace image available'
    : (useHyperspace && !isHyperspace)
      ? 'Hyperspace variant not found'
      : null)

  return (
    <>
      <div style={{ ...wrapperStyle, visibility: imageLoaded ? 'visible' : 'hidden' }}>
        <img
          src={src}
          alt={base.name}
          onLoad={onLoad}
          onError={onError}
          style={rotationDeg ? imgStyleRotated : imgStyleNormal}
        />
      </div>
      {message && <p style={messageStyle}>{message}</p>}
    </>
  )
}

export default ImagePreview