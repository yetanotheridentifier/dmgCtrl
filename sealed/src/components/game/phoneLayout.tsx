import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Button, IconButton, Sheet } from '@pwa-shared/controls'
import type { GameState, PlayerId, UnitState } from '../../engine/types'
import type { LogEntry } from '../../hooks/useGame'
import type { DescribePart } from '../../utils/describeAction'
import type { UnitInteraction } from '../gameScreen'
import CardFace from '../cardFace'
import { intentHighlight } from '../highlight'
import type { Highlight } from '../highlight'
import { DescribedParts } from '../cardRef'
import { orderUnits } from '../boardLayout'
import { BackIcon, DotsIcon, LogIcon } from '../icons'
import { unitHasKeyword } from '../../engine/keywords'
import { effectiveHp, effectivePower } from '../../engine/stats'
import { friendlyCreditTokens, hasForceToken } from '../../engine/effects'
import { TOKEN_EXPERIENCE, TOKEN_SHIELD } from '../../engine/tokenUpgrades'

/**
 * The game screen on a phone in landscape: a 196 px column of controls on the left (leave, log and
 * more; the round; each side's counts; the prompt; the action buttons), and the board filling the
 * rest, with the hand under it. Everything fits the screen at 844×390: nothing scrolls.
 *
 * Presentational: the game screen works out what can be done and hands the pieces in, so this
 * layout and the desktop one answer the same moves the same way.
 */

/** A unit's square slot, and the short edge of its card, four to a row. */
const SLOT = { normal: { slot: 56, card: 40 }, crowded: { slot: 45, card: 32 } }
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
 * A unit in its square slot: the card art, turned sideways when exhausted, with its power and HP
 * and a badge for each thing on it. The badges stay upright on an exhausted unit.
 *
 * The attacker is ringed white, a target in the colour of what picking it does (`intentHighlight`),
 * and a unit that can act in blue.
 */
export function PhoneUnit({ state, unit, interact, size = 'normal' }: {
  state: GameState
  unit: UnitState
  interact: UnitInteraction
  size?: keyof typeof SLOT
}) {
  const { slot, card } = SLOT[size]
  const clickable = (interact.actionable || interact.isTarget || interact.isUpgradeTarget) && interact.onClick
  const highlight: Highlight | undefined = interact.selected
    ? 'white'
    : interact.isTarget
      ? intentHighlight(interact.intent)
      : interact.isUpgradeTarget
        ? intentHighlight('attach')
        : interact.actionable
          ? 'accent'
          : undefined
  const count = (id: string) => unit.upgrades.filter(u => u.cardId === id).length
  const shields = count(TOKEN_SHIELD)
  const experience = count(TOKEN_EXPERIENCE)
  const upgrades = unit.upgrades.filter(u => state.cards[u.cardId]?.type !== 'token').length
  const sentinel = unitHasKeyword(state, unit, 'Sentinel')
  const name = state.cards[unit.cardId]?.name ?? unit.cardId
  const tags = [
    unit.isLeader && { kind: 'leader', text: 'LEADER', style: 'bg-amber text-black' },
    sentinel && { kind: 'sentinel', text: 'Sentinel', style: 'bg-black/80 text-ink' },
    unit.hidden && !sentinel && { kind: 'hidden', text: 'Hidden', style: 'bg-black/80 text-ink' },
    shields > 0 && { kind: 'shield', text: `Shd ${shields}`, style: 'bg-token-shield text-white' },
    experience > 0 && { kind: 'experience', text: `Exp ${experience}`, style: 'bg-token-experience text-token-ink-dark' },
  ].filter((t): t is { kind: string; text: string; style: string } => Boolean(t))
  return (
    <div
      data-testid={`board-unit-${unit.instanceId}`}
      data-actionable={interact.actionable}
      data-selected={interact.selected}
      data-target={interact.isTarget}
      data-upgrade-target={Boolean(interact.isUpgradeTarget)}
      role={clickable ? 'button' : undefined}
      aria-label={name}
      onClick={clickable ? interact.onClick : undefined}
      className={`relative flex shrink-0 items-center justify-center ${clickable ? 'cursor-pointer' : ''}`}
      style={{ width: slot, height: slot }}
    >
      <CardFace card={state.cards[unit.cardId]} fallbackName={unit.cardId} deployed={unit.isLeader} exhausted={unit.exhausted} highlight={highlight} widthPx={card} />
      <div className="pointer-events-none absolute inset-x-0 top-0.5 flex flex-col items-center gap-px">
        {tags.map(t => (
          <span key={t.kind} data-testid={`unit-badge-${t.kind}`} className={`${BADGE} ${t.style}`}>{t.text}</span>
        ))}
      </div>
      {unit.damage > 0 && (
        <span data-testid="unit-badge-damage" aria-label={`${unit.damage} damage`} className="pointer-events-none absolute left-1/2 top-1/2 min-w-4 -translate-x-1/2 -translate-y-1/2 rounded-[3px] bg-red text-center text-[10px] font-bold leading-4 text-white">
          {unit.damage}
        </span>
      )}
      {upgrades > 0 && (
        <span data-testid="unit-badge-upgrades" aria-label={`${upgrades} upgrades`} className={`${BADGE} absolute right-0 top-1/2 bg-[var(--color-surface-raised)] text-ink`}>+{upgrades}</span>
      )}
      <span className="pointer-events-none absolute bottom-0 left-0 h-3.5 w-3.5 rounded-full bg-red text-center text-[9px] font-bold leading-[14px] text-white">{effectivePower(state, unit)}</span>
      <span className="pointer-events-none absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full bg-token-hp text-center text-[9px] font-bold leading-[14px] text-white">{effectiveHp(state, unit)}</span>
    </div>
  )
}

/**
 * One side's half of an arena. The opponent's units grow up from the gap and yours down from it, so
 * both front rows meet in the middle; Sentinels sit in the front row (`orderUnits`).
 */
export function PhoneArena({ state, side, arena, unitInteraction }: {
  state: GameState
  side: PlayerId
  arena: 'ground' | 'space'
  unitInteraction: (unit: UnitState) => UnitInteraction
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
      {units.map(u => <PhoneUnit key={u.instanceId} state={state} unit={u} interact={unitInteraction(u)} size={size} />)}
    </div>
  )
}

function Notch({ label, edge }: { label: string; edge: 'left' | 'right' }) {
  return (
    <div
      aria-hidden="true"
      className="absolute top-1/2 flex h-[70px] w-[15px] -translate-y-1/2 items-center justify-center bg-[var(--color-bg-dark)]"
      style={edge === 'left' ? { left: 0, borderRadius: '0 9px 9px 0' } : { right: 0, borderRadius: '9px 0 0 9px' }}
    >
      <span className="text-[9px] tracking-[0.25em] text-ink-faint" style={{ writingMode: 'vertical-rl', transform: edge === 'left' ? 'rotate(180deg)' : undefined }}>{label}</span>
    </div>
  )
}

function Arena({ state, arena, playerInteraction, opponentInteraction }: {
  state: GameState
  arena: 'ground' | 'space'
  playerInteraction: (unit: UnitState) => UnitInteraction
  opponentInteraction: (unit: UnitState) => UnitInteraction
}) {
  return (
    <div role="region" aria-label={arena === 'space' ? 'Space arena' : 'Ground arena'} className="relative flex min-w-0 flex-col gap-[18px]">
      <PhoneArena state={state} side="opponent" arena={arena} unitInteraction={opponentInteraction} />
      <PhoneArena state={state} side="player" arena={arena} unitInteraction={playerInteraction} />
      <Notch label={arena === 'space' ? 'SPACE' : 'GROUND'} edge={arena === 'space' ? 'left' : 'right'} />
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
      <div className={`flex items-center gap-1.5 text-[10px] tracking-[0.14em] ${mine ? 'text-accent' : OPPONENT_TEXT}`}>
        {mine ? 'YOU' : 'OPPONENT'}
        {state.initiative === side && <Pill className={`border ${mine ? 'border-accent text-accent' : OPPONENT_BORDER}`}>INITIATIVE</Pill>}
        {hasForceToken(state, side) && <Pill className="bg-token-force text-ink" label={`The Force is with ${mine ? 'you' : 'the opponent'}`}>FORCE</Pill>}
        {credits > 0 && <Pill className="bg-token-credit text-ink">CRED {credits}</Pill>}
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
 * The log, sliding in from the left over the controls and leaving the board in view: newest first,
 * under the round each action was taken in, each action in one row with what it changed beneath it.
 * Card names are coloured by their owner and open the card. Undo sits at its foot when it is on.
 */
export function GameLogDrawer({ open, state, log, onClose, onUndo }: {
  open: boolean
  state: GameState | null
  log: LogEntry[]
  onClose: () => void
  onUndo?: () => void
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
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
      {onUndo && (
        <Button testId="log-undo-btn" onClick={onUndo}>Undo</Button>
      )}
    </aside>
  )
}

/** More: Help, Settings and conceding, which asks once more. No bug report on a phone. */
export function MoreSheet({ open, onClose, onHelp, onSettings, onConcede }: {
  open: boolean
  onClose: () => void
  onHelp: () => void
  onSettings: () => void
  /** Absent while conceding is not open to you: the opponent is acting, or the game is over. */
  onConcede?: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const close = () => { setConfirming(false); onClose() }
  return (
    <Sheet open={open} title="More" onClose={close}>
      <Button onClick={() => { close(); onHelp() }}>Help</Button>
      <Button onClick={() => { close(); onSettings() }}>Settings</Button>
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
function idlePrompt(state: GameState, attacker: string | undefined): DescribePart[] {
  if (state.winner !== null) return ['The game is over.']
  if (state.activePlayer !== 'player') return ['The opponent is acting.']
  if (attacker) return [`${attacker} attacks. Tap a red target.`]
  return ['Your action. Tap a highlighted card to play it, or a ready unit to attack.']
}

export function PhoneGameLayout({ state, prompt, attacker, actions, hand, centre, playerInteraction, opponentInteraction, onExit, onLog, onMore, onDiscard, onDeck }: {
  state: GameState
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
  return (
    <div
      data-testid="phone-layout"
      className="flex h-screen w-full gap-2.5 overflow-hidden"
      style={{ paddingTop: 8, paddingBottom: 8, paddingLeft: 'max(env(safe-area-inset-left, 0px), 8px)', paddingRight: 'max(env(safe-area-inset-right, 0px), 8px)' }}
    >
      <div data-testid="phone-controls" className="flex w-[196px] flex-none flex-col gap-1.5">
        <div className="flex gap-2">
          <IconButton label="Leave the game" onClick={onExit}><BackIcon /></IconButton>
          <div className="flex-1" />
          <IconButton label="Log" onClick={onLog}><LogIcon /></IconButton>
          <IconButton label="More: help, settings, concede" onClick={onMore}><DotsIcon /></IconButton>
        </div>
        <div data-testid="round-phase" className="px-0.5 pt-0.5 text-[15px]">Round {state.round} · {phase}</div>
        <PlayerSummary state={state} side="opponent" onDiscard={onDiscard} />
        <div className="flex min-h-0 flex-1 items-center overflow-hidden">
          <div data-testid="action-prompt" className="max-h-full w-full overflow-y-auto rounded-xl border border-accent/40 px-2.5 py-2 text-xs leading-4 text-ink-dim">
            <DescribedParts state={state} parts={prompt ?? idlePrompt(state, attacker)} />
          </div>
        </div>
        <PlayerSummary state={state} side="player" onDiscard={onDiscard} onDeck={onDeck} />
        <div data-testid="phone-actions" className="mt-1 max-h-[45%] overflow-y-auto">{actions}</div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <section data-testid="game-board" className="grid min-h-0 flex-1 gap-x-2" style={{ gridTemplateColumns: 'minmax(0, 1fr) 84px minmax(0, 1fr)' }}>
          <Arena state={state} arena="space" playerInteraction={playerInteraction} opponentInteraction={opponentInteraction} />
          <div className="flex flex-col gap-[18px]">
            <div className="flex flex-1 flex-col items-center justify-end gap-1.5">
              {centre.opponentLeader}
              {centre.opponentBase}
            </div>
            <div className="flex flex-1 flex-col items-center gap-1.5">
              {centre.playerBase}
              {centre.playerLeader}
            </div>
          </div>
          <Arena state={state} arena="ground" playerInteraction={playerInteraction} opponentInteraction={opponentInteraction} />
        </section>
        {hand}
      </div>
    </div>
  )
}
