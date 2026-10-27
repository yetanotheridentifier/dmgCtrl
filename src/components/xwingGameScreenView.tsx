import { useRef, useState } from 'react'
import AppScreenLayout from './layout/appScreenLayout'
import { BackIcon, DotsIcon, LogIcon } from './icons'
import TimerDisplay from './shared/timerDisplay'
import { Button, IconButton, SegmentedControl, Sheet, Stepper } from './shared/controls'
import type { HistoryEntry } from '../hooks/useGameHistory'
import type { Initiative } from '../hooks/useInitiative'
import { halfPoints, type ShipEntry } from '../utils/shipRoster'
import { shipRows } from '../utils/shipRows'
import { resolveXwsName } from '../utils/resolveXwsName'
import { shipNames } from '../utils/xwaNames'
import { xwaPilots } from '../data/xwaCards'
import { FactionIcon } from './factionIcon'

export type GameOverReason = 'score' | 'time' | 'rounds' | 'extra'

// One side's final score, by where it came from.
export interface ScoreBreakdown {
  mission: number
  ships: number
  deficit: number
  // Points added or taken away with the −/+ buttons.
  adjustments: number
  total: number
}

interface Props {
  gameStarted: boolean
  gameOver: boolean
  gameOverReason: GameOverReason | null
  result: 'win' | 'loss' | 'draw' | null
  timerRemaining: number
  timerMinutes: number
  onTimerMinutesChange: (minutes: number) => void
  round: number
  roundEndsGame: boolean
  phase: string
  onPhaseAdvance: () => void
  enableXwingPhases: boolean
  onStartGame: () => void
  scoringOpen: boolean
  onOpenScoring: () => void
  onEndOfRound: () => void
  playerScore: number
  opponentScore: number
  onPlayerIncrement: (n: number) => void
  onPlayerDecrement: (n: number) => void
  onOpponentIncrement: (n: number) => void
  onOpponentDecrement: (n: number) => void
  enableXwingAlwaysIncDec?: boolean
  logEntries: HistoryEntry<{ round: number }>[]
  logOpen: boolean
  onLogToggle: () => void
  onLogUndo: () => void
  initiative: Initiative
  onInitiativeOpponent: () => void
  onInitiativePlayer: () => void
  onBack: () => void
  onHelp: () => void
  onSettings?: () => void
  scenario?: string
  scenarioScoringActive?: boolean
  scenarioAlreadyScoredThisRound?: boolean
  pendingPlayerScenario?: number | null
  pendingOpponentScenario?: number | null
  onPlayerScenarioSelect?: (v: number) => void
  onOpponentScenarioSelect?: (v: number) => void
  playerShips: ShipEntry[]
  opponentShips: ShipEntry[]
  playerNames: string[]
  opponentNames: string[]
  onPlayerShipAdvance: (index: number, skip: boolean) => void
  onOpponentShipAdvance: (index: number, skip: boolean) => void
  onRematch: () => void
  // Offered only in a Casual game that ended on time or after its last round.
  onOneMoreRound?: () => void
  // A tournament game: game over offers only this, which records the round.
  onBackToTournament?: () => void
  playerBreakdown: ScoreBreakdown
  opponentBreakdown: ScoreBreakdown
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

const PRE_GAME_HINT = 'Tap a ship to damage it; tap again or long-press to destroy'
const LONG_PRESS_MS = 400

const CAPS: React.CSSProperties = { fontSize: '11px', letterSpacing: '0.14em', color: 'var(--color-accent)' }
const MUTED_CAPS: React.CSSProperties = { fontSize: '11px', letterSpacing: '0.1em', color: 'var(--color-text-muted)' }
const PANEL_BLOCK: React.CSSProperties = { borderRadius: '12px', background: 'var(--color-surface)' }

// The symbol before a ship's name: its faction's, or the dmgCtrl mark once it is destroyed.
const NAME_LEAD: React.CSSProperties = { verticalAlign: '-2px', marginRight: '6px' }

// The dmgCtrl mark, in outline: a destroyed ship shows it in place of its faction symbol.
function DestroyedMark() {
  return (
    <svg width="14" height="14" viewBox="19 21 146 146" fill="none" stroke="currentColor" strokeWidth="14" strokeLinejoin="round" role="img" aria-label="Destroyed" style={NAME_LEAD}>
      <path d="M96 26L103.2 77.2L141.3 42.7L113.8 86.1L138.3 88.9L116.2 99.9L156.9 131.3L109.2 111.8L110.8 136.5L96 116.6L72.3 162.3L83.2 111.8L59.3 117.6L76.3 99.9L27.3 108.4L78.7 86.1L51.2 42.7L89.4 77.2Z" />
    </svg>
  )
}

const TILE_COLOURS = {
  alive: { background: 'var(--color-tonal)', color: 'var(--color-text-primary)', sub: '#9fd8f5' },
  half: { background: '#3d2a0c', color: '#ffd08a', sub: '#ffd08a' },
  destroyed: { background: '#11151e', color: '#8b93a1', sub: '#8b93a1' },
}

function ShipTile({ entry, name, testId, full, disabled, gameOver, onAdvance }: {
  entry: ShipEntry
  name: string
  testId: string
  // A full-width row shows the ship type and points; a paired tile shows the points under the name.
  full: boolean
  disabled: boolean
  gameOver: boolean
  onAdvance: (skip: boolean) => void
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
      onAdvance(true)
    }, LONG_PRESS_MS)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!startPos.current) return
    if (Math.abs(e.clientX - startPos.current.x) > 10 || Math.abs(e.clientY - startPos.current.y) > 10) cancel()
  }
  const onPointerUp = () => {
    if (timerRef.current) { cancel(); onAdvance(false) }
  }

  const pts = entry.pilot.points
  const colours = TILE_COLOURS[entry.state]
  const destroyed = entry.state === 'destroyed'
  const status = entry.state === 'half' ? `Half · ${halfPoints(pts)} of ${pts}`
    : destroyed ? (full ? 'Destroyed' : `Destroyed · ${pts}`)
    : gameOver ? 'Survived'
    : full ? resolveXwsName(entry.pilot.ship, shipNames) : `${pts} pts`

  return (
    <button
      type="button"
      data-testid={testId}
      disabled={disabled || destroyed}
      onPointerDown={disabled ? undefined : onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={disabled ? undefined : onPointerUp}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
      style={{
        border: 'none',
        borderRadius: '12px',
        background: colours.background,
        color: colours.color,
        padding: full ? '0 14px' : '0 10px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px',
        textAlign: 'left',
        minWidth: 0,
        minHeight: 0,
        fontFamily: 'inherit',
        cursor: disabled || destroyed ? 'default' : 'pointer',
        opacity: disabled && !gameOver ? 0.75 : 1,
        WebkitTapHighlightColor: 'transparent',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        touchAction: 'manipulation',
      }}
    >
      <span style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 }}>
        <span style={{ fontSize: full ? '16px' : '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: destroyed ? 'line-through' : undefined }}>
          {destroyed ? <DestroyedMark /> : <FactionIcon faction={xwaPilots[entry.pilot.name]?.faction} size={14} style={NAME_LEAD} />}{name}
        </span>
        <span style={{ fontSize: '12px', color: colours.sub }}>{status}</span>
      </span>
      {full && <span style={{ fontSize: '20px', fontWeight: 300, color: colours.sub }}>{pts}</span>}
    </button>
  )
}

function ShipColumn({ side, ships, names, disabled, gameOver, onAdvance }: {
  side: 'player' | 'opponent'
  ships: ShipEntry[]
  names: string[]
  disabled: boolean
  gameOver: boolean
  onAdvance: (index: number, skip: boolean) => void
}) {
  const rows = shipRows(ships.map(s => s.pilot))
  if (rows.length === 0) return <div style={{ flex: 1 }} />
  return (
    <div data-testid={`${side}-pilot-list`} style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateRows: `repeat(${Math.max(rows.length, 1)}, minmax(0, 1fr))`, gap: '8px' }}>
      {rows.map(row => (
        <div key={row.join('-')} data-testid="ship-row" style={{ display: 'grid', gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))`, gap: '8px', minHeight: 0 }}>
          {row.map(i => (
            <ShipTile
              key={i}
              entry={ships[i]}
              name={names[i] ?? ships[i].pilot.name}
              testId={`${side}-ship-btn-${i}`}
              full={row.length === 1}
              disabled={disabled}
              gameOver={gameOver}
              onAdvance={skip => onAdvance(i, skip)}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

// −/+ over a column stand in for its tiles, so those over the opponent's column score for you.
function ScoreButtons({ scorer, onIncrement, onDecrement, disabled }: {
  scorer: 'player' | 'opponent'
  onIncrement: () => void
  onDecrement: () => void
  disabled: boolean
}) {
  const style: React.CSSProperties = { flex: 1, fontSize: '22px', padding: 0 }
  const who = scorer === 'player' ? 'your' : "opponent's"
  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
      <span style={{ ...MUTED_CAPS, flex: 1 }}>{scorer === 'player' ? 'YOUR SCORE' : "OPP'S SCORE"}</span>
      <button type="button" data-testid={`${scorer}-decrement`} aria-label={`Take 1 from ${who} score`} disabled={disabled} onClick={onDecrement} style={{ ...counterStyle(disabled), ...style }}>−</button>
      <button type="button" data-testid={`${scorer}-increment`} aria-label={`Add 1 to ${who} score`} disabled={disabled} onClick={onIncrement} style={{ ...counterStyle(disabled), ...style }}>+</button>
    </div>
  )
}

const counterStyle = (disabled: boolean): React.CSSProperties => ({
  height: '44px',
  maxWidth: '64px',
  border: 'none',
  borderRadius: '12px',
  background: 'var(--color-surface-raised)',
  color: disabled ? 'var(--color-text-disabled)' : 'var(--color-text-primary)',
  fontFamily: 'inherit',
  cursor: disabled ? 'default' : 'pointer',
})

function ScoreTile({ side, score, first }: { side: 'player' | 'opponent'; score: number; first: boolean }) {
  return (
    <div data-testid={`${side}-score-tile`} style={{ ...PANEL_BLOCK, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px', padding: '6px 0' }}>
      <span style={CAPS}>{side === 'player' ? 'YOU' : 'OPP'}</span>
      <span data-testid={`${side}-score`} style={{ fontSize: '30px', fontWeight: 300, lineHeight: 1 }}>{score}</span>
      <span style={{ ...MUTED_CAPS, fontSize: '10px', minHeight: '12px' }}>{first ? 'FIRST' : ''}</span>
    </div>
  )
}

function choiceStyle(selected: boolean, disabled: boolean): React.CSSProperties {
  return {
    flex: 1,
    height: '44px',
    border: 'none',
    borderRadius: '10px',
    fontFamily: 'inherit',
    fontSize: '15px',
    background: selected ? 'var(--color-accent)' : 'var(--color-surface-raised)',
    color: selected ? 'var(--color-on-accent)' : disabled ? 'var(--color-text-disabled)' : 'var(--color-text-primary)',
    fontWeight: selected ? 600 : 400,
    cursor: disabled ? 'default' : 'pointer',
  }
}

function MissionPoints({ round, scenario, alreadyScored, pendingPlayer, pendingOpponent, onPlayer, onOpponent }: {
  round: number
  scenario?: string
  alreadyScored: boolean
  pendingPlayer: number | null
  pendingOpponent: number | null
  onPlayer?: (v: number) => void
  onOpponent?: (v: number) => void
}) {
  const disabledPlayer = alreadyScored ? new Set([0, 2, 4]) : getDisabledPlayerValues(scenario, pendingOpponent)
  const disabledOpp = alreadyScored ? new Set([0, 2, 4]) : getDisabledOpponentValues(scenario, pendingPlayer)
  const row = (side: 'player' | 'opponent', selected: number | null, disabled: Set<number>, onSelect?: (v: number) => void) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
      <div style={{ width: '28px', ...MUTED_CAPS, fontSize: '10px' }}>{side === 'player' ? 'YOU' : 'OPP'}</div>
      {[0, 2, 4].map(v => (
        <button
          key={v}
          type="button"
          data-testid={`${side}-scenario-${v}`}
          aria-pressed={selected === v}
          disabled={disabled.has(v)}
          onClick={() => onSelect?.(v)}
          style={choiceStyle(selected === v, disabled.has(v))}
        >
          {v}
        </button>
      ))}
    </div>
  )
  return (
    <div style={{ ...PANEL_BLOCK, display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px' }}>
      <div style={{ ...MUTED_CAPS, textAlign: 'center' }}>{`MISSION POINTS · ROUND ${round}`}</div>
      {row('player', pendingPlayer, disabledPlayer, onPlayer)}
      {row('opponent', pendingOpponent, disabledOpp, onOpponent)}
    </div>
  )
}

function BigButton({ testId, title, subtitle, onClick }: { testId: string; title: string; subtitle?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      style={{
        flex: 1,
        minHeight: '56px',
        border: 'none',
        borderRadius: '14px',
        background: 'var(--color-accent)',
        color: 'var(--color-on-accent)',
        fontFamily: 'inherit',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '2px',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <span style={{ fontSize: '20px', fontWeight: 600 }}>{title}</span>
      {subtitle && <span style={{ fontSize: '12px' }}>{subtitle}</span>}
    </button>
  )
}

const RESULT_TEXT = { win: 'Game won', loss: 'Game lost', draw: 'Draw' }
const RESULT_COLOUR = { win: 'var(--color-success)', loss: 'var(--color-error)', draw: 'var(--color-text-primary)' }

function reasonText(reason: GameOverReason | null, round: number): string | null {
  if (reason === 'time') return `Time ran out in round ${round}`
  if (reason === 'rounds') return `Round ${round} finished`
  if (reason === 'extra') return `One more round played`
  if (reason === 'score') return `50 points reached in round ${round}`
  return null
}

function Breakdown({ player, opponent, result }: { player: ScoreBreakdown; opponent: ScoreBreakdown; result: 'win' | 'loss' | 'draw' }) {
  const rows: [string, keyof ScoreBreakdown][] = [['Mission', 'mission'], ['Ships', 'ships'], ['Deficit', 'deficit']]
  if (player.adjustments !== 0 || opponent.adjustments !== 0) rows.push(['−/+', 'adjustments'])
  const cell: React.CSSProperties = { textAlign: 'right', fontVariantNumeric: 'tabular-nums' }
  return (
    <table data-testid="score-breakdown" style={{ ...PANEL_BLOCK, width: '100%', borderSpacing: 0, padding: '4px 8px', fontSize: '12px', color: 'var(--color-text-body)' }}>
      <thead>
        <tr><th /><th style={{ ...cell, ...CAPS, fontWeight: 400 }}>YOU</th><th style={{ ...cell, ...CAPS, fontWeight: 400 }}>OPP</th></tr>
      </thead>
      <tbody>
        {rows.map(([label, key]) => (
          <tr key={key}>
            <td>{label}</td>
            <td data-testid={`breakdown-player-${key}`} style={cell}>{player[key]}</td>
            <td data-testid={`breakdown-opponent-${key}`} style={cell}>{opponent[key]}</td>
          </tr>
        ))}
        <tr style={{ fontWeight: 600 }}>
          <td>Total</td>
          <td data-testid="breakdown-player-total" style={{ ...cell, color: result === 'win' ? RESULT_COLOUR.win : result === 'loss' ? RESULT_COLOUR.loss : undefined }}>{player.total}</td>
          <td data-testid="breakdown-opponent-total" style={{ ...cell, color: result === 'loss' ? RESULT_COLOUR.win : result === 'win' ? RESULT_COLOUR.loss : undefined }}>{opponent.total}</td>
        </tr>
      </tbody>
    </table>
  )
}

const NEXT_PHASE: Record<string, string> = { Planning: 'System', System: 'Activation', Activation: 'Engagement', Engagement: 'End' }

// Newest first, under the round each entry belongs to. A 'round' entry starts its round.
function LogDrawer({ open, entries, onClose, onUndo }: {
  open: boolean
  entries: HistoryEntry<{ round: number }>[]
  onClose: () => void
  onUndo: () => void
}) {
  const groups: { title: string; entry?: HistoryEntry<{ round: number }>; items: HistoryEntry<{ round: number }>[] }[] = []
  for (const e of entries) {
    if (e.type === 'round') groups.push({ title: e.message, entry: e, items: [] })
    else if (groups.length === 0) groups.push({ title: 'Before the game', items: [e] })
    else groups[groups.length - 1].items.push(e)
  }
  const newest = entries[entries.length - 1]
  const undo = (
    <button type="button" data-testid="log-undo-btn" onClick={onUndo} style={{ height: '44px', padding: '0 14px', border: 'none', borderRadius: '10px', background: 'var(--color-accent)', color: 'var(--color-on-accent)', fontFamily: 'inherit', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}>
      Undo
    </button>
  )
  return (
    <Sheet open={open} title="Log" onClose={onClose}>
      {entries.length === 0 && <div style={{ color: 'var(--color-text-muted)' }}>No actions yet</div>}
      {[...groups].reverse().map((g, gi) => (
        <div key={g.entry?.id ?? `g${gi}`} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minHeight: '24px' }}>
            <span style={{ ...MUTED_CAPS, flex: 1, textTransform: 'uppercase' }}><span>{g.title}</span>{gi === 0 && ' · newest first'}</span>
            {g.entry && g.entry === newest && undo}
          </div>
          {[...g.items].reverse().map(e => (
            <div key={e.id} data-testid="log-entry" style={{ display: 'flex', alignItems: 'center', gap: '10px', minHeight: '44px', padding: '4px 4px 4px 12px', boxSizing: 'border-box', borderRadius: '12px', background: e === newest ? 'var(--color-tonal)' : 'var(--color-surface)' }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span style={{ fontSize: '14px' }}>{e.message}</span>
                {e.detail && <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>{e.detail}</span>}
              </div>
              {e === newest && undo}
            </div>
          ))}
        </div>
      ))}
      {entries.length > 0 && (
        <div style={{ fontSize: '12px', lineHeight: '16px', color: 'var(--color-text-muted)' }}>Undo takes back the newest entry. Repeat to step further back.</div>
      )}
    </Sheet>
  )
}

export default function XwingGameScreenView(props: Props) {
  const {
    gameStarted, gameOver, gameOverReason, result, timerRemaining, timerMinutes, onTimerMinutesChange,
    round, roundEndsGame, phase, onPhaseAdvance, enableXwingPhases, onStartGame, scoringOpen, onOpenScoring, onEndOfRound,
    playerScore, opponentScore, onPlayerIncrement, onPlayerDecrement, onOpponentIncrement, onOpponentDecrement,
    enableXwingAlwaysIncDec = false, logEntries, logOpen, onLogToggle, onLogUndo,
    initiative, onInitiativeOpponent, onInitiativePlayer, onBack, onHelp, onSettings,
    scenario, scenarioScoringActive = false, scenarioAlreadyScoredThisRound = false,
    pendingPlayerScenario = null, pendingOpponentScenario = null, onPlayerScenarioSelect, onOpponentScenarioSelect,
    playerShips, opponentShips, playerNames, opponentNames, onPlayerShipAdvance, onOpponentShipAdvance,
    onRematch, onOneMoreRound, onBackToTournament, playerBreakdown, opponentBreakdown,
  } = props
  const [openSheet, setOpenSheet] = useState<null | 'more' | 'timer'>(null)
  const close = () => setOpenSheet(null)

  const playing = gameStarted && !gameOver
  const tilesDisabled = !playing
  // Over your column: the opponent's score (your ships lost). Over theirs: yours.
  // Mission scoring takes the round's end, so the buttons step aside unless they are always shown.
  const showOverPlayerColumn = gameStarted && (enableXwingAlwaysIncDec || (playerShips.length === 0 && !scenarioScoringActive))
  const showOverOpponentColumn = gameStarted && (enableXwingAlwaysIncDec || (opponentShips.length === 0 && !scenarioScoringActive))
  const nextRoundLabel = roundEndsGame ? 'End game' : `Start round ${round + 1}`

  const header = (side: 'player' | 'opponent') => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', height: '44px', flexShrink: 0 }}>
      {side === 'player' && <IconButton label={onBackToTournament ? 'Back to tournament' : 'Back to setup'} onClick={onBack}><BackIcon /></IconButton>}
      <div style={{ ...CAPS, fontSize: '12px', flex: 1, textAlign: side === 'player' ? 'left' : 'right' }}>
        {side === 'player' ? 'YOUR SHIPS' : "OPPONENT'S SHIPS"}
      </div>
      {side === 'opponent' && (
        <button type="button" data-testid="log-btn" aria-label="Log" onClick={onLogToggle} style={{ width: '44px', height: '44px', border: 'none', borderRadius: '12px', background: 'var(--color-surface-raised)', color: 'var(--color-text-body)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <LogIcon />
        </button>
      )}
      {side === 'opponent' && <IconButton label="More: help and settings" onClick={() => setOpenSheet('more')}><DotsIcon /></IconButton>}
    </div>
  )

  const centre = (() => {
    if (!gameStarted) {
      return (
        <>
          <div style={{ flex: 1 }} />
          <Button variant="primary" onClick={onStartGame} style={{ minHeight: '56px' }}>
            <span data-testid="start-game-btn">Start game</span>
          </Button>
        </>
      )
    }
    if (gameOver && result) {
      const reason = reasonText(gameOverReason, round)
      return (
        <>
          <div data-testid="result-banner" style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontSize: '18px', fontWeight: 600, color: RESULT_COLOUR[result] }}>{RESULT_TEXT[result]}</span>
            {reason && <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>{reason}</span>}
          </div>
          <Breakdown player={playerBreakdown} opponent={opponentBreakdown} result={result} />
          <div style={{ flex: 1 }} />
          {onBackToTournament ? <Button variant="primary" onClick={onBackToTournament}>Back to tournament</Button> : (
            <>
              <Button variant="primary" onClick={onRematch}>Rematch</Button>
              {onOneMoreRound && <Button onClick={onOneMoreRound}>One more round</Button>}
              <Button onClick={onBack}>New setup</Button>
            </>
          )}
        </>
      )
    }
    const mission = scenarioScoringActive && (
      <MissionPoints
        round={round}
        scenario={scenario}
        alreadyScored={scenarioAlreadyScoredThisRound}
        pendingPlayer={pendingPlayerScenario}
        pendingOpponent={pendingOpponentScenario}
        onPlayer={onPlayerScenarioSelect}
        onOpponent={onOpponentScenarioSelect}
      />
    )
    if (enableXwingPhases) {
      const subtitle = phase === 'End' ? (roundEndsGame ? 'Tap to end the game' : `Tap to start round ${round + 1}`) : `Tap for ${NEXT_PHASE[phase]}`
      return (
        <>
          {phase === 'Planning' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ ...MUTED_CAPS, textAlign: 'center', textTransform: 'uppercase' }}>Who has initiative?</div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button type="button" aria-pressed={initiative === 'player'} onClick={onInitiativePlayer} style={choiceStyle(initiative === 'player', false)}>You</button>
                <button type="button" aria-pressed={initiative === 'opponent'} onClick={onInitiativeOpponent} style={choiceStyle(initiative === 'opponent', false)}>Opponent</button>
              </div>
            </div>
          )}
          {mission}
          <BigButton testId="phase-btn" title={phase} subtitle={subtitle} onClick={onPhaseAdvance} />
        </>
      )
    }
    return (
      <>
        <SegmentedControl
          label="First"
          options={[{ value: 'player', label: 'You' }, { value: 'opponent', label: 'Opp' }]}
          value={initiative}
          onChange={v => (v === 'player' ? onInitiativePlayer() : onInitiativeOpponent())}
        />
        {scoringOpen
          ? <>{mission}<BigButton testId="next-round-btn" title={nextRoundLabel} subtitle={`Round ${round} scored`} onClick={onEndOfRound} /></>
          : <BigButton testId="round-btn" title={`Round ${round} of 12`} subtitle="Tap to score the round" onClick={onOpenScoring} />}
      </>
    )
  })()

  // Initiative shows as FIRST under a score once Planning is over (or at any time with phases off).
  const showFirst = playing && (!enableXwingPhases || phase !== 'Planning')

  return (
    <AppScreenLayout>
      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) clamp(180px, 24vw, 240px) minmax(0, 1fr)', gap: '12px', color: 'var(--color-text-primary)' }}>
        <div data-testid="player-column" style={{ display: 'flex', flexDirection: 'column', gap: '10px', minHeight: 0 }}>
          {header('player')}
          {!gameStarted && <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', textAlign: 'center' }}>{PRE_GAME_HINT}</div>}
          {showOverPlayerColumn && <ScoreButtons scorer="opponent" disabled={gameOver} onIncrement={() => onOpponentIncrement(1)} onDecrement={() => onOpponentDecrement(1)} />}
          <ShipColumn side="player" ships={playerShips} names={playerNames} disabled={tilesDisabled} gameOver={gameOver} onAdvance={onPlayerShipAdvance} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px', boxSizing: 'border-box', borderRadius: '16px', background: 'var(--color-sheet)', minHeight: 0, overflowY: 'auto', position: 'relative' }}>
          <button
            type="button"
            data-testid="round-timer-btn"
            onClick={() => setOpenSheet('timer')}
            style={{ height: '44px', flexShrink: 0, border: 'none', borderRadius: '12px', background: 'var(--color-surface)', color: 'var(--color-text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px', fontFamily: 'inherit', cursor: 'pointer' }}
          >
            <span style={{ fontSize: '14px', color: 'var(--color-text-muted)' }}>{enableXwingPhases ? `Round ${round} / 12` : 'Timer'}</span>
            <TimerDisplay remaining={timerRemaining} testId="xwing-timer" style={{ fontSize: '18px', fontWeight: 300, letterSpacing: '0.06em' }} />
          </button>
          {/* At game over the breakdown carries the totals, which leaves room for its choices. */}
          {!gameOver && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px', flexShrink: 0 }}>
              <ScoreTile side="player" score={playerScore} first={showFirst && initiative === 'player'} />
              <ScoreTile side="opponent" score={opponentScore} first={showFirst && initiative === 'opponent'} />
            </div>
          )}
          {playing && scenario && scenario !== 'None' && <div data-testid="scenario-name" style={{ ...MUTED_CAPS, textAlign: 'center' }}>{scenario}</div>}
          {centre}
        </div>

        <div data-testid="opponent-column" style={{ display: 'flex', flexDirection: 'column', gap: '10px', minHeight: 0 }}>
          {header('opponent')}
          {showOverOpponentColumn && <ScoreButtons scorer="player" disabled={gameOver} onIncrement={() => onPlayerIncrement(1)} onDecrement={() => onPlayerDecrement(1)} />}
          <ShipColumn side="opponent" ships={opponentShips} names={opponentNames} disabled={tilesDisabled} gameOver={gameOver} onAdvance={onOpponentShipAdvance} />
        </div>
      </div>

      <LogDrawer open={logOpen} entries={logEntries} onClose={onLogToggle} onUndo={onLogUndo} />

      <Sheet open={openSheet === 'more'} title="More" onClose={close}>
        <Button onClick={() => { close(); onHelp() }}>Help</Button>
        {onSettings && <Button onClick={() => { close(); onSettings() }}>Settings</Button>}
      </Sheet>

      <Sheet open={openSheet === 'timer'} title="Round and timer" onClose={close}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px' }}>
          <span style={{ fontSize: '1rem' }}>{gameStarted ? `Round ${round} of 12` : 'Before the game'}</span>
          <TimerDisplay remaining={timerRemaining} testId="sheet-timer" style={{ fontSize: '1.6rem', fontWeight: 300 }} />
        </div>
        {!gameStarted && (
          <>
            <Stepper label="Game length" value={timerMinutes} min={5} max={180} step={5} onChange={onTimerMinutesChange} />
            <div style={{ fontSize: '13px', lineHeight: '19px', color: 'var(--color-text-muted)' }}>
              Minutes, in 5-minute steps until Start game; then it’s fixed for this game. The next X-Wing game starts at the same length.
            </div>
          </>
        )}
        <Button onClick={close}>Done</Button>
      </Sheet>
    </AppScreenLayout>
  )
}
