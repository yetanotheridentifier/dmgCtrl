import { Base } from '../hooks/useBases'
import type { GameLogEntry } from '../hooks/useGameLog'
import type { PlayMode } from '../utils/playMode'
import { useDragScrubber } from '../hooks/useDragScrubber'
import AppScreenLayout from './layout/AppScreenLayout'
import GameLogOverlay from './GameLogOverlay'
import { BackIcon, CogIcon, HelpIcon, LogIcon } from './icons'

const CARD_NATURAL_WIDTH = 1560
const CARD_NATURAL_HEIGHT = 1120
const CARD_ASPECT_RATIO = CARD_NATURAL_WIDTH / CARD_NATURAL_HEIGHT

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

interface Props {
  base: Base
  onBack: () => void
  onHelp: () => void
  onSettings?: () => void
  imageSrc: string
  imageRotationDeg: number
  count: number
  imageLoaded: boolean
  imageError: boolean
  onIncrement: (n: number) => void
  onDecrement: (n: number) => void
  onImageLoad: () => void
  onImageError: () => void
  epicActionUsed: boolean
  epicActionOverlayVisible: boolean
  onEpicActionOverlayDismiss?: () => void
  onEpicActionMark: () => void
  showEpicAction: boolean
  forceEnabled: boolean
  forceActive: boolean
  onForceEnable: () => void
  onForceGain: () => void
  onForceDismiss: () => void
  showForce: boolean
  isMysticMonastery: boolean
  mysticUsesRemaining: number
  onMysticAction: () => void
  enableLongPress: boolean
  round: number
  onRoundIncrement: () => void
  onStartGame: () => void
  logEntries: GameLogEntry[]
  onUndo: () => void
  enableActionLog: boolean
  showLog: boolean
  onLogToggle: () => void
  playMode: PlayMode
  playerScore: number
  opponentScore: number
  matchOver: boolean
  matchDrawn: boolean
  pendingConfirm: 'win' | 'loss' | 'draw' | null
  onWinPending: () => void
  onLossPending: () => void
  onDrawPending: () => void
  onConfirmResult: () => void
  onCancelConfirm: () => void
  lastGameResult: 'won' | 'lost' | 'drawn' | null
  timerRemaining: number
  timerInteractive: boolean
}

function SwuGameScreenView({
  base,
  onBack,
  onHelp,
  onSettings,
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
  epicActionOverlayVisible,
  onEpicActionOverlayDismiss,
  onEpicActionMark,
  showEpicAction,
  forceEnabled,
  forceActive,
  onForceEnable,
  onForceGain,
  onForceDismiss,
  showForce,
  isMysticMonastery,
  mysticUsesRemaining,
  onMysticAction,
  enableLongPress,
  round,
  onRoundIncrement,
  onStartGame,
  logEntries,
  onUndo,
  enableActionLog,
  showLog,
  onLogToggle,
  playMode,
  playerScore,
  opponentScore,
  matchOver,
  matchDrawn,
  pendingConfirm,
  onWinPending,
  onLossPending,
  onDrawPending,
  onConfirmResult,
  onCancelConfirm,
  lastGameResult,
  timerRemaining,
  timerInteractive,
}: Props) {
  const bothOverlaysActive = epicActionOverlayVisible && showEpicAction && forceActive && showForce
  const gameStarted = round > 0

  const { dragIndicator, handleClick, handlePointerDown, handlePointerMove, handlePointerUp, handlePointerCancel } =
    useDragScrubber(onIncrement, onDecrement, base.hp - count, count, enableLongPress && gameStarted)

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
        aria-label="Back"
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
        <BackIcon />
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
            src={`${import.meta.env.BASE_URL}dmgCtrl-force-token.png`}
            alt="Enable Force"
            style={{ width: '70%', height: '70%', objectFit: 'contain' }}
          />
        </button>
      )}

      {/* Active state: full blue, tap to gain the Force */}
      {showForce && forceEnabled && !forceActive && (
        <button
          data-testid="force-btn"
          onClick={onForceGain}
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
          <span style={{
            position: 'absolute',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            fontSize: 'clamp(0.35rem, 0.75vw, 0.5rem)',
            lineHeight: 1.2,
            color: 'rgba(147,197,253,0.7)',
            letterSpacing: '0.04em',
            pointerEvents: 'none',
          }}>
            <span>Gain</span>
            <span>Force</span>
          </span>
          <img
            src={`${import.meta.env.BASE_URL}dmgCtrl-force-token.png`}
            alt="Gain the Force"
            onError={(e) => { e.currentTarget.style.display = 'none' }}
            style={{ width: '70%', height: '70%', objectFit: 'contain', opacity: 0.9, position: 'relative', zIndex: 1 }}
          />
        </button>
      )}


      {/* Overlay-active state: greyed, interactive — tap to dismiss the Force token overlay */}
      {showForce && forceActive && (
        <button
          data-testid="force-btn-active"
          onClick={onForceDismiss}
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
            src={`${import.meta.env.BASE_URL}dmgCtrl-force-token.png`}
            alt="Dismiss Force"
            style={{ width: '70%', height: '70%', objectFit: 'contain', opacity: 0.3 }}
          />
        </button>
      )}

      {/* Epic action button — slot 1 (9vw) when Force hidden, slot 2 (16vw) otherwise */}
      {showEpicAction && (
        <button
          data-testid="epic-action-btn"
          aria-label="Epic action"
          disabled={epicActionUsed}
          onClick={onEpicActionMark}
          style={{
            position: 'absolute',
            top: `calc(env(safe-area-inset-top) + ${showForce ? 16 : 9}vw)`,
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
          <img src={`${import.meta.env.BASE_URL}dmgctrl-icon-192-white.svg`} alt="" style={{ width: '70%', height: '70%', objectFit: 'contain', opacity: epicActionUsed ? 0.4 : 0.9 }} />
        </button>
      )}

      {/* Mystic Monastery action button — slot 2 (16vw), only shown when showForce is true */}
      {showForce && isMysticMonastery && (() => {
        const disabled = forceActive || mysticUsesRemaining === 0
        return (
          <button
            data-testid="mystic-action-btn"
            onClick={disabled ? undefined : onMysticAction}
            disabled={disabled}
            style={{
              position: 'absolute',
              top: 'calc(env(safe-area-inset-top) + 16vw)',
              left: 'calc(env(safe-area-inset-left) + 2vw)',
              width: '5vw',
              height: '5vw',
              minWidth: '36px',
              minHeight: '36px',
              padding: 0,
              background: disabled ? 'rgba(80,80,80,0.25)' : 'rgba(29,78,216,0.55)',
              border: disabled ? '2px solid rgba(180,180,180,0.3)' : '2px solid rgba(147,197,253,0.8)',
              borderRadius: '8px',
              color: disabled ? 'rgba(147,197,253,0.3)' : 'rgba(147,197,253,1)',
              fontSize: 'clamp(0.8rem, 2vw, 1.2rem)',
              fontWeight: '600',
              cursor: disabled ? 'default' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10,
              WebkitTapHighlightColor: 'transparent',
              boxShadow: disabled ? 'none' : '0 0 12px rgba(29,78,216,0.4)',
            }}
          >
            <img
              src={`${import.meta.env.BASE_URL}dmgCtrl-force-token.png`}
              alt=""
              style={{
                position: 'absolute',
                width: '70%',
                height: '70%',
                objectFit: 'contain',
                opacity: disabled ? 0.1 : 0.2,
              }}
            />
            <span style={{ position: 'relative' }}>{mysticUsesRemaining}</span>
          </button>
        )
      })()}

      {/* Help button */}
      <button
        onClick={onHelp}
        aria-label="Help"
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
        <HelpIcon />
      </button>

      {/* Settings button — below help, top-right */}
      {onSettings && (
        <button
          onClick={onSettings}
          aria-label="⚙"
          style={{
            position: 'absolute',
            top: 'calc(env(safe-area-inset-top) + 9vw)',
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
          <CogIcon />
        </button>
      )}

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
          data-testid="game-card-image"
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
          justifyContent: gameStarted ? 'space-between' : 'center',
          zIndex: 2,
        }}>

          {/* Remaining health — only shown while game is in progress */}
          {gameStarted && (
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
          )}

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
              onClick={handleClick('-')}
              onPointerDown={handlePointerDown('-')}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
              disabled={!gameStarted}
              style={{
                width: '21vmin',
                height: '21vmin',
                background: 'rgba(0,0,0,0.45)',
                color: gameStarted ? 'var(--color-accent)' : 'var(--color-ui-border)',
                border: `2px solid ${gameStarted ? 'var(--color-accent)' : 'var(--color-ui-border)'}`,
                borderRadius: '8px',
                fontSize: '6vmin',
                cursor: gameStarted ? 'pointer' : 'default',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                WebkitTapHighlightColor: 'transparent',
                boxShadow: gameStarted ? '0 0 12px rgba(var(--color-accent-rgb), 0.3)' : 'none',
                userSelect: 'none',
                WebkitUserSelect: 'none',
                opacity: gameStarted ? 1 : 0.4,
              }}
            >
              −
            </button>

            {/* Counter — hidden when match is over; shows Start/Start Game X before game begins, damage count after */}
            {!matchOver && (
              <div
                data-testid="game-counter"
                onClick={gameStarted ? undefined : onStartGame}
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: gameStarted ? '20vmin' : '8vmin',
                  fontWeight: '300',
                  color: 'var(--color-text-primary)',
                  textShadow: '0 0 20px rgba(var(--color-accent-rgb), 0.4), 0 0 8px rgba(0,0,0,1)',
                  cursor: gameStarted ? 'default' : 'pointer',
                  letterSpacing: gameStarted ? undefined : '0.05em',
                }}
              >
                {gameStarted ? count : (lastGameResult !== null && !matchOver) ? `Start Game ${playerScore + opponentScore + 1}` : 'Start'}
                {!gameStarted && lastGameResult !== null && !matchOver && (
                  <div
                    data-testid="game-result-label"
                    style={{
                      fontSize: 'clamp(0.7rem, 2.5vmin, 1.2rem)',
                      fontWeight: '300',
                      color: '#ffffff',
                      letterSpacing: '0.08em',
                      marginTop: '1vmin',
                      pointerEvents: 'none',
                      textShadow: '0 1px 8px rgba(0,0,0,0.8)',
                    }}
                  >
                    {`Game ${playerScore + opponentScore} ${lastGameResult === 'won' ? 'Won' : 'Lost'}`}
                  </div>
                )}
              </div>
            )}

            {/* Plus button */}
            <button
              onClick={handleClick('+')}
              onPointerDown={handlePointerDown('+')}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
              disabled={!gameStarted}
              style={{
                width: '21vmin',
                height: '21vmin',
                background: 'rgba(0,0,0,0.45)',
                color: gameStarted ? 'var(--color-accent)' : 'var(--color-ui-border)',
                border: `2px solid ${gameStarted ? 'var(--color-accent)' : 'var(--color-ui-border)'}`,
                borderRadius: '8px',
                fontSize: '6vmin',
                cursor: gameStarted ? 'pointer' : 'default',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                WebkitTapHighlightColor: 'transparent',
                boxShadow: gameStarted ? '0 0 12px rgba(var(--color-accent-rgb), 0.3)' : 'none',
                userSelect: 'none',
                WebkitUserSelect: 'none',
                opacity: gameStarted ? 1 : 0.4,
              }}
            >
              +
            </button>

          </div>


        </div>

        {/* Epic action used overlay — full width when alone, left half when both overlays active */}
        {epicActionOverlayVisible && showEpicAction && (
          <div
            data-testid="epic-action-overlay"
            onClick={onEpicActionOverlayDismiss}
            style={{
              cursor: onEpicActionOverlayDismiss ? 'pointer' : 'default',
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
            }}
          >
            <img
              src={`${import.meta.env.BASE_URL}dmgctrl-icon-192-white.svg`}
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
            }}>Epic Action Used</span>
          </div>
        )}

        {/* Force token — full width when alone, right half when both overlays active */}
        {forceActive && showForce && (
          <div
            data-testid="force-token"
            onClick={onForceDismiss}
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
              src={`${import.meta.env.BASE_URL}dmgCtrl-force-token.png`}
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

      {/* Score panel — left column, between top buttons and round tracker */}
      {playMode !== 'casual' && (() => {
        const markerCount = playMode === 'bo3' ? 2 : 1
        const topVw = (showForce && (showEpicAction || isMysticMonastery)) ? 23 : (showForce || showEpicAction) ? 16 : 9
        return (
          <div
            data-testid="score-panel"
            style={{
              position: 'absolute',
              top: `calc(env(safe-area-inset-top) + ${topVw}vw)`,
              bottom: `calc(env(safe-area-inset-bottom) + 9vw)`,
              left: 'calc(env(safe-area-inset-left) + 2vw)',
              width: '5vw',
              minWidth: '36px',
              zIndex: 10,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '4px 0',
            }}
          >
            <button
              onClick={matchOver ? undefined : pendingConfirm === 'loss' ? onConfirmResult : onLossPending}
              disabled={matchOver}
              style={{
                width: '100%',
                background: 'transparent',
                border: `1px solid ${pendingConfirm === 'loss' ? '#ef4444' : 'var(--color-ui-border)'}`,
                borderRadius: '4px',
                padding: '0.1rem 0',
                cursor: matchOver ? 'default' : 'pointer',
                fontSize: 'clamp(0.45rem, 1vw, 0.65rem)',
                fontWeight: '300',
                color: pendingConfirm === 'loss' ? '#ef4444' : 'var(--color-text-muted)',
                letterSpacing: '0.05em',
                textAlign: 'center',
                WebkitTapHighlightColor: 'transparent',
                opacity: matchOver ? 0.4 : 1,
              }}
            >{pendingConfirm === 'loss' ? 'Confirm' : 'Opp'}</button>

            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '3px' }}>
              {Array.from({ length: markerCount }, (_, i) => (
                <div
                  key={i}
                  data-testid="score-opp-marker"
                  style={{
                    width: 'clamp(8px, 1.4vw, 12px)',
                    height: 'clamp(8px, 1.4vw, 12px)',
                    borderRadius: '50%',
                    border: i < opponentScore ? '1.5px solid #15803d' : '1.5px solid var(--color-ui-border-muted)',
                    background: i < opponentScore
                      ? 'linear-gradient(160deg, #4ade80 0%, #16a34a 100%)'
                      : 'transparent',
                    boxShadow: i < opponentScore
                      ? 'inset 0 1px 0 rgba(255,255,255,0.35), 0 2px 4px rgba(0,0,0,0.5)'
                      : 'none',
                  }}
                />
              ))}
            </div>

            {/* Timer / Draw button — between opp markers and player markers */}
            {(() => {
              const isButton = timerInteractive || pendingConfirm === 'draw'
              const isWarning = !timerInteractive && pendingConfirm !== 'draw' && timerRemaining < 60
              if (isButton) {
                const isConfirm = pendingConfirm === 'draw'
                return (
                  <button
                    data-testid="score-timer"
                    onClick={isConfirm ? onConfirmResult : onDrawPending}
                    style={{
                      width: '100%',
                      background: 'transparent',
                      border: isConfirm ? '1px solid var(--color-accent)' : '1px solid #6b7280',
                      borderRadius: '4px',
                      padding: '0.1rem 0',
                      cursor: 'pointer',
                      fontSize: 'clamp(0.45rem, 1vw, 0.65rem)',
                      fontWeight: '300',
                      color: isConfirm ? 'var(--color-accent)' : 'var(--color-text-muted)',
                      letterSpacing: '0.05em',
                      textAlign: 'center',
                      WebkitTapHighlightColor: 'transparent',
                    }}
                  >{isConfirm ? 'Confirm' : 'Draw'}</button>
                )
              }
              return (
                <div
                  data-testid="score-timer"
                  style={{
                    width: '100%',
                    padding: '0.1rem 0',
                    fontSize: 'clamp(0.5rem, 1.1vw, 0.7rem)',
                    fontWeight: '300',
                    color: isWarning ? '#ef4444' : 'var(--color-text-muted)',
                    letterSpacing: '0.03em',
                    textAlign: 'center',
                  }}
                >{formatTime(timerRemaining)}</div>
              )
            })()}

            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '3px' }}>
              {Array.from({ length: markerCount }, (_, i) => (
                <div
                  key={i}
                  data-testid="score-player-marker"
                  style={{
                    width: 'clamp(8px, 1.4vw, 12px)',
                    height: 'clamp(8px, 1.4vw, 12px)',
                    borderRadius: '50%',
                    border: i < playerScore ? '1.5px solid #15803d' : '1.5px solid var(--color-ui-border-muted)',
                    background: i < playerScore
                      ? 'linear-gradient(160deg, #4ade80 0%, #16a34a 100%)'
                      : 'transparent',
                    boxShadow: i < playerScore
                      ? 'inset 0 1px 0 rgba(255,255,255,0.35), 0 2px 4px rgba(0,0,0,0.5)'
                      : 'none',
                  }}
                />
              ))}
            </div>

            <button
              onClick={matchOver ? undefined : pendingConfirm === 'win' ? onConfirmResult : onWinPending}
              disabled={matchOver}
              style={{
                width: '100%',
                background: 'transparent',
                border: `1px solid ${pendingConfirm === 'win' ? '#22c55e' : 'var(--color-ui-border)'}`,
                borderRadius: '4px',
                padding: '0.1rem 0',
                cursor: matchOver ? 'default' : 'pointer',
                fontSize: 'clamp(0.45rem, 1vw, 0.65rem)',
                fontWeight: '300',
                color: pendingConfirm === 'win' ? '#22c55e' : 'var(--color-text-muted)',
                letterSpacing: '0.05em',
                textAlign: 'center',
                WebkitTapHighlightColor: 'transparent',
                opacity: matchOver ? 0.4 : 1,
              }}
            >{pendingConfirm === 'win' ? 'Confirm' : 'You'}</button>
          </div>
        )
      })()}

      {/* Dismiss overlay — clears pending confirm when tapping elsewhere */}
      {pendingConfirm !== null && (
        <div
          data-testid="score-dismiss-overlay"
          onClick={onCancelConfirm}
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 9,
            background: 'transparent',
          }}
        />
      )}


      {/* Match-over display */}
      {matchOver && (
        <div
          data-testid="match-result-label"
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            fontSize: 'clamp(1rem, 4vmin, 2rem)',
            fontWeight: '300',
            color: '#ffffff',
            letterSpacing: '0.08em',
            textShadow: '0 1px 8px rgba(0,0,0,0.8)',
            pointerEvents: 'none',
            zIndex: 11,
          }}
        >
          {matchDrawn ? 'Match Drawn' : playerScore > opponentScore ? 'Match Won' : 'Match Lost'}
        </div>
      )}

      {/* Round counter — bottom-left, hidden when action log is disabled or match is over */}
      {enableActionLog && !matchOver && <button
        data-testid="round-counter"
        onClick={onRoundIncrement}
        style={{
          position: 'absolute',
          bottom: 'calc(env(safe-area-inset-bottom) + 2vw)',
          left: 'calc(env(safe-area-inset-left) + 2vw)',
          width: '5vw',
          height: '5vw',
          minWidth: '36px',
          minHeight: '36px',
          padding: 0,
          background: 'linear-gradient(to bottom, rgba(59,130,246,0.25) 30%, transparent 65%)',
          border: '2px solid var(--color-ui-border)',
          borderRadius: '8px',
          color: 'var(--color-ui-border-muted)',
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          zIndex: 10,
          WebkitTapHighlightColor: 'transparent',
          overflow: 'hidden',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          boxShadow: '0 0 8px rgba(var(--color-ui-border-muted-rgb), 0.2)',
        }}
      >
        <span style={{
          textAlign: 'center',
          fontSize: 'clamp(0.45rem, 1vw, 0.65rem)',
          fontWeight: '300',
          letterSpacing: '0.05em',
          color: 'var(--color-ui-border-muted)',
          lineHeight: 1.4,
          padding: '0 2px',
          flexShrink: 0,
        }}>Round</span>
        <span style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 'clamp(0.7rem, 1.8vw, 1.1rem)',
          fontWeight: '300',
        }}>
          {round}
        </span>
      </button>}

      {/* Log button — bottom-right, aligned with round counter */}
      {enableActionLog && (
        <button
          data-testid="log-btn"
          onClick={onLogToggle}
          style={{
            position: 'absolute',
            bottom: 'calc(env(safe-area-inset-bottom) + 2vw)',
            right: 'calc(env(safe-area-inset-right) + 2vw)',
            width: '5vw',
            height: '5vw',
            minWidth: '36px',
            minHeight: '36px',
            background: 'transparent',
            border: '2px solid var(--color-ui-border)',
            borderRadius: '8px',
            color: 'var(--color-ui-border-muted)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
            WebkitTapHighlightColor: 'transparent',
            boxShadow: '0 0 8px rgba(var(--color-ui-border-muted-rgb), 0.2)',
          }}
        >
          <LogIcon />
        </button>
      )}

      {/* Log overlay */}
      {showLog && enableActionLog && (
        <GameLogOverlay entries={logEntries} onUndo={onUndo} />
      )}

      {/* Drag indicator — offset toward screen centre */}
      {dragIndicator && (() => {
        const isPlus = dragIndicator.type === '+'
        return (
          <div
            style={{
              position: 'fixed',
              left: Math.max(8, dragIndicator.clientX + (isPlus ? -100 : 55)),
              top: Math.max(8, dragIndicator.clientY - 40),
              zIndex: 200,
              pointerEvents: 'none',
            }}
          >
            <span style={{
              display: 'block',
              lineHeight: 1,
              fontSize: 'clamp(1.8rem, 9vmin, 2.8rem)',
              fontWeight: '300',
              color: 'var(--color-text-primary)',
              textShadow: '0 0 24px rgba(var(--color-accent-rgb), 0.7), 0 0 12px rgba(0,0,0,1), -1px -1px 0 rgba(0,0,0,0.9), 1px -1px 0 rgba(0,0,0,0.9), -1px 1px 0 rgba(0,0,0,0.9), 1px 1px 0 rgba(0,0,0,0.9)',
              letterSpacing: '0.04em',
            }}>
              {isPlus ? '+' : '−'}{dragIndicator.value}
            </span>
          </div>
        )
      })()}

    </AppScreenLayout>
  )
}

export default SwuGameScreenView
