import { useDragScrubber } from '../hooks/useDragScrubber'
import AppScreenLayout from './layout/appScreenLayout'
import { BackIcon, CogIcon, HelpIcon, LogIcon } from './icons'
import TimerDisplay from './shared/timerDisplay'
import GameLogOverlay from './gameLogOverlay'
import InitiativeToggle from './initiativeToggle'
import { NAV_BTN_STYLE } from '../styles/navButton'
import { BAR_CONTAINER_STYLE } from '../styles/barContainer'
import { START_TEXT_STYLE } from '../styles/startText'
import type { HistoryEntry } from '../hooks/useGameHistory'
import type { Initiative } from '../hooks/useInitiative'

interface Props {
  gameStarted: boolean
  gameOver: boolean
  result: 'win' | 'loss' | 'draw' | null
  timerRemaining: number
  timerExpired: boolean
  round: number
  phase: string
  onPhaseAdvance: () => void
  enableXwingPhases: boolean
  onStartGame: () => void
  onRoundAdvance: () => void
  playerScore: number
  opponentScore: number
  playerDeficit: number
  opponentDeficit: number
  onPlayerIncrement: (n: number) => void
  onPlayerDecrement: (n: number) => void
  onOpponentIncrement: (n: number) => void
  onOpponentDecrement: (n: number) => void
  enableLongPress: boolean
  enableActionLog: boolean
  logEntries: HistoryEntry<{ playerScore: number; opponentScore: number; round: number; gameStarted: boolean }>[]
  logOpen: boolean
  onLogToggle: () => void
  onLogUndo: () => void
  enableInitiativeBar: boolean
  initiative: Initiative
  onInitiativeOpponent: () => void
  onInitiativePlayer: () => void
  onBack: () => void
  onHelp: () => void
  onSettings?: () => void
  onGameEnd?: () => void
  scenario?: string
  scenarioScoringActive?: boolean
  scenarioAlreadyScoredThisRound?: boolean
  pendingPlayerScenario?: number | null
  pendingOpponentScenario?: number | null
  onPlayerScenarioSelect?: (v: number) => void
  onOpponentScenarioSelect?: (v: number) => void
}

const CHANCE_ENGAGEMENT = 'Chance Engagement'
const VALID_CHANCE_PAIRS: [number, number][] = [[0, 0], [2, 2], [4, 0], [0, 4]]

function getDisabledOpponentValues(scenario: string | undefined, playerSelected: number | null): Set<number> {
  if (playerSelected === null) return new Set()
  if (scenario === CHANCE_ENGAGEMENT) {
    const valid = VALID_CHANCE_PAIRS.filter(([p]) => p === playerSelected).map(([, o]) => o)
    return new Set([0, 2, 4].filter(v => !valid.includes(v)))
  }
  return playerSelected === 4 ? new Set([4]) : new Set()
}

function getDisabledPlayerValues(scenario: string | undefined, opponentSelected: number | null): Set<number> {
  if (opponentSelected === null) return new Set()
  if (scenario === CHANCE_ENGAGEMENT) {
    const valid = VALID_CHANCE_PAIRS.filter(([, o]) => o === opponentSelected).map(([p]) => p)
    return new Set([0, 2, 4].filter(v => !valid.includes(v)))
  }
  return opponentSelected === 4 ? new Set([4]) : new Set()
}

const SCENARIO_BTN = (selected: boolean, disabled = false): React.CSSProperties => ({
  width: '5vw',
  height: '5vw',
  minWidth: '36px',
  minHeight: '36px',
  background: selected ? 'rgba(var(--color-accent-rgb), 0.15)' : 'rgba(0,0,0,0.45)',
  color: selected ? 'var(--color-accent)' : 'var(--color-text-muted)',
  border: `2px solid ${selected ? 'var(--color-accent)' : 'var(--color-ui-border)'}`,
  borderRadius: '8px',
  fontSize: 'clamp(0.55rem, 1.5vw, 0.85rem)',
  fontWeight: '300',
  cursor: disabled ? 'default' : 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  WebkitTapHighlightColor: 'transparent',
  opacity: disabled ? 0.4 : 1,
})

function roundTrackerColor(remaining: number): string {
  if (remaining <= 60) return 'var(--color-error)'
  if (remaining <= 300) return 'var(--color-warning)'
  return 'var(--color-accent)'
}

const NAV_BTN: React.CSSProperties = { ...NAV_BTN_STYLE, zIndex: 10 }

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
  phase,
  onPhaseAdvance,
  enableXwingPhases,
  onStartGame,
  onRoundAdvance,
  playerScore,
  opponentScore,
  playerDeficit,
  opponentDeficit,
  onPlayerIncrement,
  onPlayerDecrement,
  onOpponentIncrement,
  onOpponentDecrement,
  enableLongPress,
  enableActionLog,
  logEntries,
  logOpen,
  onLogToggle,
  onLogUndo,
  enableInitiativeBar,
  initiative,
  onInitiativeOpponent,
  onInitiativePlayer,
  onBack,
  onHelp,
  onSettings,
  scenario,
  scenarioScoringActive = false,
  scenarioAlreadyScoredThisRound = false,
  pendingPlayerScenario = null,
  pendingOpponentScenario = null,
  onPlayerScenarioSelect,
  onOpponentScenarioSelect,
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

  const dragIndicator =
    playerScrubber.dragIndicator ??
    opponentScrubber.dragIndicator

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
          <span style={{
            color: 'var(--color-text-primary)',
            fontWeight: '200',
            fontSize: 'clamp(1.2rem, 4vw, 1.8rem)',
            letterSpacing: '0.15em',
            lineHeight: 0.8,
            pointerEvents: 'none',
          }}>
            dmgCtrl
          </span>
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
                  background: isCurrent ? 'var(--color-bg-dark)' : 'transparent',
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

      {/* Initiative bar — left column, between Back (top) and Log button (bottom) */}
      {enableInitiativeBar && (
        <div style={{
          position: 'absolute',
          top: 'calc(env(safe-area-inset-top) + 9vw)',
          bottom: `calc(env(safe-area-inset-bottom) + ${enableActionLog ? 9 : 2}vw)`,
          left: 'calc(env(safe-area-inset-left) + 2vw)',
          width: '5vw',
          minWidth: '36px',
          ...BAR_CONTAINER_STYLE,
          zIndex: 10,
          padding: 0,
          boxSizing: 'border-box',
        }}>
          <InitiativeToggle
            initiative={initiative}
            onSetOpponent={onInitiativeOpponent}
            onSetPlayer={onInitiativePlayer}
            interactive={!enableXwingPhases || !gameStarted || phase === 'Planning'}
          />
        </div>
      )}

      {/* Log — bottom-left */}
      {enableActionLog && (
        <>
          <button
            data-testid="log-btn"
            aria-label="Log"
            onClick={onLogToggle}
            style={{ ...NAV_BTN, position: 'absolute', bottom: 'calc(env(safe-area-inset-bottom) + 2vw)', left: 'calc(env(safe-area-inset-left) + 2vw)' }}
          >
            <LogIcon />
          </button>
          {logOpen && (
            <GameLogOverlay entries={logEntries} onUndo={onLogUndo} />
          )}
        </>
      )}

      {/* Main content — bottom-anchored to align with the initiative bar bottom */}
      <div style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-end',
        padding: `12vw 8vmin calc(env(safe-area-inset-bottom) + 9vw)`,
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
              You
            </div>

            {/* Score number — pre-game shows opponent's deficit (their starting score) */}
            <div
              data-testid="player-score"
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
              {gameStarted ? playerScore : opponentDeficit}
            </div>

            {/* Spacer — pushes button slot to the bottom */}
            <div style={{ flexGrow: 1 }} />

            {/* Fixed-height button slot — always present to prevent layout jump */}
            <div style={{ height: '14vmin', minHeight: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {gameStarted && (
                <div style={{ display: 'flex', flexDirection: 'row', gap: '2vmin' }}>
                  <button
                    data-testid="player-decrement"
                    onClick={playerScrubber.handleClick('-')}
                    onPointerDown={playerScrubber.handlePointerDown('-')}
                    onPointerMove={playerScrubber.handlePointerMove}
                    onPointerUp={playerScrubber.handlePointerUp}
                    onPointerCancel={playerScrubber.handlePointerCancel}
                    disabled={gameOver || scenarioScoringActive}
                    style={COUNTER_BTN(gameOver || scenarioScoringActive)}
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
                    disabled={gameOver || scenarioScoringActive}
                    style={COUNTER_BTN(gameOver || scenarioScoringActive)}
                  >
                    +
                  </button>
                </div>
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

            {/* Scenario name subtitle — shown when playing a named scenario */}
            {gameStarted && scenario && scenario !== 'None' && (
              <div
                data-testid="scenario-name"
                style={{
                  fontSize: 'clamp(0.8rem, 2.5vmin, 1.4rem)',
                  fontWeight: '300',
                  color: 'var(--color-text-muted)',
                  letterSpacing: '0.04em',
                  textAlign: 'center',
                  lineHeight: 1.3,
                  marginBottom: '1vmin',
                  maxWidth: '22vmin',
                }}
              >
                {scenario}
              </div>
            )}

            {/* Score-height area — result banner at game over; timer during
                game; Start Game text pre-game. Height matches score font
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
              ) : (
                <div
                  data-testid="start-game-btn"
                  onClick={onStartGame}
                  style={{
                    ...START_TEXT_STYLE,
                    fontSize: '8vmin',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Start Game
                </div>
              )}
            </div>

            {/* Spacer — pushes button slot to the bottom */}
            <div style={{ flexGrow: 1 }} />

            {/* Fixed-height button slot — always present to prevent layout jump */}
            <div style={{ height: '14vmin', minHeight: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {enableXwingPhases && gameStarted && !gameOver && (
                <button
                  data-testid="phase-btn"
                  onClick={onPhaseAdvance}
                  style={{
                    height: '14vmin',
                    minHeight: '36px',
                    padding: '0 4vmin',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--color-text-muted)',
                    fontSize: 'clamp(0.8rem, 2.5vmin, 1.4rem)',
                    fontWeight: '300',
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    WebkitTapHighlightColor: 'transparent',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {phase}
                </button>
              )}
            </div>

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
              Opp
            </div>

            {/* Score number — pre-game shows player's deficit (opponent's starting score) */}
            <div
              data-testid="opponent-score"
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
              {gameStarted ? opponentScore : playerDeficit}
            </div>

            {/* Spacer — pushes button slot to the bottom */}
            <div style={{ flexGrow: 1 }} />

            {/* Fixed-height button slot — always present to prevent layout jump */}
            <div style={{ height: '14vmin', minHeight: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {gameStarted && (
                <div style={{ display: 'flex', flexDirection: 'row', gap: '2vmin' }}>
                  <button
                    data-testid="opponent-decrement"
                    onClick={opponentScrubber.handleClick('-')}
                    onPointerDown={opponentScrubber.handlePointerDown('-')}
                    onPointerMove={opponentScrubber.handlePointerMove}
                    onPointerUp={opponentScrubber.handlePointerUp}
                    onPointerCancel={opponentScrubber.handlePointerCancel}
                    disabled={gameOver || scenarioScoringActive}
                    style={COUNTER_BTN(gameOver || scenarioScoringActive)}
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
                    disabled={gameOver || scenarioScoringActive}
                    style={COUNTER_BTN(gameOver || scenarioScoringActive)}
                  >
                    +
                  </button>
                </div>
              )}
            </div>
          </div>

        </div>


      </div>

      {/* Scenario scoring buttons — absolutely positioned at the same level as the log button.
          Centered on the player column (~25vw) and opponent column (~75vw). */}
      {scenarioScoringActive && (() => {
        const disabledOpp = scenarioAlreadyScoredThisRound
          ? new Set([0, 2, 4])
          : getDisabledOpponentValues(scenario, pendingPlayerScenario ?? null)
        const disabledPlayer = scenarioAlreadyScoredThisRound
          ? new Set([0, 2, 4])
          : getDisabledPlayerValues(scenario, pendingOpponentScenario ?? null)
        return (
          <>
            <div style={{
              position: 'absolute',
              bottom: 'calc(env(safe-area-inset-bottom) + 2vw)',
              left: '25vw',
              transform: 'translateX(-50%)',
              display: 'flex',
              flexDirection: 'row',
              gap: '1vw',
              zIndex: 10,
            }}>
              {[0, 2, 4].map(v => (
                <button
                  key={v}
                  data-testid={`player-scenario-${v}`}
                  onClick={() => onPlayerScenarioSelect?.(v)}
                  disabled={disabledPlayer.has(v)}
                  style={SCENARIO_BTN(pendingPlayerScenario === v, disabledPlayer.has(v))}
                >
                  {v}
                </button>
              ))}
            </div>
            <div style={{
              position: 'absolute',
              bottom: 'calc(env(safe-area-inset-bottom) + 2vw)',
              left: '75vw',
              transform: 'translateX(-50%)',
              display: 'flex',
              flexDirection: 'row',
              gap: '1vw',
              zIndex: 10,
            }}>
              {[4, 2, 0].map(v => (
                <button
                  key={v}
                  data-testid={`opponent-scenario-${v}`}
                  onClick={() => onOpponentScenarioSelect?.(v)}
                  disabled={disabledOpp.has(v)}
                  style={SCENARIO_BTN(pendingOpponentScenario === v, disabledOpp.has(v))}
                >
                  {v}
                </button>
              ))}
            </div>
          </>
        )
      })()}

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
