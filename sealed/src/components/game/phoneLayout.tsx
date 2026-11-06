import { useContext, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Button, IconButton, Sheet } from '@pwa-shared/controls'
import type { CapturedCard, GameState, PlayerId, UnitState } from '../../engine/types'
import { CardInspect, useCardZoom } from '../useCardZoom'
import { outcomeBanner } from '../outcome'
import type { LogEntry } from '../../hooks/useGame'
import { partsText, type DescribePart } from '../../utils/describeAction'
import type { UnitInteraction } from '../gameScreen'
import CardFace from '../cardFace'
import { intentHighlight } from '../highlight'
import type { Highlight } from '../highlight'
import { DescribedParts } from '../cardRef'
import { BOARD_SCALE, boardLeft, orderUnits, type BoardScale } from '../boardLayout'
import { CardZoomPopover } from '../cardZoom'
import { BackIcon, CloseIcon, DotsIcon, LogIcon } from '../icons'
import { unitHasKeyword } from '../../engine/keywords'
import { effectiveHp, effectivePower } from '../../engine/stats'
import { friendlyCreditTokens, hasForceToken } from '../../engine/effects'
import { TOKEN_ADVANTAGE, TOKEN_CARDS, TOKEN_EXPERIENCE, TOKEN_SHIELD, TOKEN_WEAKNESS } from '../../engine/tokenUpgrades'

/**
 * The game screen: a column of controls on the left (leave, log and more; the round; each side's
 * counts; the prompt; the action buttons), and the board filling the rest, with the hand under it.
 * On a phone in landscape everything fits the screen at 844×390: nothing scrolls. The desktop runs
 * the same layout grown (`BOARD_SCALE`), with the log docked in its wider column.
 *
 * Presentational: the game screen works out what can be done and hands the pieces in.
 */

/** A half holding more units than this lays them five to a row, smaller. */
const CROWDED_AFTER = 8

const PANEL = 'flex flex-1 flex-wrap justify-center gap-0.5 rounded-[10px] px-[13px]'
/** Space is drawn as a starfield; ground is plain. */
const STARFIELD: CSSProperties = {
  background: [
    'radial-gradient(1px 1px at 20% 25%, rgba(255,255,255,0.55) 50%, transparent 51%)',
    'radial-gradient(1px 1px at 72% 40%, rgba(255,255,255,0.45) 50%, transparent 51%)',
    'radial-gradient(1px 1px at 42% 78%, rgba(255,255,255,0.4) 50%, transparent 51%)',
    'radial-gradient(1.5px 1.5px at 86% 15%, rgba(255,255,255,0.5) 50%, transparent 51%)',
    'radial-gradient(1px 1px at 10% 85%, rgba(255,255,255,0.4) 50%, transparent 51%)',
    'linear-gradient(180deg, #171a3c, #0f1530)',
  ].join(', '),
}
const GROUND: CSSProperties = { background: 'rgba(255, 255, 255, 0.04)' }

/** The opponent's colour, the PWA token Sealed's theme does not name. */
const OPPONENT_TEXT = 'text-[color:var(--color-opponent)]'
const OPPONENT_BORDER = `border-[color:var(--color-opponent)] ${OPPONENT_TEXT}`

const BADGE = 'pointer-events-none whitespace-nowrap rounded-md px-[3px] text-[7px] font-bold leading-[11px] shadow-[0_1px_2px_rgba(0,0,0,0.7)]'

/**
 * Every token upgrade (`TOKEN_CARDS`, whose names they go by), in the order a unit's badges stack:
 * the short label on its board badge, and its colour there and beside its count in the held view.
 */
const TOKEN_BADGES: Record<string, { short: string; style: string }> = {
  [TOKEN_SHIELD]: { short: 'Shd', style: 'bg-token-shield text-white' },
  [TOKEN_EXPERIENCE]: { short: 'Exp', style: 'bg-token-experience text-token-ink-dark' },
  [TOKEN_ADVANTAGE]: { short: 'Adv', style: 'bg-token-advantage text-token-ink-dark' },
  [TOKEN_WEAKNESS]: { short: 'Weak', style: 'bg-token-weakness text-white' },
}

/** A count in the held view, in the colour of what it counts. */
const CHIP = 'min-w-5 rounded-[3px] text-center text-xs font-bold leading-5'

/** A unit's power and HP: a disc in each bottom corner, `size` across. */
const STAT = 'pointer-events-none absolute bottom-0 rounded-full text-center font-bold text-white'
const statStyle = (size: number): CSSProperties => ({ width: size, height: size, lineHeight: `${size}px`, fontSize: Math.round(size * 0.62) })

/**
 * A unit in its square slot: the card art, turned sideways when exhausted, with its power and HP
 * and a badge for each thing on it. The badges stay upright on an exhausted unit.
 *
 * The attacker is ringed white, a target in the colour of what picking it does (`intentHighlight`),
 * and a unit that can act in blue.
 */
export function PhoneUnit({ state, unit, interact, size = 'normal', scale = 'phone' }: {
  state: GameState
  unit: UnitState
  interact: UnitInteraction
  size?: 'normal' | 'crowded'
  scale?: BoardScale
}) {
  const { slot, card } = BOARD_SCALE[scale].unit[size]
  const stat = BOARD_SCALE[scale].unitStat
  // A held card opens full size; with a mouse, Shift over it shows it beside the board.
  const { zoomed, bind, anchorRef, setAnchor } = useCardZoom({ cardId: unit.cardId, instanceId: unit.instanceId })
  const clickable = (interact.actionable || interact.isTarget || interact.isUpgradeTarget) && interact.onClick
  const highlight: Highlight | undefined = interact.acting === 'actor'
    ? 'amber'
    : interact.acting === 'target'
      ? 'red'
      : interact.selected
    ? 'white'
    : interact.isTarget
      ? intentHighlight(interact.intent)
      : interact.isUpgradeTarget
        ? intentHighlight('attach')
        : interact.actionable
          ? 'accent'
          : undefined
  const upgrades = upgradeCards(state, unit).length
  const sentinel = unitHasKeyword(state, unit, 'Sentinel')
  const name = cardName(state, unit.cardId)
  const captured = unit.captured ?? []
  const [capturedOpen, setCapturedOpen] = useState(false)
  const tags = [
    unit.isLeader && { kind: 'leader', text: 'LEADER', style: 'bg-amber text-black' },
    sentinel && { kind: 'sentinel', text: 'Sentinel', style: 'bg-black/80 text-ink' },
    unit.hidden && !sentinel && { kind: 'hidden', text: 'Hidden', style: 'bg-black/80 text-ink' },
    ...Object.entries(TOKEN_BADGES).map(([id, { short, style }]) => {
      const n = unit.upgrades.filter(u => u.cardId === id).length
      const name = TOKEN_CARDS[id].name
      return n > 0 && { kind: name.toLowerCase(), text: `${short} ${n}`, style, label: `${n} ${name}` }
    }),
  ].filter((t): t is { kind: string; text: string; style: string; label?: string } => Boolean(t))
  return (
    <>
    {/* Outside the unit, so a tap in it never reaches the unit's own tap or hold. */}
    {capturedOpen && <CapturedCards state={state} guard={name} captured={captured} onClose={() => setCapturedOpen(false)} />}
    <div
      ref={setAnchor}
      data-testid={`board-unit-${unit.instanceId}`}
      data-actionable={interact.actionable}
      data-selected={interact.selected}
      data-target={interact.isTarget}
      data-upgrade-target={Boolean(interact.isUpgradeTarget)}
      role={clickable ? 'button' : undefined}
      aria-label={name}
      {...bind}
      onClick={clickable ? interact.onClick : undefined}
      className={`relative flex shrink-0 items-center justify-center ${clickable ? 'cursor-pointer' : ''}`}
      style={{ width: slot, height: slot }}
    >
      <CardFace card={state.cards[unit.cardId]} fallbackName={unit.cardId} deployed={unit.isLeader} exhausted={unit.exhausted} highlight={highlight} widthPx={card} />
      <div className="pointer-events-none absolute inset-x-0 top-0.5 flex flex-col items-center gap-px">
        {tags.map(t => (
          <span key={t.kind} data-testid={`unit-badge-${t.kind}`} aria-label={t.label} className={`${BADGE} ${t.style}`}>{t.text}</span>
        ))}
      </div>
      {captured.length > 0 && (
        <button
          type="button"
          data-testid="unit-badge-captured"
          aria-label={`${name}: guarding ${captured.length} captured card${captured.length === 1 ? '' : 's'}`}
          aria-expanded={capturedOpen}
          onClick={e => { e.stopPropagation(); setCapturedOpen(true) }}
          className={`${BADGE} absolute left-1/2 top-[-9px] z-10 -translate-x-1/2 cursor-pointer border-none bg-amber px-1 text-black`}
        >
          {captured.length} CAPT
        </button>
      )}
      {unit.damage > 0 && (
        <span data-testid="unit-badge-damage" aria-label={`${unit.damage} damage`} className="pointer-events-none absolute left-1/2 top-1/2 min-w-4 -translate-x-1/2 -translate-y-1/2 rounded-[3px] bg-red text-center text-[10px] font-bold leading-4 text-white">
          {unit.damage}
        </span>
      )}
      {upgrades > 0 && (
        <span data-testid="unit-badge-upgrades" aria-label={`${upgrades} upgrades`} className={`${BADGE} absolute right-0 top-1/2 bg-[var(--color-surface-raised)] text-ink`}>+{upgrades}</span>
      )}
      <span className={`${STAT} left-0 bg-red`} style={statStyle(stat)}>{effectivePower(state, unit)}</span>
      <span className={`${STAT} right-0 bg-token-hp`} style={statStyle(stat)}>{effectiveHp(state, unit)}</span>
      {zoomed && <CardZoomPopover card={state.cards[unit.cardId]} fallbackName={unit.cardId} deployed={unit.isLeader} anchorRef={anchorRef} />}
    </div>
    </>
  )
}

const cardName = (state: GameState, cardId: string) => state.cards[cardId]?.name ?? cardId

/** The upgrades on a unit that are cards, not tokens: what its +n badge counts. */
const upgradeCards = (state: GameState, unit: UnitState) => unit.upgrades.filter(u => state.cards[u.cardId]?.type !== 'token')

/** A captured card, whose it is, and what becomes of it when its guard leaves play. */
function captiveNote(state: GameState, c: CapturedCard, guard: string): string {
  const yours = c.owner === 'player'
  return `${cardName(state, c.cardId)}, ${yours ? 'your' : "the opponent's"} card. It comes back into play for ${yours ? 'you' : 'them'}, exhausted, when ${guard} leaves play.`
}

/**
 * What a unit is guarding, opened from its CAPT tag: each captured card (tap it to see it full size),
 * whose it is, and that it comes back into play exhausted for its owner when the guard leaves play.
 */
function CapturedCards({ state, guard, captured, onClose }: {
  state: GameState
  guard: string
  captured: CapturedCard[]
  onClose: () => void
}) {
  useEscape(true, onClose)
  const inspect = useContext(CardInspect)
  return (
    <>
      <button type="button" aria-label="Close the captured cards" onClick={onClose} className="fixed inset-0 z-40 cursor-default border-none bg-transparent p-0" />
      <div role="dialog" aria-label={`${guard}'s captured card${captured.length === 1 ? '' : 's'}`} className="fixed right-2 top-2 z-50 flex w-[270px] flex-col gap-2 rounded-[14px] bg-[var(--color-sheet)] p-3 shadow-[0_8px_28px_rgba(0,0,0,0.6)]">
        <div className="flex items-center gap-2">
          <span className="flex-1 text-xs tracking-[0.14em] text-accent">{guard.toUpperCase()} · GUARDING {captured.length}</span>
          <IconButton label="Close" onClick={onClose}><CloseIcon /></IconButton>
        </div>
        {captured.map((c, i) => (
          <div key={`${c.cardId}-${i}`} className="flex items-start gap-2.5">
            <button type="button" aria-label={`${cardName(state, c.cardId)}: see the card`} onClick={() => inspect?.({ cardId: c.cardId })} className="flex-none cursor-pointer border-none bg-transparent p-0">
              <CardFace card={state.cards[c.cardId]} fallbackName={c.cardId} tight widthPx={50} />
            </button>
            <div className="text-[13px] leading-[18px] text-ink-dim">{captiveNote(state, c, guard)}</div>
          </div>
        ))}
      </div>
    </>
  )
}

/**
 * One side's half of an arena. The opponent's units grow up from the gap and yours down from it, so
 * both front rows meet in the middle; Sentinels sit in the front row (`orderUnits`).
 */
export function PhoneArena({ state, side, arena, unitInteraction, scale = 'phone' }: {
  state: GameState
  side: PlayerId
  arena: 'ground' | 'space'
  unitInteraction: (unit: UnitState) => UnitInteraction
  scale?: BoardScale
}) {
  const anchor = side === 'opponent' ? 'bottom' : 'top'
  const units = orderUnits(state, state.players[side].units.filter(u => u.arena === arena), anchor)
  const size = units.length > CROWDED_AFTER ? 'crowded' : 'normal'
  const perRow = size === 'crowded' ? 5 : 4
  return (
    <div
      data-testid={`${side}-${arena}-units`}
      data-per-row={perRow}
      className={PANEL}
      style={{ ...(arena === 'space' ? STARFIELD : GROUND), flexWrap: side === 'opponent' ? 'wrap-reverse' : 'wrap', alignContent: 'flex-start' }}
    >
      {units.map(u => <PhoneUnit key={u.instanceId} state={state} unit={u} interact={unitInteraction(u)} size={size} scale={scale} />)}
    </div>
  )
}

/** The arena's name, set vertically at its outer edge as bare text over the panels and the stars. */
function ArenaLabel({ label, edge }: { label: string; edge: 'left' | 'right' }) {
  return (
    <span
      aria-hidden="true"
      className="absolute top-1/2 w-[15px] -translate-y-1/2 text-center text-[9px] leading-[15px] tracking-[0.25em] text-ink-dim"
      style={{ [edge]: 0, writingMode: 'vertical-rl', transform: edge === 'left' ? 'rotate(180deg)' : undefined }}
    >
      {label}
    </span>
  )
}

function Arena({ state, arena, playerInteraction, opponentInteraction, scale }: {
  state: GameState
  arena: 'ground' | 'space'
  playerInteraction: (unit: UnitState) => UnitInteraction
  opponentInteraction: (unit: UnitState) => UnitInteraction
  scale: BoardScale
}) {
  return (
    <div role="region" aria-label={arena === 'space' ? 'Space arena' : 'Ground arena'} className="relative flex min-w-0 flex-col" style={{ gap: BOARD_SCALE[scale].arenaGap }}>
      <PhoneArena state={state} side="opponent" arena={arena} unitInteraction={opponentInteraction} scale={scale} />
      <PhoneArena state={state} side="player" arena={arena} unitInteraction={playerInteraction} scale={scale} />
      <ArenaLabel label={arena === 'space' ? 'SPACE' : 'GROUND'} edge={arena === 'space' ? 'left' : 'right'} />
    </div>
  )
}

function Pill({ children, className, label }: { children: ReactNode; className: string; label?: string }) {
  return <span role={label ? 'img' : undefined} aria-label={label} className={`rounded-md px-1.5 py-px text-[9px] tracking-[0.08em] ${className}`}>{children}</span>
}

function Stat({ value, label, name, onClick, tonal = false }: { value: ReactNode; label: string; name: string; onClick?: () => void; tonal?: boolean }) {
  return (
    <button
      type="button"
      data-testid={`stat-${label.toLowerCase()}`}
      aria-label={name}
      onClick={onClick}
      disabled={!onClick}
      className={`flex h-[38px] min-w-0 flex-1 flex-col items-center justify-center gap-px rounded-[10px] ${tonal ? 'bg-[var(--color-tonal)]' : 'bg-surface'}`}
    >
      <b className="text-sm font-semibold leading-[15px] text-ink">{value}</b>
      <i className={`text-[8px] not-italic leading-[9px] tracking-[0.08em] ${tonal ? 'text-accent' : 'text-ink-faint'}`}>{label}</i>
    </button>
  )
}

/**
 * One side's heading and counts: resources ready of total, the opponent's hand, the deck and the
 * discard, with INITIATIVE, FORCE and CRED n beside the heading of the side holding them. The
 * discard count opens the pile; the deck count opens the top card when a card lets you look at it.
 * The heading is one height with or without a pill, so the counts (and the prompt under the
 * opponent's) do not move when the initiative or a token changes hands.
 */
export function PlayerSummary({ state, side, onDiscard, onDeck }: {
  state: GameState
  side: PlayerId
  onDiscard: (side: PlayerId) => void
  onDeck?: () => void
}) {
  const p = state.players[side]
  const mine = side === 'player'
  const whose = mine ? 'Your' : "Opponent's"
  const readyCount = p.resources.filter(r => !r.exhausted).length
  const credits = friendlyCreditTokens(state, side)
  return (
    <div data-testid={`${side}-summary`} className="flex flex-col gap-1.5">
      <div data-testid="summary-heading" className={`flex h-[18px] items-center gap-1.5 text-[10px] tracking-[0.14em] ${mine ? 'text-accent' : OPPONENT_TEXT}`}>
        {mine ? 'YOU' : 'OPPONENT'}
        {state.initiative === side && <Pill className={`border ${mine ? 'border-accent text-accent' : OPPONENT_BORDER}`}>INITIATIVE</Pill>}
        {hasForceToken(state, side) && <Pill className="bg-token-force text-ink" label={`The Force is with ${mine ? 'you' : 'the opponent'}`}>FORCE</Pill>}
        {credits > 0 && <Pill className="bg-token-credit text-ink" label={`${credits} Credit token${credits === 1 ? '' : 's'}`}>CRED {credits}</Pill>}
      </div>
      <div className="flex gap-1">
        <Stat value={`${readyCount}/${p.resources.length}`} label="RES" name={`${whose} resources: ${readyCount} ready of ${p.resources.length}`} tonal={mine} />
        {!mine && <Stat value={p.hand.length} label="HAND" name={`${whose} hand: ${p.hand.length} cards`} />}
        <Stat value={p.deck.length} label="DECK" name={`${whose} deck: ${p.deck.length} cards`} onClick={onDeck} />
        <Stat value={p.discard.length} label="DISC" name={`${whose} discard: ${p.discard.length} cards`} onClick={() => onDiscard(side)} />
      </div>
    </div>
  )
}

function roundTitle(round: number): string {
  return round === 0 ? 'Setup' : `Round ${round}`
}

/**
 * The log's entries: newest first, under the round each action was taken in, each action in one row
 * with what it changed beneath it. Card names are coloured by their owner and a tap opens the card.
 */
function LogRounds({ state, log }: { state: GameState | null; log: LogEntry[] }) {
  const rounds: { round: number; rows: { action: LogEntry; outcomes: LogEntry[] }[] }[] = []
  for (const entry of log) {
    const last = rounds[rounds.length - 1]
    if (entry.outcome && last && last.rows.length > 0) {
      last.rows[last.rows.length - 1].outcomes.push(entry)
      continue
    }
    if (!last || last.round !== entry.round) rounds.push({ round: entry.round, rows: [] })
    rounds[rounds.length - 1].rows.push({ action: entry, outcomes: [] })
  }
  return (
    <>
      {log.length === 0 && <div className="text-ink-faint">No actions yet</div>}
      {[...rounds].reverse().map((r, i) => (
        <section key={`${r.round}-${i}`} className="flex flex-col gap-1">
          <span data-testid="log-round" className="pt-1 text-[11px] tracking-[0.14em] text-accent">{roundTitle(r.round)}</span>
          {[...r.rows].reverse().map((row, j) => (
            <div key={j} data-testid="log-row" className="flex gap-2 rounded-xl bg-surface px-2 py-1.5 text-xs leading-4 text-ink-dim">
              <span className={`w-8 shrink-0 ${row.action.by === 'player' ? 'text-accent' : OPPONENT_TEXT}`}>{row.action.by === 'player' ? 'You' : 'Opp'}</span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-ink"><DescribedParts state={state} parts={row.action.parts} /></span>
                {row.outcomes.map((o, k) => <span key={k} className="opacity-80"><DescribedParts state={state} parts={o.parts} /></span>)}
              </div>
            </div>
          ))}
        </section>
      ))}
    </>
  )
}

/**
 * The log on a phone, sliding in from the left over the controls and leaving the board in view.
 * Undo sits at its foot when it is on.
 */
export function GameLogDrawer({ open, state, log, onClose, onUndo }: {
  open: boolean
  state: GameState | null
  log: LogEntry[]
  onClose: () => void
  onUndo?: () => void
}) {
  useEscape(open, onClose)
  if (!open) return null
  return (
    <aside
      data-testid="game-log-drawer"
      aria-label="Log"
      className="fixed inset-y-0 left-0 z-40 flex w-[300px] flex-col gap-2 overflow-y-auto bg-[var(--color-sheet)] shadow-[4px_0_16px_rgba(0,0,0,0.6)]"
      style={{ paddingTop: 'var(--edge-top)', paddingBottom: 'var(--edge-bottom)', paddingLeft: 'var(--edge-left)', paddingRight: '12px' }}
    >
      <div className="flex min-h-11 items-center gap-3">
        <h2 className="m-0 flex-1 text-lg font-medium">Log</h2>
        <IconButton label="Close the log" onClick={onClose}><span aria-hidden="true">×</span></IconButton>
      </div>
      <LogRounds state={state} log={log} />
      {onUndo && (
        <Button testId="log-undo-btn" onClick={onUndo}>Undo</Button>
      )}
    </aside>
  )
}

/** The log on the desktop, docked in the controls column and filling what it leaves. */
function DockedLog({ state, log }: { state: GameState; log: LogEntry[] }) {
  return (
    <div role="log" aria-label="Log" data-testid="game-log" className="flex min-h-[160px] flex-1 flex-col gap-1.5 overflow-y-auto rounded-xl bg-[var(--color-sheet)] px-2.5 py-2">
      <LogRounds state={state} log={log} />
    </div>
  )
}

/** More: Help, Settings, Report a bug (on the desktop, when turned on) and conceding, which asks once more. */
export function MoreSheet({ open, onClose, onHelp, onSettings, onReport, onConcede }: {
  open: boolean
  onClose: () => void
  onHelp: () => void
  onSettings: () => void
  /** Absent on a phone, and while the bug report is turned off in Settings. */
  onReport?: () => void
  /** Absent while conceding is not open to you: the opponent is acting, or the game is over. */
  onConcede?: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const close = () => { setConfirming(false); onClose() }
  return (
    <Sheet open={open} title="More" onClose={close}>
      <Button onClick={() => { close(); onHelp() }}>Help</Button>
      <Button onClick={() => { close(); onSettings() }}>Settings</Button>
      {onReport && <Button onClick={() => { close(); onReport() }}>Report a bug</Button>}
      {onConcede && (confirming ? (
        <div className="flex flex-col gap-2 rounded-xl bg-surface p-3">
          <span className="text-sm text-ink-dim">Concede the game?</span>
          <div className="flex gap-2">
            <Button testId="concede-confirm-btn" onClick={() => { close(); onConcede() }} style={{ flex: 1, background: 'var(--color-damage)', color: 'var(--color-text-primary)' }}>Concede</Button>
            <Button onClick={() => setConfirming(false)} style={{ flex: 1 }}>Keep playing</Button>
          </div>
        </div>
      ) : (
        <Button testId="concede-btn" onClick={() => setConfirming(true)}>Concede</Button>
      ))}
    </Sheet>
  )
}

/** A pile of cards as a sheet: a discard pile, or the top of your deck. */
export function PileSheet({ state, title, cards, onClose }: { state: GameState; title: string; cards: string[] | null; onClose: () => void }) {
  return (
    <Sheet open={cards !== null} title={title} onClose={onClose}>
      {cards && cards.length === 0 && <div className="text-ink-faint">Empty</div>}
      <div className="flex flex-wrap gap-2">
        {(cards ?? []).map((id, i) => <CardFace key={`${id}-${i}`} card={state.cards[id]} fallbackName={id} tight widthPx={80} />)}
      </div>
    </Sheet>
  )
}

/** Close on Escape while open. */
function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])
}

/** The upgrades on a unit, tokens and cards alike, one per kind in the order first attached, with how many. */
function upgradeCounts(unit: UnitState): [cardId: string, count: number][] {
  const counts = new Map<string, number>()
  for (const u of unit.upgrades) counts.set(u.cardId, (counts.get(u.cardId) ?? 0) + 1)
  return [...counts]
}

/**
 * A card held (or its name touched in the log), full size over a dimmed board, and beside it what is
 * on it when it is a unit in play: its damage and the HP it has left, whether it is ready and where,
 * and its upgrades and tokens. Then the cards on it, each as a card: its upgrade cards and the cards
 * it holds captive, in a strip that scrolls when they do not fit. A tap anywhere closes it.
 */
export function CardDetail({ state, cardId, unit, onClose }: {
  state: GameState
  cardId: string
  /** The unit it is in play as, when it is one. */
  unit?: UnitState
  onClose: () => void
}) {
  useEscape(true, onClose)
  const card = state.cards[cardId]
  const name = cardName(state, cardId)
  const owner: PlayerId | undefined = unit && (state.players.player.units.some(u => u.instanceId === unit.instanceId) ? 'player' : 'opponent')
  const upgrades = unit ? upgradeCounts(unit) : []
  const attached = unit
    ? [
        ...upgradeCards(state, unit).map(u => ({ kind: 'Upgrade', cardId: u.cardId, note: undefined })),
        ...(unit.captured ?? []).map(c => ({ kind: 'Captured', cardId: c.cardId, note: captiveNote(state, c, name) })),
      ]
    : []
  return (
    <div className="fixed inset-0 z-50">
      <button type="button" aria-label="Close the card" onClick={onClose} className="absolute inset-0 cursor-default border-none bg-[rgba(0,5,16,0.72)] p-0" />
      <div role="dialog" aria-label={`${name}, full size`} className="pointer-events-none relative flex h-full items-center justify-center gap-5 px-3">
        <CardFace card={card} fallbackName={cardId} deployed={unit?.isLeader} tight widthPx={card?.type === 'leader' || card?.type === 'base' ? 230 : 250} className="flex-none" />
        {unit && (
          <div className="flex w-[220px] flex-none flex-col gap-2 text-ink">
            <div className="text-xs tracking-[0.14em] text-accent">ON THE BOARD</div>
            <div className="flex flex-col gap-1.5 text-sm leading-[19px]">
              <span data-testid="detail-damage" className="flex items-center gap-2">
                {unit.damage > 0
                  ? <><span className={`${CHIP} bg-red text-white`}>{unit.damage}</span>{' '}damage, {effectiveHp(state, unit) - unit.damage} HP left</>
                  : `Undamaged, ${effectiveHp(state, unit)} HP`}
              </span>
              <span>{unit.exhausted ? 'Exhausted' : 'Ready'}, in {owner === 'player' ? 'your' : "the opponent's"} {unit.arena} arena</span>
            </div>
            <div className="mt-1 text-xs tracking-[0.14em] text-accent">UPGRADES</div>
            <div className="flex flex-col gap-1.5 text-sm leading-[19px]">
              {upgrades.length === 0
                ? <span className="text-ink-faint">None</span>
                : upgrades.map(([id, n]) => (
                    <span key={id} data-testid="detail-upgrade" aria-label={`${n} ${cardName(state, id)}`} className="flex items-center gap-2">
                      <span className={`${CHIP} ${TOKEN_BADGES[id]?.style ?? 'bg-[var(--color-surface-raised)] text-ink'}`}>{n}</span>{cardName(state, id)}
                    </span>
                  ))}
            </div>
            <div className="mt-2.5 text-xs leading-[17px] text-ink-faint">Tap anywhere to close.</div>
          </div>
        )}
        {attached.length > 0 && (
          // Takes pointer events so it can scroll; a tap on it still closes, as anywhere else does.
          <ul aria-label={`On ${name}`} onClick={onClose} className="pointer-events-auto m-0 flex max-h-full min-w-0 list-none items-start gap-3 overflow-auto p-0 py-3">
            {attached.map((a, i) => (
              <li key={`${a.cardId}-${i}`} aria-label={`${a.kind}: ${cardName(state, a.cardId)}`} className="flex w-[180px] flex-none flex-col gap-1.5">
                <span className="text-xs tracking-[0.14em] text-accent">{a.kind.toUpperCase()}</span>
                <CardFace card={state.cards[a.cardId]} fallbackName={a.cardId} tight widthPx={180} />
                {a.note && <span className="text-xs leading-4 text-ink-dim">{a.note}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/** One of the leader's actions in its menu: unavailable, with the reason, when it has no `onSelect`. */
export interface LeaderMenuItem {
  label: string
  detail?: string
  onSelect?: () => void
}

/**
 * Your leader's actions, opened by tapping it: each action ability, deploying (with why not, when it
 * can't be), and seeing the card. Picking one closes the menu. Your base opens the same menu as a
 * `BASE`: its Epic Action, once a game, and any action an upgrade on it gives.
 */
export function LeaderMenu({ name, kind = 'LEADER', items, onSee, onClose }: {
  name: string
  kind?: 'LEADER' | 'BASE'
  items: LeaderMenuItem[]
  onSee: () => void
  onClose: () => void
}) {
  useEscape(true, onClose)
  const item = 'flex flex-col gap-0.5 rounded-xl border-none px-3 py-2 text-left'
  return (
    <>
      <button type="button" aria-label="Close the menu" onClick={onClose} className="fixed inset-0 z-40 cursor-default border-none bg-transparent p-0" />
      <div role="menu" aria-label={name} className="fixed bottom-14 right-4 z-50 flex w-[252px] flex-col gap-1.5 rounded-[14px] bg-[var(--color-sheet)] p-2.5 shadow-[0_8px_28px_rgba(0,0,0,0.6)]">
        <span className="px-1 pb-1 pt-0.5 text-xs tracking-[0.14em] text-accent">{name.toUpperCase()} · {kind}</span>
        {items.map(it => (
          <button
            key={it.label}
            type="button"
            role="menuitem"
            aria-disabled={!it.onSelect}
            onClick={it.onSelect ? () => { onClose(); it.onSelect!() } : undefined}
            className={`${item} ${it.onSelect ? 'bg-[var(--color-tonal)] text-ink' : 'cursor-default bg-surface text-ink-faint'}`}
          >
            <span className="text-[15px] font-medium">{it.label}</span>
            {it.detail && <span className={`text-xs leading-4 ${it.onSelect ? 'text-accent' : ''}`}>{it.detail}</span>}
          </button>
        ))}
        <button type="button" role="menuitem" onClick={() => { onClose(); onSee() }} className="h-10 rounded-xl border-none bg-transparent px-3 text-left text-sm text-ink-dim">
          See the card
        </button>
      </div>
    </>
  )
}

/**
 * The game over: a card over the board saying who won and how, which decks played, and Rematch or a
 * new setup. The controls column stays uncovered, so the log is still to hand.
 */
export function PhoneGameOver({ state, deckName, onRematch, onExit, scale = 'phone' }: {
  state: GameState
  deckName: string
  onRematch: () => void
  onExit: () => void
  scale?: BoardScale
}) {
  if (state.winner === null) return null
  const outcome = outcomeBanner(state.winner, state.concededBy)
  const baseName = (side: PlayerId) => state.cards[state.players[side].base.cardId]?.name ?? 'The base'
  const how = outcome.detail ?? (state.winner === 'draw'
    ? `Both bases destroyed in round ${state.round}`
    : `${baseName(state.winner === 'player' ? 'opponent' : 'player')} destroyed in round ${state.round}`)
  const opp = state.players.opponent
  const against = `${deckName} against ${state.cards[opp.leader.cardId]?.name ?? opp.leader.cardId} · ${baseName('opponent')}`
  return (
    <div data-testid="game-over" className="fixed inset-y-0 right-0 z-30 flex items-center justify-center bg-[rgba(0,5,16,0.62)]" style={{ left: boardLeft(scale) }}>
      <div role="dialog" aria-label={`Game over: ${outcome.title.toLowerCase()}`} data-testid="game-over-banner" className="flex w-[380px] flex-col items-center gap-1.5 rounded-2xl bg-[var(--color-sheet)] p-5 text-center shadow-[0_8px_32px_rgba(0,0,0,0.6)]">
        <div className="text-xs tracking-[0.14em] text-accent">GAME OVER</div>
        <div className={`text-[30px] font-light tracking-[0.06em] ${outcome.tone}`}>{outcome.title}</div>
        <div data-testid="outcome-detail" className="text-sm text-ink-dim">{how}</div>
        <div className="text-xs text-ink-faint">{against}</div>
        <div className="mt-3 flex w-full gap-2 *:flex-1">
          <Button onClick={onExit}>New setup</Button>
          <Button variant="primary" testId="rematch-btn" onClick={onRematch}>Rematch</Button>
        </div>
        <div className="mt-1 text-xs text-ink-faint">{`Rematch shuffles the same decks. The log is still ${scale === 'phone' ? 'under Log' : 'beside the board'}.`}</div>
      </div>
    </div>
  )
}

/** One answer to a prompt: a shared button, tonal unless it is the prompt's one primary. */
export interface PromptButton {
  label: ReactNode
  onClick: () => void
  primary?: boolean
  testId?: string
}

/**
 * The one prompt pattern on a phone: a panel over the dimmed board with the card that asked (tap it to
 * see it full size), the question, and its answers, one of them primary. A choice answered on the board
 * never comes here: its question stays in the controls column's prompt.
 *
 * Getting out of it is the caller's to say. `onCancel` is the ×, which takes back your own move; the
 * game screen offers it only while nothing hidden or random has been seen. Without it, `onSetAside`
 * puts the question aside to look at the board (Show choice brings it back); with neither, it blocks.
 *
 * `bigCard` is for a card the question is about rather than one that asked (the top of your deck): the
 * card stands on the left, and the question and the answers, one per line, beside it.
 */
export function PhonePrompt({ testId, state, cardId, eyebrow, question, questionTestId, note, bigCard = false, width = 400, children, buttons, onCancel, cancelLabel = 'Cancel', onSetAside }: {
  testId: string
  state: GameState
  cardId?: string
  eyebrow?: string
  /** Parts are drawn with their card names, as the log draws them. */
  question: string | DescribePart[]
  questionTestId?: string
  note?: ReactNode
  bigCard?: boolean
  width?: number
  children?: ReactNode
  buttons: PromptButton[]
  onCancel?: () => void
  cancelLabel?: string
  onSetAside?: () => void
}) {
  const inspect = useContext(CardInspect)
  const name = cardId ? state.cards[cardId]?.name ?? cardId : undefined
  // The dialog is named by what it asks, as a screen reader would want it: the card, then the question.
  const asked = typeof question === 'string' ? question : partsText(question)
  const label = eyebrow ? `${eyebrow}: ${asked}` : asked
  const card = cardId && (
    <button
      type="button"
      aria-label={`${name}: see the card`}
      onClick={() => inspect?.({ cardId })}
      className="flex-none cursor-pointer border-none bg-transparent p-0"
    >
      <CardFace card={state.cards[cardId]} fallbackName={cardId} tight widthPx={bigCard ? 100 : 50} />
    </button>
  )
  // The primary sits on the right of a row, and first in a column.
  const ordered = bigCard ? [...buttons.filter(b => b.primary), ...buttons.filter(b => !b.primary)] : [...buttons.filter(b => !b.primary), ...buttons.filter(b => b.primary)]
  const answers = (
    <div className={`flex gap-2 ${bigCard ? 'flex-col' : '*:flex-1'}`}>
      {ordered.map((b, i) => (
        <Button key={b.testId ?? i} testId={b.testId} variant={b.primary ? 'primary' : 'secondary'} onClick={b.onClick} style={{ fontSize: '15px' }}>
          {b.label}
        </Button>
      ))}
    </div>
  )
  const setAside = onSetAside && (
    <button type="button" onClick={onSetAside} className="self-center border-none bg-transparent px-3 py-1 text-xs text-ink-dim">
      Look at the board
    </button>
  )
  const heading = (
    <div className="flex items-start gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {eyebrow && <div className="text-xs tracking-[0.14em] text-accent">{eyebrow.toUpperCase()}</div>}
        <div data-testid={questionTestId} className="text-base leading-[21px] text-ink first-letter:uppercase">
          {typeof question === 'string' ? question : <DescribedParts state={state} parts={question} />}
        </div>
        {note && <div className="text-xs leading-4 text-ink-dim">{note}</div>}
      </div>
      {onCancel && (
        <span data-testid="overlay-dismiss" className="flex-none">
          <IconButton label={cancelLabel} onClick={onCancel}><CloseIcon /></IconButton>
        </span>
      )}
    </div>
  )
  return (
    <div data-testid={testId} className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,5,16,0.62)]">
      <div
        role="dialog"
        aria-label={label}
        className="flex max-h-[calc(100vh-16px)] flex-col gap-3 overflow-y-auto rounded-2xl bg-[var(--color-sheet)] p-4 shadow-[0_8px_32px_rgba(0,0,0,0.6)]"
        style={{ width }}
      >
        {bigCard ? (
          <div className="flex gap-4">
            {card}
            <div className="flex flex-1 flex-col gap-2">
              {heading}
              {children}
              <div className="mt-auto">{answers}</div>
              {setAside}
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-3">
              {card}
              <div className="min-w-0 flex-1">{heading}</div>
            </div>
            {children}
            {answers}
            {setAside}
          </>
        )}
      </div>
    </div>
  )
}

/** The game on a phone held upright: the board needs it on its side. The game carries on when turned. */
export function TurnSideways() {
  return (
    <div data-testid="turn-sideways" className="flex h-screen w-full flex-col items-center justify-center gap-3 p-8 text-center">
      <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="7" y="2" width="10" height="20" rx="2" />
        <path d="M20 9a6 6 0 0 1 0 6" />
      </svg>
      <p className="text-lg text-ink">Turn your phone sideways</p>
      <p className="text-sm text-ink-faint">The board is laid out for a phone on its side. Your game is waiting.</p>
    </div>
  )
}

/** What the prompt says when the move in hand needs no instruction of its own. */
function idlePrompt(state: GameState, attacker: string | undefined, scale: BoardScale): DescribePart[] {
  const tap = scale === 'phone' ? 'Tap' : 'Click'
  if (state.winner !== null) return ['The game is over.']
  if (state.activePlayer !== 'player') return ['The opponent is acting.']
  if (attacker) return [`${attacker} attacks. ${tap} a red target.`]
  return [`Your action. ${tap} a highlighted card to play it, or a ready unit to attack.`]
}

export function PhoneGameLayout({ state, scale, log, prompt, attacker, actions, hand, centre, playerInteraction, opponentInteraction, onExit, onLog, onMore, onDiscard, onDeck }: {
  state: GameState
  scale: BoardScale
  /** The log, docked in the column on the desktop; a phone opens it from Log as a drawer instead. */
  log: LogEntry[]
  /** What the board's highlights are asking for, when they need saying. */
  prompt: DescribePart[] | undefined
  /** The name of the unit chosen to attack, while its target is being picked. */
  attacker?: string
  actions: ReactNode
  hand: ReactNode
  /** The centre strip: each side's leader and base. */
  centre: { opponentLeader: ReactNode; opponentBase: ReactNode; playerBase: ReactNode; playerLeader: ReactNode }
  playerInteraction: (unit: UnitState) => UnitInteraction
  opponentInteraction: (unit: UnitState) => UnitInteraction
  onExit: () => void
  onLog: () => void
  onMore: () => void
  onDiscard: (side: PlayerId) => void
  onDeck?: () => void
}) {
  const phase = state.phase.charAt(0).toUpperCase() + state.phase.slice(1)
  const S = BOARD_SCALE[scale]
  const phone = scale === 'phone'
  const roundPhase = (
    <div data-testid="round-phase" className={phone ? 'px-0.5 pt-0.5 text-[15px]' : 'flex-1 self-center pl-1 text-[17px]'}>Round {state.round} · {phase}</div>
  )
  const actionPrompt = (
    <div data-testid="action-prompt" className={`min-h-0 overflow-y-auto text-ink-dim ${phone ? 'flex-1 text-xs leading-4' : 'text-sm leading-[19px]'}`}>
      <DescribedParts state={state} parts={prompt ?? idlePrompt(state, attacker, scale)} />
    </div>
  )
  return (
    <div
      data-testid="phone-layout"
      data-scale={scale}
      className="flex h-screen w-full overflow-hidden"
      style={{ gap: S.gap, paddingTop: S.pad, paddingBottom: S.pad, paddingLeft: `max(env(safe-area-inset-left, 0px), ${S.pad}px)`, paddingRight: `max(env(safe-area-inset-right, 0px), ${S.pad}px)` }}
    >
      <div data-testid="phone-controls" className={`flex flex-none flex-col ${phone ? 'gap-1.5' : 'gap-2'}`} style={{ width: S.column }}>
        <div className="flex gap-2">
          <IconButton label="Leave the game" onClick={onExit}><BackIcon /></IconButton>
          {phone ? <div className="flex-1" /> : roundPhase}
          {phone && <IconButton label="Log" onClick={onLog}><LogIcon /></IconButton>}
          <IconButton label="More: help, settings, concede" onClick={onMore}><DotsIcon /></IconButton>
        </div>
        {phone && roundPhase}
        <PlayerSummary state={state} side="opponent" onDiscard={onDiscard} />
        {actionPrompt}
        {!phone && <DockedLog state={state} log={log} />}
        <PlayerSummary state={state} side="player" onDiscard={onDiscard} onDeck={onDeck} />
        <div data-testid="phone-actions" className="mt-1 max-h-[45%] overflow-y-auto">{actions}</div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <section data-testid="game-board" className="grid min-h-0 flex-1 gap-x-2" style={{ gridTemplateColumns: `minmax(0, 1fr) ${S.centre}px minmax(0, 1fr)` }}>
          <Arena state={state} arena="space" playerInteraction={playerInteraction} opponentInteraction={opponentInteraction} scale={scale} />
          <div className="flex flex-col" style={{ gap: S.arenaGap }}>
            <div className="flex flex-1 flex-col items-center justify-end gap-1.5">
              {centre.opponentLeader}
              {centre.opponentBase}
            </div>
            <div className="flex flex-1 flex-col items-center gap-1.5">
              {centre.playerBase}
              {centre.playerLeader}
            </div>
          </div>
          <Arena state={state} arena="ground" playerInteraction={playerInteraction} opponentInteraction={opponentInteraction} scale={scale} />
        </section>
        {hand}
      </div>
    </div>
  )
}
