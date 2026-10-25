import type { ReactNode } from 'react'
import { Base } from '../hooks/useBases'
import type { MatchResult } from '../hooks/useMatch'
import type { PlayMode } from '../utils/playMode'
import { baseKey } from '../hooks/useSwuSetup'
import SwuBaseSheet from './swuBaseSheet'
import TimerDisplay from './shared/timerDisplay'
import { Button, SegmentedControl, Sheet, Stepper } from './shared/controls'
import { CARD_ASPECT_RATIO, CARD_NATURAL_HEIGHT, CARD_NATURAL_WIDTH, DISABLED_BTN, RESULT_WORD, marginButton, mutedText, scaled } from './swuGameStyles'

// The pieces the one-player and two-player SWU game screens share: the base card as the damage
// control, the epic action and Force buttons, and the sheets. Both screens change together here.

const ICON_URL = `${import.meta.env.BASE_URL}dmgctrl-icon-192-white.svg`
const FORCE_TOKEN_URL = `${import.meta.env.BASE_URL}dmgCtrl-force-token.png`

export interface LastGame {
  result: MatchResult
  round: number
  damage: number
  // Two players: the damage their base took.
  theirDamage?: number
}

export interface Art {
  src: string | null
  rotationDeg: number
  loaded: boolean
  failed: boolean
  onLoad: () => void
  onError: () => void
}

const RESULT_OPTIONS: { value: MatchResult; label: string }[] = [
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
  { value: 'drawn', label: 'Draw' },
]

const RECORD_LABEL: Record<MatchResult, string> = { won: 'Record win', lost: 'Record loss', drawn: 'Record draw' }

const SHADOW = '0 2px 8px rgba(0,0,0,0.9), 0 0 16px rgba(0,0,0,0.6)'

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

export function SheetActions({ children }: { children: ReactNode }) {
  return <div style={{ marginTop: 'auto', paddingTop: '4px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>{children}</div>
}

// --- the base card: the damage control ---

interface CardDrag {
  onClick: () => void
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void
  onPointerMove: (e: React.PointerEvent<HTMLElement>) => void
  onPointerUp: () => void
  onPointerCancel: () => void
}

interface BaseCardProps {
  base: Base
  art: Art
  // The state of the game the card's open art shows.
  face: CardFace
  // In place of the label the face gives, such as once the game is over.
  label?: string
  disabled: boolean
  epicActionToken: boolean
  dragAmount: { type: '+' | '-'; value: number } | null | undefined
  drag: CardDrag
  // The card's width, and one hundredth of its height: every size on it scales from that.
  width: string
  unit: string
  dimmed?: boolean
}

export function BaseCard({ base, art, face, label: labelOverride, disabled, epicActionToken, dragAmount, drag, width, unit, dimmed = false }: BaseCardProps) {
  const u = (n: number) => scaled(unit, n)
  const { label: faceLabel, centre } = cardCentre({ ...face, base, unit })
  const label = labelOverride ?? faceLabel
  return (
    <button
      type="button"
      data-testid="game-card"
      aria-label={label}
      disabled={disabled}
      onClick={drag.onClick}
      onPointerDown={drag.onPointerDown}
      onPointerMove={drag.onPointerMove}
      onPointerUp={drag.onPointerUp}
      onPointerCancel={drag.onPointerCancel}
      style={{
        position: 'relative',
        aspectRatio: `${CARD_ASPECT_RATIO}`,
        width,
        flexShrink: 0,
        padding: 0,
        border: 'none',
        borderRadius: '3.5%',
        overflow: 'hidden',
        background: 'var(--color-surface)',
        color: 'var(--color-text-primary)',
        fontFamily: 'inherit',
        cursor: disabled ? 'default' : 'pointer',
        touchAction: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTapHighlightColor: 'transparent',
        boxShadow: '0 0 20px rgba(var(--color-accent-rgb), 0.3)',
        opacity: dimmed ? 0.55 : 1,
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
          <span style={{ position: 'absolute', top: '5%', left: '8%', right: '8%', zIndex: 2, textAlign: 'center', fontSize: `clamp(1rem, ${u(7)}, 1.8rem)`, fontWeight: 300, letterSpacing: '0.05em' }}>{base.name}</span>
          {base.epicAction && (
            <span style={{ position: 'absolute', top: '66%', left: '8%', right: '8%', height: '24%', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontStyle: 'italic', fontWeight: 300, lineHeight: 1.4, fontSize: `clamp(0.6rem, ${u(4)}, 1.1rem)` }}>{base.epicAction}</span>
          )}
          <span style={{ position: 'absolute', bottom: '3%', left: '8%', right: '8%', zIndex: 2, textAlign: 'center', fontSize: `clamp(0.7rem, ${u(2.5)}, 1.2rem)`, fontWeight: 300, color: 'var(--color-text-muted)' }}>{base.subtitle}</span>
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
      {epicActionToken && (
        <span
          data-testid="epic-action-token"
          style={{ position: 'absolute', left: '6%', right: '6%', bottom: '13%', height: '23%', zIndex: 3, borderRadius: '10px', background: 'rgba(var(--color-epic-rgb), 0.9)', color: '#2a1a00', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: `max(12px, ${u(3.6)})`, fontWeight: 700, letterSpacing: '0.1em', pointerEvents: 'none' }}
        >
          EPIC ACTION USED
        </span>
      )}

      {dragAmount && (
        <span
          data-testid="drag-amount"
          aria-live="polite"
          style={{ position: 'absolute', left: '64%', top: '22%', zIndex: 4, padding: '4px 12px', borderRadius: '10px', background: 'var(--color-accent)', color: 'var(--color-on-accent)', fontSize: `max(18px, ${u(6.7)})`, fontWeight: 700, pointerEvents: 'none' }}
        >
          {`${dragAmount.type === '+' ? '+' : '−'}${dragAmount.value}`}
        </span>
      )}
    </button>
  )
}

// --- what the card's open art shows ---

interface CentreProps {
  base: Base
  unit: string
  count: number
  gameStarted: boolean
  isCasual: boolean
  // The match result, once a best of 1 or 3 is decided.
  matchResult: MatchResult | null
  lastGame: LastGame | null
  playerScore: number
  opponentScore: number
  // Whose base this is, for the label: "your base" or "their base" in two players.
  owner?: string
}

export type CardFace = Omit<CentreProps, 'base' | 'unit'>

// The card's label and centre for each state of the game: Start, the damage, the next game, the match.
function cardCentre({ base, unit, count, gameStarted, isCasual, matchResult, lastGame, playerScore, opponentScore, owner }: CentreProps): { label: string; centre: ReactNode } {
  const u = (n: number) => scaled(unit, n)
  const name = owner ? `${base.name}, ${owner}` : base.name
  const hpLeft = base.hp - count
  const destroyed = gameStarted && hpLeft <= 0
  const gamesPlayed = playerScore + opponentScore
  const nextGame = gamesPlayed + 1
  const big = (text: string, n: number) => <span style={{ fontSize: u(n), fontWeight: 300, lineHeight: 1 }}>{text}</span>
  const small = (text: string) => <span style={{ fontSize: `max(12px, ${u(3.3)})`, color: 'var(--color-tonal-text)', marginTop: u(0.4) }}>{text}</span>
  const eyebrow = (text: string) => (
    <span style={{ fontSize: `max(12px, ${u(3.3)})`, letterSpacing: '0.12em', color: 'var(--color-tonal-text)', marginBottom: u(1) }}>{text}</span>
  )

  if (matchResult) {
    return { label: name, centre: big(`Match ${RESULT_WORD[matchResult]}`, 10) }
  }
  if (gameStarted) {
    const tone = destroyed ? { color: 'var(--color-error)' } : {}
    return {
      label: `${name}: tap for 1 damage, drag up to add more, drag down to remove`,
      centre: (
        <>
          <span data-testid="damage" style={{ fontSize: u(22.5), fontWeight: 300, lineHeight: 1, ...tone }}>{count}</span>
          <span style={{ fontSize: u(5.6), color: destroyed ? 'var(--color-error)' : 'var(--color-tonal-text)' }}>{`${hpLeft} HP left`}</span>
        </>
      ),
    }
  }
  if (lastGame && !isCasual) {
    return {
      label: `${name}: tap to start game ${nextGame}`,
      centre: (
        <>
          {eyebrow(`GAME ${gamesPlayed} ${RESULT_WORD[lastGame.result].toUpperCase()} · ${playerScore}–${opponentScore}`)}
          {big(`Start game ${nextGame}`, 11)}
          {small('tap the card')}
        </>
      ),
    }
  }
  return {
    label: `${name}: tap to start`,
    centre: (
      <>
        {lastGame && eyebrow(`GAME ${RESULT_WORD[lastGame.result].toUpperCase()}`)}
        {big('Start', 14)}
        {small(owner ? 'tap either card' : 'tap the card')}
      </>
    ),
  }
}

// --- the epic action and the Force ---

interface EpicActionButtonProps {
  gameStarted: boolean
  used: boolean
  onMark: () => void
  size: React.CSSProperties
}

export function EpicActionButton({ gameStarted, used, onMark, size }: EpicActionButtonProps) {
  if (!gameStarted) {
    return <button type="button" disabled aria-label="Epic action, from the game’s start" style={marginButton({ ...size, ...DISABLED_BTN })}><MarkIcon /></button>
  }
  if (used) {
    return (
      <button type="button" disabled aria-label="Epic action used" style={marginButton({ ...size, ...DISABLED_BTN })}>
        <MarkIcon /><span style={{ fontSize: '10px' }}>USED</span>
      </button>
    )
  }
  return (
    <button
      type="button"
      aria-label="Epic action: tap when used"
      onClick={onMark}
      style={marginButton({ ...size, border: '2px solid var(--color-epic)', background: 'rgba(var(--color-epic-rgb), 0.18)', color: 'var(--color-epic)', boxShadow: '0 0 12px rgba(var(--color-epic-rgb), 0.5)' })}
    >
      <MarkIcon />
    </button>
  )
}

interface ForceButtonProps {
  gameStarted: boolean
  mysticMonastery: boolean
  active: boolean
  mysticUsesRemaining: number
  onToggle: () => void
  onMysticAction: () => void
  size: React.CSSProperties
}

export function ForceButton({ gameStarted, mysticMonastery, active, mysticUsesRemaining, onToggle, onMysticAction, size }: ForceButtonProps) {
  const usesLeft = mysticMonastery ? <span style={{ fontSize: '10px', fontWeight: 700 }}>{`${mysticUsesRemaining} LEFT`}</span> : null
  if (active) {
    return (
      <button
        type="button"
        aria-label="The Force is with you: tap to clear"
        onClick={onToggle}
        style={marginButton({ ...size, background: 'var(--color-accent)', color: 'var(--color-on-accent)' })}
      >
        <ForceIcon faint={false} />{usesLeft}
      </button>
    )
  }
  const exhausted = mysticMonastery && mysticUsesRemaining <= 0
  const label = exhausted ? 'No Force uses left'
    : mysticMonastery ? `Gain the Force: ${mysticUsesRemaining} ${mysticUsesRemaining === 1 ? 'use' : 'uses'} left`
    : 'Gain the Force'
  const disabled = !gameStarted || exhausted
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={mysticMonastery ? onMysticAction : onToggle}
      style={marginButton({ ...size, ...(disabled ? DISABLED_BTN : { background: 'var(--color-tonal)', color: 'var(--color-tonal-text)' }) })}
    >
      <ForceIcon faint={disabled} />{usesLeft}
    </button>
  )
}

// --- the sheets: More, Change base, Round and timer, End game ---

export type OpenSheet = null | 'more' | 'timer' | 'base'

interface GameSheetsProps {
  openSheet: OpenSheet
  setOpenSheet: (s: OpenSheet) => void
  base: Base
  onHelp: () => void
  onSettings?: () => void
  changeBaseOptions?: Base[]
  onChangeBase?: (b: Base) => void
  playMode: PlayMode
  round: number
  playerScore: number
  opponentScore: number
  timerRemaining: number
  timerMinutes: number
  onTimerMinutesChange?: (minutes: number) => void
  timerExpired: boolean
  endGameOpen: boolean
  endGameChoice: MatchResult | null
  // The line above the result, when a base is destroyed.
  destroyedNote: string | null
  onEndGameChoice: (r: MatchResult) => void
  onKeepPlaying: () => void
  onRecord: (r: MatchResult) => void
}

export function GameSheets(props: GameSheetsProps) {
  const {
    openSheet, setOpenSheet, base, onHelp, onSettings, changeBaseOptions, onChangeBase,
    playMode, round, playerScore, opponentScore, timerRemaining, timerMinutes, onTimerMinutesChange, timerExpired,
    endGameOpen, endGameChoice, destroyedNote, onEndGameChoice, onKeepPlaying, onRecord,
  } = props
  const close = () => setOpenSheet(null)
  // Sheet actions close the sheet first, so it isn't left open behind the next screen.
  const closeThen = (fn: () => void) => () => { close(); fn() }

  const isCasual = playMode === 'casual'
  const gameStarted = round > 0
  const nextGame = playerScore + opponentScore + 1

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

  return (
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
        {destroyedNote && <div style={{ fontSize: '0.9rem', color: 'var(--color-error)' }}>{destroyedNote}</div>}
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
    </>
  )
}
