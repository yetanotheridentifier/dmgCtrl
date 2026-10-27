import { useState } from 'react'
import { Base } from '../hooks/useBases'
import type { HistoryEntry } from '../hooks/useGameHistory'
import type { Initiative } from '../hooks/useInitiative'
import type { MatchResult } from '../hooks/useMatch'
import type { PlayMode } from '../utils/playMode'
import { useCardDrag, useDragScrubber } from '../hooks/useDragScrubber'
import AppScreenLayout from './layout/appScreenLayout'
import GameLogOverlay from './gameLogOverlay'
import TimerDisplay from './shared/timerDisplay'
import { Button, IconButton, Sheet } from './shared/controls'
import { BackIcon, DotsIcon, LogIcon } from './icons'
import { BaseCard, EpicActionButton, ForceButton, GameSheets, SheetActions } from './swuGamePieces'
import type { Art, LastGame, OpenSheet } from './swuGamePieces'
import { CARD_ASPECT_RATIO, DISABLED_BTN, RESULT_WORD, marginButton, mutedText } from './swuGameStyles'

// Each margin keeps at least this much for its 60px column of buttons.
const MARGIN_MIN = 76

export interface SwuGameViewProps {
  base: Base
  onBack: () => void
  onHelp: () => void
  onSettings?: () => void
  art: Art
  count: number
  round: number
  onIncrement: (n: number) => void
  onDecrement: (n: number) => void
  onStartGame: () => void
  onRoundIncrement: () => void
  showDamageButtons: boolean
  showEpicAction: boolean
  epicActionUsed: boolean
  onEpicActionMark: () => void
  showForce: boolean
  showMysticMonastery: boolean
  forceActive: boolean
  mysticUsesRemaining: number
  onForceToggle: () => void
  onMysticAction: () => void
  showInitiative: boolean
  initiative: Initiative
  onInitiativeOpponent: () => void
  onInitiativePlayer: () => void
  logEntries: HistoryEntry<unknown>[]
  onUndo: () => void
  showLog: boolean
  onLogToggle: () => void
  playMode: PlayMode
  playerScore: number
  opponentScore: number
  // Set once a best of 1 or 3 is decided.
  matchResult: MatchResult | null
  // The game just recorded, until the next one starts.
  lastGame: LastGame | null
  timerRemaining: number
  timerMinutes: number
  // Only before the first game of a match: the length is fixed once it starts.
  onTimerMinutesChange?: (minutes: number) => void
  timerExpired: boolean
  canEndGame: boolean
  endGameOpen: boolean
  endGameChoice: MatchResult | null
  onOpenEndGame: () => void
  onEndGameChoice: (r: MatchResult) => void
  onKeepPlaying: () => void
  onRecord: (r: MatchResult) => void
  gameOverOpen: boolean
  onCloseGameOver: () => void
  onRematch: () => void
  onNewSetup: () => void
  // Offered between games of a Limited best of 3.
  changeBaseOptions?: Base[]
  onChangeBase?: (b: Base) => void
}

const MARGIN_BTN: React.CSSProperties = { width: '60px', height: '52px' }
const SIDE_BTN: React.CSSProperties = { height: '56px' }

const column: React.CSSProperties = {
  height: '100%',
  minHeight: 0,
  boxSizing: 'border-box',
  padding: '8px 0',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '8px',
}

function SwuGameScreenView(props: SwuGameViewProps) {
  const {
    base, onBack, onHelp, onSettings, art, count, round, onIncrement, onDecrement, onStartGame, onRoundIncrement,
    showDamageButtons, showEpicAction, epicActionUsed, onEpicActionMark,
    showForce, showMysticMonastery, forceActive, mysticUsesRemaining, onForceToggle, onMysticAction,
    showInitiative, initiative, onInitiativeOpponent, onInitiativePlayer,
    logEntries, onUndo, showLog, onLogToggle,
    playMode, playerScore, opponentScore, matchResult, lastGame,
    timerRemaining, timerMinutes, onTimerMinutesChange, timerExpired,
    canEndGame, endGameOpen, endGameChoice, onOpenEndGame, onEndGameChoice, onKeepPlaying, onRecord,
    gameOverOpen, onCloseGameOver, onRematch, onNewSetup,
    changeBaseOptions, onChangeBase,
  } = props

  const [openSheet, setOpenSheet] = useState<OpenSheet>(null)

  const isCasual = playMode === 'casual'
  const gameStarted = round > 0
  const matchOver = matchResult !== null
  const hpLeft = base.hp - count
  const destroyed = gameStarted && hpLeft <= 0

  const cardDrag = useCardDrag(
    gameStarted ? () => onIncrement(1) : onStartGame,
    onIncrement,
    onDecrement,
    hpLeft,
    count,
    gameStarted && !matchOver,
  )
  const buttons = useDragScrubber(onIncrement, onDecrement, hpLeft, count, gameStarted)
  const dragAmount = cardDrag.amount ?? (buttons.dragIndicator && { type: buttons.dragIndicator.type, value: buttons.dragIndicator.value })

  // The card fills the height between the edges, leaving each margin room; its sizes scale from 1vh.
  const card = (
    <BaseCard
      base={base}
      art={art}
      face={{ count, gameStarted, isCasual, matchResult, lastGame, playerScore, opponentScore }}
      disabled={matchOver}
      epicActionToken={showEpicAction && epicActionUsed}
      dragAmount={dragAmount}
      drag={cardDrag}
      width={`min(calc((100vh - var(--edge-top) - var(--edge-bottom)) * ${CARD_ASPECT_RATIO}), calc(100vw - var(--edge-left) - var(--edge-right) - ${2 * MARGIN_MIN}px))`}
      unit="1vh"
    />
  )

  // --- left margin ---

  const epicButton = showEpicAction && <EpicActionButton gameStarted={gameStarted} used={epicActionUsed} onMark={onEpicActionMark} size={SIDE_BTN} />

  const forceButton = (showForce || showMysticMonastery) && (
    <ForceButton
      gameStarted={gameStarted}
      mysticMonastery={showMysticMonastery}
      active={forceActive}
      mysticUsesRemaining={mysticUsesRemaining}
      onToggle={onForceToggle}
      onMysticAction={onMysticAction}
      size={SIDE_BTN}
    />
  )

  const initiativeSide = (side: 'opponent' | 'player') => {
    const held = initiative === side
    return (
      <button
        type="button"
        role="radio"
        aria-checked={held}
        aria-label={side === 'opponent' ? (held ? 'Opponent has initiative' : 'Opponent takes initiative') : (held ? 'You have initiative' : 'You take initiative')}
        onClick={side === 'opponent' ? onInitiativeOpponent : onInitiativePlayer}
        style={{
          width: '50px',
          height: '50px',
          flexShrink: 0,
          border: 'none',
          borderRadius: '10px',
          fontFamily: 'inherit',
          fontSize: '11px',
          letterSpacing: '0.1em',
          fontWeight: held ? 700 : 500,
          background: held ? 'var(--color-accent)' : 'var(--color-surface-raised)',
          color: held ? 'var(--color-on-accent)' : 'var(--color-text-body)',
          cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        {side === 'opponent' ? 'OPP' : 'YOU'}
      </button>
    )
  }

  const initiativeBar = showInitiative && (
    <div
      role="radiogroup"
      aria-label="Initiative"
      style={{
        width: '60px',
        flex: 1,
        minHeight: '132px',
        padding: '5px',
        boxSizing: 'border-box',
        borderRadius: '12px',
        // Outlined until someone takes it.
        background: initiative === null ? 'transparent' : 'var(--color-surface)',
        border: initiative === null ? '2px dashed var(--color-surface-raised)' : '2px solid transparent',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      {initiativeSide('opponent')}
      <span aria-hidden="true" style={{ fontSize: '10px', letterSpacing: '0.12em', color: 'var(--color-text-disabled)' }}>INIT</span>
      {initiativeSide('player')}
    </div>
  )

  const damageButton = (type: '+' | '-') => (
    <button
      type="button"
      aria-label={type === '+' ? 'Add 1 damage, hold and drag for more' : 'Remove 1 damage, hold and drag for more'}
      disabled={!gameStarted}
      onClick={buttons.handleClick(type)}
      onPointerDown={buttons.handlePointerDown(type)}
      onPointerMove={buttons.handlePointerMove}
      onPointerUp={buttons.handlePointerUp}
      onPointerCancel={buttons.handlePointerCancel}
      style={marginButton({ fontSize: '26px', touchAction: 'none', ...(gameStarted ? { background: 'var(--color-tonal)', color: 'var(--color-tonal-text)' } : DISABLED_BTN) })}
    >
      {type === '+' ? '+' : '−'}
    </button>
  )

  // --- right margin ---

  const timerChip = !isCasual && (
    <button type="button" aria-label="Timer and round tracker" onClick={() => setOpenSheet('timer')} style={marginButton({ height: '40px', background: 'var(--color-surface)' })}>
      <TimerDisplay remaining={timerRemaining} style={{ fontSize: '14px', letterSpacing: '0.04em' }} />
    </button>
  )

  const gamesChip = !isCasual && (
    <div
      role="group"
      aria-label={`Games: you ${playerScore}, opponent ${opponentScore}`}
      style={{ width: '60px', height: '40px', flexShrink: 0, borderRadius: '12px', background: 'var(--color-surface)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}
    >
      <span style={{ fontSize: '9px', letterSpacing: '0.12em', color: 'var(--color-accent)' }}>GAMES</span>
      <span style={{ fontSize: '15px', color: 'var(--color-text-primary)' }}>{`${playerScore}–${opponentScore}`}</span>
    </div>
  )

  const roundButton = gameStarted && !matchOver && (
    <button
      type="button"
      aria-label={`Round ${round}: tap for round ${round + 1}`}
      onClick={onRoundIncrement}
      style={marginButton({ height: '64px', gap: 0, background: 'var(--color-accent)', color: 'var(--color-on-accent)' })}
    >
      <span style={{ fontSize: '11px' }}>Round</span>
      <span style={{ fontSize: '24px', fontWeight: 300, lineHeight: 1.1 }}>{round}</span>
    </button>
  )

  const endGameButton = canEndGame && (
    <button
      type="button"
      aria-label="End game"
      onClick={onOpenEndGame}
      style={marginButton({ background: 'var(--color-tonal)', color: 'var(--color-tonal-text)', fontSize: '12px', fontWeight: 600, lineHeight: '14px', gap: 0 })}
    >
      <span>End</span><span>game</span>
    </button>
  )

  return (
    <AppScreenLayout>
      <div style={{
        flex: 1,
        minHeight: 0,
        display: 'grid',
        gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'center',
        overflow: 'hidden',
        color: 'var(--color-text-primary)',
      }}>
        <div style={column}>
          <IconButton label="Back" onClick={onBack} style={MARGIN_BTN}><BackIcon /></IconButton>
          {epicButton}
          {forceButton}
          {initiativeBar || <div style={{ flex: 1 }} />}
          {showDamageButtons && damageButton('-')}
        </div>

        {card}

        <div style={column}>
          <IconButton label="Log" onClick={onLogToggle} style={MARGIN_BTN}><LogIcon /></IconButton>
          <IconButton label="More" onClick={() => setOpenSheet('more')} style={MARGIN_BTN}><DotsIcon /></IconButton>
          {timerChip}
          {gamesChip}
          <div style={{ flex: 1 }} />
          {roundButton}
          {endGameButton}
          {showDamageButtons && damageButton('+')}
        </div>
      </div>

      {showLog && <GameLogOverlay entries={logEntries} onUndo={onUndo} />}
      <GameSheets
        openSheet={openSheet}
        setOpenSheet={setOpenSheet}
        base={base}
        onHelp={onHelp}
        onSettings={onSettings}
        changeBaseOptions={changeBaseOptions}
        onChangeBase={onChangeBase}
        playMode={playMode}
        round={round}
        playerScore={playerScore}
        opponentScore={opponentScore}
        timerRemaining={timerRemaining}
        timerMinutes={timerMinutes}
        onTimerMinutesChange={onTimerMinutesChange}
        timerExpired={timerExpired}
        endGameOpen={endGameOpen}
        endGameChoice={endGameChoice}
        destroyedNote={destroyed ? 'Your base is destroyed' : null}
        onEndGameChoice={onEndGameChoice}
        onKeepPlaying={onKeepPlaying}
        onRecord={onRecord}
      />
      {lastGame && (
        <Sheet open={gameOverOpen} title={`Game ${RESULT_WORD[lastGame.result]}`} onClose={onCloseGameOver}>
          <div style={mutedText}>{`Ended in round ${lastGame.round} · ${lastGame.damage} damage taken`}</div>
          <SheetActions>
            <Button onClick={onNewSetup}>New setup</Button>
            <Button variant="primary" onClick={onRematch} style={{ minHeight: '52px', padding: '0 24px' }}>Rematch</Button>
          </SheetActions>
        </Sheet>
      )}
    </AppScreenLayout>
  )
}

export default SwuGameScreenView
