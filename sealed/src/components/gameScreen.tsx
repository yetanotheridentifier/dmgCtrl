import { useState, type CSSProperties } from 'react'
import { useGame } from '../hooks/useGame'
import type { UseGameOptions } from '../hooks/useGame'
import type { SavedDeck } from '../data/deckStore'
import type { EngineCard, GameState, PlayerId, UnitState } from '../engine/types'
import type { Action } from '../engine/actions'
import { describeAction } from '../utils/describeAction'
import { orderUnits } from './boardLayout'
import { outcomeBanner } from './outcome'
import CardFace from './cardFace'
import { CARD_WIDTH_PX } from './cardSizing'
import { tokenLayout, TOKEN_W, TOKEN_H } from './tokens'
import { useCardZoom } from './useCardZoom'
import { CardZoomPopover } from './cardZoom'

interface Props {
  deck: SavedDeck
  opponentDeck: SavedDeck
  onExit: () => void
  /** Injectable for deterministic tests; defaults to real randomness. */
  gameOptions?: UseGameOptions
}

export interface UnitInteraction {
  /** This friendly unit has at least one legal action — click to select it. */
  actionable: boolean
  selected: boolean
  /** This enemy unit is a legal target of the selected attacker. */
  isTarget: boolean
  onClick?: () => void
}

export function UnitLine({ state, unit, interact }: { state: GameState; unit: UnitState; interact: UnitInteraction }) {
  const card = state.cards[unit.cardId]
  const { zoomed, bind } = useCardZoom()
  const clickable = (interact.actionable || interact.isTarget) && interact.onClick
  const highlight: 'accent' | 'red' | 'accent-dim' | undefined = interact.selected
    ? 'accent'
    : interact.isTarget
      ? 'red'
      : interact.actionable
        ? 'accent-dim'
        : undefined
  return (
    <div
      data-testid={`board-unit-${unit.instanceId}`}
      data-actionable={interact.actionable}
      data-selected={interact.selected}
      data-target={interact.isTarget}
      onClick={clickable ? interact.onClick : undefined}
      {...bind}
      className={`relative w-fit shrink-0 ${clickable ? 'cursor-pointer' : ''}`}
    >
      <CardFace card={card} fallbackName={unit.cardId} deployed={unit.isLeader} exhausted={unit.exhausted} highlight={highlight} />
      <CardTokens unit={unit} />
      {zoomed && <CardZoomPopover card={card} deployed={unit.isLeader} fallbackName={unit.cardId} />}
    </div>
  )
}

/**
 * Effect tokens (physical-token style) laid over a unit card on this
 * non-rotating wrapper, so they stay upright when the card is exhausted. Damage
 * is the first token; more effect types slot into the same 1–4 layout (#326).
 */
function CardTokens({ unit }: { unit: UnitState }) {
  const tokens: { key: string; label: string; color: string; testid: string }[] = []
  if (unit.damage > 0) {
    tokens.push({ key: 'damage', label: String(unit.damage), color: 'var(--color-red)', testid: `board-unit-damage-${unit.instanceId}` })
  }
  if (tokens.length === 0) return null

  const positions = tokenLayout(tokens.length, unit.exhausted ? 'landscape' : 'portrait')
  return (
    <div className="pointer-events-none absolute inset-0">
      {tokens.map((t, i) => (
        <span
          key={t.key}
          data-testid={t.testid}
          className="absolute flex items-center justify-center select-none tabular-nums"
          style={{
            left: `${positions[i].left}%`,
            top: `${positions[i].top}%`,
            transform: 'translate(-50%, -50%)',
            width: TOKEN_W,
            height: TOKEN_H,
            borderRadius: 6,
            background: t.color,
            color: '#fff',
            fontSize: `${Math.round(TOKEN_H * 0.6)}px`,
            fontWeight: 600,
            lineHeight: 1,
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.7)',
          }}
        >
          {t.label}
        </span>
      ))}
    </div>
  )
}

/**
 * One player's units in one arena, anchored to the battlefront. The grid cell's
 * alignment (items-end for the opponent, items-start for you) pins the lane to
 * the centre line; extra units wrap *away* from it. Keeps `{side}-{arena}-units`.
 */
function ArenaZone({ state, side, arena, unitInteraction, anchor }: {
  state: GameState
  side: PlayerId
  arena: 'ground' | 'space'
  unitInteraction: (unit: UnitState) => UnitInteraction
  anchor: 'top' | 'bottom'
}) {
  const units = orderUnits(state, state.players[side].units.filter(u => u.arena === arena), anchor)
  return (
    <div data-testid={`${side}-${arena}-units`} className="flex flex-wrap gap-2 justify-center">
      {units.length === 0 ? (
        <p className="text-ink-faint text-xs italic">empty</p>
      ) : (
        units.map(u => <UnitLine key={u.instanceId} state={state} unit={u} interact={unitInteraction(u)} />)
      )}
    </div>
  )
}

/** A base card in the central strip, with an HP overlay; clickable when a target. */
function BaseCard({ state, side, onAttack }: {
  state: GameState
  side: PlayerId
  onAttack?: () => void
}) {
  const p = state.players[side]
  const baseCard = state.cards[p.base.cardId]
  const { zoomed, bind } = useCardZoom()
  // Base HP comes from the card metadata (bases vary; never assume 30).
  const baseHp = baseCard?.hp ?? 0
  // Damage taken, counting up to the base's HP — the SWU-standard display (#323).
  // A future ticket makes counting down (remaining) a user preference (#324).
  const damage = Math.min(p.base.damage, baseHp)
  const inner = (
    <div className="relative">
      <CardFace card={baseCard} fallbackName={p.base.cardId} highlight={onAttack ? 'red' : undefined} />
      {/* Damage overlaid on the card, PWA game-screen style: light weight,
          accent glow + dark outline, ~50% of the card's height. Nudged up a
          little since the base art sits low, so the number reads centred on it. */}
      <span
        data-testid={`${side}-base-hp`}
        aria-label={`${side === 'player' ? 'Your' : 'Opponent'} base damage: ${damage} of ${baseHp}`}
        className="pointer-events-none absolute inset-0 flex items-center justify-center tabular-nums select-none"
        style={{
          fontSize: `${Math.round(CARD_WIDTH_PX * 0.5)}px`,
          fontWeight: 300,
          lineHeight: 1,
          letterSpacing: '0.05em',
          color: 'var(--color-ink)',
          textShadow: '0 0 20px rgba(79, 195, 247, 0.4), 0 0 8px rgba(0, 0, 0, 1)',
          transform: 'translateY(-2%)',
        }}
      >
        {damage}
      </span>
    </div>
  )
  return (
    <div data-testid={`${side}-base-card`} {...bind} className="relative">
      {onAttack ? (
        <button
          data-testid={`target-${side}-base`}
          onClick={onAttack}
          className="block cursor-pointer"
        >
          {inner}
        </button>
      ) : (
        inner
      )}
      {zoomed && <CardZoomPopover card={baseCard} fallbackName={p.base.cardId} />}
    </div>
  )
}

/** A leader in the central strip: its card while undeployed, a marker once deployed. */
function LeaderCard({ state, side }: { state: GameState; side: PlayerId }) {
  const p = state.players[side]
  const leaderCard = state.cards[p.leader.cardId]
  const name = leaderCard?.name ?? p.leader.cardId
  const { zoomed, bind } = useCardZoom()
  if (p.leader.deployed) {
    return (
      <div data-testid={`${side}-leader-card`}>
        <div className="flex h-[72px] w-[120px] items-center justify-center rounded-lg border border-dashed border-line/40 px-1 text-center text-[10px] text-ink-faint">
          {name} · deployed
        </div>
      </div>
    )
  }
  return (
    <div data-testid={`${side}-leader-card`} {...bind} className="relative">
      <CardFace card={leaderCard} fallbackName={p.leader.cardId} exhausted={p.leader.exhausted} />
      {/* Undeployed leader: Shift while hovering shows its unit (back) side (#321). */}
      {zoomed && <CardZoomPopover card={leaderCard} deployed={false} fallbackName={p.leader.cardId} />}
    </div>
  )
}

/**
 * A card in your hand. Clickable to play (blue) or resource (green); hover /
 * focus / long-press zooms it (#321). Its own component so it can use the zoom hook.
 */
function HandCard({ card, cardId, index, action, onAct }: {
  card: EngineCard | undefined
  cardId: string
  index: number
  action: Action | undefined
  onAct: (action: Action) => void
}) {
  const { zoomed, bind } = useCardZoom()
  const isResource = action?.type === 'resourceCard' || action?.type === 'setupResource'
  const popover = zoomed && <CardZoomPopover card={card} fallbackName={cardId} />
  if (action) {
    // Clickable shortcut for the matching action-menu button:
    // "Play …" (action phase) or "Resource …" (setup/regroup).
    return (
      <button
        data-testid={`hand-card-${index}`}
        data-playable={true}
        onClick={() => onAct(action)}
        {...bind}
        className="relative block w-fit shrink-0 cursor-pointer"
      >
        <CardFace card={card} fallbackName={cardId} tight highlight={isResource ? 'green' : 'accent'} />
        {popover}
      </button>
    )
  }
  return (
    <span
      data-testid={`hand-card-${index}`}
      data-playable={false}
      {...bind}
      className="relative block w-fit shrink-0"
    >
      {/* Dim the card (unplayable), but not the zoom popover — the opacity must
          stay off the wrapper or it'd dim and trap the popover above (#321). */}
      <CardFace card={card} fallbackName={cardId} tight className="opacity-60" />
      {popover}
    </span>
  )
}

/** Compact info line for a player: resources, leader status, hand (opp), piles. */
function InfoBar({ state, side }: { state: GameState; side: PlayerId }) {
  const p = state.players[side]
  const leaderCard = state.cards[p.leader.cardId]
  const readyRes = p.resources.filter(r => !r.exhausted).length
  const leaderStatus = p.leader.deployed
    ? 'deployed'
    : p.leader.epicActionUsed
      ? 'epic action used'
      : 'undeployed'
  return (
    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
      <h3 className="text-accent text-xs uppercase tracking-[0.12em] font-light">{side === 'player' ? 'You' : 'Opponent'}</h3>
      <span className="text-sm">
        Resources <span data-testid={`${side}-resources`} className="font-mono">{readyRes}/{p.resources.length}</span>
      </span>
      <span className="text-sm text-ink-dim">{leaderCard?.name ?? 'Leader'} · {leaderStatus}</span>
      {side === 'opponent' && (
        <span className="text-sm">
          Hand <span data-testid="opponent-hand-count" className="font-mono">{p.hand.length}</span>
        </span>
      )}
      <span className="text-sm text-ink-faint">Deck {p.deck.length} · Discard {p.discard.length}</span>
    </div>
  )
}

/**
 * The battlefield (#4): Ground and Space lanes flank a central strip holding both
 * players' bases and leaders. Reading down the centre — opponent leader, opponent
 * base, your base, your leader — so the bases sit closest together and the leaders
 * are outermost. Each grid row is one player, aligning their lanes with their cards.
 */
function Board({ state, playerInteraction, opponentInteraction, baseAttack }: {
  state: GameState
  playerInteraction: (unit: UnitState) => UnitInteraction
  opponentInteraction: (unit: UnitState) => UnitInteraction
  baseAttack?: () => void
}) {
  // Ground | Leaders+Bases | Space. Set the template with an inline style rather
  // than a Tailwind arbitrary value: the commas inside minmax() don't compile
  // reliably as an arbitrary `grid-cols-[…]` value, which collapsed the grid.
  const cols: CSSProperties = { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)', columnGap: '1rem' }
  return (
    <section data-testid="battlefield" className="border-2 border-line/60 rounded-xl bg-surface p-4 space-y-2">
      <InfoBar state={state} side="opponent" />

      {/* Lane labels, aligned to the same three columns as the battlefield. */}
      <div style={cols}>
        <div className="text-ink-faint text-[10px] uppercase tracking-widest">Ground</div>
        <div />
        <div className="text-ink-faint text-[10px] uppercase tracking-widest text-right">Space</div>
      </div>

      {/* Opponent half: everything anchored to the BOTTOM (the battlefront), so
          the opponent base and front-line units meet the centre; extra units
          stack upward, away from it. */}
      <div className="items-end" style={cols}>
        <ArenaZone state={state} side="opponent" arena="ground" unitInteraction={opponentInteraction} anchor="bottom" />
        <div className="flex flex-col items-center gap-2">
          <LeaderCard state={state} side="opponent" />
          <BaseCard state={state} side="opponent" onAttack={baseAttack} />
        </div>
        <ArenaZone state={state} side="opponent" arena="space" unitInteraction={opponentInteraction} anchor="bottom" />
      </div>

      {/* Player half: everything anchored to the TOP (the battlefront). Your base
          sits just below the opponent's, so the two bases meet at the centre. */}
      <div className="items-start" style={cols}>
        <ArenaZone state={state} side="player" arena="ground" unitInteraction={playerInteraction} anchor="top" />
        <div className="flex flex-col items-center gap-2">
          <BaseCard state={state} side="player" />
          <LeaderCard state={state} side="player" />
        </div>
        <ArenaZone state={state} side="player" arena="space" unitInteraction={playerInteraction} anchor="top" />
      </div>

      <InfoBar state={state} side="player" />
    </section>
  )
}

export default function GameScreen({ deck, opponentDeck, onExit, gameOptions }: Props) {
  const { status, errorDetail, gameState, legal, log, act, rematch } = useGame(deck, opponentDeck, gameOptions)
  // Board affordance (#314): click an actionable friendly unit to select it,
  // then click a highlighted target to attack. Any action clears the selection.
  const [selectedAttacker, setSelectedAttacker] = useState<string | null>(null)

  function actAndClear(action: Action) {
    setSelectedAttacker(null)
    act(action)
  }

  if (status === 'loading') {
    return (
      <div data-testid="game-loading" className="text-ink-dim text-sm">
        Hydrating cards…
      </div>
    )
  }

  if (status === 'error' || !gameState) {
    return (
      <div data-testid="game-error" className="max-w-xl">
        <p className="text-red text-sm">Couldn't load the cards for this deck — check your connection and try again.</p>
        {errorDetail && (
          <p data-testid="game-error-detail" className="mt-2 text-ink-dim text-xs font-mono">
            {errorDetail}
          </p>
        )}
        <button data-testid="exit-btn" onClick={onExit} className="mt-4 px-5 py-2 text-sm border-2 border-line/60 rounded-xl text-ink-dim hover:text-ink">
          Back to decks
        </button>
      </div>
    )
  }

  // What clicking each hand card does, keyed by hand index: play it in the action
  // phase, resource it in the setup or regroup phase (#6, #328). Derived from the
  // legal moves so the hand affordance always matches what the engine allows.
  const handAction = new Map<number, Action>()
  for (const a of legal) {
    if (a.type === 'playCard' || a.type === 'resourceCard' || a.type === 'setupResource') handAction.set(a.handIndex, a)
  }
  const hand = gameState.players.player.hand

  const attacks = legal.filter(a => a.type === 'attack')
  const attackerIds = new Set(attacks.map(a => a.attackerId))
  const selectedAttacks = selectedAttacker
    ? attacks.filter(a => a.attackerId === selectedAttacker)
    : []
  const targetUnitIds = new Set(
    selectedAttacks.flatMap(a => (a.target.kind === 'unit' ? [a.target.instanceId] : [])),
  )
  const baseAttack = selectedAttacks.find(a => a.target.kind === 'base')

  const playerInteraction = (unit: { instanceId: string }): UnitInteraction => ({
    actionable: attackerIds.has(unit.instanceId),
    selected: selectedAttacker === unit.instanceId,
    isTarget: false,
    onClick: attackerIds.has(unit.instanceId)
      ? () => setSelectedAttacker(prev => (prev === unit.instanceId ? null : unit.instanceId))
      : undefined,
  })

  const opponentInteraction = (unit: { instanceId: string }): UnitInteraction => ({
    actionable: false,
    selected: false,
    isTarget: targetUnitIds.has(unit.instanceId),
    onClick: targetUnitIds.has(unit.instanceId)
      ? () => actAndClear({ type: 'attack', attackerId: selectedAttacker!, target: { kind: 'unit', instanceId: unit.instanceId } })
      : undefined,
  })

  return (
    <div data-testid="game-screen" className="w-full space-y-4">
      <div data-testid="game-board" className="lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-4 lg:items-start">
        <div className="space-y-4 min-w-0">
        <div className="flex items-center gap-6 text-sm text-ink-dim">
          <span>Round <span className="font-mono text-ink">{gameState.round}</span></span>
          <span>Phase <span className="font-mono text-ink">{gameState.phase}</span></span>
          <span>Initiative <span className="font-mono text-ink">{gameState.initiative === 'player' ? 'you' : 'opponent'}</span></span>
          <button data-testid="exit-btn" onClick={onExit} className="ml-auto px-3 py-1 text-xs border-2 border-line/60 rounded-lg text-ink-dim hover:text-ink">
            Exit
          </button>
        </div>

        <Board
          state={gameState}
          playerInteraction={playerInteraction}
          opponentInteraction={opponentInteraction}
          baseAttack={baseAttack ? () => actAndClear(baseAttack) : undefined}
        />

        {/* Your hand */}
        <section className="border-2 border-line/60 rounded-xl bg-surface p-4">
          <h3 className="text-accent text-xs uppercase tracking-[0.12em] font-light">Your hand</h3>
          <ul data-testid="player-hand" className="mt-2 flex flex-wrap gap-1">
            {hand.length === 0 && <li className="text-ink-faint text-xs italic">empty</li>}
            {hand.map((cardId, i) => (
              <li key={`${cardId}-${i}`}>
                <HandCard
                  card={gameState.cards[cardId]}
                  cardId={cardId}
                  index={i}
                  action={handAction.get(i)}
                  onAct={actAndClear}
                />
              </li>
            ))}
          </ul>
        </section>

        {/* Game over or action menu */}
        {gameState.winner !== null ? (
          <section data-testid="game-over-banner" className="border-2 border-amber rounded-xl bg-surface p-6 text-center shadow-[0_0_12px_rgba(245,166,35,0.3)]">
            <p className={`text-xl font-semibold ${outcomeBanner(gameState.winner).tone}`}>
              {outcomeBanner(gameState.winner).title}
            </p>
            <div className="mt-4 flex justify-center gap-3">
              <button data-testid="rematch-btn" onClick={rematch} className="px-5 py-2 text-sm border-2 border-green text-green rounded-xl shadow-[0_0_12px_rgba(34,197,94,0.3)] hover:bg-green/10">
                Rematch
              </button>
              <button onClick={onExit} className="px-5 py-2 text-sm border-2 border-line/60 text-ink-dim rounded-xl hover:text-ink">
                Back to decks
              </button>
            </div>
          </section>
        ) : (
          <section data-testid="action-menu" className="border-2 border-line/60 rounded-xl bg-surface p-4">
            <h3 className="text-accent text-xs uppercase tracking-[0.12em] font-light">
              {legal.length > 0 ? 'Your move' : 'Opponent is thinking…'}
            </h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {legal.map((action, i) => (
                <button
                  key={i}
                  data-testid={`action-btn-${i}`}
                  onClick={() => actAndClear(action)}
                  className="px-4 py-1.5 text-sm border-2 border-accent text-accent rounded-xl shadow-[0_0_12px_rgba(79,195,247,0.3)] hover:bg-accent/10"
                >
                  {describeAction(gameState, 'player', action)}
                </button>
              ))}
            </div>
          </section>
        )}

        </div>

        {/* Log — right-hand panel so the board keeps the width (#315) */}
        <aside data-testid="game-log-panel" className="mt-4 lg:mt-0 lg:sticky lg:top-4 lg:self-start border-2 border-line/60 rounded-xl bg-surface p-4">
          <h3 className="text-accent text-xs uppercase tracking-[0.12em] font-light">Log</h3>
          <ol data-testid="game-log" className="mt-2 space-y-0.5 text-xs font-mono text-ink-dim max-h-48 lg:max-h-[70vh] overflow-y-auto">
            {log.map((entry, i) => (
              <li key={i}>
                <span className={entry.by === 'player' ? 'text-accent' : 'text-amber'}>
                  {entry.by === 'player' ? 'you' : 'opp'}
                </span>{' '}
                {entry.text}
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </div>
  )
}
