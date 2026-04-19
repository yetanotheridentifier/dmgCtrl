import { Base } from '../hooks/useBases'

interface ImagePreviewProps {
  base: Base
  src: string | null
  isHyperspace: boolean
  allFailed: boolean
  useHyperspace: boolean
  onError: () => void
}

const imgStyle: React.CSSProperties = {
  width: '100%',
  borderRadius: '12px',
  border: '2px solid #4fc3f7',
  boxShadow: '0 0 20px rgba(79, 195, 247, 0.3)',
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

function ImagePreview({ base, src, isHyperspace, allFailed, useHyperspace, onError }: ImagePreviewProps) {
  if (allFailed || !src) {
    return <p style={errorStyle}>No base images found</p>
  }

  const message = (!useHyperspace && isHyperspace)
    ? 'Only hyperspace image available'
    : (useHyperspace && !isHyperspace)
      ? 'Hyperspace variant not found'
      : null

  return (
    <>
      <img src={src} alt={base.name} onError={onError} style={imgStyle} />
      {message && <p style={messageStyle}>{message}</p>}
    </>
  )
}

export default ImagePreview