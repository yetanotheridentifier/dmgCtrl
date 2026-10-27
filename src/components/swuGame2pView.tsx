import { useState } from 'react'
import type { ReactNode } from 'react'
import { Base } from '../hooks/useBases'
import type { MatchResult } from '../hooks/useMatch'
import { useCardDrag, useDragScrubber } from '../hooks/useDragScrubber'
import SplitScreenLayout from './layout/splitScreenLayout'
import GameLogOverlay from './gameLogOverlay'
import TimerDisplay from './shared/timerDisplay'
import { IconButton } from './shared/controls'
import { BackIcon, DotsIcon, LogIcon } from './icons'
import { BaseCard, EpicActionButton, ForceButton, GameSheets } from './swuGamePieces'
import type { Art, CardFace, OpenSheet } from './swuGamePieces'
import { CARD_ASPECT_RATIO, DISABLED_BTN, marginButton } from './swuGameStyles'
import type { SwuGameViewProps } from './swuGameScreenView'

// One player's half: their base and what acts on it.
export interface SwuSide {
  base: Base
  art: Art
  count: number
  onIncrement: (n: number) => void
  onDecrement: (n: number) => void
  showEpicAction: boolean
  epicActionUsed: boolean
  onEpicActionMark: () => void
  showForce: boolean
  showMysticMonastery: boolean
  forceActive: boolean
  mysticUsesRemaining: number
  onForceToggle: () => void
  onMysticAction: () => void
}

// Your side comes in the one-player props; theirs alongside.
export interface SwuGame2pViewProps extends SwuGameViewProps {
  them: SwuSide
  // Set when a base reaches 0, for the End game sheet.
  destroyedNote: string | null
}

const BOTTOM_ROW = 60
const ROW_BTN: React.CSSProperties = { width: `${BOTTOM_ROW}px`, height: `${BOTTOM_ROW}px` }
// The card fills its half's width, or its height less the row of buttons, whichever is less.
const CARD_WIDTH = `min(100cqw, calc((100cqh - ${BOTTOM_ROW + 8}px) * ${CARD_ASPECT_RATIO}))`
const CARD_UNIT = `calc(${CARD_WIDTH} / ${CARD_ASPECT_RATIO} / 100)`

const STRIP_BTN: React.CSSProperties = { width: '52px', height: '100%' }

const RESULT_TITLE: Record<MatchResult, string> = { won: 'Game won', lost: 'Game lost', drawn: 'Game drawn' }
const FLIP: Record<MatchResult, MatchResult> = { won: 'lost', lost: 'won', drawn: 'drawn' }

interface HalfProps {
  side: SwuSide
  owner: 'yours' | 'theirs'
  round: number
  playing: boolean
  centreProps: Omit<CardFace, 'count' | 'owner'>
  onStartGame: () => void
  showDamageButtons: boolean
  showInitiative: boolean
  holdsInitiative: boolean
  onTakeInitiative: () => void
  // Once a casual game is over: this player's result, and the game's round and damage.
  result: { result: MatchResult; round: number; damage: number } | null
  // The log, over this half when open (yours: it reads the right way up for the phone's owner).
  log?: ReactNode
}

function Half({ side, owner, round, playing, centreProps, onStartGame, showDamageButtons, showInitiative, holdsInitiative, onTakeInitiative, result, log }: HalfProps) {
  const { base, count, onIncrement, onDecrement } = side
  const flipped = owner === 'theirs'
  const gameStarted = round > 0
  const hpLeft = base.hp - count
  const cardDrag = useCardDrag(gameStarted ? () => onIncrement(1) : onStartGame, onIncrement, onDecrement, hpLeft, count, playing, flipped)
  const buttons = useDragScrubber(onIncrement, onDecrement, hpLeft, count, gameStarted, flipped)
  const dragAmount = cardDrag.amount ?? (buttons.dragIndicator && { type: buttons.dragIndicator.type, value: buttons.dragIndicator.value })

  const whose = owner === 'yours' ? 'your base' : 'their base'
  const who = owner === 'yours' ? { group: 'Your initiative', held: 'You hold the initiative', take: 'You: take the initiative' }
    : { group: 'Their initiative', held: 'They hold the initiative', take: 'They: take the initiative' }

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
      style={marginButton({ ...ROW_BTN, fontSize: '28px', fontWeight: 300, touchAction: 'none', ...(gameStarted ? { background: 'var(--color-surface-raised)', color: 'var(--color-text-primary)' } : DISABLED_BTN) })}
    >
      {type === '+' ? '+' : '−'}
    </button>
  )

  let row: ReactNode
  if (result) {
    row = (
      <div style={{ height: `${BOTTOM_ROW}px`, flexShrink: 0, boxSizing: 'border-box', padding: '0 14px', borderRadius: '12px', background: 'var(--color-sheet)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '22px', fontWeight: 600, color: result.result === 'won' ? 'var(--color-success)' : result.result === 'lost' ? 'var(--color-error)' : 'var(--color-text-primary)' }}>
          {RESULT_TITLE[result.result]}
        </span>
        <span style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>{`Round ${result.round} · ${result.damage} damage`}</span>
      </div>
    )
  } else {
    row = (
      <div style={{ height: `${BOTTOM_ROW}px`, flexShrink: 0, display: 'flex', gap: '8px' }}>
        {side.showEpicAction && <EpicActionButton gameStarted={gameStarted} used={side.epicActionUsed} onMark={side.onEpicActionMark} size={ROW_BTN} />}
        {(side.showForce || side.showMysticMonastery) && (
          <ForceButton
            gameStarted={gameStarted}
            mysticMonastery={side.showMysticMonastery}
            active={side.forceActive}
            mysticUsesRemaining={side.mysticUsesRemaining}
            onToggle={side.onForceToggle}
            onMysticAction={side.onMysticAction}
            size={ROW_BTN}
          />
        )}
        <div role={showInitiative ? 'radiogroup' : undefined} aria-label={showInitiative ? who.group : undefined} style={{ flex: 1, display: 'flex', gap: '8px' }}>
          {showInitiative ? (
            <button
              type="button"
              role="radio"
              aria-checked={holdsInitiative}
              aria-label={holdsInitiative ? who.held : who.take}
              onClick={onTakeInitiative}
              style={{
                flex: 1,
                minWidth: 0,
                height: `${BOTTOM_ROW}px`,
                boxSizing: 'border-box',
                borderRadius: '12px',
                fontFamily: 'inherit',
                fontSize: '12px',
                letterSpacing: '0.12em',
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
                ...(holdsInitiative
                  ? { border: 'none', background: 'var(--color-accent)', color: 'var(--color-on-accent)', fontWeight: 700 }
                  : { border: '2px solid var(--color-surface-raised)', background: 'transparent', color: 'var(--color-text-muted)', fontWeight: 500 }),
              }}
            >
              {holdsInitiative ? 'INITIATIVE' : 'TAKE INITIATIVE'}
            </button>
          ) : <div style={{ flex: 1 }} />}
          {showDamageButtons && damageButton('-')}
          {showDamageButtons && damageButton('+')}
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Takes the height the row leaves, so the row sits at the foot of the half. */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
        <BaseCard
          base={base}
          art={side.art}
          // Once the game is over, the card keeps the damage it ended on.
          face={result ? { ...centreProps, gameStarted: true, count: result.damage, owner: whose } : { ...centreProps, count, owner: whose }}
          label={result ? `${base.name}, ${whose}` : undefined}
          disabled={result !== null || centreProps.matchResult !== null}
          epicActionToken={side.showEpicAction && side.epicActionUsed}
          dragAmount={dragAmount}
          drag={cardDrag}
          width={CARD_WIDTH}
          unit={CARD_UNIT}
          dimmed={result !== null}
        />
      </div>
      {row}
      {log}
    </>
  )
}

function SwuGame2pView(props: SwuGame2pViewProps) {
  const {
    them, destroyedNote, base, art, count, onIncrement, onDecrement,
    showEpicAction, epicActionUsed, onEpicActionMark, showForce, showMysticMonastery, forceActive, mysticUsesRemaining, onForceToggle, onMysticAction,
    onBack, onHelp, onSettings, round, onStartGame, onRoundIncrement, showDamageButtons,
    showInitiative, initiative, onInitiativeOpponent, onInitiativePlayer,
    logEntries, onUndo, showLog, onLogToggle,
    playMode, playerScore, opponentScore, matchResult, lastGame,
    timerRemaining, timerMinutes, onTimerMinutesChange, timerExpired,
    canEndGame, endGameOpen, endGameChoice, onOpenEndGame, onEndGameChoice, onKeepPlaying, onRecord,
    gameOverOpen, onRematch, onNewSetup, changeBaseOptions, onChangeBase,
  } = props

  const [openSheet, setOpenSheet] = useState<OpenSheet>(null)

  const you: SwuSide = {
    base, art, count, onIncrement, onDecrement, showEpicAction, epicActionUsed, onEpicActionMark,
    showForce, showMysticMonastery, forceActive, mysticUsesRemaining, onForceToggle, onMysticAction,
  }

  const isCasual = playMode === 'casual'
  const gameStarted = round > 0
  const matchOver = matchResult !== null
  const playing = gameStarted && !matchOver
  const over = gameOverOpen && lastGame !== null ? lastGame : null
  const centreProps = { gameStarted, isCasual, matchResult, lastGame, playerScore, opponentScore }
  const common = { round, playing, centreProps, onStartGame, showDamageButtons, showInitiative }

  const stripStyle: React.CSSProperties = {
    height: '72px',
    flexShrink: 0,
    boxSizing: 'border-box',
    padding: '8px',
    display: 'flex',
    gap: '6px',
    background: 'var(--color-bg-deep)',
    borderTop: '1px solid var(--color-surface-raised)',
    borderBottom: '1px solid var(--color-surface-raised)',
  }

  const logButton = <IconButton label="Log" onClick={onLogToggle} style={STRIP_BTN}><LogIcon /></IconButton>

  const strip = over ? (
    <nav aria-label="Game over" style={{ ...stripStyle, gap: '8px' }}>
      {logButton}
      <button type="button" onClick={onNewSetup} style={marginButton({ flex: 1, width: 'auto', height: '100%', background: 'var(--color-tonal)', color: 'var(--color-tonal-text)', fontSize: '15px', fontWeight: 500 })}>New setup</button>
      <button type="button" onClick={onRematch} style={marginButton({ flex: 1.3, width: 'auto', height: '100%', background: 'var(--color-accent)', color: 'var(--color-on-accent)', fontSize: '17px', fontWeight: 600 })}>Rematch</button>
    </nav>
  ) : (
    <nav aria-label="Game" style={stripStyle}>
      <IconButton label="Back to setup" onClick={onBack} style={STRIP_BTN}><BackIcon /></IconButton>
      {logButton}
      <button
        type="button"
        aria-label={playing ? `Round ${round}: tap for round ${round + 1}` : `Round ${Math.max(round, 1)}, starts with the game`}
        disabled={!playing}
        onClick={onRoundIncrement}
        style={marginButton({ flex: 1, width: 'auto', height: '100%', flexDirection: 'row', alignItems: 'baseline', gap: '8px', paddingTop: '10px', ...(playing ? { background: 'var(--color-accent)', color: 'var(--color-on-accent)' } : DISABLED_BTN) })}
      >
        <span style={{ fontSize: '13px' }}>Round</span>
        <span style={{ fontSize: '30px', fontWeight: 300, lineHeight: 1 }}>{Math.max(round, 1)}</span>
      </button>
      {!isCasual && (
        <button type="button" aria-label="Timer and round tracker" onClick={() => setOpenSheet('timer')} style={marginButton({ height: '100%', background: 'var(--color-surface)', gap: 0 })}>
          <TimerDisplay remaining={timerRemaining} style={{ fontSize: '14px', letterSpacing: '0.04em' }} />
          <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>{`${playerScore}–${opponentScore}`}</span>
        </button>
      )}
      <button
        type="button"
        aria-label="End game"
        disabled={!canEndGame}
        onClick={onOpenEndGame}
        style={marginButton({ height: '100%', fontSize: '12px', fontWeight: 600, lineHeight: '14px', gap: 0, ...(canEndGame ? { background: 'var(--color-tonal)', color: 'var(--color-tonal-text)' } : DISABLED_BTN) })}
      >
        <span>End</span><span>game</span>
      </button>
      <IconButton label="More" onClick={() => setOpenSheet('more')} style={STRIP_BTN}><DotsIcon /></IconButton>
    </nav>
  )

  return (
    <div style={{ color: 'var(--color-text-primary)' }}>
      <SplitScreenLayout
        topLabel="Their half"
        top={(
          <Half
            side={them}
            owner="theirs"
            {...common}
            holdsInitiative={initiative === 'opponent'}
            onTakeInitiative={onInitiativeOpponent}
            result={over && { result: FLIP[over.result], round: over.round, damage: over.theirDamage ?? 0 }}
          />
        )}
        middle={strip}
        bottomLabel="Your half"
        bottom={(
          <Half
            side={you}
            owner="yours"
            {...common}
            holdsInitiative={initiative === 'player'}
            onTakeInitiative={onInitiativePlayer}
            result={over && { result: over.result, round: over.round, damage: over.damage }}
            log={showLog && <GameLogOverlay entries={logEntries} onUndo={onUndo} position={{ inset: '8px' }} />}
          />
        )}
      />
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
        destroyedNote={destroyedNote}
        onEndGameChoice={onEndGameChoice}
        onKeepPlaying={onKeepPlaying}
        onRecord={onRecord}
      />
    </div>
  )
}

export default SwuGame2pView
