import { useState, type CSSProperties, type ReactNode } from 'react'
import { Button, OptionRow, Stepper } from '@pwa-shared/controls'
import { payWithCreditRange, payWithPicked, usableCreditTokens } from '../engine/payment'
import { readyResourceCount } from '../engine/resources'
import { nameableCardNames, nameableTraits, zoneCards } from '../engine/legalMoves'
import { useGame } from '../hooks/useGame'
import type { UseGameOptions } from '../hooks/useGame'
import type { SavedDeck } from '../data/deckStore'
import type { EngineCard, GameState, PendingChoice, PendingTrigger, PlayerId, TargetIntent } from '../engine/types'
import { baseEpicAction, leaderActions, mayLookAtDeckTop, triggerAbility } from '../engine/abilities'
import type { Action } from '../engine/actions'
import { describeAction, describeActionParts, handCardRef } from '../utils/describeAction'
import type { DescribePart } from '../utils/describeAction'
import { describeChoiceParts, describeChoiceQuestion, choiceSourceCard, answeredWithButtons, BOARD_TARGET_KINDS, allocation, isRepeatable, paidFor, paidForCard } from '../utils/describeChoice'
import { upgradeHostIds, upgradeHostName } from '../utils/upgradeHosts'
import { buildReportMarkdown, issueUrl } from '../utils/bugReport'
import { BugReportOverlay } from './bugReportOverlay'
import { FIELD_CLASS } from './field'
import { GameLoadError, GameLoading, PrintedStatsNotice } from './game/gameEdgeStates'
import { SettingsSheet } from './settingsSheet'
import { useSettings } from '../hooks/useSettings'
import { RELEASE, COMMIT_ID } from '../buildIdentity'
import { isDev } from '../env'
import { actionFocus, BOARD_SCALE, boardLeft, deployBlocker, handOverlap, type BoardScale } from './boardLayout'
import CardFace from './cardFace'
import { intentHighlight } from './highlight'
import { CardGridOverlay } from './cardGridOverlay'
import { CARD_WIDTH_PX, cardRadius, longEdge } from './cardSizing'
import { baseHostId, baseHostOwner } from '../engine/types'
import { useCardZoom, CardInspect } from './useCardZoom'
import type { InspectTarget } from './useCardZoom'
import { CardRef } from './cardRef'
import { CardZoomPopover } from './cardZoom'
import { useMediaQuery, PHONE_LANDSCAPE_QUERY, PHONE_PORTRAIT_QUERY } from '../hooks/useMediaQuery'
import { CardDetail, GameLogDrawer, LeaderMenu, MoreSheet, PhoneGameLayout, PhoneGameOver, PhonePrompt, PileSheet, TurnSideways } from './game/phoneLayout'
import type { LeaderMenuItem, PromptButton } from './game/phoneLayout'

interface Props {
  deck: SavedDeck
  opponentDeck: SavedDeck
  /** Leave the game — wired to the dmgCtrl icon in the game screen's header. */
  onExit: () => void
  /**
   * Open Help: the game's own, from the ? button in the header, or the one named section a link
   * in the settings form asks for.
   */
  onHelp: (section?: string) => void
  /** Injectable for deterministic tests; defaults to real randomness. */
  gameOptions?: UseGameOptions
}

export interface UnitInteraction {
  /** This friendly unit has at least one legal action — click to select it. */
  actionable: boolean
  selected: boolean
  /** This unit is a legal target of the selected attacker, leader ability or live choice. */
  isTarget: boolean
  /** What targeting it does, which colours the highlight; absent for an attack (red). */
  intent?: TargetIntent
  /** Valid target for the upgrade currently being placed from hand. */
  isUpgradeTarget?: boolean
  /** The opponent's action on show names this unit: the one acting (amber) or its target (red). */
  acting?: 'actor' | 'target'
  onClick?: () => void
}

/** What the corner button says when dismissing an overlay takes back the action that raised it. */
const CANCEL_LABEL = 'Cancel: take back the action that raised this'

/**
 * "Select a card" overlay — pick one of several cards (Vane's upgrade-to-defeat, the unique
 * rule, the Armorer's resource reveal). `disabled` items are revealed but not selectable; a Cancel
 * appears when `onCancel` is given. A thin wrapper over `CardGridOverlay`.
 */
/** An upgrade host's name (a unit, or whose base); falls back to "the unit" if it has left play. */
function hostDisplayName(state: GameState, hostId: string): string {
  return upgradeHostName(state, hostId) || 'the unit'
}

export function CardSelectOverlay({ state, prompt, items, onPick, onCancel, onDismiss }: {
  state: GameState
  prompt: string
  items: { cardId: string; optionIndex: number; disabled?: boolean; key?: string | number }[]
  onPick: (optionIndex: number) => void
  onCancel?: () => void
  /** Cancels the action that raised the choice; absent, the overlay blocks until answered. */
  onDismiss?: () => void
}) {
  return (
    <CardGridOverlay
      idPrefix="card-select"
      prompt={prompt}
      onDismiss={onDismiss}
      dismissLabel={CANCEL_LABEL}
      state={state}
      items={items.map(item => {
        const key = item.key ?? item.optionIndex
        return {
          cardId: item.cardId,
          key,
          testId: `card-select-${key}`,
          dimmed: item.disabled,
          onSelect: () => onPick(item.optionIndex),
        }
      })}
      buttons={onCancel && [{ label: 'Cancel', testId: 'card-select-cancel', onClick: onCancel }]}
    />
  )
}

/**
 * "Search" reveal overlay — the private "look at the top N" for Improvised Identity: each
 * revealed ground unit gets a Discard button; the rest are dimmed. A thin wrapper over `CardGridOverlay`.
 */
export function SearchRevealOverlay({ state, choice, onPick, onDone }: {
  state: GameState
  choice: Extract<PendingChoice, { kind: 'search' }>
  onPick: (deckIndex: number) => void
  /** Given only when nothing is pickable (#413): the reveal is shown, and Done dismisses it. */
  onDone?: () => void
}) {
  return (
    <CardGridOverlay
      idPrefix="search"
      prompt={onDone
        ? `Look at the top ${choice.revealed.length}: no ground unit to discard`
        : `Look at the top ${choice.revealed.length}: discard a ground unit`}
      state={state}
      items={choice.revealed.map((cardId, i) => {
        const c = state.cards[cardId]
        const ground = c?.type === 'unit' && c.arena === 'ground'
        return ground
          ? { cardId, key: i, testId: `search-pick-${i}`, actionLabel: 'Discard', onSelect: () => onPick(i) }
          : { cardId, key: i, dimmed: true }
      })}
      buttons={onDone && [{ label: 'Done', testId: 'search-done', onClick: onDone }]}
    />
  )
}

/**
 * "Search the top N, draw a match" overlay (Clan Wren Loyalist): reveals the top cards; the
 * trait-matching ones get a Draw button, the rest are dimmed. Mandatory (a match exists). A thin
 * wrapper over `CardGridOverlay`.
 */
export function SearchDrawOverlay({ state, choice, onPick, onDone }: {
  state: GameState
  choice: Extract<PendingChoice, { kind: 'searchDraw' }>
  onPick: (deckIndex: number) => void
  /** Given only when nothing matched (#413): the cards are shown, and Done bottoms them. */
  onDone?: () => void
}) {
  const eligible = new Set(choice.eligibleIndices)
  return (
    <CardGridOverlay
      idPrefix="search-draw"
      prompt={onDone
        ? `Search the top ${choice.revealed.length}: no match, these go to the bottom`
        : `Search the top ${choice.revealed.length}: draw a match`}
      state={state}
      items={choice.revealed.map((cardId, i) => eligible.has(i)
        ? { cardId, key: i, testId: `search-draw-pick-${i}`, actionLabel: 'Draw', onSelect: () => onPick(i) }
        : { cardId, key: i, dimmed: true })}
      buttons={onDone && [{ label: 'Done', testId: 'search-draw-done', onClick: onDone }]}
    />
  )
}

/**
 * "Who resolves first" overlay (CR 7.6.10).
 *
 * With triggers owed on both sides, the active player chooses which PLAYER clears their batch first.
 * They choose the player and nothing else: the opponent's internal order is the opponent's (CR 7.6.9),
 * so this deliberately offers two buttons rather than a draggable list.
 *
 * **Both batches are listed, with the card that raised each.** That is the "why am I being asked this"
 * answer, and it is the whole reason the choice is legible: the order question itself names no card,
 * because it exists precisely because two cards triggered at once. Seeing what is waiting on each side
 * is what makes the decision a decision rather than a coin flip with buttons.
 *
 * Portalled to body for the same reason the other overlays are: it must clear the board's stacking
 * context.
 */
/**
 * How one waiting ability reads: the card that carries it, then what it does.
 *
 * Taken from the ability registry rather than from any choice it might raise, because most abilities
 * raise none. Listing choices here was the UI half of the same defect as the engine's: a batch of
 * abilities that quietly draw and make tokens rendered as "nothing waiting", and the player was asked
 * to order a list of nothing.
 */
function triggerLabel(state: GameState, t: PendingTrigger): string {
  // Ambush and Support are abilities on pseudo cards with no entry in the card database, so they are
  // named by the unit they fired from: the card the player is actually looking at.
  const source = t.sourceInstanceId
    ? [...state.players.player.units, ...state.players.opponent.units].find(u => u.instanceId === t.sourceInstanceId)
    : undefined
  const name = state.cards[t.cardId]?.name ?? (source ? state.cards[source.cardId]?.name : undefined) ?? t.cardId
  const text = triggerAbility(t)?.description
  return text ? `${name}: ${text}` : name
}

/**
 * Paying with Credit tokens: how many to defeat, on the shared stepper held between what ready
 * resources leave uncovered and what is held, the rest from resources, then Pay. One tap is one
 * answer, so one move and one line in the log. Paying units are not asked here: they are picked on
 * the board, an answer each, and their step keeps its Pay buttons in the controls column.
 */
export function PayWithPrompt({ state, choice, onPay, onCancel, onSetAside }: {
  state: GameState
  choice: Extract<PendingChoice, { kind: 'payWith' }>
  onPay: (credits: number) => void
  onCancel?: () => void
  onSetAside?: () => void
}) {
  const { min, max } = payWithCreditRange(state, choice)
  const [picked, setPicked] = useState(min)
  const credits = Math.min(max, Math.max(min, picked))
  const held = usableCreditTokens(state, choice.controller) - choice.credits
  return (
    <PhonePrompt
      testId="pay-with-overlay"
      state={state}
      cardId={paidForCard(state, choice)}
      eyebrow={`Paying for ${paidFor(state, choice)} · cost ${choice.cost}`}
      question="Each Credit token you defeat pays 1. Use as many as you like, then the rest comes from your resources."
      buttons={[{ label: 'Pay', onClick: () => onPay(credits), primary: true, testId: 'pay-btn' }]}
      onCancel={onCancel}
      cancelLabel={CANCEL_LABEL}
      onSetAside={onSetAside}
    >
      <div role="group" aria-label="Credit tokens to defeat" className="flex items-center gap-2.5">
        <Stepper label="Credit tokens" value={credits} min={min} max={max} onChange={setPicked} showLabel={false} />
        <div className="text-sm leading-[17px] text-ink-dim">Credit tokens<br />you have {held}</div>
      </div>
      <div data-testid="pay-from-resources" className="text-sm text-ink-dim">
        Then <b className="text-ink">{choice.cost - payWithPicked(choice) - credits}</b> from resources · {readyResourceCount(state.players[choice.controller])} ready
      </div>
    </PhonePrompt>
  )
}

export function TriggerOrderOverlay({ state, mine, theirs, onPick, onDismiss }: {
  state: GameState
  mine: PendingTrigger[]
  theirs: PendingTrigger[]
  onPick: (optionIndex: number) => void
  /** Cancels the action that raised the triggers; absent, the overlay blocks until answered. */
  onDismiss?: () => void
}) {
  // Each side's triggers in a tile, the answers under them. The waiting abilities are information,
  // not answers, so they are plain text: the only buttons are the two that answer.
  const tile = (title: string, tone: string, triggers: PendingTrigger[], testId: string) => (
    <div data-testid={testId} className="flex flex-col gap-1.5 rounded-xl bg-surface px-3 py-2.5">
      <div className={`text-[11px] tracking-[0.14em] ${tone}`}>{title}</div>
      {triggers.length === 0
        ? <div className="text-sm text-ink-faint">Nothing waiting</div>
        : triggers.map(t => <div key={t.id} className="text-sm leading-[19px] text-ink">{triggerLabel(state, t)}</div>)}
    </div>
  )
  return (
    <PhonePrompt
      testId="trigger-order-overlay"
      state={state}
      width={560}
      question="Abilities triggered on both sides. Who resolves first?"
      buttons={[
        { label: 'They resolve first', onClick: () => onPick(1), testId: 'trigger-order-theirs-btn' },
        { label: 'I resolve first', onClick: () => onPick(0), primary: true, testId: 'trigger-order-mine-btn' },
      ]}
      onCancel={onDismiss}
      cancelLabel={CANCEL_LABEL}
    >
      <div className="grid grid-cols-2 gap-2.5">
        {tile('YOUR TRIGGERS', 'text-accent', mine, 'trigger-order-mine')}
        {tile("OPPONENT'S TRIGGERS", 'text-[color:var(--color-opponent)]', theirs, 'trigger-order-theirs')}
      </div>
    </PhonePrompt>
  )
}

/**
 * Ordering your own simultaneous abilities (CR 7.6.9).
 *
 * One button per waiting ability, and no decline: they all resolve, the only question is the sequence.
 * Each is named by its own card, which is the whole point of asking, since a unit's own ability and one
 * granted by an upgrade attached to it are otherwise indistinguishable.
 */
export function NextTriggerOverlay({ state, candidates, onPick, onDismiss }: {
  state: GameState
  candidates: { triggerId: string; cardId: string; sourceInstanceId?: string }[]
  onPick: (optionIndex: number) => void
  /** Cancels the action that raised the triggers; absent, the overlay blocks until answered. */
  onDismiss?: () => void
}) {
  const owed = state.pendingTriggers ?? []
  const labels = candidates.map(c => {
    const trigger = owed.find(t => t.id === c.triggerId)
    return trigger ? triggerLabel(state, trigger) : (state.cards[c.cardId]?.name ?? c.cardId)
  })
  // Two copies of one card each hold their own ability, and the label cannot tell them apart.
  // Number those so the buttons are at least distinct to click.
  const label = (i: number) => {
    const duplicated = labels.filter(l => l === labels[i]).length > 1
    const seen = labels.slice(0, i + 1).filter(l => l === labels[i]).length
    return duplicated ? `${labels[i]} (${seen})` : labels[i]
  }
  // Picking here is not accepting the ability, and the difference is not obvious: there is no decline
  // on this prompt because all of them resolve, and a "may" is turned down on its own choice once its
  // turn comes. The note says so.
  return (
    <PhonePrompt
      testId="next-trigger-overlay"
      state={state}
      question="Several of your abilities triggered at once. Which resolves next?"
      note="Each will resolve in turn. You can still decline optional effects when they do."
      buttons={[]}
      onCancel={onDismiss}
      cancelLabel={CANCEL_LABEL}
    >
      <div className="flex flex-col gap-2">
        {candidates.map((c, i) => (
          <Button key={c.triggerId} testId={`next-trigger-btn-${i}`} variant={i === 0 ? 'primary' : 'secondary'} onClick={() => onPick(i)} style={{ fontSize: '15px' }}>
            {label(i)}
          </Button>
        ))}
      </div>
    </PhonePrompt>
  )
}

/**
 * "Name a card" overlay (Ryder Azadi): a text box that filters the nameable card list (every card in
 * the current game, both decks) by substring, with the card that asked and its question.
 *
 * `what` names what is being picked, so "name a Trait" (The First Legion) uses the same overlay: the
 * two choices differ in the list and the heading and in nothing else.
 */
/** How many matching names are listed: as many as fit beside a phone keyboard's half of the screen. */
const NAME_MATCHES = 3

export function NameCardOverlay({ state, choice, names, onPick, what = 'card', onDismiss }: {
  state: GameState
  choice: PendingChoice
  names: string[]
  onPick: (name: string) => void
  what?: string
  /** Cancels the action that asked for the name; absent, the overlay blocks until answered. */
  onDismiss?: () => void
}) {
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState<string | null>(null)
  const filtered = query.trim() ? names.filter(n => n.toLowerCase().includes(query.trim().toLowerCase())) : names
  // A name is chosen from the matches first and named by the primary button, so a slip of the
  // finger in a short list does not answer the card.
  const asker = choiceSourceCard(state, choice)
  const shown = filtered.slice(0, NAME_MATCHES)
  return (
    <PhonePrompt
      testId="name-card-overlay"
      state={state}
      cardId={asker}
      eyebrow={asker ? state.cards[asker]?.name ?? asker : undefined}
      question={describeChoiceQuestion(state, choice)}
      width={440}
      buttons={chosen && shown.includes(chosen) ? [{ label: `Name ${chosen}`, testId: 'name-card-confirm', onClick: () => onPick(chosen), primary: true }] : []}
      onCancel={onDismiss}
      cancelLabel={CANCEL_LABEL}
    >
      <label className="flex flex-col gap-1.5 text-xs tracking-[0.14em] text-ink-dim">
        {`${what.toUpperCase()} NAME`}
        <input
          data-testid="name-card-input"
          autoFocus
          aria-autocomplete="list"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className={`h-11 ${FIELD_CLASS}`}
        />
      </label>
      <div role="group" aria-label="Matching names" className="flex flex-col gap-1">
        {shown.map((n, i) => (
          <OptionRow key={n} testId={`name-card-option-${i}`} title={n} selected={n === chosen} onClick={() => setChosen(n)} />
        ))}
        {filtered.length === 0 && <div className="py-2 text-sm text-ink-faint">No match</div>}
      </div>
    </PhonePrompt>
  )
}

/**
 * A choice's answers as the phone prompt's buttons, each keeping its index in `actions` for its test
 * id. One is primary, the first that accepts; a decline is never it.
 */
function promptButtons(state: GameState, actions: Action[], onPick: (action: Action) => void, testId: string): PromptButton[] {
  const primary = actions.findIndex(a => a.type !== 'skipTrigger')
  return actions.map((action, i): PromptButton => ({
    label: describeAction(state, 'player', action),
    onClick: () => onPick(action),
    primary: i === primary,
    testId: `${testId}-${i}`,
  }))
}

/**
 * "Search & play for free" overlay: reveals the searched cards; eligible ones get a "Play free"
 * button, the rest are dimmed, and Done stops early. A thin wrapper over `CardGridOverlay`.
 *
 * Two searches share it and ask different things, so the prompt reads the choice rather than naming
 * a card: Admiral Ackbar plays space units within a combined cost budget, and a `playOne` search (Eye
 * of Sion) plays a single unit of any arena costing no more than the budget.
 */
export function SearchPlayFreeOverlay({ state, choice, onPick, onDone }: {
  state: GameState
  choice: Extract<PendingChoice, { kind: 'searchPlayFree' }>
  onPick: (deckIndex: number) => void
  onDone: () => void
}) {
  const eligible = new Set(choice.eligibleIndices)
  const prompt = choice.playOne
    ? `Play a unit costing ${choice.budget} or less for free${choice.entersReady ? '. It enters play ready' : ''}`
    : `Play space units for free: ${choice.budget} cost left`
  return (
    <CardGridOverlay
      idPrefix="search-free"
      prompt={prompt}
      state={state}
      items={choice.revealed.map((cardId, i) => eligible.has(i)
        ? { cardId, key: i, testId: `search-free-pick-${i}`, actionLabel: 'Play free', onSelect: () => onPick(i) }
        : { cardId, key: i, dimmed: true })}
      buttons={[{ label: 'Done', testId: 'search-free-done', onClick: onDone }]}
    />
  )
}

/**
 * "Search for an upgrade to attach" overlay (Reforge): reveals the searched cards; the ones that
 * can actually be taken get a Play button, the rest are dimmed. Which are playable is decided by
 * the LEGAL MOVES rather than by `eligibleIndices`, because an eligible upgrade may still be
 * unaffordable after the discount. A Done button passes. A thin wrapper over `CardGridOverlay`.
 */
export function SearchPlayUpgradeOverlay({ state, choice, playableIndices, onPick, onDone }: {
  state: GameState
  choice: Extract<PendingChoice, { kind: 'searchPlayUpgrade' }>
  playableIndices: number[]
  onPick: (deckIndex: number) => void
  onDone: () => void
}) {
  const playable = new Set(playableIndices)
  return (
    <CardGridOverlay
      idPrefix="search-upgrade"
      prompt={playable.size > 0
        ? `Search the top ${choice.revealed.length}: play an upgrade, ${choice.discount} less`
        : `Search the top ${choice.revealed.length}: nothing to attach, these go back`}
      state={state}
      items={choice.revealed.map((cardId, i) => playable.has(i)
        ? { cardId, key: i, testId: `search-upgrade-pick-${i}`, actionLabel: 'Play', onSelect: () => onPick(i) }
        : { cardId, key: i, dimmed: true })}
      buttons={[{ label: 'Done', testId: 'search-upgrade-done', onClick: onDone }]}
    />
  )
}

/**
 * "Look at an opponent's hand" overlay (Imperial Defector / Remnant Lookouts): reveals the
 * target's hand face-up. View-only unless `mayDiscard`, when each card the legal moves offer
 * (`discardable`, hand indices) gets a Discard button and the rest are dimmed. Done dismisses it, and
 * is given only when the legal moves allow declining. A thin wrapper over `CardGridOverlay`.
 */
export function OpponentHandOverlay({ state, choice, discardable, onDiscard, onDone }: {
  state: GameState
  choice: Extract<PendingChoice, { kind: 'lookAtHand' }>
  discardable: number[]
  onDiscard: (handIndex: number) => void
  onDone?: () => void
}) {
  const offered = new Set(discardable)
  const hand = state.players[choice.target].hand
  const prompt = hand.length === 0
    ? "Opponent's hand is empty"
    : choice.mayDiscard ? "Opponent's hand: you may discard one" : "Opponent's hand"
  return (
    <CardGridOverlay
      idPrefix="opp-hand"
      prompt={prompt}
      state={state}
      items={hand.map((cardId, i) => !choice.mayDiscard
        ? { cardId, key: i }
        : offered.has(i)
          ? { cardId, key: i, testId: `opp-hand-pick-${i}`, actionLabel: 'Discard', onSelect: () => onDiscard(i) }
          : { cardId, key: i, dimmed: true })}
      buttons={onDone && [{ label: 'Done', testId: 'opp-hand-done', onClick: onDone }]}
    />
  )
}

/**
 * "Look at the top card of each player's deck" overlay (Grand Admiral Thrawn): each card face-up
 * and captioned with whose deck it tops, in the order the look lists them. View-only and raised every round, so
 * Done and a click beside the cards both answer it. A thin wrapper over `CardGridOverlay`.
 */
export function DeckTopsOverlay({ state, prompt, tops, onDone }: {
  state: GameState
  prompt: string
  tops: Extract<PendingChoice, { kind: 'lookAtDeckTops' }>['tops']
  onDone: () => void
}) {
  return (
    <CardGridOverlay
      idPrefix="deck-tops"
      prompt={prompt}
      state={state}
      items={tops.map(({ deck, cardId }) => ({
        cardId, key: deck, caption: deck === 'player' ? 'Your deck' : "Opponent's deck", captionTestId: `deck-tops-caption-${deck}`,
      }))}
      buttons={[{ label: 'Done', testId: 'deck-tops-done', onClick: onDone, primary: true }]}
    />
  )
}

/**
 * A base that can be clicked: attacked, picked by a choice, or chosen as an upgrade host. `intent` is
 * what picking it does, which colours the highlight; absent for an attack (red).
 */
interface BaseTarget {
  onClick: () => void
  intent?: TargetIntent
}

/** A base card in the central strip, with an HP overlay; clickable when a target. */
function BaseCard({ state, side, target, widthPx, attacked = false, menu }: {
  state: GameState
  side: PlayerId
  target?: BaseTarget
  /** The opponent's action on show is aimed at this base: ringed red. */
  attacked?: boolean
  /** A phone opens the base's actions as a menu from the base: ringed blue while one can be taken. */
  menu?: { open: boolean; actionable: boolean; onOpen: () => void }
  /** The card's short edge, framed tight to the card; the board's default square slot when absent. */
  widthPx?: number
}) {
  const p = state.players[side]
  const baseCard = state.cards[p.base.cardId]
  const { zoomed, bind, anchorRef, setAnchor } = useCardZoom({ cardId: p.base.cardId })
  const { settings } = useSettings()
  // Base HP comes from the card metadata (bases vary; never assume 30).
  const baseHp = baseCard?.hp ?? 0
  // Damage taken, counting up to the base's HP, is the SWU-standard display and the default.
  // Clamped either way: an overkill must read as a full base rather than as more damage than
  // the base has HP, or as negative health remaining (#323).
  const damage = Math.min(p.base.damage, baseHp)
  const countDown = settings.baseHealthDisplay === 'remaining'
  const shown = countDown ? baseHp - damage : damage
  const label = countDown ? 'health remaining' : 'damage'
  const inner = (
    <div className="relative">
      <CardFace
        card={baseCard}
        fallbackName={p.base.cardId}
        highlight={target ? intentHighlight(target.intent) : attacked ? 'red' : menu?.open ? 'white' : menu?.actionable ? 'accent' : undefined}
        widthPx={widthPx}
        tight={widthPx !== undefined}
      />
      {/* Damage overlaid on the card, PWA game-screen style: light weight,
          accent glow + dark outline, ~50% of the card's height. Nudged up a
          little since the base art sits low, so the number reads centred on it. */}
      <span
        data-testid={`${side}-base-hp`}
        aria-label={`${side === 'player' ? 'Your' : 'Opponent'} base ${label}: ${shown} of ${baseHp}`}
        className="pointer-events-none absolute inset-0 flex items-center justify-center tabular-nums select-none"
        style={{
          fontSize: `${Math.round((widthPx ?? CARD_WIDTH_PX) * 0.5)}px`,
          fontWeight: 300,
          lineHeight: 1,
          letterSpacing: '0.05em',
          color: 'var(--color-text-primary)',
          textShadow: '0 0 20px rgba(79, 195, 247, 0.4), 0 0 8px rgba(0, 0, 0, 1)',
          transform: 'translateY(-2%)',
        }}
      >
        {shown}
      </span>
      {/* Upgrades on the base (Fortify), named along its foot rather than stacked behind it as a unit's
          are: the base is landscape and sits between both boards, so a stack would run into either one.
          Each name zooms to the card on hover. */}
      {(p.base.upgrades ?? []).length > 0 && (
        <ul data-testid={`${side}-base-upgrades`} className="absolute inset-x-1 bottom-1 flex flex-wrap justify-center gap-1 text-[10px] leading-tight">
          {p.base.upgrades!.map((up, i) => (
            <li key={`${up.cardId}-${i}`} className="rounded bg-surface-solid/85 px-1">
              <CardRef state={state} cardId={up.cardId} controller={side} text={state.cards[up.cardId]?.name ?? up.cardId} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
  return (
    <div ref={setAnchor} data-testid={`${side}-base-card`} {...bind} className="relative">
      {target ? (
        <button
          data-testid={`target-${side}-base`}
          onClick={target.onClick}
          className="block cursor-pointer"
        >
          {inner}
        </button>
      ) : menu ? (
        <button
          type="button"
          data-testid={`${side}-base-menu-btn`}
          aria-label={`${baseCard?.name ?? p.base.cardId}: open its actions`}
          aria-expanded={menu.open}
          onClick={menu.onOpen}
          className="block cursor-pointer border-none bg-transparent p-0"
        >
          {inner}
        </button>
      ) : (
        inner
      )}
      {zoomed && <CardZoomPopover card={baseCard} fallbackName={p.base.cardId} anchorRef={anchorRef} />}
    </div>
  )
}

/** A leader in the centre strip: its card while undeployed, an empty slot saying Deployed once it is a
 *  unit. `widthPx` is the card's short edge. */
export function LeaderCard({ state, side, widthPx = CARD_WIDTH_PX, interact, labelDeployed = false }: {
  state: GameState
  side: PlayerId
  widthPx?: number
  interact?: UnitInteraction
  /** Say Deployed in the empty slot: the leader's unit is too small to tell at a glance. */
  labelDeployed?: boolean
}) {
  const p = state.players[side]
  const leaderCard = state.cards[p.leader.cardId]
  const { zoomed, bind, anchorRef, setAnchor } = useCardZoom({ cardId: p.leader.cardId })
  // Deployed → the leader is on the battlefield as a unit; the slot is an empty
  // outline (whether it's deployed is self-evident). Keep it for alignment.
  if (p.leader.deployed) {
    return (
      <div data-testid={`${side}-leader-card`} className="relative w-fit">
        <div style={{ width: longEdge(widthPx), height: widthPx, borderRadius: cardRadius(widthPx) }} className="border border-line/50" />
        {labelDeployed && <span className="absolute inset-0 flex items-center justify-center text-[10px] uppercase tracking-wider text-ink-dim">Deployed</span>}
      </div>
    )
  }
  // Deployed once and defeated (its epic action is spent) — it can't redeploy.
  const defeated = p.leader.epicActionUsed
  // An undeployed leader with an available activated ability is clickable.
  const clickable = Boolean(interact?.onClick)
  const highlight = interact?.selected ? 'accent' : interact?.actionable ? 'accent-dim' : undefined
  return (
    <div
      ref={setAnchor}
      data-testid={`${side}-leader-card`}
      {...bind}
      data-actionable={interact?.actionable}
      data-selected={interact?.selected}
      onClick={clickable ? interact!.onClick : undefined}
      className={`relative w-fit ${clickable ? 'cursor-pointer' : ''}`}
    >
      <CardFace card={leaderCard} fallbackName={p.leader.cardId} exhausted={p.leader.exhausted} widthPx={widthPx} highlight={highlight} />
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
      {/* Shift while hovering shows the leader's unit (back) side. */}
      {zoomed && <CardZoomPopover card={leaderCard} deployed={false} fallbackName={p.leader.cardId} anchorRef={anchorRef} />}
    </div>
  )
}

/**
 * A card in your hand. Clickable to play (blue) or resource (green); hover /
 * focus / long-press zooms it. Its own component so it can use the zoom hook.
 */
function HandCard({ card, cardId, index, action, onAct, onSelect, selected, discarding, widthPx, isNew = false }: {
  card: EngineCard | undefined
  /** The card's short edge; the board's default when absent. */
  widthPx?: number
  cardId: string
  index: number
  action: Action | undefined
  onAct: (action: Action) => void
  /** Set for an upgrade card: click selects it, then you click a unit to attach. */
  onSelect?: () => void
  selected?: boolean
  /** A pending "discard a card" choice: clicking discards this card — highlight it red. */
  discarding?: boolean
  /** Just drawn at the regroup: tagged NEW. */
  isNew?: boolean
}) {
  const { zoomed, bind, anchorRef, setAnchor } = useCardZoom({ cardId })
  const isResource = action?.type === 'resourceCard' || action?.type === 'setupResource'
  const playHighlight = discarding ? 'red' : isResource ? 'green' : 'accent'
  const popover = (
    <>
      {isNew && <span data-testid="hand-card-new" className="pointer-events-none absolute left-1/2 top-0.5 z-10 -translate-x-1/2 rounded-md bg-accent px-1 text-[8px] font-bold leading-3 text-black">NEW</span>}
      {zoomed && <CardZoomPopover card={card} fallbackName={cardId} anchorRef={anchorRef} />}
    </>
  )
  if (action) {
    // Clickable shortcut for the matching action-menu button:
    // "Play …" (action phase) or "Resource …" (setup/regroup).
    return (
      <button
        ref={setAnchor}
        data-testid={`hand-card-${index}`}
        data-playable={true}
        onClick={() => onAct(action)}
        {...bind}
        className="relative block w-fit shrink-0 cursor-pointer"
      >
        <CardFace card={card} fallbackName={cardId} tight highlight={playHighlight} widthPx={widthPx} />
        {popover}
      </button>
    )
  }
  if (onSelect) {
    // An upgrade: clicking selects it (bright when selected), then a unit is clicked
    // to attach it. Highlighted blue like a playable card.
    return (
      <button
        ref={setAnchor}
        data-testid={`hand-card-${index}`}
        data-playable={true}
        data-selected={Boolean(selected)}
        onClick={onSelect}
        {...bind}
        className="relative block w-fit shrink-0 cursor-pointer"
      >
        <CardFace card={card} fallbackName={cardId} tight highlight={selected ? 'accent' : 'accent-dim'} widthPx={widthPx} />
        {popover}
      </button>
    )
  }
  return (
    <span
      ref={setAnchor}
      data-testid={`hand-card-${index}`}
      data-playable={false}
      {...bind}
      className="relative block w-fit shrink-0"
    >
      {/* Dim the card (unplayable), but not the zoom popover — the opacity must
          stay off the wrapper or it'd dim and trap the popover above. */}
      <CardFace card={card} fallbackName={cardId} tight className="opacity-60" widthPx={widthPx} />
      {popover}
    </span>
  )
}

/** Cards resourced during setup, before the first round (CR 5.2.1f). */
const SETUP_RESOURCES = 2

/**
 * Prompts for the steps that aren't resolved by clicking the board.
 *
 * Resourcing asks the player to click a hand card, which looks exactly like playing one, so
 * both resourcing steps say which it is — setup counts the picks off (two are required),
 * regroup's single pick is optional so it names the way out. The mulligan is resolved from the
 * Action buttons entirely, and points there: without it a new player clicks at their hand and
 * gets no response, with nothing on screen explaining why.
 *
 * Returns nothing outside those steps, or while the opponent is to act.
 */
function setupPrompt(state: GameState): DescribePart[] | undefined {
  if (state.activePlayer !== 'player' || state.winner !== null) return undefined
  // The bot's offer to concede a certain loss: answered from the Action column like the mulligan.
  if (state.concessionOffer === 'opponent') {
    return ['Your opponent offers to concede: accept, or play it out, in the Action column']
  }
  if (state.phase === 'setup' && state.setupStage === 'mulligan') {
    return ['Mulligan or keep your opening hand, choose in the Action column']
  }
  if (state.phase === 'setup' && state.setupStage === 'resource') {
    return [`Choose a card to resource: ${state.players.player.resources.length} of ${SETUP_RESOURCES}`]
  }
  if (state.phase === 'regroup' && !state.regroupResourced.player) {
    return ['Choose a card to resource, or skip']
  }
  return undefined
}

export default function GameScreen({ deck, opponentDeck, onExit, onHelp, gameOptions }: Props) {
  const { settings } = useSettings()
  // The opponent's pace is the player's setting; `gameOptions` (tests) may pin one of its own.
  const { status, errorDetail, loadProgress, gameState, legal, log, act, undo, canUndo, cancelChoice, rematch, replayData, unresolvedPrintings, opponentAction, regroupDrawn } = useGame(deck, opponentDeck, { opponentDelayMs: settings.opponentDelayMs, ...gameOptions })
  // Board affordance: click an actionable friendly unit to select it,
  // then click a highlighted target to attack. Any action clears the selection.
  const [selectedAttacker, setSelectedAttacker] = useState<string | null>(null)
  // Placing an upgrade: click an upgrade card in hand (its hand index is
  // held here) to highlight valid target units, then click a unit to attach it.
  const [selectedUpgrade, setSelectedUpgrade] = useState<number | null>(null)
  // Using an undeployed leader's activated ability: click the leader to select
  // it, then click a highlighted target unit.
  const [leaderSelected, setLeaderSelected] = useState(false)
  // Defeating an upgrade is picked in two steps: click the unit carrying it on the board (so it is
  // obvious where it sits and who controls it), then choose which of its upgrades in the overlay.
  // This holds the unit chosen in step one; null means we are still on step one.
  const [upgradeHost, setUpgradeHost] = useState<string | null>(null)
  // Bug report (#373): `reporting` opens the form; `fallbackReport` holds the assembled text when
  // the clipboard refused it, so the report is shown to copy by hand rather than lost.
  const [reporting, setReporting] = useState(false)
  const [fallbackReport, setFallbackReport] = useState<string | undefined>(undefined)
  // Settings: a sheet over the board, not a screen. Routing away would unmount this component and
  // the game with it.
  const [settingsOpen, setSettingsOpen] = useState(false)
  // A button choice put aside to read the board (only where it cannot be cancelled): the id of the
  // choice whose overlay is hidden. Any action clears it, so the next choice always shows.
  const [hiddenChoice, setHiddenChoice] = useState<string | null>(null)
  // One layout: a phone on its side, with its log, More and piles opened from the controls column,
  // and the desktop, the same grown with the log docked. Held upright, a phone is asked to turn.
  const scale: BoardScale = useMediaQuery(PHONE_LANDSCAPE_QUERY) ? 'phone' : 'desktop'
  const sizes = BOARD_SCALE[scale]
  const upright = useMediaQuery(PHONE_PORTRAIT_QUERY)
  const [logOpen, setLogOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [pile, setPile] = useState<{ title: string; cards: string[] } | null>(null)
  // A held card, or a name touched in the log, opens full size until closed.
  const [inspecting, setInspecting] = useState<InspectTarget | null>(null)
  // Your leader's actions open as a menu from the leader.
  const [leaderMenuOpen, setLeaderMenuOpen] = useState(false)
  // And your base's: its Epic Action and any action an upgrade on it gives.
  const [baseMenuOpen, setBaseMenuOpen] = useState(false)
  // The notice naming cards that play with printed stats only, once put away, stays away this game.
  const [noticeDismissed, setNoticeDismissed] = useState(false)

  async function submitReport(title: string, description: string) {
    const { initialState, moves } = replayData()
    const markdown = buildReportMarkdown({ description, release: RELEASE, commitId: COMMIT_ID, isDev: isDev(), log, initialState, moves, unresolvedPrintings })
    try {
      await navigator.clipboard.writeText(markdown)
    } catch {
      // Keep the form open with the text in reach; opening GitHub now would mean a half-filed
      // issue with nothing to paste into it.
      setFallbackReport(markdown)
      return
    }
    window.open(issueUrl(title), '_blank', 'noopener')
    setReporting(false)
    setFallbackReport(undefined)
  }

  function clearSelections() {
    setSelectedAttacker(null)
    setSelectedUpgrade(null)
    setLeaderSelected(false)
    setUpgradeHost(null)
    setHiddenChoice(null)
  }

  // Dismissing an overlay on the player's own trigger takes back the action that raised it.
  const cancel = cancelChoice ? () => { clearSelections(); cancelChoice() } : undefined

  function actAndClear(action: Action) {
    clearSelections()
    act(action)
  }

  // Until the board is dealt the whole screen is the game starting, or why it could not; the way
  // back to setup is in its corner. After that the play area is the live board.
  let edgeScreen: ReactNode = null
  let playContent: ReactNode = null
  // A "look at a card" overlay (Camtono): shown centre-screen while the human
  // resolves a mayPlayTopFree choice. Rendered over everything in the main return.
  let choiceOverlay: ReactNode = null
  if (status === 'loading') {
    edgeScreen = <GameLoading title={`${deck.name} against ${opponentDeck.name}`} progress={loadProgress} onExit={onExit} />
  } else if (status === 'error' || !gameState) {
    edgeScreen = <GameLoadError deckName={deck.name} detail={errorDetail} offline={!navigator.onLine} onRetry={rematch} onExit={onExit} />
  } else {
    // What clicking each hand card does, keyed by hand index: play it in the action
    // phase, resource it in the setup or regroup phase (#6). Derived from the
    // legal moves so the hand affordance always matches what the engine allows.
    // A "look at an opponent's hand" discard also uses acceptChoice+handIndex, but its
    // indices are into the OPPONENT's hand (shown in an overlay) — keep them off our own hand.
    const oppHandChoiceId = gameState.pendingChoices?.find(c => c.kind === 'lookAtHand' && c.controller === 'player')?.id
    const handAction = new Map<number, Action>()
    for (const a of legal) {
      // A Fortify upgrade has one place to go, its player's base, so clicking it plays it as a unit is played.
      if (a.type === 'playUnit' || a.type === 'playEvent' || a.type === 'playBaseUpgrade' || a.type === 'resourceCard' || a.type === 'setupResource') handAction.set(a.handIndex, a)
      // "Play a unit from hand" ability choice: the affordable hand cards become clickable.
      else if (a.type === 'acceptChoice' && a.handIndex !== undefined && a.choiceId !== oppHandChoiceId) handAction.set(a.handIndex, a)
    }
    const hand = gameState.players.player.hand

    // A "discard a card from hand" choice (Mos Espa Watermonger): the hand cards
    // glow red and clicking one discards it; an optional discard also offers a Decline.
    const discardChoice = gameState.pendingChoices?.find(
      (c): c is Extract<PendingChoice, { kind: 'selectDiscard' }> => c.kind === 'selectDiscard' && c.controller === 'player',
    )
    const discardDecline = discardChoice ? legal.find(a => a.type === 'skipTrigger' && a.choiceId === discardChoice.id) : undefined

    // An optional "play a unit from hand" (Crix Madine): the candidate cards are clickable in
    // hand; a Decline button lets the player pass on the "may".
    const handPlayChoice = gameState.pendingChoices?.find(
      (c): c is Extract<PendingChoice, { kind: 'playUnitFromHand' }> => c.kind === 'playUnitFromHand' && c.controller === 'player' && c.optional === true,
    )
    const handPlayDecline = handPlayChoice ? legal.find(a => a.type === 'skipTrigger' && a.choiceId === handPlayChoice.id) : undefined

    const attacks = legal.filter(a => a.type === 'attack')
    const attackerIds = new Set(attacks.map(a => a.attackerId))
    const selectedAttacks = selectedAttacker ? attacks.filter(a => a.attackerId === selectedAttacker) : []
    const targetUnitIds = new Set(
      selectedAttacks.flatMap(a => (a.target.kind === 'unit' ? [a.target.instanceId] : [])),
    )
    const baseAttack = selectedAttacks.find(a => a.target.kind === 'base')

    // Placing an upgrade: which hand cards are upgrades, and — once one is
    // selected — which units it may attach to. While placing, unit clicks attach
    // the upgrade rather than driving an attack.
    // A Pilot played as an upgrade is a menu button instead: clicking the card plays it as a unit.
    const upgradeMoves = legal.filter((a): a is Extract<Action, { type: 'playUpgrade' }> => a.type === 'playUpgrade' && !a.piloting)
    const upgradeHandIndices = new Set(upgradeMoves.map(a => a.handIndex))
    const upgradeTargetIds = new Set(
      selectedUpgrade !== null ? upgradeMoves.filter(a => a.handIndex === selectedUpgrade).map(a => a.targetInstanceId) : [],
    )
    const placing = selectedUpgrade !== null

    // Undeployed-leader activated abilities: click the leader to use a target-less
    // one, or to highlight its target units and then click one.
    const leaderAbilityMoves = legal.filter((a): a is Extract<Action, { type: 'useLeaderAbility' }> => a.type === 'useLeaderAbility')
    const leaderTargetIds = new Map<string, Action>()
    if (leaderSelected) for (const a of leaderAbilityMoves) if (a.targetInstanceId) leaderTargetIds.set(a.targetInstanceId, a)
    // The leader opens its menu: each action, deploying, and the card.
    const deployMoves = legal.filter((a): a is Extract<Action, { type: 'deployLeader' }> => a.type === 'deployLeader')
    const takeLeaderAbility = (index: number) => {
      const moves = leaderAbilityMoves.filter(a => a.index === index)
      const targetless = moves.find(a => a.targetInstanceId === undefined)
      if (targetless) { actAndClear(targetless); return }
      setSelectedAttacker(null)
      setSelectedUpgrade(null)
      setLeaderSelected(true)
    }
    const playerLeader = gameState.players.player.leader
    const leaderMenuItems: LeaderMenuItem[] = [
      ...leaderActions(playerLeader.cardId).map((def, index) => ({
        label: 'Use action',
        detail: leaderAbilityMoves.some(a => a.index === index) ? def.description : playerLeader.exhausted ? 'Your leader is exhausted' : def.description,
        onSelect: leaderAbilityMoves.some(a => a.index === index) ? () => takeLeaderAbility(index) : undefined,
      })),
      ...(deployMoves.length > 0
        ? deployMoves.map(a => ({ label: describeAction(gameState, 'player', a), onSelect: () => actAndClear(a) }))
        : [{ label: 'Deploy', detail: deployBlocker(gameState) }]),
    ]
    // Your base's actions are a menu on the base, as the leader's are.
    const baseMoves = legal.filter((a): a is Extract<Action, { type: 'useBaseAbility' }> => a.type === 'useBaseAbility')
    const playerBase = gameState.players.player.base
    const epic = baseEpicAction(playerBase.cardId)
    const epicMove = baseMoves.find(a => a.cardId === undefined)
    const baseMenuItems: LeaderMenuItem[] = [
      ...(epic
        ? [{
            label: 'Use Epic Action',
            detail: playerBase.epicActionUsed ? 'Used this game' : `${epic.description} Once a game.`,
            onSelect: epicMove ? () => actAndClear(epicMove) : undefined,
          }]
        : []),
      ...baseMoves.filter(a => a.cardId !== undefined).map(a => ({ label: describeAction(gameState, 'player', a), onSelect: () => actAndClear(a) })),
    ]
    const leaderInteract: UnitInteraction = {
      actionable: leaderAbilityMoves.length > 0 || deployMoves.length > 0,
      selected: leaderSelected || leaderMenuOpen,
      isTarget: false,
      onClick: () => (leaderSelected ? setLeaderSelected(false) : setLeaderMenuOpen(true)),
    }

    // Optional targeted pending choices — resolved by clicking a highlighted
    // board unit plus a Decline button, rather than one menu button per target.
    // Greater Sarlacc's step picks facedown resources, which are not on the board, so it is answered
    // from the menu, one button per resource, like any other card pick.
    // Vernestra Rwoh's step picks cards in the discard pile, also not on the board: it gets the same
    // card picker as any other "choose a card in a pile", below.
    // A Credit token is the player's rather than a unit's, so paying with one is a button too. The
    // paying step is answered on the board only while a unit that pays as a resource is on offer;
    // its Credit token button stays in the action column beside it (see `choiceBoardActions`).
    const paysOnBoard = (c: PendingChoice) => legal.some(a => a.type === 'acceptChoice' && a.choiceId === c.id && a.targetInstanceId !== undefined)
    const targetChoice = gameState.pendingChoices?.find(c => c.controller === 'player' && (BOARD_TARGET_KINDS as readonly string[]).includes(c.kind) && !(c.kind === 'exploit' && (c.resources || c.fromDiscard || c.credit)) && !(c.kind === 'payWith' && !paysOnBoard(c)))
    const choiceTargetIds = new Map<string, Action>()
    // Base targets (selectDamageTarget): pick a player's base to take the damage.
    const baseTargetActions = new Map<PlayerId, Action>()
    if (targetChoice) for (const a of legal) if (a.type === 'acceptChoice' && a.choiceId === targetChoice.id) {
      if (a.targetInstanceId) choiceTargetIds.set(a.targetInstanceId, a)
      else if (a.baseTarget) baseTargetActions.set(a.baseTarget, a)
    }
    const declineChoice = targetChoice ? legal.find(a => a.type === 'skipTrigger' && a.choiceId === targetChoice.id) : undefined
    const boardTargetAction = (instanceId: string): Action | undefined => leaderTargetIds.get(instanceId) ?? choiceTargetIds.get(instanceId)
    /** What a board target's action does to it, for the highlight colour: the leader ability's or the choice's intent. */
    const boardTargetIntent = (action: Action): TargetIntent | undefined =>
      action.type === 'useLeaderAbility' ? leaderActions(gameState.players.player.leader.cardId)[action.index]?.intent : targetChoice?.intent

    /**
     * What the board highlights are asking for (#370). Two sources: a pending choice raised by
     * a trigger — the case that most needs explaining, since the opponent's card may have
     * caused it — and placing an upgrade, which is local UI state rather than a choice.
     *
     * Deliberately silent for the base actions (playing a card, picking an attacker): those are
     * self-evident, and a permanent prompt would train the player to ignore the panel.
     */
    const actionPrompt: DescribePart[] | undefined = targetChoice
      ? describeChoiceParts(gameState, targetChoice)
      : placing
        ? ['Choose a unit to attach ', handCardRef(gameState, 'player', selectedUpgrade) ?? 'this upgrade', ' to']
        : setupPrompt(gameState)

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

    // A unit that is a target of the selected leader ability or an active choice.
    const asBoardTarget = (instanceId: string): UnitInteraction | null => {
      const action = boardTargetAction(instanceId)
      return action ? { actionable: false, selected: false, isTarget: true, intent: boardTargetIntent(action), onClick: () => actAndClear(action) } : null
    }

    /**
     * Step one of defeating an upgrade: the units carrying candidates highlight, and clicking one
     * opens the picker on it. Selecting here changes UI state only — no action is taken until an
     * upgrade is chosen, so a misclick costs nothing.
     */
    const asUpgradeHost = (instanceId: string): UnitInteraction | null =>
      pickedHost === null && upgradeHosts.includes(instanceId)
        ? { actionable: false, selected: false, isTarget: true, onClick: () => setUpgradeHost(instanceId) }
        : null

    const playerInteractionBase = (unit: { instanceId: string }): UnitInteraction =>
      upgradeInteraction(unit.instanceId) ?? asUpgradeHost(unit.instanceId) ?? asBoardTarget(unit.instanceId) ?? {
        actionable: attackerIds.has(unit.instanceId),
        selected: selectedAttacker === unit.instanceId,
        isTarget: false,
        onClick: attackerIds.has(unit.instanceId)
          ? () => { setSelectedUpgrade(null); setLeaderSelected(false); setSelectedAttacker(prev => (prev === unit.instanceId ? null : unit.instanceId)) }
          : undefined,
      }

    const opponentInteractionBase = (unit: { instanceId: string }): UnitInteraction =>
      upgradeInteraction(unit.instanceId) ?? asUpgradeHost(unit.instanceId) ?? asBoardTarget(unit.instanceId) ?? {
        actionable: false,
        selected: false,
        isTarget: targetUnitIds.has(unit.instanceId),
        onClick: targetUnitIds.has(unit.instanceId)
          ? () => actAndClear({ type: 'attack', attackerId: selectedAttacker!, target: { kind: 'unit', instanceId: unit.instanceId } })
          : undefined,
      }

    // The opponent's action, while it is on show, rings the unit acting and its target.
    const focus: ReturnType<typeof actionFocus> = opponentAction ? actionFocus(opponentAction) : {}
    const withActing = (interact: UnitInteraction, instanceId: string): UnitInteraction =>
      instanceId === focus.actorId ? { ...interact, acting: 'actor' } : instanceId === focus.targetId ? { ...interact, acting: 'target' } : interact
    const playerInteraction = (unit: { instanceId: string }) => withActing(playerInteractionBase(unit), unit.instanceId)
    const opponentInteraction = (unit: { instanceId: string }) => withActing(opponentInteractionBase(unit), unit.instanceId)

    // Regroup: the cards just drawn, on the end of the hand, are tagged NEW until you resource.
    const newFrom = gameState.phase === 'regroup' && !gameState.regroupResourced.player ? hand.length - regroupDrawn : hand.length

    // The hand is one row under the board, fanned (overlapping) once it is too long for it.
    const fan = handOverlap(hand.length, scale)
    const playerHand = (
      <ul
        data-testid="player-hand"
        data-fanned={fan > 0}
        className="flex flex-none items-end justify-center gap-1.5"
        style={{ height: sizes.handRow }}
      >
        {hand.map((cardId, i) => (
          <li key={`${cardId}-${i}`} style={fan > 0 && i > 0 ? { marginLeft: -fan } : undefined}>
            <HandCard
              widthPx={sizes.handCard}
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
              discarding={discardChoice !== undefined}
              isNew={i >= newFrom}
            />
          </li>
        ))}
      </ul>
    )

    // "Who resolves first" (CR 7.6.10) gates every other choice, so it is selected first and rendered
    // ahead of everything in the overlay chain below.
    const orderChoice = gameState.pendingChoices?.find(
      (c): c is Extract<PendingChoice, { kind: 'chooseTriggerOrder' }> =>
        c.kind === 'chooseTriggerOrder' && c.controller === 'player',
    )
    // Read off the trigger queue: abilities are what the rules order, and most raise no choice at all.
    const waiting = (side: PlayerId) =>
      (gameState.pendingTriggers ?? []).filter(t => t.controller === side)

    // "Which of mine resolves next" (CR 7.6.9) gates the queue in the same way.
    const nextTriggerChoice = gameState.pendingChoices?.find(
      (c): c is Extract<PendingChoice, { kind: 'chooseNextTrigger' }> =>
        c.kind === 'chooseNextTrigger' && c.controller === 'player',
    )

    // A "look at the top card" choice (Camtono): its accept/decline moves are
    // shown inside the centre-screen overlay next to the card, not in the action menu.
    const lookChoice = gameState.pendingChoices?.find(
      (c): c is Extract<PendingChoice, { kind: 'mayPlayTopFree' }> => c.kind === 'mayPlayTopFree' && c.controller === 'player',
    )
    const lookActions = lookChoice
      ? legal.filter(a => (a.type === 'acceptChoice' || a.type === 'skipTrigger') && a.choiceId === lookChoice.id)
      : []

    // A "may discard the revealed top card" choice (Reanimated Night Trooper, stage 2, #388):
    // having chosen which deck to look at, its top card is shown in the same centre-screen
    // overlay, with Discard/Leave underneath — not the action menu.
    const discardTopChoice = gameState.pendingChoices?.find(
      (c): c is Extract<PendingChoice, { kind: 'mayDiscardTop' }> => c.kind === 'mayDiscardTop' && c.controller === 'player',
    )
    const discardTopActions = discardTopChoice
      ? legal.filter(a => (a.type === 'acceptChoice' || a.type === 'skipTrigger') && a.choiceId === discardTopChoice.id)
      : []

    // A "search" reveal (Improvised Identity): its discard picks live in the
    // centre-screen overlay, not the action menu.
    const searchChoice = gameState.pendingChoices?.find(
      (c): c is Extract<PendingChoice, { kind: 'search' }> => c.kind === 'search' && c.controller === 'player',
    )
    // Both the picks and, when nothing is pickable (#413), the acknowledge that dismisses the reveal.
    const searchActions = searchChoice ? legal.filter(a => (a.type === 'acceptChoice' || a.type === 'skipTrigger') && a.choiceId === searchChoice.id) : []

    // A "look at an opponent's hand" choice (Imperial Defector / Remnant Lookouts): its
    // discard picks + Done live in the reveal overlay, not the action menu.
    const lookHandChoice = gameState.pendingChoices?.find(
      (c): c is Extract<PendingChoice, { kind: 'lookAtHand' }> => c.kind === 'lookAtHand' && c.controller === 'player',
    )
    const lookHandActions = lookHandChoice ? legal.filter(a => (a.type === 'acceptChoice' || a.type === 'skipTrigger') && a.choiceId === lookHandChoice.id) : []

    // A "look at the top card of each deck" choice (Grand Admiral Thrawn): view-only, so its Done
    // lives in the overlay that shows the cards. Only the player's own look is ever found here.
    const deckTopsChoice = gameState.pendingChoices?.find(
      (c): c is Extract<PendingChoice, { kind: 'lookAtDeckTops' }> => c.kind === 'lookAtDeckTops' && c.controller === 'player',
    )
    const deckTopsActions = deckTopsChoice ? legal.filter(a => a.type === 'skipTrigger' && a.choiceId === deckTopsChoice.id) : []

    // A "search top N, draw a trait match" choice (Clan Wren Loyalist): draw picks in the overlay.
    const searchDrawChoice = gameState.pendingChoices?.find(
      (c): c is Extract<PendingChoice, { kind: 'searchDraw' }> => c.kind === 'searchDraw' && c.controller === 'player',
    )
    const searchDrawActions = searchDrawChoice ? legal.filter(a => (a.type === 'acceptChoice' || a.type === 'skipTrigger') && a.choiceId === searchDrawChoice.id) : []

    // A "search & play for free" choice (Admiral Ackbar, Eye of Sion): picks + Done in the overlay.
    const searchFreeChoice = gameState.pendingChoices?.find(
      (c): c is Extract<PendingChoice, { kind: 'searchPlayFree' }> => c.kind === 'searchPlayFree' && c.controller === 'player',
    )
    const searchFreeActions = searchFreeChoice ? legal.filter(a => (a.type === 'acceptChoice' || a.type === 'skipTrigger') && a.choiceId === searchFreeChoice.id) : []

    // A "search for an upgrade to attach" choice (Reforge): picks + Done in the overlay. Which
    // cards are actually playable comes from the legal moves, since an eligible upgrade can still
    // be unaffordable after the discount.
    const searchUpgradeChoice = gameState.pendingChoices?.find(
      (c): c is Extract<PendingChoice, { kind: 'searchPlayUpgrade' }> => c.kind === 'searchPlayUpgrade' && c.controller === 'player',
    )
    const searchUpgradeActions = searchUpgradeChoice ? legal.filter(a => (a.type === 'acceptChoice' || a.type === 'skipTrigger') && a.choiceId === searchUpgradeChoice.id) : []

    // A "name a card" choice (Ryder Azadi): resolved in a text-input overlay, not the menu.
    const nameCardChoice = gameState.pendingChoices?.find(
      (c): c is Extract<PendingChoice, { kind: 'nameCard' }> => c.kind === 'nameCard' && c.controller === 'player',
    )
    const nameCardActions = nameCardChoice ? legal.filter(a => a.type === 'acceptChoice' && a.choiceId === nameCardChoice.id) : []

    // A "name a Trait" choice (The First Legion): the same overlay over the Trait list.
    const nameTraitChoice = gameState.pendingChoices?.find(
      (c): c is Extract<PendingChoice, { kind: 'nameTrait' }> => c.kind === 'nameTrait' && c.controller === 'player',
    )
    const nameTraitActions = nameTraitChoice ? legal.filter(a => a.type === 'acceptChoice' && a.choiceId === nameTraitChoice.id) : []

    // A "select an upgrade to defeat" choice (Vane) and the unique-copy version. Both are picked
    // in two steps: highlight the units carrying candidates on the board, then show that unit's
    // upgrades in the card picker. Neither goes in the action menu.
    const selectUpgradeChoice = gameState.pendingChoices?.find(
      (c): c is Extract<PendingChoice, { kind: 'selectUpgradeToDefeat' }> => c.kind === 'selectUpgradeToDefeat' && c.controller === 'player',
    )
    const selectUpgradeActions = selectUpgradeChoice
      ? legal.filter(a => (a.type === 'acceptChoice' || a.type === 'skipTrigger') && a.choiceId === selectUpgradeChoice.id)
      : []

    // A "return a card from your discard" choice (Moff Gideon): a centre-screen card picker.
    const fromDiscardChoice = gameState.pendingChoices?.find(
      (c): c is Extract<PendingChoice, { kind: 'selectFromDiscard' }> => c.kind === 'selectFromDiscard' && c.controller === 'player',
    )
    const fromDiscardActions = fromDiscardChoice
      ? legal.filter(a => (a.type === 'acceptChoice' || a.type === 'skipTrigger') && a.choiceId === fromDiscardChoice.id)
      : []

    // Vernestra Rwoh's additional cost: the same picker over the discard pile, one pick at a time,
    // with Done as its cancel. The offered indices come from the legal moves, so the cost rule and
    // the picks already made are stated in one place.
    const bottomFromDiscardChoice = gameState.pendingChoices?.find(
      (c): c is Extract<PendingChoice, { kind: 'exploit' }> => c.kind === 'exploit' && !!c.fromDiscard && c.controller === 'player',
    )
    const bottomFromDiscardActions = bottomFromDiscardChoice
      ? legal.filter(a => (a.type === 'acceptChoice' || a.type === 'skipTrigger') && a.choiceId === bottomFromDiscardChoice.id)
      : []

    // Playing a card out of a zone (The Armorer, Osha, a Smuggle): a card picker over that zone,
    // playable cards selectable and the rest revealed but dimmed. In the overlay, not the menu.
    const playFromChoice = gameState.pendingChoices?.find(
      (c): c is Extract<PendingChoice, { kind: 'playCardFrom' }> => c.kind === 'playCardFrom' && c.controller === 'player',
    )
    const playFromActions = playFromChoice
      ? legal.filter(a => (a.type === 'acceptChoice' || a.type === 'skipTrigger') && a.choiceId === playFromChoice.id)
      : []

    // Unique rule: pick which duplicate upgrade to defeat (mandatory) — a centre-screen picker.
    const uniqueChoice = gameState.pendingChoices?.find(
      (c): c is Extract<PendingChoice, { kind: 'selectUniqueToDefeat' }> => c.kind === 'selectUniqueToDefeat' && c.controller === 'player',
    )
    const uniqueActions = uniqueChoice ? legal.filter(a => a.type === 'acceptChoice' && a.choiceId === uniqueChoice.id) : []

    // Whichever upgrade-defeat choice is live drives the same two-step picker. Step one highlights
    // the hosts on the board; step two opens the picker on the chosen host. A host that has left
    // play (defeated mid-choice) drops us back to step one rather than opening an empty picker.
    /**
     * Any choice waiting on the player, board-target or not. Menu-driven choices (the arena to
     * mine, which mode to take) had no prompt at all, leaving a row of buttons with nothing
     * explaining what was being asked (#379/#380). Suppressed when an overlay is showing, since
     * those carry their own prompt.
     */
    const anyPlayerChoice = gameState.pendingChoices?.find(c => c.controller === 'player')

    const upgradePick = selectUpgradeChoice ?? uniqueChoice
    const upgradeHosts = upgradePick ? upgradeHostIds(upgradePick.candidates) : []
    const pickedHost = upgradeHost !== null && upgradeHosts.includes(upgradeHost) ? upgradeHost : null

    // Playing, resourcing, attacking and attaching upgrades are all driven by
    // clicking a card or unit, so the menu holds only the remaining choices —
    // mulligan, keep hand, take the initiative, pass (and skip/deploy).
    // Leader abilities are driven from the leader card; a board-target choice is driven
    // from the board + a single Decline button — neither belongs in the action menu.
    const CLICK_HANDLED: Action['type'][] = ['playUnit', 'playEvent', 'playUpgrade', 'playBaseUpgrade', 'attack', 'resourceCard', 'setupResource', 'useLeaderAbility']
    // A paying step's Credit token is not on the board, so that one answer is left for the menu.
    const creditPick = (a: Action) => targetChoice?.kind === 'payWith' && a.type === 'acceptChoice' && a.targetInstanceId === undefined
    const choiceBoardActions = targetChoice ? legal.filter(a => (a.type === 'acceptChoice' || a.type === 'skipTrigger') && a.choiceId === targetChoice.id && !creditPick(a)) : []
    // "Play a unit from hand" accepts are clicked on the hand card, not the menu.
    const isHandPlay = (a: Action) => a.type === 'acceptChoice' && a.handIndex !== undefined
    const isPilotPlay = (a: Action) => a.type === 'playUpgrade' && a.piloting === true
    const unclaimed = gameState.winner === null
      ? legal.filter(a => (!CLICK_HANDLED.includes(a.type) || isPilotPlay(a)) && !lookActions.includes(a) && !discardTopActions.includes(a) && !searchActions.includes(a) && !lookHandActions.includes(a) && !deckTopsActions.includes(a) && !searchDrawActions.includes(a) && !searchFreeActions.includes(a) && !searchUpgradeActions.includes(a) && !nameCardActions.includes(a) && !nameTraitActions.includes(a) && !fromDiscardActions.includes(a) && !choiceBoardActions.includes(a) && !selectUpgradeActions.includes(a) && !playFromActions.includes(a) && !uniqueActions.includes(a) && !isHandPlay(a) && a !== discardDecline && a !== handPlayDecline)
      : []
    // Whatever choice is left, answered with buttons, goes to the button overlay rather than the
    // action column. Not while the board or the hand is answering another choice: those keep their
    // own affordance in view, and their sibling's buttons stay in the column beside them. A choice
    // answered on the board (Ambush's attack, a unit to pick) is never taken, even when the decline
    // is its only button: see `answeredWithButtons`.
    const answers = (choiceId: string) => (a: Action) => (a.type === 'acceptChoice' || a.type === 'skipTrigger') && a.choiceId === choiceId
    const allAnswers = (choiceId: string) => legal.filter(a => 'choiceId' in a && a.choiceId === choiceId)
    const buttonChoice = !targetChoice && !discardChoice && !handPlayChoice && !upgradePick
      ? gameState.pendingChoices?.find(c => {
          const all = allAnswers(c.id)
          return c.controller === 'player' && all.length > 0 && all.every(a => unclaimed.includes(a)) && answeredWithButtons(all)
        })
      : undefined
    const buttonChoiceActions = buttonChoice ? unclaimed.filter(answers(buttonChoice.id)) : []
    const buttonChoiceHidden = buttonChoice !== undefined && hiddenChoice === buttonChoice.id
    // Deploying is in the leader's menu and the base's actions in the base's, so neither is a button.
    const menuActions = unclaimed.filter(a => !buttonChoiceActions.includes(a) && a.type !== 'deployLeader' && a.type !== 'useBaseAbility')
    // The board-target decline and the hand-discard decline share one button (only one
    // choice is active at a time). "Done" for a repeatable pick (`isRepeatable`), else "Decline".
    // An optional "defeat an upgrade" choice (Clan Vizsla Soldier, Vane's On Attack, #416): the
    // two-step host-then-upgrade picker's own Cancel only steps back to re-pick a host, it never
    // declines the ability, so an optional instance needs its own reachable decline. Shown here
    // (step one, before a host is picked) rather than in the step-two overlay, which is a
    // full-screen modal that would hide this button anyway.
    const upgradeDefeatDecline = selectUpgradeActions.find(a => a.type === 'skipTrigger')
    const declineButton = declineChoice ?? discardDecline ?? handPlayDecline ?? upgradeDefeatDecline
    // Distribute HUD (Ninth Sister damage, Helgait tokens, indirect damage, healing): how much of the
    // pool is allocated.
    const distribute = targetChoice ? allocation(targetChoice) : undefined
    const repeatable = targetChoice !== undefined && isRepeatable(targetChoice)
    // The shared Button, filled and thumb-sized: secondary throughout, the prompt above carrying the
    // next step, and primary only for Show choice, which brings a waiting choice back. Conceding is
    // under More, and choosing an attacker gets its own way back, since tapping the unit again is a
    // small target. Two to a row leaves each button narrow, so they share a tighter padding and
    // line, which keeps a label such as Take the initiative to two lines.
    const fit: CSSProperties = { padding: '0 8px', lineHeight: 1.25 }
    const actionColumn = (
      // Two to a row, where the column is short: a pair such as Take initiative and Pass side by side,
      // and anything left over across the width.
      <div className="flex flex-wrap gap-1.5 *:mt-0 *:min-w-0 *:flex-1 *:basis-[40%]">
        {selectedAttacker && <Button testId="cancel-attack-btn" style={fit} onClick={() => setSelectedAttacker(null)}>Cancel attack</Button>}
        {/* A count across the column, the question itself being in the prompt above. */}
        {distribute && (
          <div data-testid="distribute-hud" role="status" className="flex h-[52px] basis-full items-center justify-center gap-2 rounded-xl bg-surface text-[15px] text-ink-dim">
            <b className="text-xl font-semibold text-ink">{distribute.spent}</b>
            {` of ${distribute.total} ${distribute.label === 'Healing' ? 'healed' : 'placed'}`}
          </div>
        )}
        {declineButton && <Button testId="decline-choice-btn" style={fit} onClick={() => actAndClear(declineButton)}>{repeatable ? 'Done' : 'Decline'}</Button>}
        {buttonChoiceHidden && <Button variant="primary" testId="show-choice-btn" style={fit} onClick={() => setHiddenChoice(null)}>Show choice</Button>}
        {menuActions.map((action, i) => (
          <Button key={i} testId={`action-btn-${i}`} style={fit} onClick={() => actAndClear(action)}>{describeAction(gameState, 'player', action)}</Button>
        ))}
        {declineChoice === undefined && menuActions.length === 0 && legal.length === 0 && gameState.winner === null && (
          <span className="text-center text-xs text-ink-faint">Opponent…</span>
        )}
        {/* Not a game action: it takes back your last one, and the AI's reply with it. Last in
            the column, and absent (not disabled) with nothing to undo, so it never reads as a
            move you could make.
            Off unless the player asks for it: rewinding past a mulligan, a draw or a search lets
            the same decision be taken again with the hidden cards already seen. The mechanism
            still runs, so turning the setting on mid-game takes effect at once. */}
        {settings.allowUndo && canUndo && <Button testId="undo-btn" style={fit} onClick={() => { clearSelections(); undo() }}>Undo</Button>}
      </div>
    )

    if (orderChoice) {
      choiceOverlay = (
        <TriggerOrderOverlay
          state={gameState}
          mine={waiting('player')}
          theirs={waiting('opponent')}
          onPick={optionIndex => actAndClear({ type: 'acceptChoice', choiceId: orderChoice.id, optionIndex })}
          onDismiss={cancel}
        />
      )
    } else if (nextTriggerChoice) {
      choiceOverlay = (
        <NextTriggerOverlay
          state={gameState}
          candidates={nextTriggerChoice.candidates}
          onPick={optionIndex => actAndClear({ type: 'acceptChoice', choiceId: nextTriggerChoice.id, optionIndex })}
          onDismiss={cancel}
        />
      )
    } else if (lookChoice || discardTopChoice) {
      // The top card stands beside its question. A card has been seen, so there is no ×.
      const top = (lookChoice ?? discardTopChoice)!
      const asker = choiceSourceCard(gameState, top)
      const yours = !discardTopChoice || discardTopChoice.deck === 'player'
      choiceOverlay = (
        <PhonePrompt
          testId="card-choice-overlay"
          state={gameState}
          cardId={top.cardId}
          bigCard
          width={460}
          eyebrow={`${asker ? `${gameState.cards[asker]?.name ?? asker} · ` : ''}Top of ${yours ? 'your' : "the opponent's"} deck`}
          question={describeChoiceQuestion(gameState, top)}
          questionTestId="card-choice-prompt"
          note={yours ? 'Only you see this card.' : undefined}
          buttons={promptButtons(gameState, lookChoice ? lookActions : discardTopActions, actAndClear, 'choice-btn')}
        />
      )
    } else if (searchChoice) {
      choiceOverlay = (
        <SearchRevealOverlay
          state={gameState}
          choice={searchChoice}
          onPick={deckIndex => actAndClear({ type: 'acceptChoice', choiceId: searchChoice.id, deckIndex })}
          // Only offered when there is nothing to discard, which is exactly when the engine
          // makes the acknowledge legal (#413).
          onDone={searchActions.some(a => a.type === 'skipTrigger')
            ? () => actAndClear({ type: 'skipTrigger', choiceId: searchChoice.id })
            : undefined}
        />
      )
    } else if (lookHandChoice) {
      choiceOverlay = (
        <OpponentHandOverlay
          state={gameState}
          choice={lookHandChoice}
          discardable={lookHandActions.flatMap(a => (a.type === 'acceptChoice' && a.handIndex !== undefined ? [a.handIndex] : []))}
          onDiscard={handIndex => actAndClear({ type: 'acceptChoice', choiceId: lookHandChoice.id, handIndex })}
          onDone={lookHandActions.some(a => a.type === 'skipTrigger')
            ? () => actAndClear({ type: 'skipTrigger', choiceId: lookHandChoice.id })
            : undefined}
        />
      )
    } else if (deckTopsChoice && deckTopsActions.length > 0) {
      choiceOverlay = (
        <DeckTopsOverlay
          state={gameState}
          prompt={describeChoiceParts(gameState, deckTopsChoice).map(part => (typeof part === 'string' ? part : part.text)).join('')}
          tops={deckTopsChoice.tops}
          onDone={() => actAndClear(deckTopsActions[0])}
        />
      )
    } else if (searchDrawChoice) {
      choiceOverlay = (
        <SearchDrawOverlay
          state={gameState}
          choice={searchDrawChoice}
          onPick={deckIndex => actAndClear({ type: 'acceptChoice', choiceId: searchDrawChoice.id, deckIndex })}
          onDone={searchDrawActions.some(a => a.type === 'skipTrigger')
            ? () => actAndClear({ type: 'skipTrigger', choiceId: searchDrawChoice.id })
            : undefined}
        />
      )
    } else if (searchFreeChoice) {
      choiceOverlay = (
        <SearchPlayFreeOverlay
          state={gameState}
          choice={searchFreeChoice}
          onPick={deckIndex => actAndClear({ type: 'acceptChoice', choiceId: searchFreeChoice.id, deckIndex })}
          onDone={() => actAndClear({ type: 'skipTrigger', choiceId: searchFreeChoice.id })}
        />
      )
    } else if (searchUpgradeChoice) {
      choiceOverlay = (
        <SearchPlayUpgradeOverlay
          state={gameState}
          choice={searchUpgradeChoice}
          playableIndices={searchUpgradeActions.flatMap(a => (a.type === 'acceptChoice' && a.deckIndex !== undefined ? [a.deckIndex] : []))}
          onPick={deckIndex => actAndClear({ type: 'acceptChoice', choiceId: searchUpgradeChoice.id, deckIndex })}
          onDone={() => actAndClear({ type: 'skipTrigger', choiceId: searchUpgradeChoice.id })}
        />
      )
    } else if (nameCardChoice) {
      choiceOverlay = (
        <NameCardOverlay
          names={nameableCardNames(gameState)}
          onPick={cardName => actAndClear({ type: 'acceptChoice', choiceId: nameCardChoice.id, cardName })}
          onDismiss={cancel}
          state={gameState}
          choice={nameCardChoice}
        />
      )
    } else if (nameTraitChoice) {
      choiceOverlay = (
        <NameCardOverlay
          what="Trait"
          names={nameableTraits(gameState)}
          onPick={traitName => actAndClear({ type: 'acceptChoice', choiceId: nameTraitChoice.id, traitName })}
          onDismiss={cancel}
          state={gameState}
          choice={nameTraitChoice}
        />
      )
    } else if (selectUpgradeChoice && pickedHost !== null) {
      // Step two: only this unit's upgrades, so which one you are defeating is unambiguous even
      // when two units share a name. Cancel steps back to the board rather than declining.
      choiceOverlay = (
        <CardSelectOverlay
          state={gameState}
          prompt={`Choose an upgrade to defeat from ${hostDisplayName(gameState, pickedHost)}`}
          // flatMap keeps each candidate's original index as its optionIndex while dropping the
          // ones on other units.
          items={selectUpgradeChoice.candidates.flatMap((c, i) =>
            c.unitId === pickedHost ? [{ cardId: c.cardId, optionIndex: i, key: i }] : [])}
          onPick={optionIndex => actAndClear({ type: 'acceptChoice', choiceId: selectUpgradeChoice.id, optionIndex })}
          onDismiss={cancel}
          onCancel={() => setUpgradeHost(null)}
        />
      )
    } else if (playFromChoice) {
      // Reveal the whole zone; the cards that can be played are selectable, the rest are dimmed.
      // An offered candidate can still be unplayable (its cost moved, its host left), so the dimming
      // reads the legal moves rather than the candidate list.
      const decline = playFromActions.find(a => a.type === 'skipTrigger')
      const playable = new Set(playFromActions.flatMap(a => (a.type === 'acceptChoice' && a.optionIndex !== undefined ? [a.optionIndex] : [])))
      const items = zoneCards(gameState, 'player', playFromChoice.zone).map((cardId, i) => {
        const optionIndex = playFromChoice.candidates.findIndex(c => c.index === i)
        return { cardId, optionIndex, disabled: optionIndex === -1 || !playable.has(optionIndex), key: i }
      })
      choiceOverlay = (
        <CardSelectOverlay
          state={gameState}
          prompt={describeChoiceParts(gameState, playFromChoice).map(part => (typeof part === 'string' ? part : part.text)).join('')}
          items={items}
          onPick={optionIndex => actAndClear({ type: 'acceptChoice', choiceId: playFromChoice.id, optionIndex })}
          onDismiss={cancel}
          onCancel={decline ? () => actAndClear(decline) : undefined}
        />
      )
    } else if (fromDiscardChoice) {
      const decline = fromDiscardActions.find(a => a.type === 'skipTrigger')
      choiceOverlay = (
        <CardSelectOverlay
          state={gameState}
          prompt="Return a card from your discard to your hand"
          items={fromDiscardChoice.candidates.map((cardId, i) => ({ cardId, optionIndex: i, key: i }))}
          onPick={optionIndex => actAndClear({ type: 'acceptChoice', choiceId: fromDiscardChoice.id, optionIndex })}
          onDismiss={cancel}
          onCancel={decline ? () => actAndClear(decline) : undefined}
        />
      )
    } else if (bottomFromDiscardChoice) {
      const offered = new Set(bottomFromDiscardActions.flatMap(a => (a.type === 'acceptChoice' && a.optionIndex !== undefined ? [a.optionIndex] : [])))
      const stop = bottomFromDiscardActions.find(a => a.type === 'skipTrigger')
      const left = bottomFromDiscardChoice.limit - bottomFromDiscardChoice.picks.length
      choiceOverlay = (
        <CardSelectOverlay
          state={gameState}
          prompt={`Put a unit that costs ${bottomFromDiscardChoice.maxCost} or less on the bottom of your deck to play ${gameState.cards[bottomFromDiscardChoice.cardId]?.name ?? 'this unit'} with its "When Played" abilities (${left} more at most)`}
          items={gameState.players.player.discard.map((cardId, i) => ({ cardId, optionIndex: i, key: i, disabled: !offered.has(i) }))}
          onPick={optionIndex => offered.has(optionIndex) && actAndClear({ type: 'acceptChoice', choiceId: bottomFromDiscardChoice.id, optionIndex })}
          onDismiss={cancel}
          onCancel={stop ? () => actAndClear(stop) : undefined}
        />
      )
    } else if (uniqueChoice && pickedHost !== null) {
      // Unique rule: two copies of the same upgrade. Same two-step pick — the copies are
      // identically named, so the host is the only thing telling them apart.
      choiceOverlay = (
        <CardSelectOverlay
          state={gameState}
          prompt={`You control two ${gameState.cards[uniqueChoice.cardId]?.name ?? 'copies'}, defeat the one on ${hostDisplayName(gameState, pickedHost)}`}
          items={uniqueChoice.candidates.flatMap((c, i) =>
            c.unitId === pickedHost ? [{ cardId: c.cardId, optionIndex: i, key: i }] : [])}
          onPick={optionIndex => actAndClear({ type: 'acceptChoice', choiceId: uniqueChoice.id, optionIndex })}
          onDismiss={cancel}
          onCancel={() => setUpgradeHost(null)}
        />
      )
    } else if (buttonChoice?.kind === 'payWith' && !buttonChoiceHidden) {
      const id = buttonChoice.id
      choiceOverlay = (
        <PayWithPrompt
          key={id}
          state={gameState}
          choice={buttonChoice}
          onPay={credits => actAndClear(credits === 0 ? { type: 'skipTrigger', choiceId: id } : { type: 'acceptChoice', choiceId: id, credits })}
          onCancel={cancel}
          onSetAside={cancel ? undefined : () => setHiddenChoice(id)}
        />
      )
    } else if (buttonChoice && !buttonChoiceHidden) {
      // Cancelled when it can be; otherwise put aside, and brought back from the action column.
      const asker = choiceSourceCard(gameState, buttonChoice)
      choiceOverlay = (
        <PhonePrompt
          testId="choice-overlay"
          state={gameState}
          cardId={asker}
          eyebrow={asker ? gameState.cards[asker]?.name ?? asker : undefined}
          question={describeChoiceQuestion(gameState, buttonChoice)}
          questionTestId="choice-overlay-prompt"
          buttons={promptButtons(gameState, buttonChoiceActions, actAndClear, 'choice-option')}
          onCancel={cancel}
          cancelLabel={CANCEL_LABEL}
          onSetAside={cancel ? undefined : () => setHiddenChoice(buttonChoice.id)}
        />
      )
    }

    // What the board's highlights are asking for. None while a prompt panel asks its own question.
    // Step one of the upgrade pick has its own instruction; it is computed after the choice is found,
    // so it overrides the general prompt here rather than inside it.
    const boardPrompt = choiceOverlay
      ? undefined
      : upgradePick && pickedHost === null
        ? [upgradeHosts.some(id => baseHostOwner(id)) ? 'Choose the unit or base to defeat an upgrade from' : 'Choose the unit to defeat an upgrade from']
        : buttonChoiceHidden && buttonChoice
          ? [...describeChoiceParts(gameState, buttonChoice), '. Look at the board, then answer.']
          : actionPrompt ?? (anyPlayerChoice ? describeChoiceParts(gameState, anyPlayerChoice) : undefined)
    const baseTarget = (side: PlayerId): BaseTarget | undefined => {
      // Step one of an upgrade pick: a base carrying a candidate (Fortify) is a host like a unit.
      if (upgradePick && pickedHost === null && upgradeHosts.includes(baseHostId(side))) return { onClick: () => setUpgradeHost(baseHostId(side)) }
      if (side === 'opponent' && baseAttack) return { onClick: () => actAndClear(baseAttack) }
      const pick = baseTargetActions.get(side)
      return pick ? { onClick: () => actAndClear(pick), intent: targetChoice?.intent } : undefined
    }

    const state = gameState
    const attacker = selectedAttacker ? state.players.player.units.find(u => u.instanceId === selectedAttacker) : undefined
    // The opponent's chosen action, said while it waits to be shown, redacted as the log is.
    const opponentPrompt: DescribePart[] | undefined = opponentAction && state.activePlayer === 'opponent'
      ? ['Opponent: ', ...describeActionParts(state, 'opponent', opponentAction, { redact: true })]
      : undefined
    const leaderName = state.cards[state.players.player.leader.cardId]?.name ?? state.players.player.leader.cardId
    playContent = (
      <>
      {leaderMenuOpen && !state.players.player.leader.deployed && (
        <LeaderMenu
          name={leaderName}
          items={leaderMenuItems}
          onSee={() => setInspecting({ cardId: state.players.player.leader.cardId })}
          onClose={() => setLeaderMenuOpen(false)}
        />
      )}
      {baseMenuOpen && baseMenuItems.length > 0 && (
        <LeaderMenu
          name={state.cards[playerBase.cardId]?.name ?? playerBase.cardId}
          kind="BASE"
          items={baseMenuItems}
          onSee={() => setInspecting({ cardId: playerBase.cardId })}
          onClose={() => setBaseMenuOpen(false)}
        />
      )}
      <PhoneGameLayout
        state={state}
        scale={scale}
        log={log}
        prompt={opponentPrompt ?? boardPrompt}
        attacker={attacker ? state.cards[attacker.cardId]?.name ?? attacker.cardId : undefined}
        actions={actionColumn}
        hand={playerHand}
        centre={{
          opponentLeader: <LeaderCard state={state} side="opponent" widthPx={sizes.centreCard} labelDeployed />,
          opponentBase: <BaseCard state={state} side="opponent" target={baseTarget('opponent')} widthPx={sizes.centreCard} />,
          playerBase: (
            <BaseCard
              state={state}
              side="player"
              target={baseTarget('player')}
              attacked={focus.targetBase}
              widthPx={sizes.centreCard}
              menu={baseMenuItems.length > 0 ? { open: baseMenuOpen, actionable: baseMoves.length > 0, onOpen: () => setBaseMenuOpen(true) } : undefined}
            />
          ),
          playerLeader: <LeaderCard state={state} side="player" widthPx={sizes.centreCard} interact={leaderInteract} labelDeployed />,
        }}
        playerInteraction={playerInteraction}
        opponentInteraction={opponentInteraction}
        onExit={onExit}
        onLog={() => setLogOpen(true)}
        onMore={() => setMoreOpen(true)}
        onDiscard={side => setPile({ title: side === 'player' ? 'Your discard' : "Opponent's discard", cards: state.players[side].discard })}
        onDeck={mayLookAtDeckTop(state, 'player') ? () => setPile({ title: 'Top of your deck', cards: state.players.player.deck.slice(0, 1) }) : undefined}
      />
      </>
    )
  }

  if (edgeScreen || !gameState) return edgeScreen
  // Held upright, a phone is asked to turn; the game carries on underneath and is there when it does.
  if (upright) return <TurnSideways />
  const inspectedUnit = inspecting?.instanceId
    ? [...gameState.players.player.units, ...gameState.players.opponent.units].find(u => u.instanceId === inspecting.instanceId)
    : undefined
  return (
    <CardInspect.Provider value={setInspecting}>
    <div data-testid="game-screen" className="h-screen w-full">
      {playContent}
      {/* Over the board, clear of the controls column. */}
      {unresolvedPrintings.length > 0 && !noticeDismissed && (
        <div className="fixed right-2 top-2 z-40" style={{ left: boardLeft(scale) + 8 }}>
          <PrintedStatsNotice names={unresolvedPrintings.map(u => u.name ?? u.id)} onDismiss={() => setNoticeDismissed(true)} />
        </div>
      )}
      {choiceOverlay}
      {/* The desktop docks the log in the column; a phone opens it as a drawer. */}
      {scale === 'phone' && (
        <GameLogDrawer
          open={logOpen}
          state={gameState}
          log={log}
          onClose={() => setLogOpen(false)}
          onUndo={settings.allowUndo && canUndo ? () => { clearSelections(); undo() } : undefined}
        />
      )}
      <MoreSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        onHelp={() => onHelp()}
        onSettings={() => setSettingsOpen(true)}
        onReport={scale === 'desktop' && settings.showBugReport ? () => setReporting(true) : undefined}
        onConcede={gameState.winner === null && gameState.activePlayer === 'player' ? () => { clearSelections(); act({ type: 'concede' }) } : undefined}
      />
      <PileSheet state={gameState} title={pile?.title ?? ''} cards={pile?.cards ?? null} onClose={() => setPile(null)} />
      {/* The bug report, opened from More on the desktop, sits above the board and its sheets. */}
      {reporting && (
        <BugReportOverlay
          onSubmit={submitReport}
          onCancel={() => { setReporting(false); setFallbackReport(undefined) }}
          fallbackReport={fallbackReport}
        />
      )}
      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} onHelp={onHelp} />
      {!logOpen && <PhoneGameOver state={gameState} deckName={deck.name} onRematch={rematch} onExit={onExit} scale={scale} />}
      {inspecting && <CardDetail state={gameState} cardId={inspecting.cardId} unit={inspectedUnit} onClose={() => setInspecting(null)} />}
    </div>
    </CardInspect.Provider>
  )
}

