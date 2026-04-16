import { Base } from '../hooks/useBases'
import { useSwuGame } from '../hooks/useSwuGame'
import SwuGameScreenView from './swuGameScreenView'

interface Props {
  base: Base
  onBack: () => void
  onHelp: () => void
  useHyperspace: boolean
}

function SwuGameScreen({ base, onBack, onHelp, useHyperspace }: Props) {
  const { count, imageLoaded, imageError, increment, decrement, handleImageLoad, handleImageError } = useSwuGame()

  return (
    <SwuGameScreenView
      base={base}
      onBack={onBack}
      onHelp={onHelp}
      useHyperspace={useHyperspace}
      count={count}
      imageLoaded={imageLoaded}
      imageError={imageError}
      onIncrement={increment}
      onDecrement={decrement}
      onImageLoad={handleImageLoad}
      onImageError={handleImageError}
    />
  )
}

export default SwuGameScreen