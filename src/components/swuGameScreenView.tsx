import { Base } from '../hooks/useBases'
import AppScreenLayout from './layout/AppScreenLayout'

const CARD_NATURAL_WIDTH = 1560
const CARD_NATURAL_HEIGHT = 1120
const CARD_ASPECT_RATIO = CARD_NATURAL_WIDTH / CARD_NATURAL_HEIGHT

interface Props {
  base: Base
  onBack: () => void
  onHelp: () => void
  imageSrc: string
  imageRotationDeg: number
  count: number
  imageLoaded: boolean
  imageError: boolean
  onIncrement: () => void
  onDecrement: () => void
  onImageLoad: () => void
  onImageError: () => void
  epicActionUsed: boolean
  onEpicActionToggle: () => void
  showEpicAction: boolean
  forceEnabled: boolean
  forceActive: boolean
  onForceEnable: () => void
  onForceToggle: () => void
  showForce: boolean
}

function SwuGameScreenView({
  base,
  onBack,
  onHelp,
  imageSrc,
  imageRotationDeg,
  count,
  imageLoaded,
  imageError,
  onIncrement,
  onDecrement,
  onImageLoad,
  onImageError,
  epicActionUsed,
  onEpicActionToggle,
  showEpicAction,
  forceEnabled,
  forceActive,
  onForceEnable,
  onForceToggle,
  showForce,
}: Props) {
  const bothOverlaysActive = epicActionUsed && showEpicAction && forceActive && showForce

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
          top: 'calc(env(safe-area-inset-top) + 2vw)',
          left: 'calc(env(safe-area-inset-left) + 2vw)',
          width: '5vw',
          height: '5vw',
          minWidth: '36px',
          minHeight: '36px',
          background: 'transparent',
          border: '2px solid var(--color-ui-border)',
          borderRadius: '8px',
          color: 'var(--color-ui-border-muted)',
          fontSize: 'clamp(0.8rem, 2vw, 1.2rem)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10,
          WebkitTapHighlightColor: 'transparent',
          boxShadow: '0 0 8px rgba(var(--color-ui-border-muted-rgb), 0.2)',
        }}
      >
        &lt;
      </button>

      {/* Force button — slot 1 (9vw), always shown when showForce is true */}
      {/* Locked state: dimmed, first tap enables Force for this base */}
      {showForce && !forceEnabled && !forceActive && (
        <button
          data-testid="force-btn-locked"
          onClick={onForceEnable}
          style={{
            position: 'absolute',
            top: 'calc(env(safe-area-inset-top) + 9vw)',
            left: 'calc(env(safe-area-inset-left) + 2vw)',
            width: '5vw',
            height: '5vw',
            minWidth: '36px',
            minHeight: '36px',
            padding: 0,
            background: 'transparent',
            border: '2px solid var(--color-ui-border)',
            borderRadius: '8px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
            WebkitTapHighlightColor: 'transparent',
            opacity: 0.4,
          }}
        >
          <img
            src="/dmgCtrl/force-token.png"
            alt="Enable Force"
            style={{ width: '70%', height: '70%', objectFit: 'contain' }}
          />
        </button>
      )}

      {/* Active state: full blue, tap to gain the Force */}
      {showForce && forceEnabled && !forceActive && (
        <button
          data-testid="force-btn"
          onClick={onForceToggle}
          style={{
            position: 'absolute',
            top: 'calc(env(safe-area-inset-top) + 9vw)',
            left: 'calc(env(safe-area-inset-left) + 2vw)',
            width: '5vw',
            height: '5vw',
            minWidth: '36px',
            minHeight: '36px',
            padding: 0,
            background: 'rgba(29,78,216,0.35)',
            border: '2px solid rgba(147,197,253,0.6)',
            borderRadius: '8px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
            WebkitTapHighlightColor: 'transparent',
            boxShadow: '0 0 12px rgba(29,78,216,0.3)',
          }}
        >
          <img
            src="/dmgCtrl/force-token.png"
            alt="Gain the Force"
            style={{ width: '70%', height: '70%', objectFit: 'contain', opacity: 0.9 }}
          />
        </button>
      )}


      {/* Overlay-active state: greyed, interactive — tap to dismiss the Force token overlay */}
      {showForce && forceActive && (
        <button
          data-testid="force-btn-active"
          onClick={onForceToggle}
          style={{
            position: 'absolute',
            top: 'calc(env(safe-area-inset-top) + 9vw)',
            left: 'calc(env(safe-area-inset-left) + 2vw)',
            width: '5vw',
            height: '5vw',
            minWidth: '36px',
            minHeight: '36px',
            padding: 0,
            background: 'rgba(80,80,80,0.25)',
            border: '2px solid rgba(180,180,180,0.3)',
            borderRadius: '8px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <img
            src="/dmgCtrl/force-token.png"
            alt="Dismiss Force"
            style={{ width: '70%', height: '70%', objectFit: 'contain', opacity: 0.3 }}
          />
        </button>
      )}

      {/* Epic action button — slot 2 (16vw), only shown when base has a non-Force epic action */}
      {showEpicAction && (
        <button
          data-testid="epic-action-btn"
          onClick={onEpicActionToggle}
          style={{
            position: 'absolute',
            top: 'calc(env(safe-area-inset-top) + 16vw)',
            left: 'calc(env(safe-area-inset-left) + 2vw)',
            width: '5vw',
            height: '5vw',
            minWidth: '36px',
            minHeight: '36px',
            background: epicActionUsed ? 'transparent' : 'rgba(245,197,24,0.18)',
            border: epicActionUsed ? '2px solid var(--color-ui-border)' : '2px solid var(--color-epic)',
            borderRadius: '8px',
            color: epicActionUsed ? 'var(--color-ui-border)' : 'var(--color-epic)',
            fontSize: 'clamp(0.8rem, 2vw, 1.2rem)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
            WebkitTapHighlightColor: 'transparent',
            boxShadow: epicActionUsed ? 'none' : '0 0 12px rgba(245,197,24,0.5)',
          }}
        >
          ★
        </button>
      )}

      {/* Help button */}
      <button
        onClick={onHelp}
        style={{
          position: 'absolute',
          top: 'calc(env(safe-area-inset-top) + 2vw)',
          right: 'calc(env(safe-area-inset-right) + 2vw)',
          width: '5vw',
          height: '5vw',
          minWidth: '36px',
          minHeight: '36px',
          background: 'transparent',
          border: '2px solid var(--color-ui-border)',
          borderRadius: '8px',
          color: 'var(--color-ui-border-muted)',
          fontSize: 'clamp(0.8rem, 2vw, 1.2rem)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10,
          WebkitTapHighlightColor: 'transparent',
          boxShadow: '0 0 8px rgba(var(--color-ui-border-muted-rgb), 0.2)',
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
        boxShadow: '0 0 20px rgba(var(--color-accent-rgb), 0.3)',
      }}>

        {/* Border overlay — sits above card art to cover edge fringe */}
        <div style={{
          position: 'absolute',
          inset: 0,
          zIndex: 10,
          border: '2px solid var(--color-accent)',
          borderRadius: 'inherit',
          pointerEvents: 'none',
        }} />

        {/* Card image */}
        <img
          src={imageSrc}
          alt={base.name}
          onLoad={onImageLoad}
          onError={onImageError}
          style={imageRotationDeg ? {
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: `${100 * CARD_NATURAL_HEIGHT / CARD_NATURAL_WIDTH}%`,
            height: `${100 * CARD_NATURAL_WIDTH / CARD_NATURAL_HEIGHT}%`,
            objectFit: 'cover',
            transform: `translate(-50%, -50%) rotate(${imageRotationDeg}deg)`,
            display: imageLoaded ? 'block' : 'none',
          } : {
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
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
                color: 'var(--color-text-primary)',
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
                  color: 'var(--color-text-primary)',
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
                color: 'var(--color-text-muted)',
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
              color: 'var(--color-text-primary)',
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
                color: 'var(--color-accent)',
                border: '2px solid var(--color-accent)',
                borderRadius: '8px',
                fontSize: '6vmin',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                WebkitTapHighlightColor: 'transparent',
                boxShadow: '0 0 12px rgba(var(--color-accent-rgb), 0.3)',
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
              color: 'var(--color-text-primary)',
              textShadow: '0 0 20px rgba(var(--color-accent-rgb), 0.4), 0 0 8px rgba(0,0,0,1)',
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
                color: 'var(--color-accent)',
                border: '2px solid var(--color-accent)',
                borderRadius: '8px',
                fontSize: '6vmin',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                WebkitTapHighlightColor: 'transparent',
                boxShadow: '0 0 12px rgba(var(--color-accent-rgb), 0.3)',
              }}
            >
              +
            </button>

          </div>


        </div>

        {/* Epic action used overlay — full width when alone, left half when both overlays active */}
        {epicActionUsed && showEpicAction && (
          <div
            data-testid="epic-action-overlay"
            onClick={onEpicActionToggle}
            style={{
              position: 'absolute',
              top: '68%',
              left: '8%',
              right: bothOverlaysActive ? '51%' : '8%',
              height: '22%',
              zIndex: 8,
              background: 'rgba(245,197,24,0.55)',
              border: '2px solid var(--color-epic)',
              borderRadius: '8px',
              boxShadow: '0 0 18px rgba(245,197,24,0.55), 0 4px 14px rgba(0,0,0,0.6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <span style={{
              fontSize: bothOverlaysActive ? '10vmin' : '20vmin',
              color: '#ffffff',
              textShadow: '0 2px 10px rgba(0,0,0,0.9), 0 0 24px rgba(245,197,24,0.6)',
              pointerEvents: 'none',
            }}>✕</span>
          </div>
        )}

        {/* Force token — full width when alone, right half when both overlays active */}
        {forceActive && showForce && (
          <div
            data-testid="force-token"
            onClick={onForceToggle}
            style={{
              position: 'absolute',
              top: '68%',
              left: bothOverlaysActive ? '51%' : '8%',
              right: '8%',
              height: '22%',
              zIndex: 8,
              background: 'rgba(29,78,216,0.82)',
              border: '2px solid rgba(147,197,253,0.8)',
              borderRadius: '8px',
              boxShadow: '0 0 18px rgba(29,78,216,0.6), 0 4px 14px rgba(0,0,0,0.6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            {/* Translucent watermark symbol */}
            <img
              src="/dmgCtrl/force-token.png"
              alt=""
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: '80%',
                height: '80%',
                objectFit: 'contain',
                opacity: 0.15,
                pointerEvents: 'none',
              }}
            />
            <span style={{
              position: 'relative',
              fontSize: bothOverlaysActive ? 'clamp(0.6rem, 3vmin, 1rem)' : 'clamp(1rem, 5vmin, 2rem)',
              color: '#ffffff',
              fontWeight: '300',
              letterSpacing: '0.08em',
              textShadow: '0 1px 8px rgba(0,0,0,0.8), 0 0 16px rgba(0,0,0,0.6)',
              pointerEvents: 'none',
            }}>The Force is With You</span>
          </div>
        )}

      </div>

      </div>

    </AppScreenLayout>
  )
}

export default SwuGameScreenView