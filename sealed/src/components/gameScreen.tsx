import { useState, type CSSProperties, type ReactNode } from 'react'
import { useGame } from '../hooks/useGame'
import type { UseGameOptions } from '../hooks/useGame'
import type { SavedDeck } from '../data/deckStore'
import type { EngineCard, GameState, PlayerId, UnitState, UpgradeAttachment } from '../engine/types'
import type { Action } from '../engine/actions'
import { describeAction } from '../utils/describeAction'
import { orderUnits } from './boardLayout'
import { outcomeBanner } from './outcome'
import CardFace from './cardFace'
import { CARD_WIDTH_PX } from './cardSizing'
import { tokenLayout, TOKEN_W, TOKEN_H } from './tokens'
import { TOKEN_SHIELD, TOKEN_EXPERIENCE, TOKEN_ADVANTAGE } from '../engine/tokenUpgrades'
import { unitHasKeyword } from '../engine/keywords'
import { useCardZoom } from './useCardZoom'
import { CardZoomPopover } from './cardZoom'
import { DeckPile, ResourceStack, DiscardPile, OpponentHand, EmptySlot } from './mat'

interface Props {
  deck: SavedDeck
  opponentDeck: SavedDeck
  /** Leave the game — wired to the dmgCtrl icon in the game screen's header (#332). */
  onExit: () => void
  /** Open the Help screen — wired to the ? button in the header (#332). */
  onHelp: () => void
  /** Injectable for deterministic tests; defaults to real randomness. */
  gameOptions?: UseGameOptions
}

export interface UnitInteraction {
  /** This friendly unit has at least one legal action — click to select it. */
  actionable: boolean
  selected: boolean
  /** This enemy unit is a legal target of the selected attacker. */
  isTarget: boolean
  /** Valid target for the upgrade currently being placed from hand (#336). */
  isUpgradeTarget?: boolean
  onClick?: () => void
}

/** How far each attached upgrade protrudes below the one in front of it (#336). */
const UPGRADE_STEP_PX = 34

/**
 * One attached upgrade, positioned behind the unit and protruding from the bottom.
 * It carries its OWN Shift+hover / long-press zoom on its exposed strip, so you can
 * read it there (hovering the unit card zooms the unit, not the upgrade). It stays
 * upright when the unit is exhausted, dimming (opaque) along with it (#336).
 */
function AttachedUpgrade({ card, fallbackName, top, dim }: {
  card: EngineCard | undefined
  fallbackName: string
  top: number
  dim: boolean
}) {
  const { zoomed, bind } = useCardZoom()
  return (
    <div className="pointer-events-auto absolute left-1/2 -translate-x-1/2" style={{ top }} {...bind}>
      <CardFace card={card} fallbackName={fallbackName} tight className={dim ? 'brightness-[0.55]' : ''} />
      {zoomed && <CardZoomPopover card={card} fallbackName={fallbackName} />}
    </div>
  )
}

/**
 * The stack of attached upgrades behind the unit, protruding downward. The
 * first-played sits closest to the unit; each later one goes further back and
 * further down so every stat modifier shows. Rendered back-to-front (reversed) so
 * the fronts paint on top, all below the unit card in the tile (#336).
 */
function UpgradeStack({ state, upgrades, instanceId, exhausted }: {
  state: GameState
  upgrades: UpgradeAttachment[]
  instanceId: string
  exhausted: boolean
}) {
  if (upgrades.length === 0) return null
  return (
    <div data-testid={`board-unit-upgrades-${instanceId}`} className="pointer-events-none absolute inset-0">
      {upgrades
        .map((up, i) => ({ up, i }))
        .reverse()
        .map(({ up, i }) => (
          <AttachedUpgrade
            key={i}
            card={state.cards[up.cardId]}
            fallbackName={up.cardId}
            top={(i + 1) * UPGRADE_STEP_PX}
            dim={exhausted}
          />
        ))}
    </div>
  )
}

export function UnitLine({ state, unit, interact }: { state: GameState; unit: UnitState; interact: UnitInteraction }) {
  const card = state.cards[unit.cardId]
  const { zoomed, bind } = useCardZoom()
  // Only card upgrades stack behind the unit; token upgrades render as on-card
  // tokens via CardTokens instead (#334).
  const cardUpgrades = unit.upgrades.filter(u => state.cards[u.cardId]?.type !== 'token')
  const clickable = (interact.actionable || interact.isTarget || interact.isUpgradeTarget) && interact.onClick
  const highlight: 'accent' | 'red' | 'accent-dim' | 'green' | undefined = interact.selected
    ? 'accent'
    : interact.isTarget
      ? 'red'
      : interact.isUpgradeTarget
        ? 'green'
        : interact.actionable
          ? 'accent-dim'
          : undefined
  return (
    <div
      data-testid={`board-unit-${unit.instanceId}`}
      data-actionable={interact.actionable}
      data-selected={interact.selected}
      data-target={interact.isTarget}
      data-upgrade-target={Boolean(interact.isUpgradeTarget)}
      onClick={clickable ? interact.onClick : undefined}
      className={`relative w-fit shrink-0 ${clickable ? 'cursor-pointer' : ''}`}
      style={{ paddingBottom: cardUpgrades.length * UPGRADE_STEP_PX }}
    >
      <UpgradeStack state={state} upgrades={cardUpgrades} instanceId={unit.instanceId} exhausted={unit.exhausted} />
      {/* The unit card carries the unit's own zoom — hover here, not the dead tile
          padding; the upgrades zoom from their exposed strips instead (#336). */}
      <div className="relative w-fit" {...bind}>
        <CardFace card={card} fallbackName={unit.cardId} deployed={unit.isLeader} exhausted={unit.exhausted} highlight={highlight} />
        <CardTokens unit={unit} />
        {/* Keyword badges (#334): Hidden (temporary, until next phase) and Sentinel
            (a keyword — shown while the unit has it, gone if it loses it/defeated).
            Stacked so both can show. */}
        <div className="pointer-events-none absolute inset-x-0 top-1 flex flex-col items-center gap-0.5">
          {unit.hidden && (
            <span data-testid={`board-unit-hidden-${unit.instanceId}`} className="rounded bg-black/75 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-ink shadow-[0_1px_3px_rgba(0,0,0,0.7)]">
              Hidden
            </span>
          )}
          {unitHasKeyword(state, unit, 'Sentinel') && (
            <span data-testid={`board-unit-sentinel-${unit.instanceId}`} className="rounded bg-black/75 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-ink shadow-[0_1px_3px_rgba(0,0,0,0.7)]">
              Sentinel
            </span>
          )}
        </div>
      </div>
      {zoomed && <CardZoomPopover card={card} deployed={unit.isLeader} fallbackName={unit.cardId} />}
    </div>
  )
}

/**
 * Effect tokens (physical-token style) laid over a unit card on this
 * non-rotating wrapper, so they stay upright when the card is exhausted. Damage
 * is the first token; more effect types slot into the same 1–4 layout (#326).
 */
interface CardToken {
  key: string
  label: string
  color: string
  testid: string
  /** Small caption above the count (e.g. "adv." on the Advantage token). */
  sub?: string
  /** Text colour; defaults to white. Dark on the light gold Advantage token. */
  textColor?: string
}

function CardTokens({ unit }: { unit: UnitState }) {
  const countToken = (id: string) => unit.upgrades.filter(u => u.cardId === id).length
  const tokens: CardToken[] = []
  if (unit.damage > 0) {
    tokens.push({ key: 'damage', label: String(unit.damage), color: 'var(--color-red)', testid: `board-unit-damage-${unit.instanceId}` })
  }
  // Token upgrades render as on-card tokens (not cards behind the unit) (#334):
  // Shield = blue, Experience = amber (+1/+1), Advantage = gold "adv." (+1/0 next combat).
  const shields = countToken(TOKEN_SHIELD)
  if (shields > 0) {
    tokens.push({ key: 'shield', label: String(shields), color: '#3b82f6', testid: `board-unit-shield-${unit.instanceId}` })
  }
  const experience = countToken(TOKEN_EXPERIENCE)
  if (experience > 0) {
    tokens.push({ key: 'experience', label: String(experience), color: 'var(--color-amber)', testid: `board-unit-experience-${unit.instanceId}` })
  }
  const advantage = countToken(TOKEN_ADVANTAGE)
  if (advantage > 0) {
    tokens.push({ key: 'advantage', label: String(advantage), color: '#f5c518', sub: 'adv.', textColor: '#1a1200', testid: `board-unit-advantage-${unit.instanceId}` })
  }
  if (tokens.length === 0) return null

  const positions = tokenLayout(tokens.length, unit.exhausted ? 'landscape' : 'portrait')
  return (
    <div className="pointer-events-none absolute inset-0">
      {tokens.map((t, i) => (
        <span
          key={t.key}
          data-testid={t.testid}
          className="absolute flex flex-col items-center justify-center select-none tabular-nums"
          style={{
            left: `${positions[i].left}%`,
            top: `${positions[i].top}%`,
            transform: 'translate(-50%, -50%)',
            width: TOKEN_W,
            height: TOKEN_H,
            borderRadius: 6,
            background: t.color,
            color: t.textColor ?? '#fff',
            fontSize: `${Math.round(TOKEN_H * 0.6)}px`,
            fontWeight: 600,
            lineHeight: 1,
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.7)',
          }}
        >
          {t.sub && <span style={{ fontSize: `${Math.round(TOKEN_H * 0.26)}px`, fontWeight: 700, opacity: 0.85 }}>{t.sub}</span>}
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
      {units.map(u => <UnitLine key={u.instanceId} state={state} unit={u} interact={unitInteraction(u)} />)}
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

/** A leader: its card while undeployed, a marker once deployed. `widthPx` scales
 *  it down for the opponent's mat column; omitted, it renders at full size. */
function LeaderCard({ state, side, widthPx }: { state: GameState; side: PlayerId; widthPx?: number }) {
  const p = state.players[side]
  const leaderCard = state.cards[p.leader.cardId]
  const { zoomed, bind } = useCardZoom()
  // Deployed → the leader is on the battlefield as a unit; the slot is an empty
  // outline (whether it's deployed is self-evident). Keep it for alignment.
  if (p.leader.deployed) {
    return (
      <div data-testid={`${side}-leader-card`} className="w-fit">
        <EmptySlot landscape widthPx={widthPx} />
      </div>
    )
  }
  // Deployed once and defeated (its epic action is spent) — it can't redeploy.
  const defeated = p.leader.epicActionUsed
  return (
    <div data-testid={`${side}-leader-card`} {...bind} className="relative w-fit">
      <CardFace card={leaderCard} fallbackName={p.leader.cardId} exhausted={p.leader.exhausted} widthPx={widthPx} />
      {defeated && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span
            className="rounded bg-amber px-2 py-2 text-sm leading-none text-white"
            style={{ boxShadow: '0 1px 3px rgba(0, 0, 0, 0.7)' }}
          >
            Deployed
          </span>
        </div>
      )}
      {/* Shift while hovering shows the leader's unit (back) side (#321). */}
      {zoomed && <CardZoomPopover card={leaderCard} deployed={false} fallbackName={p.leader.cardId} />}
    </div>
  )
}

/**
 * A card in your hand. Clickable to play (blue) or resource (green); hover /
 * focus / long-press zooms it (#321). Its own component so it can use the zoom hook.
 */
function HandCard({ card, cardId, index, action, onAct, onSelect, selected }: {
  card: EngineCard | undefined
  cardId: string
  index: number
  action: Action | undefined
  onAct: (action: Action) => void
  /** Set for an upgrade card: click selects it, then you click a unit to attach (#336). */
  onSelect?: () => void
  selected?: boolean
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
  if (onSelect) {
    // An upgrade: clicking selects it (bright when selected), then a unit is clicked
    // to attach it. Highlighted blue like a playable card (#336).
    return (
      <button
        data-testid={`hand-card-${index}`}
        data-playable={true}
        data-selected={Boolean(selected)}
        onClick={onSelect}
        {...bind}
        className="relative block w-fit shrink-0 cursor-pointer"
      >
        <CardFace card={card} fallbackName={cardId} tight highlight={selected ? 'accent' : 'accent-dim'} />
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
  // Space | Leaders+Bases | Ground. Set the template with an inline style rather
  // than a Tailwind arbitrary value: the commas inside minmax() don't compile
  // reliably as an arbitrary `grid-cols-[…]` value, which collapsed the grid. The
  // battlefront (centre column) aligns with the opponent leader in the bar above.
  const cols: CSSProperties = { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)', columnGap: '1rem' }
  return (
    // Transparent — the play-area container behind it supplies one continuous
    // background across the opponent bar, battlefield and player bar (#332). It
    // grows to fill the play area's height, centring the board vertically.
    <section data-testid="battlefield" className="flex flex-1 flex-col justify-center gap-1.5 px-2">
      {/* Opponent half: everything anchored to the BOTTOM (the battlefront), so
          the opponent base and front-line units meet the centre; extra units
          stack upward, away from it. */}
      <div className="items-end" style={cols}>
        <ArenaZone state={state} side="opponent" arena="space" unitInteraction={opponentInteraction} anchor="bottom" />
        {/* Opponent leader lives in their bar's centre column (#332), so the strip
            holds only their base here. */}
        <div className="flex flex-col items-center gap-2">
          <BaseCard state={state} side="opponent" onAttack={baseAttack} />
        </div>
        <ArenaZone state={state} side="opponent" arena="ground" unitInteraction={opponentInteraction} anchor="bottom" />
      </div>

      {/* Battlefront: Space / Ground labels (centred over their lanes) flank the
          game state, which sits between the two bases (#332). */}
      <div className="items-center" style={cols}>
        <div className="text-ink-faint text-sm uppercase tracking-widest text-center">Space</div>
        <div data-testid="game-state" className="text-center text-sm text-ink leading-tight whitespace-nowrap">
          <div><span className="text-accent uppercase">Round:</span> {state.round} - <span className="capitalize">{state.phase}</span></div>
          <div><span className="text-accent uppercase">Initiative:</span> {state.initiative === 'player' ? 'You' : 'Opponent'}</div>
        </div>
        <div className="text-ink-faint text-sm uppercase tracking-widest text-center">Ground</div>
      </div>

      {/* Player half: everything anchored to the TOP (the battlefront). Your base
          sits just below the opponent's, so the two bases meet at the centre. */}
      <div className="items-start" style={cols}>
        <ArenaZone state={state} side="player" arena="space" unitInteraction={playerInteraction} anchor="top" />
        <div className="flex flex-col items-center gap-2">
          <BaseCard state={state} side="player" />
          <LeaderCard state={state} side="player" />
        </div>
        <ArenaZone state={state} side="player" arena="ground" unitInteraction={playerInteraction} anchor="top" />
      </div>
    </section>
  )
}

/**
 * A labelled column within a player bar (#332): its component with an accent
 * all-caps label rotated 90° anticlockwise on the left (vertical-rl + rotate
 * reads bottom-to-top on iOS, which lacks `sideways-lr`). A subtle background band
 * separates it from its neighbours over the shared play-area background.
 */
function BarColumn({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 rounded-lg bg-surface px-1.5 py-1">
      <span
        className="shrink-0 text-accent text-[11px] uppercase tracking-[0.15em] font-light"
        style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
      >
        {label}
      </span>
      <div className="flex min-w-0 flex-1 items-center justify-center">{children}</div>
    </div>
  )
}

/**
 * The opponent bar (#332): their leader in the centre so it lines up with the
 * bases and the player leader below, flanked by discard + hand on the left and
 * resources + deck on the right. Transparent, joined to the battlefield below.
 */
function OpponentBar({ state }: { state: GameState }) {
  const p = state.players.opponent
  const ready = p.resources.filter(r => !r.exhausted).length
  const exhausted = p.resources.length - ready
  const cols: CSSProperties = { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)', columnGap: '1.5rem', alignItems: 'stretch' }
  return (
    <div data-testid="opponent-mat" className="px-2 py-2" style={cols}>
      {/* Left: discard, then the hand filling the space up to the leader. */}
      <div className="grid min-w-0 items-stretch gap-2" style={{ gridTemplateColumns: 'auto minmax(0, 1fr)' }}>
        <BarColumn label="Discard"><DiscardPile state={state} side="opponent" /></BarColumn>
        <BarColumn label="Hand"><OpponentHand count={p.hand.length} /></BarColumn>
      </div>
      {/* Centre column: the leader, aligned to the bottom so it meets the base. */}
      <div className="flex items-end justify-center">
        <LeaderCard state={state} side="opponent" widthPx={CARD_WIDTH_PX} />
      </div>
      <div className="flex min-w-0 items-stretch justify-end gap-2">
        <BarColumn label="Resources"><ResourceStack ready={ready} exhausted={exhausted} /></BarColumn>
        <BarColumn label="Deck"><DeckPile count={p.deck.length} /></BarColumn>
      </div>
    </div>
  )
}

/**
 * The player bar (#332): Deck | Resources | Hand | Action | Discard, the hand
 * flexing to fill the remaining width (the most important area). The action column
 * is a fixed width so its buttons don't shift the layout between phases.
 */
function PlayerBar({ state, hand, action }: { state: GameState; hand: ReactNode; action: ReactNode }) {
  const p = state.players.player
  const ready = p.resources.filter(r => !r.exhausted).length
  const exhausted = p.resources.length - ready
  const cols: CSSProperties = { display: 'grid', gridTemplateColumns: 'auto auto minmax(0, 1fr) 10rem auto', columnGap: '0.5rem', alignItems: 'stretch' }
  return (
    <div data-testid="player-mat" className="px-2 py-2" style={cols}>
      <BarColumn label="Deck"><DeckPile count={p.deck.length} /></BarColumn>
      <BarColumn label="Resources"><ResourceStack ready={ready} exhausted={exhausted} /></BarColumn>
      <BarColumn label="Hand">{hand}</BarColumn>
      <BarColumn label="Action">{action}</BarColumn>
      <BarColumn label="Discard"><DiscardPile state={state} side="player" /></BarColumn>
    </div>
  )
}

export default function GameScreen({ deck, opponentDeck, onExit, onHelp, gameOptions }: Props) {
  const { status, errorDetail, gameState, legal, log, act, rematch } = useGame(deck, opponentDeck, gameOptions)
  // Board affordance (#314): click an actionable friendly unit to select it,
  // then click a highlighted target to attack. Any action clears the selection.
  const [selectedAttacker, setSelectedAttacker] = useState<string | null>(null)
  // Placing an upgrade (#336): click an upgrade card in hand (its hand index is
  // held here) to highlight valid target units, then click a unit to attach it.
  const [selectedUpgrade, setSelectedUpgrade] = useState<number | null>(null)

  function actAndClear(action: Action) {
    setSelectedAttacker(null)
    setSelectedUpgrade(null)
    act(action)
  }

  // The play area (right of the log) shows loading, an error, or the live board.
  // The surrounding frame — icon (exit) + help + log — always renders, so leaving
  // and Help stay available even while cards load or a load fails (#332).
  let playContent: ReactNode
  if (status === 'loading') {
    playContent = (
      <div data-testid="game-loading" className="p-6 text-ink-dim text-sm">
        Hydrating cards…
      </div>
    )
  } else if (status === 'error' || !gameState) {
    playContent = (
      <div data-testid="game-error" className="max-w-xl p-6">
        <p className="text-red text-sm">Couldn't load the cards for this deck — check your connection and try again.</p>
        {errorDetail && (
          <p data-testid="game-error-detail" className="mt-2 text-ink-dim text-xs font-mono">
            {errorDetail}
          </p>
        )}
        <button data-testid="error-back-btn" onClick={onExit} className="mt-4 px-5 py-2 text-sm border-2 border-line/60 rounded-xl text-ink-dim hover:text-ink">
          Back to decks
        </button>
      </div>
    )
  } else {
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
    const selectedAttacks = selectedAttacker ? attacks.filter(a => a.attackerId === selectedAttacker) : []
    const targetUnitIds = new Set(
      selectedAttacks.flatMap(a => (a.target.kind === 'unit' ? [a.target.instanceId] : [])),
    )
    const baseAttack = selectedAttacks.find(a => a.target.kind === 'base')

    // Placing an upgrade (#336): which hand cards are upgrades, and — once one is
    // selected — which units it may attach to. While placing, unit clicks attach
    // the upgrade rather than driving an attack.
    const upgradeMoves = legal.filter(a => a.type === 'playUpgrade')
    const upgradeHandIndices = new Set(upgradeMoves.map(a => a.handIndex))
    const upgradeTargetIds = new Set(
      selectedUpgrade !== null ? upgradeMoves.filter(a => a.handIndex === selectedUpgrade).map(a => a.targetInstanceId) : [],
    )
    const placing = selectedUpgrade !== null

    const upgradeInteraction = (instanceId: string): UnitInteraction | null =>
      placing
        ? {
            actionable: false,
            selected: false,
            isTarget: false,
            isUpgradeTarget: upgradeTargetIds.has(instanceId),
            onClick: upgradeTargetIds.has(instanceId)
              ? () => actAndClear({ type: 'playUpgrade', handIndex: selectedUpgrade, targetInstanceId: instanceId })
              : undefined,
          }
        : null

    const playerInteraction = (unit: { instanceId: string }): UnitInteraction =>
      upgradeInteraction(unit.instanceId) ?? {
        actionable: attackerIds.has(unit.instanceId),
        selected: selectedAttacker === unit.instanceId,
        isTarget: false,
        onClick: attackerIds.has(unit.instanceId)
          ? () => { setSelectedUpgrade(null); setSelectedAttacker(prev => (prev === unit.instanceId ? null : unit.instanceId)) }
          : undefined,
      }

    const opponentInteraction = (unit: { instanceId: string }): UnitInteraction =>
      upgradeInteraction(unit.instanceId) ?? {
        actionable: false,
        selected: false,
        isTarget: targetUnitIds.has(unit.instanceId),
        onClick: targetUnitIds.has(unit.instanceId)
          ? () => actAndClear({ type: 'attack', attackerId: selectedAttacker!, target: { kind: 'unit', instanceId: unit.instanceId } })
          : undefined,
      }

    const playerHand = (
      <ul data-testid="player-hand" className="flex flex-wrap justify-center gap-1">
        {hand.map((cardId, i) => (
          <li key={`${cardId}-${i}`}>
            <HandCard
              card={gameState.cards[cardId]}
              cardId={cardId}
              index={i}
              action={handAction.get(i)}
              onAct={actAndClear}
              onSelect={
                upgradeHandIndices.has(i)
                  ? () => { setSelectedAttacker(null); setSelectedUpgrade(prev => (prev === i ? null : i)) }
                  : undefined
              }
              selected={selectedUpgrade === i}
            />
          </li>
        ))}
      </ul>
    )

    // Playing, resourcing, attacking and attaching upgrades are all driven by
    // clicking a card or unit, so the menu holds only the remaining choices —
    // mulligan, keep hand, take the initiative, pass (and skip/deploy) (#332/#336).
    const CLICK_HANDLED: Action['type'][] = ['playCard', 'playUpgrade', 'attack', 'resourceCard', 'setupResource']
    const menuActions = gameState.winner === null ? legal.filter(a => !CLICK_HANDLED.includes(a.type)) : []
    const actionColumn = (
      <div className="flex flex-col items-stretch gap-1.5">
        {menuActions.map((action, i) => (
          <button
            key={i}
            data-testid={`action-btn-${i}`}
            onClick={() => actAndClear(action)}
            className="rounded-xl border-2 border-accent px-3 py-1.5 text-xs text-accent shadow-[0_0_12px_rgba(79,195,247,0.3)] hover:bg-accent/10"
          >
            {describeAction(gameState, 'player', action)}
          </button>
        ))}
        {menuActions.length === 0 && legal.length === 0 && gameState.winner === null && (
          <span className="text-center text-xs text-ink-faint">Opponent…</span>
        )}
      </div>
    )

    // The play area: one continuous background across the opponent bar, the
    // battlefield, and the player bar — joined, edge-to-edge, filling the height.
    playContent = (
      <div data-testid="game-board" className="flex min-h-0 flex-1 flex-col">
        <OpponentBar state={gameState} />
        <Board
          state={gameState}
          playerInteraction={playerInteraction}
          opponentInteraction={opponentInteraction}
          baseAttack={baseAttack ? () => actAndClear(baseAttack) : undefined}
        />
        <PlayerBar state={gameState} hand={playerHand} action={actionColumn} />
      </div>
    )
  }

  return (
    <div data-testid="game-screen" className="grid h-screen w-full" style={{ gridTemplateColumns: '16rem 1fr' }}>
      {/* Left column: the header (on the core theme background, like the page
          header) above the log panel — no divider to the play area (#332). */}
      <div className="flex min-h-0 flex-col">
        <header className="flex items-center justify-between px-2 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <button data-testid="exit-btn" onClick={onExit} aria-label="Exit to decks" className="shrink-0 rounded-lg hover:opacity-80">
              <img src={`${import.meta.env.BASE_URL}dmgCtrl-icon-transparent-192.png`} alt="dmgCtrl" className="h-9 w-9" />
            </button>
            <span className="truncate text-xl font-extralight tracking-[0.1em] text-ink">dmgCtrl</span>
          </div>
          <button
            onClick={onHelp}
            aria-label="Help"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-2 border-line text-ink-dim hover:text-ink shadow-[0_0_8px_rgba(156,163,175,0.2)]"
          >
            ?
          </button>
        </header>
        <aside data-testid="game-log-panel" className="ml-2 mt-3 mb-2 min-h-0 flex-1 overflow-y-auto rounded-lg bg-surface p-3">
          <h3 className="text-accent text-xs uppercase tracking-[0.12em] font-light">Log</h3>
          <ol data-testid="game-log" className="mt-2 space-y-0.5 text-xs text-ink-dim">
            {log.map((entry, i) => (
              // Actor in its own fixed-width column so the actions line up (#332).
              <li key={i} className="flex gap-2">
                <span className={`w-8 shrink-0 ${entry.by === 'player' ? 'text-accent' : 'text-amber'}`}>
                  {entry.by === 'player' ? 'You' : 'Opp'}
                </span>
                <span>{entry.text}</span>
              </li>
            ))}
          </ol>
        </aside>
      </div>

      {/* Right column: the play area, edge-to-edge to the top and right. It is
          transparent (starfield); the bars carry the surface background, so the
          battlefield between them shows the stars (#332). */}
      <div className="flex min-h-0 flex-col">
        {playContent}
      </div>

      {/* Game over — a modal overlay over the whole screen (#332). */}
      {gameState && gameState.winner !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <section
            data-testid="game-over-banner"
            style={{ backgroundColor: '#0d1b2a' }}
            className="rounded-xl border-2 border-amber p-8 text-center shadow-[0_0_24px_rgba(245,166,35,0.35)]"
          >
            <p className={`text-2xl font-semibold ${outcomeBanner(gameState.winner).tone}`}>
              {outcomeBanner(gameState.winner).title}
            </p>
            <div className="mt-6 flex justify-center gap-3">
              <button data-testid="rematch-btn" onClick={rematch} className="px-5 py-2 text-sm border-2 border-green text-green rounded-xl shadow-[0_0_12px_rgba(34,197,94,0.3)] hover:bg-green/10">
                Rematch
              </button>
              <button onClick={onExit} className="px-5 py-2 text-sm border-2 border-line/60 text-ink-dim rounded-xl hover:text-ink">
                Back to decks
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
