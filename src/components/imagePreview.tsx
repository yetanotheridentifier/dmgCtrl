import { useState, useEffect } from 'react'
import { Base } from '../hooks/useBases'

interface ImagePreviewProps {
  base: Base
  useHyperspace: boolean
  onHyperspaceUnavailable: () => void
  onNormalUnavailable: () => void
}

function ImagePreview({
  base,
  useHyperspace,
  onHyperspaceUnavailable,
  onNormalUnavailable,
}: ImagePreviewProps) {
  const [normalHiResFailed, setNormalHiResFailed] = useState(false)
  const [normalFailed, setNormalFailed] = useState(false)
  const [hyperspaceFailed, setHyperspaceFailed] = useState(false)

  // Reset failure state when base changes
  useEffect(() => {
    setNormalHiResFailed(false)
    setNormalFailed(false)
    setHyperspaceFailed(false)
  }, [base.set, base.number])

  const effectiveHyperspaceSrc = base.hyperspaceArtHiRes ?? base.hyperspaceArt
  // Two-stage normal src: try hi-res CDN first, fall back to low-res within the
  // same "normal" tier before declaring normal art unavailable.
  const effectiveNormalSrc = (!normalHiResFailed && base.frontArt)
    ? base.frontArt
    : base.frontArtLowRes

  const handleNormalError = () => {
    if (!normalHiResFailed && base.frontArt && base.frontArtLowRes) {
      // Hi-res CDN failed but low-res is available — try it silently
      setNormalHiResFailed(true)
    } else {
      setNormalFailed(true)
      onNormalUnavailable()
    }
  }

  const showHyperspace = useHyperspace && !!effectiveHyperspaceSrc && !hyperspaceFailed
  const showNormal = !showHyperspace && !normalFailed

  if (normalFailed && hyperspaceFailed) {
    return (
      <p style={{
        color: '#ff6b6b',
        fontWeight: '300',
        fontSize: 'clamp(0.7rem, 2.5vw, 1rem)',
        margin: 0,
        fontStyle: 'italic',
      }}>
        No base images found
      </p>
    )
  }

  if (normalFailed && !useHyperspace) {
    // Normal failed, not trying hyperspace — check if hyperspace exists
    if (effectiveHyperspaceSrc) {
      return (
        <>
          <img
            src={effectiveHyperspaceSrc}
            alt={base.name}
            onError={() => {
              setHyperspaceFailed(true)
            }}
            style={{
              width: '100%',
              borderRadius: '12px',
              border: '2px solid #4fc3f7',
              boxShadow: '0 0 20px rgba(79, 195, 247, 0.3)',
            }}
          />
          <p style={{
            color: '#a8a8b3',
            fontWeight: '300',
            fontSize: 'clamp(0.7rem, 2.5vw, 1rem)',
            margin: 0,
            fontStyle: 'italic',
          }}>
            Only hyperspace image available
          </p>
        </>
      )
    }
    return (
      <p style={{
        color: '#ff6b6b',
        fontWeight: '300',
        fontSize: 'clamp(0.7rem, 2.5vw, 1rem)',
        margin: 0,
        fontStyle: 'italic',
      }}>
        No base images found
      </p>
    )
  }

  if (showHyperspace) {
    return (
      <img
        src={effectiveHyperspaceSrc!}
        alt={base.name}
        onError={() => {
          setHyperspaceFailed(true)
          onHyperspaceUnavailable()
        }}
        style={{
          width: '100%',
          borderRadius: '12px',
          border: '2px solid #4fc3f7',
          boxShadow: '0 0 20px rgba(79, 195, 247, 0.3)',
        }}
      />
    )
  }

  if (hyperspaceFailed && useHyperspace) {
    return (
      <>
        <img
          src={effectiveNormalSrc!}
          alt={base.name}
          onError={handleNormalError}
          style={{
            width: '100%',
            borderRadius: '12px',
            border: '2px solid #4fc3f7',
            boxShadow: '0 0 20px rgba(79, 195, 247, 0.3)',
          }}
        />
        <p style={{
          color: '#a8a8b3',
          fontWeight: '300',
          fontSize: 'clamp(0.7rem, 2.5vw, 1rem)',
          margin: 0,
          fontStyle: 'italic',
        }}>
          Hyperspace variant not found
        </p>
      </>
    )
  }

  if (showNormal) {
    return (
      <img
        src={effectiveNormalSrc!}
        alt={base.name}
        onError={handleNormalError}
        style={{
          width: '100%',
          borderRadius: '12px',
          border: '2px solid #4fc3f7',
          boxShadow: '0 0 20px rgba(79, 195, 247, 0.3)',
        }}
      />
    )
  }

  return null
}

export default ImagePreview