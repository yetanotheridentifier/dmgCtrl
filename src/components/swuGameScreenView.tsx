import { Base } from '../hooks/useBases'
import AppScreenLayout from './layout/AppScreenLayout'

const CARD_NATURAL_WIDTH = 1560
const CARD_NATURAL_HEIGHT = 1120
const CARD_ASPECT_RATIO = CARD_NATURAL_WIDTH / CARD_NATURAL_HEIGHT

interface Props {
  base: Base
  onBack: () => void
  onHelp: () => void
  useHyperspace: boolean
  count: number
  imageLoaded: boolean
  imageError: boolean
  onIncrement: () => void
  onDecrement: () => void
  onImageLoad: () => void
  onImageError: () => void
}

function SwuGameScreenView({
  base,
  onBack,
  onHelp,
  useHyperspace,
  count,
  imageLoaded,
  imageError,
  onIncrement,
  onDecrement,
  onImageLoad,
  onImageError,
}: Props) {
  return (
    <AppScreenLayout>

      {/* Centring wrapper — card is the sole flex item, kept above star field */}
      <div style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        touchAction: 'none',
        zIndex: 1,
      }}>

      {/* Back button */}
      <button
        onClick={onBack}
        style={{
          position: 'absolute',
          top: 'calc(env(safe-area-inset-top) + 1vh)',
          left: 'calc(env(safe-area-inset-left) + 1vw)',
          width: '5vw',
          height: '5vw',
          minWidth: '36px',
          minHeight: '36px',
          background: 'transparent',
          border: '2px solid #6b7280',
          borderRadius: '8px',
          color: '#9ca3af',
          fontSize: 'clamp(0.8rem, 2vw, 1.2rem)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10,
          WebkitTapHighlightColor: 'transparent',
          boxShadow: '0 0 8px rgba(156, 163, 175, 0.2)',
        }}
      >
        &lt;
      </button>

      {/* Help button */}
      <button
        onClick={onHelp}
        style={{
          position: 'absolute',
          top: 'calc(env(safe-area-inset-top) + 1vh)',
          right: 'calc(env(safe-area-inset-right) + 1vw)',
          width: '5vw',
          height: '5vw',
          minWidth: '36px',
          minHeight: '36px',
          background: 'transparent',
          border: '2px solid #6b7280',
          borderRadius: '8px',
          color: '#9ca3af',
          fontSize: 'clamp(0.8rem, 2vw, 1.2rem)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10,
          WebkitTapHighlightColor: 'transparent',
          boxShadow: '0 0 8px rgba(156, 163, 175, 0.2)',
        }}
      >
        ?
      </button>

      {/* Card container */}
      <div style={{
        position: 'relative',
        aspectRatio: `${CARD_ASPECT_RATIO}`,
        width: `min(100vw, calc(100vh * ${CARD_ASPECT_RATIO}))`,
        maxWidth: '100%',
        maxHeight: '100%',
        flexShrink: 0,
        borderRadius: '3.5%',
        overflow: 'hidden',
        zIndex: 1,
        boxShadow: '0 0 20px rgba(79, 195, 247, 0.3)',
      }}>

        {/* Border overlay — sits above card art to cover edge fringe */}
        <div style={{
          position: 'absolute',
          inset: 0,
          zIndex: 10,
          border: '2px solid #4fc3f7',
          borderRadius: 'inherit',
          pointerEvents: 'none',
        }} />

        {/* Card image */}
        <img
          src={useHyperspace && base.hyperspaceArt ? base.hyperspaceArt : base.frontArt}
          alt={base.name}
          onLoad={onImageLoad}
          onError={onImageError}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            display: imageLoaded ? 'block' : 'none',
          }}
        />

        {imageError && (
          <>
            {/* Base name — top of card */}
            <div style={{
              position: 'absolute',
              top: '10%',
              left: '8%',
              right: '8%',
              zIndex: 2,
              display: 'flex',
              justifyContent: 'center',
            }}>
              <p style={{
                color: '#ffffff',
                fontWeight: '300',
                fontSize: 'clamp(1rem, 10vh, 1.8rem)',
                margin: 0,
                textAlign: 'center',
                letterSpacing: '0.05em',
              }}>
                {base.name}
              </p>
            </div>

            {/* Epic action — below counter, 25% of height */}
            {base.epicAction && (
              <div style={{
                position: 'absolute',
                top: '65%',
                left: '8%',
                right: '8%',
                height: '25%',
                zIndex: 2,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <p style={{
                  color: '#ffffff',
                  fontWeight: '300',
                  fontSize: 'clamp(0.6rem, 4vh, 1.1rem)',
                  margin: 0,
                  textAlign: 'center',
                  fontStyle: 'italic',
                  lineHeight: 1.4,
                }}>
                  {base.epicAction}
                </p>
              </div>
            )}

            {/* Subtitle/location — bottom */}
            <div style={{
              position: 'absolute',
              bottom: '5%',
              left: '8%',
              right: '8%',
              zIndex: 2,
              display: 'flex',
              justifyContent: 'center',
            }}>
              <p style={{
                color: '#a8a8b3',
                fontWeight: '300',
                fontSize: 'clamp(0.7rem, 2vh, 1.2rem)',
                margin: 0,
                textAlign: 'center',
                letterSpacing: '0.05em',
              }}>
                {base.subtitle}
              </p>
            </div>
          </>
        )}

        {/* Shading layer — full card coverage so gradient fades naturally at every edge */}
        {!imageError && (
          <div style={{
            position: 'absolute',
            inset: 0,
            zIndex: 1,
            background: 'radial-gradient(ellipse 44% 34% at 50% 53%, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.40) 35%, rgba(0,0,0,0.18) 65%, transparent 100%)',
            pointerEvents: 'none',
          }} />
        )}

        {/* Counter overlay — layout only, no background */}
        <div style={{
          position: 'absolute',
          top: '30%',
          bottom: '36%',
          left: '8%',
          right: '8%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'space-between',
          zIndex: 2,
        }}>

          {/* Remaining health */}
          <div style={{
            width: '100%',
            display: 'flex',
            justifyContent: 'flex-end',
          }}>
            <span style={{
              fontSize: '6vmin',
              fontWeight: '300',
              color: '#ffffff',
              letterSpacing: '0.05em',
              textShadow: '0 2px 4px rgba(0,0,0,1), 0 0 12px rgba(0,0,0,1), -1px -1px 0 rgba(0,0,0,1), 1px -1px 0 rgba(0,0,0,1), -1px 1px 0 rgba(0,0,0,1), 1px 1px 0 rgba(0,0,0,1)',
            }}>
              Remaining: {base.hp - count}
            </span>
          </div>

          {/* Buttons and counter row */}
          <div style={{
            width: '100%',
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>

            {/* Minus button */}
            <button
              onClick={onDecrement}
              style={{
                width: '21vmin',
                height: '21vmin',
                background: 'rgba(0,0,0,0.45)',
                color: '#4fc3f7',
                border: '2px solid #4fc3f7',
                borderRadius: '8px',
                fontSize: '6vmin',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                WebkitTapHighlightColor: 'transparent',
                boxShadow: '0 0 12px rgba(79, 195, 247, 0.3)',
              }}
            >
              −
            </button>

            {/* Counter */}
            <div style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '20vmin',
              fontWeight: '300',
              color: '#ffffff',
              textShadow: '0 0 20px rgba(79, 195, 247, 0.4), 0 0 8px rgba(0,0,0,1)',
            }}>
              {count}
            </div>

            {/* Plus button */}
            <button
              onClick={onIncrement}
              style={{
                width: '21vmin',
                height: '21vmin',
                background: 'rgba(0,0,0,0.45)',
                color: '#4fc3f7',
                border: '2px solid #4fc3f7',
                borderRadius: '8px',
                fontSize: '6vmin',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                WebkitTapHighlightColor: 'transparent',
                boxShadow: '0 0 12px rgba(79, 195, 247, 0.3)',
              }}
            >
              +
            </button>

          </div>

        </div>

      </div>

      </div>

    </AppScreenLayout>
  )
}

export default SwuGameScreenView