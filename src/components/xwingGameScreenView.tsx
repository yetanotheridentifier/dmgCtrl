import { useDragScrubber } from '../hooks/useDragScrubber'
import AppScreenLayout from './layout/appScreenLayout'
import { BackIcon, CogIcon, HelpIcon, LogIcon } from './icons'
import TimerDisplay from './shared/timerDisplay'

interface Props {
  gameStarted: boolean
  gameOver: boolean
  result: 'win' | 'loss' | 'draw' | null
  timerRemaining: number
  timerExpired: boolean
  round: number
  playerDeficit: number
  opponentDeficit: number
  onPlayerDeficitIncrement: (n: number) => void
  onPlayerDeficitDecrement: (n: number) => void
  onOpponentDeficitIncrement: (n: number) => void
  onOpponentDeficitDecrement: (n: number) => void
  onStartGame: () => void
  onRoundAdvance: () => void
  playerScore: number
  opponentScore: number
  onPlayerIncrement: (n: number) => void
  onPlayerDecrement: (n: number) => void
  onOpponentIncrement: (n: number) => void
  onOpponentDecrement: (n: number) => void
  enableLongPress: boolean
  enableActionLog: boolean
  onBack: () => void
  onHelp: () => void
  onSettings?: () => void
  onGameEnd?: () => void
}

function roundTrackerColor(remaining: number): string {
  if (remaining <= 60) return 'var(--color-error)'
  if (remaining <= 300) return 'var(--color-warning)'
  return 'var(--color-accent)'
}

const NAV_BTN: React.CSSProperties = {
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
}

const COUNTER_BTN = (disabled: boolean): React.CSSProperties => ({
  width: '14vmin',
  height: '14vmin',
  background: 'rgba(0,0,0,0.45)',
  color: disabled ? 'var(--color-ui-border)' : 'var(--color-accent)',
  border: `2px solid ${disabled ? 'var(--color-ui-border)' : 'var(--color-accent)'}`,
  borderRadius: '8px',
  fontSize: '5vmin',
  cursor: disabled ? 'default' : 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  WebkitTapHighlightColor: 'transparent',
  boxShadow: disabled ? 'none' : '0 0 12px rgba(var(--color-accent-rgb), 0.3)',
  userSelect: 'none',
  WebkitUserSelect: 'none',
  opacity: disabled ? 0.4 : 1,
})

export default function XwingGameScreenView({
  gameStarted,
  gameOver,
  result,
  timerRemaining,
  timerExpired,
  round,
  playerDeficit,
  opponentDeficit,
  onPlayerDeficitIncrement,
  onPlayerDeficitDecrement,
  onOpponentDeficitIncrement,
  onOpponentDeficitDecrement,
  onStartGame,
  onRoundAdvance,
  playerScore,
  opponentScore,
  onPlayerIncrement,
  onPlayerDecrement,
  onOpponentIncrement,
  onOpponentDecrement,
  enableLongPress,
  enableActionLog,
  onBack,
  onHelp,
  onSettings,
}: Props) {
  // Score scrubbers — active during game; floor is 0 (deficit applied separately, future ticket)
  const playerScrubber = useDragScrubber(
    onPlayerIncrement,
    onPlayerDecrement,
    50 - playerScore,
    playerScore,
    enableLongPress && gameStarted && !gameOver,
  )

  const opponentScrubber = useDragScrubber(
    onOpponentIncrement,
    onOpponentDecrement,
    50 - opponentScore,
    opponentScore,
    enableLongPress && gameStarted && !gameOver,
  )

  // Deficit scrubbers — active pre-game
  const playerDeficitScrubber = useDragScrubber(
    onPlayerDeficitIncrement,
    onPlayerDeficitDecrement,
    4 - playerDeficit,
    playerDeficit,
    enableLongPress && !gameStarted,
  )

  const opponentDeficitScrubber = useDragScrubber(
    onOpponentDeficitIncrement,
    onOpponentDeficitDecrement,
    4 - opponentDeficit,
    opponentDeficit,
    enableLongPress && !gameStarted,
  )

  const dragIndicator =
    playerScrubber.dragIndicator ??
    opponentScrubber.dragIndicator ??
    playerDeficitScrubber.dragIndicator ??
    opponentDeficitScrubber.dragIndicator

  return (
    <AppScreenLayout>

      {/* Back + title — top-left flex row; title hidden once game starts */}
      <div style={{
        position: 'absolute',
        top: 'calc(env(safe-area-inset-top) + 2vw)',
        left: 'calc(env(safe-area-inset-left) + 2vw)',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: '1vw',
        zIndex: 10,
      }}>
        <button
          aria-label="Back"
          onClick={onBack}
          style={NAV_BTN}
        >
          <BackIcon />
        </button>
        {!gameStarted && (
          <>
            <img
              src={`${import.meta.env.BASE_URL}dmgCtrl-icon-transparent-192.png`}
              alt="dmgCtrl"
              style={{ height: 'clamp(1.2rem, 4vw, 1.8rem)', width: 'auto', pointerEvents: 'none' }}
            />
            <span style={{
              color: 'var(--color-text-primary)',
              fontWeight: '200',
              fontSize: 'clamp(1.2rem, 4vw, 1.8rem)',
              letterSpacing: '0.15em',
              pointerEvents: 'none',
            }}>
              dmgCtrl
            </span>
          </>
        )}
      </div>

      {/* Help — top-right */}
      <button
        aria-label="Help"
        onClick={onHelp}
        style={{ ...NAV_BTN, position: 'absolute', top: 'calc(env(safe-area-inset-top) + 2vw)', right: 'calc(env(safe-area-inset-right) + 2vw)' }}
      >
        <HelpIcon />
      </button>

      {/* Settings — below help, top-right */}
      {onSettings && (
        <button
          aria-label="Settings"
          onClick={onSettings}
          style={{ ...NAV_BTN, position: 'absolute', top: 'calc(env(safe-area-inset-top) + 9vw)', right: 'calc(env(safe-area-inset-right) + 2vw)' }}
        >
          <CogIcon />
        </button>
      )}

      {/* Round tracker — continuous bar, top aligned with score buttons, only after game starts.
          Alignment: left/right = outer edge of player/opponent score button pairs.
          Derived: playerColCenter = 25vw - 2.5vmin, halfPairWidth = 15vmin → 25vw - 17.5vmin.
          No container border — the bar is formed by each segment's own borders so there is
          nothing for the tab to "show through". */}
      {gameStarted && (
        <div
          data-testid="round-tracker"
          style={{
            position: 'absolute',
            top: 'calc(env(safe-area-inset-top) + 2vw)',
            left: 'calc(25vw - 17.5vmin)',
            right: 'calc(25vw - 17.5vmin)',
            // Height matches nav button outer size (5vw / 36px)
            height: '5vw',
            minHeight: '36px',
            display: 'flex',
            flexDirection: 'row',
            // flex-start so the current segment (which is taller) hangs down from the top edge
            alignItems: 'flex-start',
            zIndex: 10,
            borderRadius: '8px',
            overflow: 'visible',
            background: 'rgba(0,0,0,0.2)',
            boxShadow: '0 0 8px rgba(var(--color-ui-border-muted-rgb), 0.2)',
          }}
        >
          {Array.from({ length: 12 }, (_, i) => {
            const roundNum = i + 1
            const isCurrent = roundNum === round
            const isNext = roundNum === round + 1
            const isFirst = roundNum === 1
            const isLast = roundNum === 12
            const clickable = isNext && !timerExpired
            const timerColor = roundTrackerColor(timerRemaining)

            // Non-current: outer corners follow bar radius; inner corners are flat.
            const radius = isFirst ? '8px 0 0 8px' : isLast ? '0 8px 8px 0' : '0'

            // Current segment extends below the bar — bottom corners always rounded.
            // top-left top-right bottom-right bottom-left
            const currentRadius = isFirst ? '8px 0 8px 8px' : isLast ? '0 8px 8px 8px' : '0 0 8px 8px'

            // Non-current segments form the bar via their own top/bottom (and edge) borders.
            // borderColor is always set so tests can read element.style.borderColor.
            // Individual widths control which sides are visible without a container border.
            const segmentStyle: React.CSSProperties = isCurrent
              ? {
                  height: 'calc(100% + 10px)',
                  borderWidth: '2px',
                  borderStyle: 'solid',
                  borderColor: timerColor,
                  borderRadius: currentRadius,
                }
              : {
                  height: '100%',
                  borderStyle: 'solid',
                  borderColor: 'var(--color-ui-border)',
                  borderTopWidth: '2px',
                  borderBottomWidth: '2px',
                  borderLeftWidth: isFirst ? '2px' : '0',
                  borderRightWidth: isLast ? '2px' : '0',
                  borderRadius: radius,
                }

            return (
              <button
                key={roundNum}
                aria-label={`Round ${roundNum}`}
                onClick={clickable ? onRoundAdvance : undefined}
                style={{
                  position: 'relative',
                  flex: 1,
                  minWidth: 0,
                  boxSizing: 'border-box',
                  background: isCurrent ? 'rgba(0,0,0,0.35)' : 'transparent',
                  ...segmentStyle,
                  color: isCurrent ? timerColor : 'var(--color-text-muted)',
                  fontSize: 'clamp(0.6rem, 1.6vw, 1rem)',
                  cursor: clickable ? 'pointer' : 'default',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  WebkitTapHighlightColor: 'transparent',
                  padding: 0,
                }}
              >
                {roundNum}
              </button>
            )
          })}
        </div>
      )}

      {/* Log — bottom-left, stub */}
      {enableActionLog && (
        <button
          data-testid="log-btn"
          aria-label="Log"
          style={{ ...NAV_BTN, position: 'absolute', bottom: 'calc(env(safe-area-inset-bottom) + 2vw)', left: 'calc(env(safe-area-inset-left) + 2vw)' }}
        >
          <LogIcon />
        </button>
      )}

      {/* Main content — centred in available area */}
      <div style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '12vw 8vmin 8vmin',
        boxSizing: 'border-box',
        touchAction: 'none',
      }}>

        {/*
          Three-column layout.
          Outer row stretches all columns to the same height so the centre
          column can pin Start Game / timer to the bottom, aligning it with
          the [−][+] buttons in the player/opponent columns.
        */}
        <div style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'stretch',
          justifyContent: 'space-between',
          width: '100%',
          gap: '2vmin',
        }}>

          {/* ── Player column ── */}
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}>
            {/* Label */}
            <div style={{
              fontSize: 'clamp(0.75rem, 2.2vmin, 1.2rem)',
              fontWeight: '300',
              color: 'var(--color-text-muted)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              marginBottom: '2vmin',
            }}>
              {gameStarted ? 'You' : 'Your deficit'}
            </div>

            {/* Score / deficit number — sits near top of flex space */}
            <div
              data-testid={gameStarted ? 'player-score' : 'player-deficit-value'}
              style={{
                fontSize: '15vmin',
                fontWeight: '300',
                color: 'var(--color-text-primary)',
                textShadow: '0 0 20px rgba(var(--color-accent-rgb), 0.4), 0 0 8px rgba(0,0,0,1)',
                lineHeight: 1,
                minWidth: '8vmin',
                textAlign: 'center',
              }}
            >
              {gameStarted ? playerScore : playerDeficit}
            </div>

            {/* Spacer — pushes buttons to the bottom */}
            <div style={{ flexGrow: 1, minHeight: '4vmin' }} />

            {/* Buttons — [−] [+] */}
            <div style={{ display: 'flex', flexDirection: 'row', gap: '2vmin' }}>
              {gameStarted ? (
                <>
                  <button
                    data-testid="player-decrement"
                    onClick={playerScrubber.handleClick('-')}
                    onPointerDown={playerScrubber.handlePointerDown('-')}
                    onPointerMove={playerScrubber.handlePointerMove}
                    onPointerUp={playerScrubber.handlePointerUp}
                    onPointerCancel={playerScrubber.handlePointerCancel}
                    disabled={gameOver}
                    style={COUNTER_BTN(gameOver)}
                  >
                    −
                  </button>
                  <button
                    data-testid="player-increment"
                    onClick={playerScrubber.handleClick('+')}
                    onPointerDown={playerScrubber.handlePointerDown('+')}
                    onPointerMove={playerScrubber.handlePointerMove}
                    onPointerUp={playerScrubber.handlePointerUp}
                    onPointerCancel={playerScrubber.handlePointerCancel}
                    disabled={gameOver}
                    style={COUNTER_BTN(gameOver)}
                  >
                    +
                  </button>
                </>
              ) : (
                <>
                  <button
                    data-testid="player-deficit-decrement"
                    onClick={playerDeficitScrubber.handleClick('-')}
                    onPointerDown={playerDeficitScrubber.handlePointerDown('-')}
                    onPointerMove={playerDeficitScrubber.handlePointerMove}
                    onPointerUp={playerDeficitScrubber.handlePointerUp}
                    onPointerCancel={playerDeficitScrubber.handlePointerCancel}
                    style={COUNTER_BTN(false)}
                  >
                    −
                  </button>
                  <button
                    data-testid="player-deficit-increment"
                    onClick={playerDeficitScrubber.handleClick('+')}
                    onPointerDown={playerDeficitScrubber.handlePointerDown('+')}
                    onPointerMove={playerDeficitScrubber.handlePointerMove}
                    onPointerUp={playerDeficitScrubber.handlePointerUp}
                    onPointerCancel={playerDeficitScrubber.handlePointerCancel}
                    style={COUNTER_BTN(false)}
                  >
                    +
                  </button>
                </>
              )}
            </div>
          </div>

          {/* ── Centre column: result banner / Start Game / Timer ── */}
          <div style={{
            width: '22vmin',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            flexShrink: 0,
          }}>
            {/* Invisible label placeholder — aligns the score-height area
                with the score numbers in the outer columns */}
            <div style={{
              fontSize: 'clamp(0.75rem, 2.2vmin, 1.2rem)',
              marginBottom: '2vmin',
              visibility: 'hidden',
              userSelect: 'none',
            }}>
              _
            </div>

            {/* Score-height area — result banner at game over; timer during
                game (ticket #228); empty pre-game. Height matches score font
                so content is vertically centred relative to the score numbers. */}
            <div style={{
              height: '15vmin',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              {gameStarted && gameOver ? (
                <div
                  data-testid="result-banner"
                  style={{
                    fontSize: 'clamp(1.2rem, 8vmin, 3.5rem)',
                    fontWeight: '300',
                    letterSpacing: '0.06em',
                    color: result === 'win' ? 'var(--color-success)' : result === 'loss' ? 'var(--color-error)' : 'var(--color-text-muted)',
                    whiteSpace: 'nowrap',
                    textAlign: 'center',
                    lineHeight: 1,
                  }}
                >
                  {result === 'win' ? 'Game Won' : result === 'loss' ? 'Game Lost' : 'Draw'}
                </div>
              ) : gameStarted ? (
                <TimerDisplay
                  remaining={timerRemaining}
                  testId="xwing-timer"
                  style={{
                    fontSize: 'clamp(1.2rem, 8vmin, 3.5rem)',
                    fontWeight: '300',
                    letterSpacing: '0.06em',
                    textAlign: 'center',
                    lineHeight: 1,
                  }}
                />
              ) : null}
            </div>

            {/* Spacer — pushes bottom content to align with outer column buttons */}
            <div style={{ flexGrow: 1 }} />

            {/* Start Game — pre-game only */}
            {!gameStarted && (
              <button
                data-testid="start-game-btn"
                onClick={onStartGame}
                style={{
                  height: '14vmin',
                  minHeight: '36px',
                  padding: '0 4vmin',
                  background: 'transparent',
                  border: '2px solid var(--color-accent)',
                  borderRadius: '8px',
                  color: 'var(--color-accent)',
                  fontSize: 'clamp(0.8rem, 2.2vmin, 1.2rem)',
                  fontWeight: '300',
                  letterSpacing: '0.08em',
                  cursor: 'pointer',
                  WebkitTapHighlightColor: 'transparent',
                  boxShadow: '0 0 12px rgba(var(--color-accent-rgb), 0.3)',
                  whiteSpace: 'nowrap',
                }}
              >
                Start Game
              </button>
            )}
          </div>

          {/* ── Opponent column ── */}
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}>
            {/* Label */}
            <div style={{
              fontSize: 'clamp(0.75rem, 2.2vmin, 1.2rem)',
              fontWeight: '300',
              color: 'var(--color-text-muted)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              marginBottom: '2vmin',
            }}>
              {gameStarted ? 'Opp' : "Opp's deficit"}
            </div>

            {/* Score / deficit number — sits near top of flex space */}
            <div
              data-testid={gameStarted ? 'opponent-score' : 'opponent-deficit-value'}
              style={{
                fontSize: '15vmin',
                fontWeight: '300',
                color: 'var(--color-text-primary)',
                textShadow: '0 0 20px rgba(var(--color-accent-rgb), 0.4), 0 0 8px rgba(0,0,0,1)',
                lineHeight: 1,
                minWidth: '8vmin',
                textAlign: 'center',
              }}
            >
              {gameStarted ? opponentScore : opponentDeficit}
            </div>

            {/* Spacer — pushes buttons to the bottom */}
            <div style={{ flexGrow: 1, minHeight: '4vmin' }} />

            {/* Buttons — [−] [+] */}
            <div style={{ display: 'flex', flexDirection: 'row', gap: '2vmin' }}>
              {gameStarted ? (
                <>
                  <button
                    data-testid="opponent-decrement"
                    onClick={opponentScrubber.handleClick('-')}
                    onPointerDown={opponentScrubber.handlePointerDown('-')}
                    onPointerMove={opponentScrubber.handlePointerMove}
                    onPointerUp={opponentScrubber.handlePointerUp}
                    onPointerCancel={opponentScrubber.handlePointerCancel}
                    disabled={gameOver}
                    style={COUNTER_BTN(gameOver)}
                  >
                    −
                  </button>
                  <button
                    data-testid="opponent-increment"
                    onClick={opponentScrubber.handleClick('+')}
                    onPointerDown={opponentScrubber.handlePointerDown('+')}
                    onPointerMove={opponentScrubber.handlePointerMove}
                    onPointerUp={opponentScrubber.handlePointerUp}
                    onPointerCancel={opponentScrubber.handlePointerCancel}
                    disabled={gameOver}
                    style={COUNTER_BTN(gameOver)}
                  >
                    +
                  </button>
                </>
              ) : (
                <>
                  <button
                    data-testid="opponent-deficit-decrement"
                    onClick={opponentDeficitScrubber.handleClick('-')}
                    onPointerDown={opponentDeficitScrubber.handlePointerDown('-')}
                    onPointerMove={opponentDeficitScrubber.handlePointerMove}
                    onPointerUp={opponentDeficitScrubber.handlePointerUp}
                    onPointerCancel={opponentDeficitScrubber.handlePointerCancel}
                    style={COUNTER_BTN(false)}
                  >
                    −
                  </button>
                  <button
                    data-testid="opponent-deficit-increment"
                    onClick={opponentDeficitScrubber.handleClick('+')}
                    onPointerDown={opponentDeficitScrubber.handlePointerDown('+')}
                    onPointerMove={opponentDeficitScrubber.handlePointerMove}
                    onPointerUp={opponentDeficitScrubber.handlePointerUp}
                    onPointerCancel={opponentDeficitScrubber.handlePointerCancel}
                    style={COUNTER_BTN(false)}
                  >
                    +
                  </button>
                </>
              )}
            </div>
          </div>

        </div>


      </div>

      {/* Drag indicator — increment offsets right, decrement offsets left */}
      {dragIndicator && (() => {
        const isPlus = dragIndicator.type === '+'
        return (
          <div style={{
            position: 'fixed',
            left: Math.max(8, dragIndicator.clientX + (isPlus ? 55 : -100)),
            top: Math.max(8, dragIndicator.clientY - 40),
            zIndex: 200,
            pointerEvents: 'none',
          }}>
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
