import { useRef, useLayoutEffect } from 'react'
import { Base } from '../hooks/useBases'
import { CARD_NATURAL_HEIGHT as CARD_H, CARD_NATURAL_WIDTH as CARD_W, cardBorder, cardGlow, rotatedArt } from './swuGameStyles'

interface ImagePreviewProps {
  overlay?: React.ReactNode
  base: Base
  src: string | null
  isHyperspace: boolean
  allFailed: boolean
  imageLoaded: boolean
  rotationDeg: number
  useHyperspace: boolean
  fill?: 'width' | 'height'
  // fill='height' only: centre the art in its space rather than pushing it to the right.
  centred?: boolean
  onLoad: () => void
  onError: () => void
}

const wrapperStyleWidth: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  aspectRatio: `${CARD_W} / ${CARD_H}`,
  position: 'relative',
  overflow: 'hidden',
  borderRadius: '12px',
  ...cardBorder(),
  boxShadow: cardGlow(),
}

// The message under the art, a fixed height so a frame sized from its space can leave room for it.
const MESSAGE_HEIGHT = 24

const imgStyleNormal: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
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

function ImagePreview({ base, src, isHyperspace, allFailed, imageLoaded, rotationDeg, useHyperspace, fill = 'width', centred = false, onLoad, onError, overlay }: ImagePreviewProps) {
  const imgRef = useRef<HTMLImageElement>(null)

  // Held in a ref, and updated before the effect below runs, so the check fires on a change of
  // `src` alone. Depending on `onLoad` directly would re-run it whenever the parent re-rendered
  // with a fresh inline callback, reporting the same image as loaded over and over.
  const onLoadRef = useRef(onLoad)
  useLayoutEffect(() => {
    onLoadRef.current = onLoad
  })

  // Browsers don't re-fire the load event for cached images, so React's onLoad
  // handler can miss it if the image was already in cache when this component mounts.
  // Check img.complete synchronously after commit and call onLoad ourselves if so.
  useLayoutEffect(() => {
    if (imgRef.current?.complete) onLoadRef.current()
  }, [src])

  if (allFailed || !src) {
    return (
      <div style={{
        ...cardBorder(),
        borderRadius: '12px',
        boxSizing: 'border-box',
        boxShadow: cardGlow(),
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
    ...wrapperStyleWidth,
    ...(imageLoaded ? {} : { opacity: 0, boxShadow: 'none', borderStyle: 'none' }),
    ...(message ? {
      borderBottomLeftRadius: 0,
      borderBottomRightRadius: 0,
    } : {}),
  }

  // The frame is always the card's shape, its width set and its height following. fill='height' sizes
  // that width from the space it has: as tall as fits under the message, no wider than the space. A
  // frame that took the space's shape instead cropped the art.
  const column = (
    <div style={{ display: 'flex', flexDirection: 'column', ...(fill === 'height' ? { width: `min(100cqw, (100cqh - ${message ? MESSAGE_HEIGHT : 0}px) * ${CARD_W / CARD_H})` } : {}) }}>
      <div style={imageWrapperStyle}>
        <img
          ref={imgRef}
          src={src}
          alt={base.name}
          onLoad={onLoad}
          onError={onError}
          style={rotationDeg ? rotatedArt(rotationDeg, 'cover') : imgStyleNormal}
        />
        {overlay}
      </div>
      {message && (
        <div style={{
          borderLeft: '2px solid var(--color-accent)',
          borderRight: '2px solid var(--color-accent)',
          borderBottom: '2px solid var(--color-accent)',
          borderRadius: '0 0 12px 12px',
          boxSizing: 'border-box',
          height: `${MESSAGE_HEIGHT}px`,
          padding: '0 1.5vw',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 12px rgba(var(--color-accent-rgb), 0.2)',
        }}>
          <p style={{ ...messageStyle, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{message}</p>
        </div>
      )}
    </div>
  )

  if (fill === 'width') return column
  return (
    <div style={{ width: '100%', height: '100%', containerType: 'size', display: 'flex', alignItems: 'center', justifyContent: centred ? 'center' : 'flex-end' }}>
      {column}
    </div>
  )
}

export default ImagePreview
