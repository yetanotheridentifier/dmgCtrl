import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Base } from '../hooks/useBases'
import { useBaseArt } from '../hooks/useBaseArt'
import { useUserSettings } from '../hooks/useUserSettings'
import { useCardDrag } from '../hooks/useDragScrubber'
import GameLogOverlay from './gameLogOverlay'
import { Button, Sheet } from './shared/controls'
import { BackIcon, DotsIcon, FlagIcon, LogIcon, PlanIcon } from './icons'
import { BaseCard, MarkIcon } from './swuGamePieces'
import { CARD_ASPECT_RATIO, hasEpicAction, scaled } from './swuGameStyles'
import { lastPhase } from '../utils/twinSuns'
import type { Counter, Placing, TwinSunsState } from '../utils/twinSuns'

export type Seat = 'Top left' | 'Top right' | 'Bottom left' | 'Bottom right'

export interface TwinSunsPlayer {
  base: Base
  seat: Seat
}

interface LogEntry {
  id: string
  type: string
  message: string
  color: string
}

interface Props {
  // You first (top left), then the opponents in seat order.
  players: TwinSunsPlayer[]
  state: TwinSunsState
  // Each player's place, once the game is over.
  placings: Placing[] | null
  picking: Counter | null
  confirmEnd: boolean
  onTap: (i: number) => void
  onIncrement: (i: number, n: number) => void
  onDecrement: (i: number, n: number) => void
  onEpic: (i: number, used: boolean) => void
  onPick: (c: Counter) => void
  onCancelPick: () => void
  onRound: () => void
  onOpenEnd: () => void
  onKeepPlaying: () => void
  onFinish: () => void
  onNoOne: () => void
  onUndoDamage: () => void
  onRematch: () => void
  onNewSetup: () => void
  onBack: () => void
  onHelp: () => void
  onSettings?: () => void
  logEntries: LogEntry[]
  onUndo: () => void
  showLog: boolean
  onLogToggle: () => void
}

const BG = '#05080f'
const TOKEN_EDGE = '#0a0e1a'
const PLAN = '#5b8cff'
const BLAST = '#ef5350'
const FINISH = '#ffb74d'
const COUNTERS: { counter: Counter; name: string; colour: string }[] = [
  { counter: 'initiative', name: 'Initiative', colour: 'var(--color-accent)' },
  { counter: 'plan', name: 'Plan', colour: PLAN },
  { counter: 'blast', name: 'Blast', colour: BLAST },
]
const COUNTER_NAME: Record<Counter, string> = { initiative: 'Initiative', plan: 'Plan', blast: 'Blast' }
const COUNTER_COLOUR: Record<Counter, string> = { initiative: 'var(--color-accent)', plan: PLAN, blast: BLAST }

// A tablet lying flat: the bar's controls grow to 94px squares and the cards with them. Its short side
// decides, so a phone held in portrait (its screen turned to landscape) stays a phone.
const LARGE_QUERY = '(min-width: 600px) and (min-height: 600px)'
function useLarge() {
  const [large, setLarge] = useState(() => window.matchMedia(LARGE_QUERY).matches)
  useEffect(() => {
    const m = window.matchMedia(LARGE_QUERY)
    const update = () => setLarge(m.matches)
    m.addEventListener('change', update)
    return () => m.removeEventListener('change', update)
  }, [])
  return large
}

// The card fills its cell's width or height, whichever runs out first.
const CARD_WIDTH = `min(calc(100cqw - 16px), calc((100cqh - 8px) * ${CARD_ASPECT_RATIO}))`
const CARD_UNIT = `calc(${CARD_WIDTH} / ${CARD_ASPECT_RATIO} / 100)`
const u = (n: number) => scaled(CARD_UNIT, n)

const TAP: React.CSSProperties = {
  boxSizing: 'border-box',
  fontFamily: 'inherit',
  cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent',
  userSelect: 'none',
  WebkitUserSelect: 'none',
}

const barButton = (extra: React.CSSProperties = {}): React.CSSProperties => ({
  ...TAP,
  flexShrink: 0,
  border: 'none',
  borderRadius: '12px',
  padding: 0,
  background: 'var(--color-surface-raised)',
  color: 'var(--color-text-body)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '4px',
  fontSize: '12px',
  ...extra,
})

const token = (colour: string): React.CSSProperties => ({
  ...TAP,
  width: `min(${u(18)}, 52px)`,
  height: `min(${u(18)}, 52px)`,
  padding: 0,
  border: `2px solid ${TOKEN_EDGE}`,
  borderRadius: '50%',
  background: colour,
  color: '#04121c',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxShadow: '0 2px 6px rgba(0,0,0,0.6)',
})

const cover: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 6,
  borderRadius: '3.5%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: u(2),
}

interface CellProps {
  index: number
  player: TwinSunsPlayer
  state: TwinSunsState
  placing: Placing | null
  picking: Counter | null
  onTap: (i: number) => void
  onIncrement: (i: number, n: number) => void
  onDecrement: (i: number, n: number) => void
  onEpic: (i: number, used: boolean) => void
  onPick: (c: Counter) => void
  // The log, over your cell, facing you.
  log?: ReactNode
  style?: React.CSSProperties
}

function Cell({ index, player, state, placing, picking, onTap, onIncrement, onDecrement, onEpic, onPick, log, style }: CellProps) {
  const { base, seat } = player
  const { useHyperspace } = useUserSettings()
  const art = useBaseArt(base, useHyperspace)
  const top = seat.startsWith('Top')
  const yours = index === 0
  const damage = state.damage[index]
  const out = state.out[index]
  const choosing = picking !== null || state.pending.length > 0
  const playing = !state.finished && !out && !choosing
  const hpLeft = base.hp - damage
  const drag = useCardDrag(
    () => onTap(index),
    n => onIncrement(index, n),
    n => onDecrement(index, n),
    hpLeft,
    damage,
    playing,
    top,
  )

  const selectable = !state.finished && !out && choosing
  const highlight = selectable ? (state.pending.length > 0 ? 'var(--color-success)' : COUNTER_COLOUR[picking as Counter]) : null
  const label = (() => {
    if (!selectable) return undefined
    if (state.pending.length > 0) return `${base.name}: destroyed it, heals 5`
    return picking === 'initiative' ? `${base.name}: takes the initiative` : `${base.name}: claimed ${COUNTER_NAME[picking as Counter]}`
  })()

  const showEpic = hasEpicAction(base) && !out && !state.finished
  const used = state.epicUsed[index]

  return (
    <section
      aria-label={seat}
      style={{
        position: 'relative',
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        containerType: 'size',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...(top ? { transform: 'rotate(180deg)' } : {}),
        ...style,
      }}
    >
      <div style={{ position: 'relative', width: CARD_WIDTH, aspectRatio: `${CARD_ASPECT_RATIO}`, borderRadius: '3.5%', boxShadow: highlight ? `0 0 0 3px ${highlight}, 0 0 14px ${highlight}` : undefined }}>
        <BaseCard
          base={base}
          art={{ src: art.src, rotationDeg: art.rotationDeg, loaded: art.imageLoaded, failed: art.allFailed, onLoad: art.onLoad, onError: art.onError }}
          face={{ count: damage, gameStarted: true, isCasual: true, matchResult: null, lastGame: null, playerScore: 0, opponentScore: 0, owner: yours ? 'your base' : undefined }}
          label={label}
          disabled={out || state.finished}
          epicActionToken={false}
          dragAmount={drag.amount}
          drag={drag}
          width="100%"
          unit={CARD_UNIT}
        />

        {/* The counters this player holds, down the card's left edge */}
        <div style={{ position: 'absolute', left: '3%', top: '20%', zIndex: 5, display: 'flex', flexDirection: 'column', gap: u(2) }}>
          {state.initiative === index && (
            <button type="button" aria-label={`Initiative, ${base.name}: tap to move it`} onClick={() => onPick('initiative')} style={token('var(--color-accent)')}>
              <FlagIcon size="55%" />
            </button>
          )}
          {state.plan === index && <span role="img" aria-label={`Plan, ${base.name}`} style={token(PLAN)}><PlanIcon size="55%" /></span>}
          {state.blast === index && <span role="img" aria-label={`Blast, ${base.name}`} style={token(BLAST)}><MarkIcon size="55%" /></span>}
        </div>

        {yours && (
          <span aria-hidden="true" style={{ position: 'absolute', right: '3%', top: '21%', zIndex: 5, fontSize: `max(10px, ${u(5.3)})`, letterSpacing: '0.16em', fontWeight: 700, color: 'var(--color-accent)', textShadow: '0 1px 4px #000' }}>YOU</span>
        )}

        {showEpic && (used ? (
          <button
            type="button"
            aria-label={`${base.name}: epic action used, tap to undo`}
            onClick={() => onEpic(index, false)}
            style={{ ...TAP, position: 'absolute', left: '3%', right: '3%', bottom: '2%', height: '36%', zIndex: 5, border: '2px solid var(--color-epic)', borderRadius: '6px', background: 'rgba(var(--color-epic-rgb), 0.55)', boxShadow: '0 0 18px rgba(var(--color-epic-rgb), 0.55), 0 4px 14px rgba(0,0,0,0.6)', color: '#1a1500', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: u(4), fontSize: `max(12px, ${u(7)})`, fontWeight: 700, letterSpacing: '0.08em', padding: 0 }}
          >
            <MarkIcon size={u(11)} />
            <span>EPIC ACTION USED</span>
          </button>
        ) : (
          <button
            type="button"
            aria-label={`${base.name}: epic action, tap when used`}
            onClick={() => onEpic(index, true)}
            style={{ ...TAP, position: 'absolute', right: '5%', bottom: '6%', zIndex: 5, width: `min(${u(21)}, 64px)`, height: `min(${u(21)}, 64px)`, border: '2px solid var(--color-epic)', borderRadius: '50%', background: '#2b2610', color: 'var(--color-epic)', boxShadow: '0 0 12px rgba(var(--color-epic-rgb), 0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
          >
            <MarkIcon size="52%" />
          </button>
        ))}

        {state.healed === index && (
          <div style={{ position: 'absolute', left: '50%', top: u(4), zIndex: 5, transform: 'translateX(-50%)', padding: '4px 12px', borderRadius: '12px', background: '#0f2a18', border: '1px solid var(--color-success)', color: '#86efac', fontSize: `max(13px, ${u(7)})`, fontWeight: 600, whiteSpace: 'nowrap' }}>
            +5 healed
          </div>
        )}

        {out && (
          <div role="img" aria-label={`${base.name} is destroyed`} style={{ ...cover, background: 'rgba(5,8,15,0.92)', color: 'var(--color-error)' }}>
            <MarkIcon size={u(30)} />
            <span style={{ fontSize: `max(16px, ${u(11)})`, fontWeight: 700, letterSpacing: '0.12em' }}>DESTROYED</span>
          </div>
        )}

        {placing && placing.place !== null && (
          <div role="img" aria-label={`${placing.label}, ${placing.hpLeft} HP left`} style={{ ...cover, background: 'rgba(5,8,15,0.88)' }}>
            <span style={{ fontSize: `max(24px, ${u(20)})`, fontWeight: 600, lineHeight: 1, color: placing.place === 1 ? 'var(--color-success)' : 'var(--color-text-primary)' }}>{placing.label}</span>
            <span style={{ fontSize: `max(13px, ${u(8)})`, color: 'var(--color-text-body)' }}>{`${placing.hpLeft} HP left`}</span>
          </div>
        )}
      </div>
      {log}
    </section>
  )
}

function SwuTwinSunsGameView(props: Props) {
  const {
    players, state, placings, picking, confirmEnd, onTap, onIncrement, onDecrement, onEpic, onPick, onCancelPick,
    onRound, onOpenEnd, onKeepPlaying, onFinish, onNoOne, onUndoDamage, onRematch, onNewSetup, onBack, onHelp, onSettings,
    logEntries, onUndo, showLog, onLogToggle,
  } = props
  const large = useLarge()
  const [moreOpen, setMoreOpen] = useState(false)
  const four = players.length === 4
  const last = lastPhase(state)
  const over = placings !== null

  // --- the bar ---

  const square = large ? '94px' : null
  // Back, Log and More are the counters' size, their icons centred in the counters' icon box.
  const counterSize = large ? { width: '94px', height: '94px', borderRadius: '16px', fontSize: '13px' } : { width: '60px', height: '60px', fontSize: '11px' }
  const iconSize = large ? '36px' : '26px'
  const iconBox = (icon: ReactNode) => (
    <span style={{ width: iconSize, height: iconSize, fontSize: iconSize, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{icon}</span>
  )

  const back = <button type="button" aria-label="Back to setup" onClick={onBack} style={barButton(counterSize)}>{iconBox(<BackIcon />)}{large && <span>Back</span>}</button>
  const logButton = <button type="button" aria-label="Log" onClick={onLogToggle} style={barButton(counterSize)}>{iconBox(<LogIcon />)}{large && <span>Log</span>}</button>
  const more = <button type="button" aria-label="More" onClick={() => setMoreOpen(true)} style={barButton(counterSize)}>{iconBox(<DotsIcon />)}{large && <span>More</span>}</button>

  const counterButton = ({ counter, name, colour }: typeof COUNTERS[number]) => {
    if (counter === 'initiative') {
      return (
        <button key={counter} type="button" aria-label="Claim initiative: tap, then the base of the player who takes it" onClick={() => onPick('initiative')} style={barButton({ ...counterSize, background: 'var(--color-surface)', color: colour, border: `2px solid ${colour}` })}>
          <FlagIcon size={iconSize} /><span>{name}</span>
        </button>
      )
    }
    const taken = state[counter] !== null
    const icon = counter === 'plan' ? <PlanIcon size={iconSize} /> : <MarkIcon size={iconSize} />
    return taken ? (
      <button key={counter} type="button" disabled aria-label={`${name} is claimed this round`} style={barButton({ ...counterSize, background: '#0d111a', color: '#3b4352', border: '2px solid var(--color-surface-raised)', cursor: 'default' })}>
        {icon}<span>{name}</span>
      </button>
    ) : (
      <button key={counter} type="button" aria-label={`${name}: tap, then the base of the player who claimed it`} onClick={() => onPick(counter)} style={barButton({ ...counterSize, background: 'var(--color-surface)', color: colour, border: `2px solid ${colour}` })}>
        {icon}<span>{name}</span>
      </button>
    )
  }
  const counters = COUNTERS.map(counterButton)

  const roundButton = (
    <button type="button" aria-label={`Round ${state.round}: tap for round ${state.round + 1}; Plan and Blast return`} onClick={onRound} style={barButton({ ...(large ? { width: '94px', height: '94px', borderRadius: '16px', gap: '2px' } : { flex: 1, height: four ? '60px' : '56px', flexDirection: 'row', gap: '6px' }), background: 'var(--color-accent)', color: 'var(--color-on-accent)' })}>
      <span style={{ fontSize: large ? '13px' : '12px' }}>Round</span>
      <span style={{ fontSize: large ? '38px' : '24px', fontWeight: 300, lineHeight: 1 }}>{state.round}</span>
    </button>
  )
  const finishButton = (
    <button type="button" aria-label="Finish game: end of this phase" onClick={onFinish} style={barButton({ ...(large ? { width: '94px', height: '94px', borderRadius: '16px', fontSize: '15px' } : { flex: 1, height: '60px', fontSize: '17px' }), background: FINISH, color: '#2a1a00', fontWeight: 700 })}>
      Finish game
    </button>
  )
  const endButton = (
    <button type="button" aria-label="End game" onClick={onOpenEnd} style={barButton({ ...(large ? { width: '94px', height: '94px', borderRadius: '16px', fontSize: '15px' } : four ? { width: '100%', height: '38px', borderRadius: '10px' } : { width: '98px', height: '56px', borderRadius: '10px' }), background: 'var(--color-tonal)', color: 'var(--color-tonal-text)', fontWeight: 600 })}>
      {large ? <span style={{ textAlign: 'center', lineHeight: '18px' }}>End<br />game</span> : 'End game'}
    </button>
  )

  const outNames = players.filter((_, i) => state.out[i]).map(p => p.base.name)
  const lastNote = last && (
    <div role="status" style={{ fontSize: '12px', lineHeight: '16px', color: '#ffe0a8' }}>
      <b style={{ letterSpacing: '0.1em' }}>LAST PHASE</b>
      <br />
      {`${outNames.join(' and ')} ${outNames.length > 1 ? 'are' : 'is'} out. Finish at the end of this phase; most HP left wins.`}
    </div>
  )

  const wide = (extra: React.CSSProperties = {}) => barButton({ width: '100%', height: '44px', borderRadius: '10px', fontSize: '14px', color: 'var(--color-text-primary)', ...extra })
  const status = (children: ReactNode) => <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px', lineHeight: '18px', color: 'var(--color-text-primary)' }}>{children}</div>
  const spacer = <div style={{ flex: 1 }} />
  const headRow = large
    ? <div style={{ display: 'grid', gridTemplateColumns: four ? '94px' : '94px 94px', gap: '8px' }}>{back}{logButton}{more}</div>
    : <div style={{ display: 'flex', gap: '6px', justifyContent: 'space-between' }}>{back}{logButton}{more}</div>

  let body: ReactNode
  if (over) {
    const order = players.map((p, i) => ({ p, i, placing: placings[i] }))
      .sort((a, b) => (a.placing.place ?? 99) - (b.placing.place ?? 99))
    body = (
      <>
        {headRow}
        <div style={{ fontSize: '11px', letterSpacing: '0.14em', color: 'var(--color-text-muted)' }}>{`RESULT · ROUND ${state.round}`}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px' }}>
          {order.map(({ p, i, placing }) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '6px' }}>
              <span>
                <b style={{ color: placing.place === null ? 'var(--color-error)' : placing.place === 1 ? 'var(--color-success)' : 'var(--color-text-primary)' }}>{placing.label.split(' · ')[0]}</b>
                {` ${p.base.name}${i === 0 ? ' (you)' : ''}`}
              </span>
              <span style={{ color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{placing.place === null ? '' : `${placing.hpLeft} HP`}</span>
            </div>
          ))}
        </div>
        {spacer}
        <button type="button" onClick={onNewSetup} style={wide({ background: 'var(--color-tonal)', color: 'var(--color-tonal-text)' })}>New setup</button>
        <button type="button" onClick={onRematch} style={wide({ height: '56px', borderRadius: '12px', fontSize: '17px', fontWeight: 600, background: 'var(--color-accent)', color: 'var(--color-on-accent)' })}>Rematch</button>
      </>
    )
  } else if (state.pending.length > 0) {
    const destroyed = players[state.pending[0]].base.name
    body = (
      <>
        {headRow}
        {status(
          <>
            <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-error)' }}>{`${destroyed} is destroyed`}</div>
            <div>Tap the base of the player who destroyed it. That base heals 5.</div>
          </>,
        )}
        {spacer}
        <button type="button" onClick={onNoOne} style={wide()}>No one</button>
        <button type="button" onClick={onUndoDamage} style={wide({ background: 'var(--color-tonal)', color: 'var(--color-tonal-text)' })}>Undo the damage</button>
      </>
    )
  } else if (picking) {
    const colour = COUNTER_COLOUR[picking]
    // Nobody has the initiative until the game starts: choosing who does is how it starts.
    const opening = state.initiative === null
    const who = opening ? 'takes it' : picking === 'initiative' ? 'takes the initiative' : `claimed ${COUNTER_NAME[picking]}`
    body = (
      <>
        {headRow}
        {status(
          <>
            {opening && <div style={{ fontSize: '15px', fontWeight: 600 }}>Who has the initiative?</div>}
            <span aria-hidden="true" style={{ ...barButton({ ...counterSize, background: colour, color: '#1a0505', fontWeight: 700 }), cursor: 'default' }}>
              {picking === 'initiative' ? <FlagIcon size={iconSize} /> : picking === 'plan' ? <PlanIcon size={iconSize} /> : <MarkIcon size={iconSize} />}
              <span>{COUNTER_NAME[picking]}</span>
            </span>
            <span>{`Tap the base of the player who ${who}`}</span>
          </>,
        )}
        {spacer}
        {!opening && <button type="button" onClick={onCancelPick} style={wide()}>Cancel</button>}
      </>
    )
  } else if (confirmEnd) {
    body = (
      <>
        {headRow}
        {status(<span>End the game now? Most HP left wins.</span>)}
        {spacer}
        <button type="button" onClick={onKeepPlaying} style={wide()}>Keep playing</button>
        <button type="button" onClick={onFinish} style={wide({ background: 'var(--color-tonal)', color: 'var(--color-tonal-text)' })}>End game now</button>
      </>
    )
  } else if (large) {
    // Every control a 94px square: one column between the bases in 4 players, two in 3.
    body = (
      <div style={{ margin: 'auto', display: 'grid', gridTemplateColumns: four ? '94px' : '94px 94px', gap: '8px' }}>
        {back}{logButton}
        {four ? <>{more}{counters}</> : <>{counters}{more}</>}
        {last ? finishButton : roundButton}
        {last ? <div style={{ width: square ?? undefined, overflow: 'hidden' }}>{lastNote}</div> : endButton}
      </div>
    )
  } else {
    body = (
      <>
        {headRow}
        <div role="group" aria-label="Counters" style={{ display: 'flex', gap: '7px', justifyContent: 'space-between' }}>{counters}</div>
        {lastNote}
        {spacer}
        {last ? finishButton : four ? <>{roundButton}{endButton}</> : <div style={{ display: 'flex', gap: '6px' }}>{roundButton}{endButton}</div>}
      </>
    )
  }

  const barWidth = large ? (four ? '110px' : '212px') : (four ? '210px' : '290px')
  const bar = (
    <nav
      aria-label={over ? 'Game over, facing you' : 'Game, facing you'}
      style={{ width: barWidth, flexShrink: 0, boxSizing: 'border-box', padding: '8px', display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', transform: 'rotate(180deg)' }}
    >
      {body}
    </nav>
  )

  // --- the cells ---

  const cellFor = (seat: Seat, style?: React.CSSProperties) => {
    const i = players.findIndex(p => p.seat === seat)
    if (i < 0) return null
    return (
      <Cell
        key={seat}
        index={i}
        player={players[i]}
        state={state}
        placing={placings ? placings[i] : null}
        picking={picking}
        onTap={onTap}
        onIncrement={onIncrement}
        onDecrement={onDecrement}
        onEpic={onEpic}
        onPick={onPick}
        log={i === 0 && showLog ? <GameLogOverlay entries={logEntries} onUndo={onUndo} position={{ inset: '8px' }} /> : undefined}
        style={style}
      />
    )
  }

  let layout: ReactNode
  if (four) {
    layout = (
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>{cellFor('Top left')}{cellFor('Bottom left')}</div>
        {bar}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>{cellFor('Top right')}{cellFor('Bottom right')}</div>
      </div>
    )
  } else {
    // Three players: the bar between the two bases on one side, the single base centred on the other.
    const row = (side: 'top' | 'bottom', left: Seat, right: Seat) => {
      const pair = players.some(p => p.seat === left) && players.some(p => p.seat === right)
      const single: React.CSSProperties = { flex: `0 1 calc((100% - ${barWidth}) / 2)` }
      return (
        <div data-testid={`twin-suns-row-${side}`} style={{ flex: 1, minHeight: 0, display: 'flex', justifyContent: pair ? 'normal' : 'center' }}>
          {pair ? <>{cellFor(left)}{bar}{cellFor(right)}</> : cellFor(left, single) ?? cellFor(right, single)}
        </div>
      )
    }
    layout = <>{row('top', 'Top left', 'Top right')}{row('bottom', 'Bottom left', 'Bottom right')}</>
  }

  return (
    <div
      data-testid="twin-suns"
      data-players={players.length}
      style={{ position: 'fixed', inset: 0, overflow: 'hidden', boxSizing: 'border-box', paddingTop: 'var(--edge-top)', paddingRight: 'var(--edge-right)', paddingBottom: 'var(--edge-bottom)', paddingLeft: 'var(--edge-left)', background: BG, color: 'var(--color-text-primary)', display: 'flex', flexDirection: 'column' }}
    >
      {layout}
      <Sheet open={moreOpen} title="More" onClose={() => setMoreOpen(false)}>
        <Button onClick={() => { setMoreOpen(false); onHelp() }}>Help</Button>
        {onSettings && <Button onClick={() => { setMoreOpen(false); onSettings() }}>Settings</Button>}
      </Sheet>
    </div>
  )
}

export default SwuTwinSunsGameView
