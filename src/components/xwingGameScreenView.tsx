import { useDragScrubber } from '../hooks/useDragScrubber'
import AppScreenLayout from './layout/appScreenLayout'
import { BackIcon, CogIcon, HelpIcon, LogIcon } from './icons'
import TimerDisplay from './shared/timerDisplay'
import GameLogOverlay from './gameLogOverlay'
import InitiativeToggle from './initiativeToggle'
import { NAV_BTN_STYLE } from '../styles/navButton'
import { BAR_CONTAINER_STYLE } from '../styles/barContainer'
import { START_TEXT_STYLE } from '../styles/startText'
import { useRef, Fragment } from 'react'
import type { HistoryEntry } from '../hooks/useGameHistory'
import type { Initiative } from '../hooks/useInitiative'
import type { XwingPilot } from '../utils/parseXwsText'
import { displayPilots } from '../utils/displayPilots'
import type { ShipEntry } from '../utils/shipRoster'

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
  playerPilots?: XwingPilot[]
  opponentPilots?: XwingPilot[]
  playerShips?: ShipEntry[]
  opponentShips?: ShipEntry[]
  onPlayerShipAdvance?: (index: number, skip: boolean) => void
  onOpponentShipAdvance?: (index: number, skip: boolean) => void
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
  width: '100%',
  height: '10vmin',
  minHeight: '36px',
  background: selected ? 'rgba(var(--color-accent-rgb), 0.15)' : 'rgba(0,0,0,0.45)',
  color: selected ? 'var(--color-accent)' : 'var(--color-text-muted)',
  border: `2px solid ${selected ? 'var(--color-accent)' : 'var(--color-ui-border)'}`,
  borderRadius: '8px',
  fontSize: 'clamp(0.65rem, 2vmin, 1rem)',
  fontWeight: '300',
  cursor: disabled ? 'default' : 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  WebkitTapHighlightColor: 'transparent',
  opacity: disabled ? 0.4 : 1,
})

const LONG_PRESS_MS = 400

function DmgCtrlIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 192 192" style={{ width: '100%', height: '100%' }} xmlns="http://www.w3.org/2000/svg">
      <path d="M 96,26 L 103.2,77.2 L 141.3,42.7 L 113.8,86.1 L 138.3,88.9 L 116.2,99.9 L 156.9,131.3 L 109.2,111.8 L 110.8,136.5 L 96.0,116.6 L 72.3,162.3 L 83.2,111.8 L 59.3,117.6 L 76.3,99.9 L 27.3,108.4 L 78.7,86.1 L 51.2,42.7 L 89.4,77.2 Z"
        fill="none" stroke="rgba(0,0,0,0.6)" strokeWidth="11" strokeLinejoin="round" transform="translate(1,1)" />
      <path d="M 96,26 L 103.2,77.2 L 141.3,42.7 L 113.8,86.1 L 138.3,88.9 L 116.2,99.9 L 156.9,131.3 L 109.2,111.8 L 110.8,136.5 L 96.0,116.6 L 72.3,162.3 L 83.2,111.8 L 59.3,117.6 L 76.3,99.9 L 27.3,108.4 L 78.7,86.1 L 51.2,42.7 L 89.4,77.2 Z"
        fill="none" stroke={color} strokeWidth="8" strokeLinejoin="round" />
    </svg>
  )
}

function ShipButton({ entry, index, onAdvance, align, side, displayName }: {
  entry: ShipEntry
  index: number
  onAdvance: (index: number, skip: boolean) => void
  align: 'left' | 'right'
  side: 'player' | 'opponent'
  displayName: string
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startPos = useRef<{ x: number; y: number } | null>(null)

  const cancel = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    startPos.current = { x: e.clientX, y: e.clientY }
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      onAdvance(index, true)
    }, LONG_PRESS_MS)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!startPos.current) return
    if (Math.abs(e.clientX - startPos.current.x) > 10 || Math.abs(e.clientY - startPos.current.y) > 10) cancel()
  }

  const onPointerUp = () => {
    if (timerRef.current) { cancel(); onAdvance(index, false) }
  }

  const isHalf = entry.state === 'half'
  const color = isHalf ? 'var(--color-warning)' : 'var(--color-accent)'

  const iconEl = (
    <button
      data-testid={`${side}-ship-btn-${index}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={cancel}
      style={{
        width: '3vmin',
        height: '3vmin',
        minWidth: '20px',
        minHeight: '20px',
        background: 'transparent',
        border: `1.5px solid ${color}`,
        borderRadius: '5px',
        padding: '1px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        WebkitTapHighlightColor: 'transparent',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      <DmgCtrlIcon color={color} />
    </button>
  )

  const nameEl = (
    <span style={{
      flex: 1,
      fontSize: 'clamp(0.7rem, 2.2vmin, 1.2rem)',
      fontWeight: '300',
      color,
      letterSpacing: '0.04em',
      lineHeight: 1.2,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      minWidth: 0,
      textAlign: align === 'right' ? 'right' : 'left',
    }}>
      {displayName}
    </span>
  )

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      gap: '1vmin',
      width: '100%',
      justifyContent: align === 'left' ? 'flex-start' : 'flex-end',
    }}>
      {align === 'left' ? <>{iconEl}{nameEl}</> : <>{nameEl}{iconEl}</>}
    </div>
  )
}

function roundTrackerColor(remaining: number): string {
  if (remaining <= 60) return 'var(--color-error)'
  if (remaining <= 300) return 'var(--color-warning)'
  return 'var(--color-accent)'
}

const NAV_BTN: React.CSSProperties = { ...NAV_BTN_STYLE, zIndex: 10 }

const COUNTER_BTN = (disabled: boolean): React.CSSProperties => ({
  ...NAV_BTN_STYLE,
  color: disabled ? 'var(--color-ui-border)' : 'var(--color-accent)',
  border: `2px solid ${disabled ? 'var(--color-ui-border)' : 'var(--color-accent)'}`,
  fontSize: '4vmin',
  cursor: disabled ? 'default' : 'pointer',
  boxShadow: disabled ? 'none' : '0 0 12px rgba(var(--color-accent-rgb), 0.3)',
  userSelect: 'none',
  WebkitUserSelect: 'none',
  opacity: disabled ? 0.4 : 1,
  zIndex: 10,
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
  playerPilots,
  opponentPilots,
  playerShips,
  opponentShips,
  onPlayerShipAdvance,
  onOpponentShipAdvance,
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

  const disabledPlayerSet: Set<number> = scenarioAlreadyScoredThisRound
    ? new Set([0, 2, 4])
    : getDisabledPlayerValues(scenario, pendingOpponentScenario ?? null)
  const disabledOppSet: Set<number> = scenarioAlreadyScoredThisRound
    ? new Set([0, 2, 4])
    : getDisabledOpponentValues(scenario, pendingPlayerScenario ?? null)

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

      {/* Main content — top-down; spacer clears nav/round-tracker; bounded row fills remaining height */}
      <div style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        touchAction: 'none',
      }}>
        <div style={{ flexShrink: 0, height: 'calc(env(safe-area-inset-top) + 9vw)' }} />

        <div style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'stretch',
          gap: '2vmin',
          paddingLeft: 'calc(env(safe-area-inset-left) + 8vw)',
          paddingRight: 'calc(env(safe-area-inset-right) + 8vw)',
          paddingBottom: `calc(env(safe-area-inset-bottom) + ${gameStarted && scenarioScoringActive ? '2vw' : gameStarted ? '8vw' : '2vw'})`,
          // Pin score row centre to the INIT label centre in the initiative bar (both pre-game and in-game).
          // INIT label Y = 50vh + (safe_top−safe_bottom)/2 (it sits at top:50% inside the bar which
          // spans env(safe-area-inset-top)+9vw → env(safe-area-inset-bottom)+9vw).
          // Score row centre = topSpacer(safe_top+9vw) + paddingTop + buttonSlot(10vmin) + ½scoreRow(7vmin);
          // solving for paddingTop gives:  33vmin − 9vw − safe_top/2 − safe_bottom/2
          paddingTop: 'max(0px, calc(33vmin - 9vw - env(safe-area-inset-top) / 2 - env(safe-area-inset-bottom) / 2))',
          boxSizing: 'border-box',
        }}>

          {/* ── Player column ── */}
          <div style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            position: 'relative',
          }}>
            {/* Inc/Dec overlay — vertically centred between round-tracker bottom and score row top.
                Column top = safe_top+9vw+paddingTop (row paddingTop shifts the column element).
                top (col coords) = −3.5vw + 5vmin + min(0, 4.5vw−16.5vmin+safe/4) — see derivation
                in git history. Horizontally right-aligned: + RHS sits at the DmgCtrl icon edge. */}
            {gameStarted && !scenarioScoringActive && !(opponentShips && opponentShips.length > 0) && (
              <div style={{
                position: 'absolute',
                top: 'calc(-3.5vw + 5vmin + min(0px, 4.5vw - 16.5vmin + env(safe-area-inset-top) / 4 + env(safe-area-inset-bottom) / 4))',
                left: 0,
                right: 0,
                height: '5vw',
                minHeight: '36px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                paddingRight: 'calc(50% - 14vmin)',
                gap: '2vmin',
              }}>
                <button
                  data-testid="player-decrement"
                  onClick={playerScrubber.handleClick('-')}
                  onPointerDown={playerScrubber.handlePointerDown('-')}
                  onPointerMove={playerScrubber.handlePointerMove}
                  onPointerUp={playerScrubber.handlePointerUp}
                  onPointerCancel={playerScrubber.handlePointerCancel}
                  disabled={gameOver}
                  style={COUNTER_BTN(gameOver)}
                >−</button>
                <button
                  data-testid="player-increment"
                  onClick={playerScrubber.handleClick('+')}
                  onPointerDown={playerScrubber.handlePointerDown('+')}
                  onPointerMove={playerScrubber.handlePointerMove}
                  onPointerUp={playerScrubber.handlePointerUp}
                  onPointerCancel={playerScrubber.handlePointerCancel}
                  disabled={gameOver}
                  style={COUNTER_BTN(gameOver)}
                >+</button>
              </div>
            )}

            {/* Button slot — fixed 10vmin; reserved for alignment (scenario buttons moved to centre column) */}
            <div style={{ height: '10vmin', minHeight: '36px' }} />

            {/* Score row — fixed height matches centre timer so all three centres align */}
            <div style={{ height: '14vmin', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '3vmin' }}>
              <div style={{
                fontSize: 'clamp(0.75rem, 2.2vmin, 1.2rem)',
                fontWeight: '300',
                color: 'var(--color-text-muted)',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}>
                You
              </div>
              <div
                data-testid="player-score"
                style={{
                  fontSize: '14vmin',
                  fontWeight: '300',
                  color: 'var(--color-text-primary)',
                  textShadow: '0 0 20px rgba(var(--color-accent-rgb), 0.4), 0 0 8px rgba(0,0,0,1)',
                  lineHeight: 1,
                  width: '3ch',
                  textAlign: 'center',
                }}
              >
                {gameStarted ? playerScore : 0}
              </div>
            </div>
            </div>

            {/* Pilot area — ship buttons in-game, text list pre-game, spacer if no list; no scroll */}
            {gameStarted && playerShips && playerShips.length > 0 ? (
              <div data-testid="player-pilot-list" style={{
                flex: 1,
                minHeight: 0,
                width: '100%',
                boxSizing: 'border-box',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5vmin',
                paddingTop: '1vmin',
                // Align icon RHS with score right edge = column_centre + ½score_row_width (≈14vmin)
                paddingRight: 'calc(50% - 14vmin)',
              }}>
                {(() => {
                  const names = displayPilots(playerShips.map(e => e.pilot))
                  return playerShips.map((entry, i) =>
                    entry.state !== 'destroyed' ? (
                      <ShipButton key={i} entry={entry} index={i} onAdvance={onPlayerShipAdvance!} align="right" side="player" displayName={names[i].displayName} />
                    ) : null
                  )
                })()}
              </div>
            ) : playerPilots && playerPilots.length > 0 ? (
              <div data-testid="player-pilot-list" style={{
                flex: 1,
                minHeight: 0,
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5vmin',
                // paddingTop: push first ship down so ship 8 bottom aligns with log button bottom.
                // Derivation: pilot_list_height = 43vmin − 2vw − (safe_top+safe_bottom)/2;
                // paddingTop = pilot_list_height − 8×2.64vmin − 7×0.5vmin = 18vmin − 2vw − safe/2
                paddingTop: 'max(0px, calc(13.5vmin - 1.5vw - env(safe-area-inset-top) / 2 - env(safe-area-inset-bottom) / 2))',
                // paddingLeft: shifts text centre 3.5vmin right (= half of label+gap = (label+3vmin)/2)
                // so the list centre aligns with the score number centre, not the column centre.
                paddingLeft: '7vmin',
              }}>
                {displayPilots(playerPilots).map((p, i) => (
                  <div key={i} style={{
                    fontSize: 'clamp(0.75rem, 2.2vmin, 1.2rem)',
                    fontWeight: '300',
                    color: 'var(--color-text-muted)',
                    textAlign: 'center',
                    letterSpacing: '0.04em',
                    lineHeight: 1.2,
                  }}>
                    {p.displayName}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ flex: 1 }} />
            )}
          </div>

          {/* ── Centre column: result banner / Start Game / Timer ── */}
          <div style={{
            width: '22vmin',
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            flexShrink: 0,
          }}>
            {/* Button slot — phase button (aligns with outer inc/dec and scenario slots) */}
            <div style={{ height: '10vmin', minHeight: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {enableXwingPhases && gameStarted && !gameOver && (
                <button
                  data-testid="phase-btn"
                  onClick={onPhaseAdvance}
                  style={{
                    height: '10vmin',
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

            {/* Timer/result/start — height matches score row (14vmin) so all three centres align */}
            <div style={{
              height: '14vmin',
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

            {/* Scenario name slot — locked directly below timer, same 10vmin slot as phase above */}
            <div style={{ height: '10vmin', minHeight: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {gameStarted && scenario && scenario !== 'None' && (
                <div
                  data-testid="scenario-name"
                  style={{
                    fontSize: 'clamp(0.8rem, 2.5vmin, 1.4rem)',
                    fontWeight: '300',
                    color: 'var(--color-text-muted)',
                    letterSpacing: '0.04em',
                    textAlign: 'center',
                    whiteSpace: 'nowrap',
                    lineHeight: 1.3,
                  }}
                >
                  {scenario}
                </div>
              )}
            </div>

            {/* Spacer — pushes scenario grid to the bottom */}
            <div style={{ flexGrow: 1 }} />

            {/* Scenario scoring grid — 2×3, left col = player, right col = opponent.
                Column width = 5vw (matches nav buttons). Gap widens to keep outer edges
                level with the timer digit edges: timer ≈ 4ch+1em in 8vmin font. */}
            {gameStarted && scenarioScoringActive && (
              <div style={{
                display: 'grid',
                gridTemplateColumns: '5vw 5vw',
                columnGap: 'max(2vmin, calc(4ch + 1em - 10vw))',
                rowGap: '2vmin',
                fontSize: 'clamp(1.2rem, 8vmin, 3.5rem)',
                alignSelf: 'center',
                paddingBottom: '2vmin',
              }}>
                {[0, 2, 4].map(v => (
                  <Fragment key={v}>
                    <button
                      data-testid={`player-scenario-${v}`}
                      onClick={() => onPlayerScenarioSelect?.(v)}
                      disabled={disabledPlayerSet.has(v)}
                      style={{
                        ...SCENARIO_BTN(pendingPlayerScenario === v, disabledPlayerSet.has(v)),
                        height: undefined,
                        minHeight: '36px',
                        aspectRatio: '1 / 1',
                        fontSize: 'clamp(0.65rem, 2vmin, 1rem)',
                      }}
                    >
                      {v}
                    </button>
                    <button
                      data-testid={`opponent-scenario-${v}`}
                      onClick={() => onOpponentScenarioSelect?.(v)}
                      disabled={disabledOppSet.has(v)}
                      style={{
                        ...SCENARIO_BTN(pendingOpponentScenario === v, disabledOppSet.has(v)),
                        height: undefined,
                        minHeight: '36px',
                        aspectRatio: '1 / 1',
                        fontSize: 'clamp(0.65rem, 2vmin, 1rem)',
                      }}
                    >
                      {v}
                    </button>
                  </Fragment>
                ))}
              </div>
            )}

          </div>

          {/* ── Opponent column ── */}
          <div style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            position: 'relative',
          }}>
            {/* Inc/Dec overlay — same vertical formula as player; left-aligned so
                − LHS sits at the opponent DmgCtrl icon edge. */}
            {gameStarted && !scenarioScoringActive && !(playerShips && playerShips.length > 0) && (
              <div style={{
                position: 'absolute',
                top: 'calc(-3.5vw + 5vmin + min(0px, 4.5vw - 16.5vmin + env(safe-area-inset-top) / 4 + env(safe-area-inset-bottom) / 4))',
                left: 0,
                right: 0,
                height: '5vw',
                minHeight: '36px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-start',
                paddingLeft: 'calc(50% - 14vmin)',
                gap: '2vmin',
              }}>
                <button
                  data-testid="opponent-decrement"
                  onClick={opponentScrubber.handleClick('-')}
                  onPointerDown={opponentScrubber.handlePointerDown('-')}
                  onPointerMove={opponentScrubber.handlePointerMove}
                  onPointerUp={opponentScrubber.handlePointerUp}
                  onPointerCancel={opponentScrubber.handlePointerCancel}
                  disabled={gameOver}
                  style={COUNTER_BTN(gameOver)}
                >−</button>
                <button
                  data-testid="opponent-increment"
                  onClick={opponentScrubber.handleClick('+')}
                  onPointerDown={opponentScrubber.handlePointerDown('+')}
                  onPointerMove={opponentScrubber.handlePointerMove}
                  onPointerUp={opponentScrubber.handlePointerUp}
                  onPointerCancel={opponentScrubber.handlePointerCancel}
                  disabled={gameOver}
                  style={COUNTER_BTN(gameOver)}
                >+</button>
              </div>
            )}

            {/* Button slot — reserved for alignment (scenario buttons moved to centre column) */}
            <div style={{ height: '10vmin', minHeight: '36px' }} />

            {/* Score row — fixed height matches centre timer so all three centres align */}
            <div style={{ height: '14vmin', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '3vmin' }}>
              <div
                data-testid="opponent-score"
                style={{
                  fontSize: '14vmin',
                  fontWeight: '300',
                  color: 'var(--color-text-primary)',
                  textShadow: '0 0 20px rgba(var(--color-accent-rgb), 0.4), 0 0 8px rgba(0,0,0,1)',
                  lineHeight: 1,
                  width: '3ch',
                  textAlign: 'center',
                }}
              >
                {gameStarted ? opponentScore : 0}
              </div>
              <div style={{
                fontSize: 'clamp(0.75rem, 2.2vmin, 1.2rem)',
                fontWeight: '300',
                color: 'var(--color-text-muted)',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}>
                Opp
              </div>
            </div>
            </div>

            {/* Pilot area: ship buttons when in-game, text list pre-game, spacer if no list */}
            {gameStarted && opponentShips && opponentShips.length > 0 ? (
              <div data-testid="opponent-pilot-list" style={{
                flex: 1,
                minHeight: 0,
                width: '100%',
                boxSizing: 'border-box',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5vmin',
                paddingTop: '1vmin',
                // Align icon LHS with score left edge = column_centre − ½score_row_width (≈14vmin)
                paddingLeft: 'calc(50% - 14vmin)',
              }}>
                {(() => {
                  const names = displayPilots(opponentShips.map(e => e.pilot))
                  return opponentShips.map((entry, i) =>
                    entry.state !== 'destroyed' ? (
                      <ShipButton key={i} entry={entry} index={i} onAdvance={onOpponentShipAdvance!} align="left" side="opponent" displayName={names[i].displayName} />
                    ) : null
                  )
                })()}
              </div>
            ) : opponentPilots && opponentPilots.length > 0 ? (
              <div data-testid="opponent-pilot-list" style={{
                flex: 1,
                minHeight: 0,
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5vmin',
                paddingTop: 'max(0px, calc(13.5vmin - 1.5vw - env(safe-area-inset-top) / 2 - env(safe-area-inset-bottom) / 2))',
                paddingRight: '7vmin',
              }}>
                {displayPilots(opponentPilots).map((p, i) => (
                  <div key={i} style={{
                    fontSize: 'clamp(0.75rem, 2.2vmin, 1.2rem)',
                    fontWeight: '300',
                    color: 'var(--color-text-muted)',
                    textAlign: 'center',
                    letterSpacing: '0.04em',
                    lineHeight: 1.2,
                  }}>
                    {p.displayName}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ flex: 1 }} />
            )}
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
