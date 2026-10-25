import { useState } from 'react'
import type { ReactNode } from 'react'
import { Base } from '../hooks/useBases'
import type { HistoryEntry } from '../hooks/useGameHistory'
import type { Initiative } from '../hooks/useInitiative'
import type { MatchResult } from '../hooks/useMatch'
import type { PlayMode } from '../utils/playMode'
import { useCardDrag, useDragScrubber } from '../hooks/useDragScrubber'
import { baseKey } from '../hooks/useSwuSetup'
import AppScreenLayout from './layout/appScreenLayout'
import GameLogOverlay from './gameLogOverlay'
import SwuBaseSheet from './swuBaseSheet'
import TimerDisplay from './shared/timerDisplay'
import { Button, IconButton, SegmentedControl, Sheet, Stepper } from './shared/controls'
import { BackIcon, DotsIcon, LogIcon } from './icons'

const CARD_NATURAL_WIDTH = 1560
const CARD_NATURAL_HEIGHT = 1120
const CARD_ASPECT_RATIO = CARD_NATURAL_WIDTH / CARD_NATURAL_HEIGHT
// Each margin keeps at least this much for its 60px column of buttons.
const MARGIN_MIN = 76

const ICON_URL = `${import.meta.env.BASE_URL}dmgctrl-icon-192-white.svg`
const FORCE_TOKEN_URL = `${import.meta.env.BASE_URL}dmgCtrl-force-token.png`

export interface LastGame {
  result: MatchResult
  round: number
  damage: number
}

interface Art {
  src: string | null
  rotationDeg: number
  loaded: boolean
  failed: boolean
  onLoad: () => void
  onError: () => void
}

interface Props {
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

type OpenSheet = null | 'more' | 'timer' | 'base'

const RESULT_OPTIONS: { value: MatchResult; label: string }[] = [
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
  { value: 'drawn', label: 'Draw' },
]

const RECORD_LABEL: Record<MatchResult, string> = { won: 'Record win', lost: 'Record loss', drawn: 'Record draw' }
const RESULT_WORD: Record<MatchResult, string> = { won: 'won', lost: 'lost', drawn: 'drawn' }

const SHADOW = '0 2px 8px rgba(0,0,0,0.9), 0 0 16px rgba(0,0,0,0.6)'

const MARGIN_BTN: React.CSSProperties = { width: '60px', height: '52px' }

const marginButton = (extra: React.CSSProperties = {}): React.CSSProperties => ({
  width: '60px',
  height: '52px',
  flexShrink: 0,
  border: 'none',
  borderRadius: '12px',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
  cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent',
  userSelect: 'none',
  WebkitUserSelect: 'none',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '2px',
  background: 'var(--color-surface-raised)',
  color: 'var(--color-text-body)',
  ...extra,
})

const DISABLED_BTN: React.CSSProperties = {
  background: 'var(--color-surface)',
  color: 'var(--color-text-disabled)',
  cursor: 'default',
  boxShadow: 'none',
}

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

const mutedText: React.CSSProperties = { fontSize: '0.85rem', lineHeight: 1.45, color: 'var(--color-text-muted)' }

// The dmgCtrl mark, drawn in the button's own colour.
function MarkIcon() {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'block',
        width: '22px',
        height: '22px',
        background: 'currentColor',
        WebkitMask: `url(${ICON_URL}) center / contain no-repeat`,
        mask: `url(${ICON_URL}) center / contain no-repeat`,
      }}
    />
  )
}

function ForceIcon({ faint }: { faint: boolean }) {
  return <img src={FORCE_TOKEN_URL} alt="" style={{ width: '24px', height: '24px', objectFit: 'contain', opacity: faint ? 0.35 : 0.9 }} />
}

function SheetActions({ children }: { children: ReactNode }) {
  return <div style={{ marginTop: 'auto', paddingTop: '4px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>{children}</div>
}

function SwuGameScreenView(props: Props) {
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
  const close = () => setOpenSheet(null)
  // Sheet actions close the sheet first, so it isn't left open behind the next screen.
  const closeThen = (fn: () => void) => () => { close(); fn() }

  const isCasual = playMode === 'casual'
  const gameStarted = round > 0
  const matchOver = matchResult !== null
  const hpLeft = base.hp - count
  const destroyed = gameStarted && hpLeft <= 0
  const gamesPlayed = playerScore + opponentScore
  const nextGame = gamesPlayed + 1

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

  // --- the card's open art: the damage, or what the next tap does ---

  const big = (text: string, fontSize: string) => (
    <span style={{ fontSize, fontWeight: 300, lineHeight: 1 }}>{text}</span>
  )
  const small = (text: string) => (
    <span style={{ fontSize: 'max(12px, 3.3vh)', color: 'var(--color-tonal-text)', marginTop: '0.4vh' }}>{text}</span>
  )

  let cardLabel: string
  let centre: ReactNode
  if (matchOver) {
    cardLabel = base.name
    centre = big(`Match ${RESULT_WORD[matchResult]}`, '10vh')
  } else if (gameStarted) {
    cardLabel = `${base.name}: tap for 1 damage, drag up to add more, drag down to remove`
    const tone = destroyed ? { color: 'var(--color-error)' } : {}
    centre = (
      <>
        <span data-testid="damage" style={{ fontSize: '22.5vh', fontWeight: 300, lineHeight: 1, ...tone }}>{count}</span>
        <span style={{ fontSize: '5.6vh', color: destroyed ? 'var(--color-error)' : 'var(--color-tonal-text)' }}>{`${hpLeft} HP left`}</span>
      </>
    )
  } else if (lastGame && !isCasual) {
    cardLabel = `${base.name}: tap to start game ${nextGame}`
    centre = (
      <>
        <span style={{ fontSize: 'max(12px, 3.3vh)', letterSpacing: '0.12em', color: 'var(--color-tonal-text)', marginBottom: '1vh' }}>
          {`GAME ${gamesPlayed} ${RESULT_WORD[lastGame.result].toUpperCase()} · ${playerScore}–${opponentScore}`}
        </span>
        {big(`Start game ${nextGame}`, '11vh')}
        {small('tap the card')}
      </>
    )
  } else {
    cardLabel = `${base.name}: tap to start`
    centre = (
      <>
        {lastGame && (
          <span style={{ fontSize: 'max(12px, 3.3vh)', letterSpacing: '0.12em', color: 'var(--color-tonal-text)', marginBottom: '1vh' }}>
            {`GAME ${RESULT_WORD[lastGame.result].toUpperCase()}`}
          </span>
        )}
        {big('Start', '14vh')}
        {small('tap the card')}
      </>
    )
  }

  const card = (
    <button
      type="button"
      data-testid="game-card"
      aria-label={cardLabel}
      disabled={matchOver}
      onClick={cardDrag.onClick}
      onPointerDown={cardDrag.onPointerDown}
      onPointerMove={cardDrag.onPointerMove}
      onPointerUp={cardDrag.onPointerUp}
      onPointerCancel={cardDrag.onPointerCancel}
      style={{
        position: 'relative',
        aspectRatio: `${CARD_ASPECT_RATIO}`,
        width: `min(calc((100vh - 8px) * ${CARD_ASPECT_RATIO}), calc(100vw - ${2 * MARGIN_MIN}px))`,
        padding: 0,
        border: 'none',
        borderRadius: '3.5%',
        overflow: 'hidden',
        background: 'var(--color-surface)',
        color: 'var(--color-text-primary)',
        fontFamily: 'inherit',
        cursor: matchOver ? 'default' : 'pointer',
        touchAction: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTapHighlightColor: 'transparent',
        boxShadow: '0 0 20px rgba(var(--color-accent-rgb), 0.3)',
      }}
    >
      {/* Border overlay: above the art, to cover its edge fringe */}
      <span aria-hidden="true" style={{ position: 'absolute', inset: 0, zIndex: 10, border: '2px solid var(--color-accent)', borderRadius: 'inherit', pointerEvents: 'none' }} />

      <img
        src={art.src ?? undefined}
        alt={base.name}
        onLoad={art.onLoad}
        onError={art.onError}
        data-testid="game-card-image"
        draggable={false}
        style={art.rotationDeg ? {
          position: 'absolute',
          top: '50%',
          left: '50%',
          width: `${100 * CARD_NATURAL_HEIGHT / CARD_NATURAL_WIDTH}%`,
          height: `${100 * CARD_NATURAL_WIDTH / CARD_NATURAL_HEIGHT}%`,
          objectFit: 'cover',
          transform: `translate(-50%, -50%) rotate(${art.rotationDeg}deg)`,
          display: art.loaded ? 'block' : 'none',
          pointerEvents: 'none',
        } : {
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: art.loaded ? 'block' : 'none',
          pointerEvents: 'none',
        }}
      />

      {/* No art: the card's own text, in the places the card prints it */}
      {art.failed && (
        <>
          <span style={{ position: 'absolute', top: '5%', left: '8%', right: '8%', zIndex: 2, textAlign: 'center', fontSize: 'clamp(1rem, 7vh, 1.8rem)', fontWeight: 300, letterSpacing: '0.05em' }}>{base.name}</span>
          {base.epicAction && (
            <span style={{ position: 'absolute', top: '66%', left: '8%', right: '8%', height: '24%', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontStyle: 'italic', fontWeight: 300, lineHeight: 1.4, fontSize: 'clamp(0.6rem, 4vh, 1.1rem)' }}>{base.epicAction}</span>
          )}
          <span style={{ position: 'absolute', bottom: '3%', left: '8%', right: '8%', zIndex: 2, textAlign: 'center', fontSize: 'clamp(0.7rem, 2.5vh, 1.2rem)', fontWeight: 300, color: 'var(--color-text-muted)' }}>{base.subtitle}</span>
        </>
      )}

      {/* Shading behind the number, fading out before the top band and the text box */}
      {!art.failed && (
        <span aria-hidden="true" style={{ position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none', background: 'radial-gradient(ellipse 40% 26% at 50% 39%, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.35) 45%, transparent 100%)' }} />
      )}

      {/* The open art between the top band (HP, name, aspect) and the text box */}
      <span
        data-testid="game-counter"
        style={{ position: 'absolute', left: 0, right: 0, top: '17%', height: '45%', zIndex: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textShadow: SHADOW }}
      >
        {centre}
      </span>

      {/* The one thing allowed over the text box, as the physical token is */}
      {showEpicAction && epicActionUsed && (
        <span
          data-testid="epic-action-token"
          style={{ position: 'absolute', left: '6%', right: '6%', bottom: '13%', height: '23%', zIndex: 3, borderRadius: '10px', background: 'rgba(var(--color-epic-rgb), 0.9)', color: '#2a1a00', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'max(12px, 3.6vh)', fontWeight: 700, letterSpacing: '0.1em', pointerEvents: 'none' }}
        >
          EPIC ACTION USED
        </span>
      )}

      {dragAmount && (
        <span
          data-testid="drag-amount"
          aria-live="polite"
          style={{ position: 'absolute', left: '64%', top: '22%', zIndex: 4, padding: '4px 12px', borderRadius: '10px', background: 'var(--color-accent)', color: 'var(--color-on-accent)', fontSize: 'max(18px, 6.7vh)', fontWeight: 700, pointerEvents: 'none' }}
        >
          {`${dragAmount.type === '+' ? '+' : '−'}${dragAmount.value}`}
        </span>
      )}
    </button>
  )

  // --- left margin ---

  const epicButton = showEpicAction && (() => {
    if (!gameStarted) {
      return <button type="button" disabled aria-label="Epic action, from the game’s start" style={marginButton({ height: '56px', ...DISABLED_BTN })}><MarkIcon /></button>
    }
    if (epicActionUsed) {
      return (
        <button type="button" disabled aria-label="Epic action used" style={marginButton({ height: '56px', ...DISABLED_BTN })}>
          <MarkIcon /><span style={{ fontSize: '10px' }}>USED</span>
        </button>
      )
    }
    return (
      <button
        type="button"
        aria-label="Epic action: tap when used"
        onClick={onEpicActionMark}
        style={marginButton({ height: '56px', border: '2px solid var(--color-epic)', background: 'rgba(var(--color-epic-rgb), 0.18)', color: 'var(--color-epic)', boxShadow: '0 0 12px rgba(var(--color-epic-rgb), 0.5)' })}
      >
        <MarkIcon />
      </button>
    )
  })()

  const forceButton = (showForce || showMysticMonastery) && (() => {
    const usesLeft = showMysticMonastery ? <span style={{ fontSize: '10px', fontWeight: 700 }}>{`${mysticUsesRemaining} LEFT`}</span> : null
    if (forceActive) {
      return (
        <button
          type="button"
          aria-label="The Force is with you: tap to clear"
          onClick={onForceToggle}
          style={marginButton({ height: '56px', background: 'var(--color-accent)', color: 'var(--color-on-accent)' })}
        >
          <ForceIcon faint={false} />{usesLeft}
        </button>
      )
    }
    const exhausted = showMysticMonastery && mysticUsesRemaining <= 0
    const label = exhausted ? 'No Force uses left'
      : showMysticMonastery ? `Gain the Force: ${mysticUsesRemaining} ${mysticUsesRemaining === 1 ? 'use' : 'uses'} left`
      : 'Gain the Force'
    const disabled = !gameStarted || exhausted
    return (
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onClick={showMysticMonastery ? onMysticAction : onForceToggle}
        style={marginButton({ height: '56px', ...(disabled ? DISABLED_BTN : { background: 'var(--color-tonal)', color: 'var(--color-tonal-text)' }) })}
      >
        <ForceIcon faint={disabled} />{usesLeft}
      </button>
    )
  })()

  const initiativeSide = (side: 'opponent' | 'player') => {
    const held = initiative === side
    const who = side === 'opponent' ? 'Opponent' : 'You'
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
        {who === 'Opponent' ? 'OPP' : 'YOU'}
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

  // --- sheets ---

  const endTitle = isCasual ? 'End game' : `End game ${nextGame}`
  const endNote = (() => {
    if (isCasual) return 'Damage resets for a rematch. Undo in the log takes it back.'
    if (endGameChoice === null) return 'Choose the result to record it.'
    const p = playerScore + (endGameChoice === 'won' ? 1 : 0)
    const o = opponentScore + (endGameChoice === 'lost' ? 1 : 0)
    const needed = playMode === 'bo3' ? 2 : 1
    const ends = endGameChoice === 'drawn' || p >= needed || o >= needed || timerExpired
    if (endGameChoice === 'drawn') return `A draw ends the match ${p}–${o}.`
    if (ends) return `This ends the match ${p}–${o}.`
    return `Match ${p}–${o} after this; damage resets for game ${nextGame + 1}. Undo in the log takes it back.`
  })()

  const sheets = (
    <>
      <Sheet open={openSheet === 'more'} title="More" onClose={close}>
        <Button onClick={closeThen(onHelp)}>Help</Button>
        {onSettings && <Button onClick={closeThen(onSettings)}>Settings</Button>}
        {changeBaseOptions && <Button onClick={() => setOpenSheet('base')}>Change base</Button>}
      </Sheet>

      {changeBaseOptions && onChangeBase && (
        <SwuBaseSheet
          open={openSheet === 'base'}
          onClose={close}
          bases={changeBaseOptions}
          favouriteBases={[]}
          recentBases={[]}
          currentKey={baseKey(base)}
          onChoose={b => { onChangeBase(b); close() }}
        />
      )}

      <Sheet open={openSheet === 'timer'} title="Round and timer" onClose={close}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px' }}>
          <span style={{ fontSize: '1rem' }}>{gameStarted ? `Round ${round}` : `Before game ${nextGame}`}</span>
          <TimerDisplay remaining={timerRemaining} style={{ fontSize: '1.6rem', fontWeight: 300 }} />
        </div>
        {onTimerMinutesChange && (
          <>
            <Stepper label="Game length" value={timerMinutes} min={5} max={90} step={5} onChange={onTimerMinutesChange} />
            <div style={mutedText}>
              {`Minutes, in 5-minute steps until game 1 starts; then it’s fixed for this match. The next ${playMode === 'bo3' ? 'best of 3' : 'best of 1'} starts at the same length.`}
            </div>
          </>
        )}
        <SheetActions><Button onClick={close}>Done</Button></SheetActions>
      </Sheet>

      <Sheet open={endGameOpen} title={endTitle} onClose={onKeepPlaying}>
        {destroyed && <div style={{ fontSize: '0.9rem', color: 'var(--color-error)' }}>Your base is destroyed</div>}
        <SegmentedControl label="Result" options={RESULT_OPTIONS} value={endGameChoice} onChange={onEndGameChoice} />
        <div style={mutedText}>{endNote}</div>
        <SheetActions>
          <Button onClick={onKeepPlaying}>Keep playing</Button>
          <Button
            variant="primary"
            disabled={endGameChoice === null}
            onClick={() => { if (endGameChoice) onRecord(endGameChoice) }}
            style={{ minHeight: '52px', padding: '0 24px' }}
          >
            {endGameChoice ? RECORD_LABEL[endGameChoice] : 'Record'}
          </Button>
        </SheetActions>
      </Sheet>

      {lastGame && (
        <Sheet open={gameOverOpen} title={`Game ${RESULT_WORD[lastGame.result]}`} onClose={onCloseGameOver}>
          <div style={mutedText}>{`Ended in round ${lastGame.round} · ${lastGame.damage} damage taken`}</div>
          <SheetActions>
            <Button onClick={onNewSetup}>New setup</Button>
            <Button variant="primary" onClick={onRematch} style={{ minHeight: '52px', padding: '0 24px' }}>Rematch</Button>
          </SheetActions>
        </Sheet>
      )}
    </>
  )

  return (
    <AppScreenLayout>
      <div style={{
        flex: 1,
        minHeight: 0,
        boxSizing: 'border-box',
        padding: '4px 0',
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
      {sheets}
    </AppScreenLayout>
  )
}

export default SwuGameScreenView
