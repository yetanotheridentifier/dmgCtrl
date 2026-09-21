/**
 * Game state schema — pure data, fully JSON-serialisable.
 *
 * The engine is a pure function over this shape: (state, action) => state.
 * `cards` is the static card database for the match; it is shared by reference
 * between successive states and never mutated, so structural cloning of states
 * stays cheap for search (MCTS) later.
 *
 * Card ability *text* is never stored here — abilities live in the registry keyed by card id
 * (see abilities.ts), so state stays plain JSON and replays deterministically.
 */

import type { AttackTarget } from './actions'
import type { TriggerPoint } from './abilities'

export type PlayerId = 'player' | 'opponent'
export type Arena = 'ground' | 'space'
export type Phase = 'setup' | 'action' | 'regroup'
export type CardType = 'unit' | 'event' | 'upgrade' | 'leader' | 'base' | 'token'

/** A keyword on a card; `value` carries the numeral for Raid 2, Restore 1, etc. */
export interface KeywordInstance {
  name: string
  value?: number
}

/** Normalised static card data (from SWUDB detail via cardDb.ts). */
export interface EngineCard {
  id: string
  name: string
  subtitle?: string
  type: CardType
  arena?: Arena
  cost: number
  power?: number
  hp?: number
  aspects: string[]
  traits: string[]
  keywords: KeywordInstance[]
  unique: boolean
  /** Card art URL as served by the data source; render via artUrl(). */
  frontArt?: string
  /** Back-side art (SWUDB BackArt): the unit side of a deployed leader. */
  backArt?: string
  /** Rules/ability text (SWUDB FrontText); shown in the textual card fallback. */
  text?: string
  /**
   * Printed rarity (SWUDB Rarity): Common, Uncommon, Rare, Legendary, Special. No rules meaning,
   * but it is the designers' own statement of how strong a card is, which the AI uses to judge a
   * card's worth in hand (#393). Absent for tokens and any source data that omits it.
   */
  rarity?: string
}

export type CardDb = Readonly<Record<string, EngineCard>>

/**
 * An upgrade attached to a unit. `owner` is the player who played it —
 * on defeat the upgrade returns to its owner's discard, which may differ from the
 * unit's controller when an upgrade is attached to an enemy unit.
 */
export interface UpgradeAttachment {
  cardId: string
  owner: PlayerId
}

/** A unit in play. instanceId keeps duplicate copies of a card distinct. */
export interface UnitState {
  instanceId: string
  cardId: string
  arena: Arena
  damage: number
  exhausted: boolean
  isLeader: boolean
  /**
   * Attached upgrades. Card upgrades return to their owner's discard on defeat;
   * token upgrades (cardId in TOKEN_CARDS, type `token`) never go to a discard —
   * they cease to exist. The UI draws them as on-card tokens rather than behind-card upgrades.
   */
  upgrades: UpgradeAttachment[]
  /**
   * Hidden state: the unit can't be attacked (unless it has Sentinel, which
   * overrides Hidden); cleared at the next phase. Set on entry for units with the
   * Hidden keyword, or when an ability grants it.
   */
  hidden?: boolean
  /**
   * Keywords temporarily granted for a single attack (Support). Set only
   * during the resolution of a support attack and cleared immediately after, so a
   * resting state never carries it. `unitHasKeyword`/`unitKeywordValue` include it.
   */
  grantedKeywords?: KeywordInstance[]
  /**
   * Card ids whose full abilities this unit has been granted for a single attack (Support,
   * Improvised Identity). Like `grantedKeywords`, set only during that attack and cleared
   * immediately after. Read them via `abilityCardIds`, which every ability lookup goes through so
   * that EVERY category of ability is lent, not just the ones whose hook happened to remember to
   * check (#417). Abilities only: printed traits do not travel.
   */
  grantedAbilityCardIds?: string[]
  /**
   * Keys of once-per-round action abilities this unit has already used this round
   * (`${cardId}#${index}`); cleared at round start.
   */
  usedAbilities?: string[]
  /**
   * How many upgrades have been played onto this unit this round (Guardian of the Whills discounts
   * the first). Per unit rather than per player, and per round rather than per phase, because that
   * is what the card counts. Cleared at the round boundary alongside `usedAbilities`.
   */
  upgradesPlayedThisRound?: number
  /**
   * Resources exhausted to play this unit, recorded by `playUnitCard` because payment happens before
   * the unit exists and nothing on the board remembers it afterwards. Absent means none were paid,
   * which is what Weequay Pirate reads ("if no resources were paid to play this unit"): a free play,
   * a full discount, or a cost of zero. It is the amount paid, not the card's cost.
   */
  resourcesPaidToPlay?: number
  /**
   * Cards this unit has captured (Bothan-5) — card ids held face-down under it, out of every
   * other zone. Released to their owner's discard when the captor leaves play.
   */
  captured?: string[]
  /**
   * A card name this unit forbids the opponent from playing while it's in play (Ryder
   * Azadi). Set by its When Played "name a card"; the restriction ends naturally
   * when the unit leaves play (the field goes with it).
   */
  namedCard?: string
  /**
   * Set alongside `namedCard` when the naming raises the card's cost for opponents rather than
   * forbidding it outright (Qi'ra). A named card with a surcharge is still playable, so the
   * prohibition must skip it: `namedByOpponent` filters these out and `effectiveCost` adds the
   * amount instead.
   */
  namedCardSurcharge?: number
  /**
   * The player who OWNS this card, when that differs from the player who controls it (Rehabilitation
   * takes control of an enemy unit). Which `players[…].units` array a unit sits in is its
   * *controller*; ownership decides where the card goes when it leaves play — a stolen unit is
   * defeated into its owner's discard, not its controller's. Absent = owner is the controller,
   * which is true of every unit that has never changed hands.
   */
  owner?: PlayerId
  /**
   * How long a unit controlled by someone other than its `owner` stays that way. Absent means until the
   * regroup phase starts (Change of Heart, Rehabilitation), which is the common case. `'permanent'` is a
   * change of control with no end (C-3P0, Galen Erso). An instance id is "when that unit leaves play,
   * the owner takes control" (Grand Moff Tarkin): control goes back once it is no longer in play.
   */
  controlUntil?: 'permanent' | string
  /**
   * Another unit this one chose as it was played, for an effect that lasts while this unit is in play
   * (BD-1, Huyang). Read by the card's own aura, so the effect ends when either unit leaves play.
   */
  chosenUnitId?: string
}

export interface ResourceState {
  cardId: string
  exhausted: boolean
}

export interface LeaderState {
  cardId: string
  /** false: Leader side in base zone. true: deployed, lives in units[] with isLeader. */
  deployed: boolean
  epicActionUsed: boolean
  exhausted: boolean
}

export interface BaseState {
  cardId: string
  damage: number
  /** The base's "Epic Action" has been used: once each game, like a leader's deploy (CR 2.5). */
  epicActionUsed?: boolean
  /**
   * Upgrades attached to the base (Fortify: "Attach this to your base, not a unit"). Absent means none.
   * Each gives the base its ability, which belongs to the base's controller: see `baseAbilityCardIds`.
   * A card upgrade goes to its owner's discard pile when defeated, as one on a unit does.
   */
  upgrades?: UpgradeAttachment[]
}

/** True if a card is played onto its player's base rather than onto a unit (the Fortify keyword). */
export function isFortify(card: EngineCard | undefined): boolean {
  return card?.type === 'upgrade' && card.keywords.some(k => k.name === 'Fortify')
}

/**
 * Every card that supplies a base's abilities: the base card itself and each upgrade attached to it.
 * The base-zone counterpart of `abilityCardIds`, and the one place that set is spelled out.
 */
export function baseAbilityCardIds(base: BaseState): string[] {
  return [base.cardId, ...(base.upgrades ?? []).map(u => u.cardId)]
}

export interface PlayerState {
  leader: LeaderState
  base: BaseState
  hand: string[]
  /** Draw order: index 0 is the top of the deck. */
  deck: string[]
  discard: string[]
  resources: ResourceState[]
  units: UnitState[]
  /**
   * Grants waiting for the next unit this player plays this phase (Sabine → Shielded; Mouse
   * Droid → −1 cost to the next Imperial; Neel → the next ≤1-power unit enters ready).
   * Each grant carries an optional filter (`trait` / `maxPower`) and is consumed by the next unit
   * that matches it — `costDelta` folds into `effectiveCost`, `keywords` / `entersReady` apply in
   * `playUnitCard`. Cleared at the start of the regroup phase.
   */
  nextUnitGrants?: NextUnitGrant[]
}

/**
 * Where an instance of damage came from (Gorian Shard's Corsair). Card-level rather than
 * instance-level so it also describes a leader's or an event's damage, which have no unit in play.
 * `undefined` means "unattributed" — treated as preventable.
 */
export interface DamageSource {
  cardId: string
  controller: PlayerId
}

/** A pending "your next unit …" grant. All fields are plain data (GameState is JSON). */
export interface NextUnitGrant {
  keywords?: KeywordInstance[]
  costDelta?: number // e.g. −1 to the matching unit's cost
  entersReady?: boolean
  // Filter — the grant only applies to (and is consumed by) a unit matching all set constraints:
  trait?: string // the unit must have this trait
  maxPower?: number // the unit's printed power must be ≤ this
  cardId?: string // the unit must be a copy of this card (Jump to Lightspeed)
  // The unit must share a keyword with a unit `owner` controls (Morgan Elsbeth). Read off printed
  // keywords, since this module sits below the keyword readers.
  sharesKeywordWithFriendly?: boolean
  // The grant is for the next EVENT played instead of the next unit (Rex): only `costDelta` applies.
  event?: boolean
}

/** True if `card` is a unit satisfying a grant's filter. `state` and `owner` are needed only by a board-reading filter. */
export function nextUnitGrantMatches(card: EngineCard | undefined, grant: NextUnitGrant, state?: GameState, owner?: PlayerId): boolean {
  if (!card || card.type !== (grant.event ? 'event' : 'unit')) return false
  if (grant.trait && !card.traits.some(t => t.toLowerCase() === grant.trait!.toLowerCase())) return false
  if (grant.maxPower !== undefined && (card.power ?? 0) > grant.maxPower) return false
  if (grant.cardId !== undefined && card.id !== grant.cardId) return false
  if (grant.sharesKeywordWithFriendly) {
    if (!state || !owner) return false
    const names = new Set(card.keywords.map(k => k.name))
    if (!state.players[owner].units.some(u => (state.cards[u.cardId]?.keywords ?? []).some(k => names.has(k.name)))) return false
  }
  return true
}

/**
 * Every card that supplies this unit's abilities: its own card, each attached upgrade, and any card
 * lent to it for a single attack (Support, Improvised Identity).
 *
 * The ONE definition of that set. It used to be spelled out at each lookup site, and the spellings
 * drifted: only some included the lent cards, so an ability whose hook happened to live at a
 * granted-blind site was silently never lent. Scion Shuttle's `aura` and Red Leader's
 * `attacksEitherArena` were both lost that way (#417). Route every ability lookup through here.
 *
 * Duplicates are deliberate and must not be collapsed: two copies of the same upgrade on one host,
 * or a Support source whose card matches the borrower's, each apply their ability again, and
 * keyword numerals stack (CR).
 *
 * Printed TRAITS are deliberately not covered by this: Support lends "this unit's other abilities",
 * and a trait is not an ability. Only a `grantedTraits` hook lends traits.
 */
export function abilityCardIds(unit: UnitState): string[] {
  return [unit.cardId, ...unit.upgrades.map(u => u.cardId), ...(unit.grantedAbilityCardIds ?? [])]
}

export interface GameState {
  cards: CardDb
  players: Record<PlayerId, PlayerState>
  /** Controller of the initiative counter. */
  initiative: PlayerId
  /**
   * Who used Take the Initiative this round (null: available). The taker is
   * hard-passed — they auto-pass every remaining turn this action phase
   * (CR 1.15.5b). A normal pass does NOT lock a player out; only consecutive
   * passes end the phase (CR 1.15.6d).
   */
  initiativeTakenBy: PlayerId | null
  activePlayer: PlayerId
  phase: Phase
  round: number
  /** Action phase ends when both players pass consecutively. */
  consecutivePasses: number
  /** Regroup: whether each player has made their resource-1-card choice yet. */
  regroupResourced: Record<PlayerId, boolean>
  /**
   * This board is a SEARCH SIMULATION, so the regroup it crosses is a model rather than the real one.
   *
   * Never set in real play. An AI stamps it on its own copy before searching, and every board reached
   * from there inherits it, which is what makes the property hold however the boundary is reached: at
   * the root, in a modelled reply, or deep in the frontier.
   *
   * It exists because `enterRegroup` deals both players two cards off a fully-ordered deck held in
   * state. A search that crossed the real regroup would score a hand containing cards nobody has drawn,
   * and would then prefer lines whose value came from knowing them.
   *
   * Exactly three deviations, all in `simulatedRegroupFor` and `enterRegroup`:
   *
   * 1. **The two cards are removed from the deck but not read.** Deck size is public and the deck-out
   *    clock is real, so they are spent rather than left in place, and the empty-deck damage still
   *    lands.
   * 2. **They enter the hand unidentified.** Hand SIZE is public and the draw is deterministic, so the
   *    size is modelled; the identities are not. Consumers already skip a hand entry with no
   *    definition, so the placeholders are unplayable and unpriced.
   * 3. **The resourcing choice is not made here at all.** The engine models the mechanical half and
   *    predicts nothing: whether a seat banks depends on evaluation weights, which are not the
   *    engine's to know. `search.ts: settleCrossing` applies the choice for both seats afterwards,
   *    from public quantities alone, which is what keeps the opponent's choice out of their hand.
   */
  simulatedRegroup?: boolean
  /** Monotonic counter for deterministic unit instance ids. */
  instanceCounter: number
  /** Seed for in-game shuffles (mulligans) — advances on use, replays deterministically. */
  rngSeed: number
  /** Sub-stage of the setup phase: mulligan decisions, then resource picks (CR 5.2.1e–f). */
  setupStage: 'mulligan' | 'resource'
  /** Terminal outcome: a winning player, `'draw'` (both bases fall at once), or null while live. */
  winner: PlayerId | 'draw' | null
  /**
   * Queue of pending mid-resolution choices. While the head is set, the
   * only legal moves are that choice's options (or `skipTrigger` to decline), and
   * `activePlayer` is held at the choice's `controller` so the right side decides.
   * Ambush/Support use it (a single-element queue); optional "may…" abilities and
   * simultaneous `whenReadies` triggers push one entry per decision.
   */
  pendingChoices?: PendingChoice[]
  /**
   * A combat suspended mid-resolution: an "On Defense" ability raised a choice
   * before combat damage. Holds what's needed to resume (`completeAttack`) once the
   * choice(s) drain, plus the attacker's `activePlayer` to restore for the turn pass.
   */
  // `prevented` collects units whose incoming combat damage a prevention effect has cancelled
  // (The Mandalorian) — decided at the `prevent` stage, honoured when damage is dealt.
  pendingAttack?: { attackerId: string; target: AttackTarget; activePlayer: PlayerId; stage: 'onDefense' | 'damage'; viaAmbush?: boolean; preventAsked?: string[]; prevented?: string[] }
  /**
   * A "take the initiative" whose "When you take the initiative" trigger raised a choice:
   * the turn transition (end the phase, or pass to the opponent) is deferred until the choice
   * drains. `true` = taking the initiative also ended the action phase (CR 1.15.5c).
   */
  pendingInitiativeEndsPhase?: boolean
  /**
   * An opponent-interjected choice is pending as part of this player's action (Sabine Wren):
   * `activePlayer` is temporarily the choosing opponent, and this holds the original actor so that
   * once the interjected choice(s) drain, control is restored to them and the turn advances normally.
   * Generic — any effect that makes "an opponent" choose mid-action sets this.
   */
  pendingResumeActive?: PlayerId
  /**
   * Triggered abilities that have fired but not yet resolved, one entry per **ability**.
   *
   * The rules order triggered abilities (CR 7.6.9, 7.6.10), and most abilities resolve without asking
   * the player anything. Ordering therefore cannot be read off `pendingChoices`: a batch where one side
   * draws a card and the other looks at a deck top puts a single entry in that queue, so the engine
   * saw one side owing something and never asked. The abilities have to exist as data before they run.
   *
   * Per ability rather than per unit, because a unit's own ability and one granted by an upgrade on it
   * are two abilities the player orders (the reported case was exactly that).
   */
  pendingTriggers?: PendingTrigger[]
  /**
   * Which side is currently entitled to resolve its triggers, once CR 7.6.10 has been answered.
   *
   * Held separately from `activePlayer` because that moves for other reasons, and a batch may outlive
   * several choices. Scoped to the layer it was answered for, so a nested batch does not silently
   * inherit an answer given about the batch it interrupted. Cleared when the triggers drain.
   */
  triggerTurn?: { side: PlayerId; layer: number }
  /**
   * Transient "this phase" stat/keyword modifiers, each aimed at a unit.
   * Folded into `effectivePower`/`effectiveHp`/`unitKeywords`; cleared at the start of
   * the regroup phase so a unit defeated during regroup uses its base stats.
   */
  lastingEffects?: LastingEffect[]
  /** Effects cards have left to happen later (`DelayedEffect`). */
  delayedEffects?: DelayedEffect[]
  /** Card names nobody can play this phase (Transmission Jamming). Cleared as the regroup phase starts. */
  bannedNames?: string[]
  /** Permissions to play a named card out of a discard pile this phase. Cleared as regroup starts. */
  discardPlayGrants?: DiscardPlayGrant[]
  /** Bases whose next damage this phase is prevented (Close the Shield Gate). Cleared as the regroup phase starts. */
  shieldedBases?: PlayerId[]
  /** Bases can't be healed for this phase (Shifty Suspects). Cleared as the regroup phase starts. */
  basesUnhealable?: boolean
  /**
   * Events the engine tracks within a boundary so abilities can query them:
   * which units entered play this phase and which cards were defeated this phase
   * (per controller). Reset whenever the phase changes.
   */
  phaseEvents?: PhaseEvents
}

/**
 * One option of a choose-one/modal ability. A small serialisable effect descriptor,
 * resolved by the engine when the option is picked. New variants extend the `kind` union.
 * `arenaLastingBuff`: grant every unit in `arena` (both players) the given "this phase" buff.
 */
/**
 * Reference to a specific attached upgrade (its host + position), for card-select choices. The host is a
 * unit's instance id, or `baseHostId(owner)` for an upgrade on that player's base (Fortify).
 */
export interface UpgradeRef {
  unitId: string
  upgradeIndex: number
  cardId: string
}

/** The host id an `UpgradeRef` gives an upgrade on `owner`'s base. */
export const baseHostId = (owner: PlayerId): string => `base:${owner}`
/** Whose base a host id names, or undefined when it names a unit. */
export const baseHostOwner = (hostId: string): PlayerId | undefined =>
  hostId === 'base:player' ? 'player' : hostId === 'base:opponent' ? 'opponent' : undefined

/** The current combat's roles, so combat-conditional auras (Grogu) can react to who is
 *  attacking / defending. Threaded through `StatContext` into the aura pass during damage resolution. */
export interface CombatContext {
  attackerInstanceId: string
  defenderInstanceId: string
  /**
   * The attack was declared via Ambush. Part of the combat rather than of the attacker's own
   * context because a card can read it about someone else's attack: Enfys Nest takes 3 power off
   * the defender while ANY friendly unit attacks using Ambush.
   */
  viaAmbush?: boolean
}

/** A hand card offered for play by an ability — its hand position + card id. */
/**
 * Where the rest of an ability lives once a choice partway through it is answered: the `ifYouDo` hook
 * of `cardId`, run for `owner` (the player whose ability it is, who need not be the one answering) with
 * `sourceInstanceId` as its source. `step` tells apart the stages of an ability with more than two.
 */
export interface IfYouDo {
  cardId: string
  owner: PlayerId
  sourceInstanceId?: string
  step?: string
  /** An upgrade an earlier stage chose, carried to the next (Jocasta Nu's upgrade, then its new unit). */
  upgrade?: UpgradeRef
  /** A unit an earlier stage chose, carried to the next (Strike True's friendly unit, then its target). */
  unit?: string
}

export interface HandCardRef {
  handIndex: number
  cardId: string
}

/** Parameters for a "play a unit from hand" step: cost delta and whether it enters ready. */
export interface PlayFromHandSpec {
  costDelta: number
  entersReady: boolean
}

/**
 * The zone a `playCardFrom` play takes its card out of. `hand` is there because an ability that
 * plays a card of any type from hand is the same play as one out of the resource zone, differing
 * only in where the card is picked up: the Play a Card action itself does not come through here.
 *
 * A discard pile is a zone like the rest, so playing out of one adds zones rather than a door. The
 * paired zones (`handOrResources`, `handOrDiscard`, `anyDiscard`) are each ONE zone for ONE play out
 * of either half, listed in the order a card names them, so an index past the first half names the
 * second.
 */
export type PlayFromZone =
  | 'hand' | 'resources' | 'opponentResources' | 'deckTop' | 'handOrResources'
  | 'discard' | 'opponentDiscard' | 'anyDiscard' | 'handOrDiscard'

/** True if `zone` can hold a card somebody other than the player playing it owns. */
export function zoneCrossesOwners(zone: PlayFromZone): boolean {
  return zone === 'opponentResources' || zone === 'opponentDiscard' || zone === 'anyDiscard'
}

/** A card offered for play, with its index in the zone it is played out of. */
export interface PlayFromRef {
  index: number
  cardId: string
}

/**
 * Aspect penalties a play ignores: every one ("ignoring its aspect penalties"), every one from the
 * named icons (Osha's "ignoring its Villainy aspect penalties"), or exactly one penalty from the
 * named icons (the LAW bases' "ignoring 1 of its Vigilance, Command, Aggression, or Cunning aspect
 * penalties"). Each penalty is 2 resources, so "one" is a flat 2 off a card that has any of them
 * unprovided, which is why it needs no pick from the player.
 */
export type AspectWaiver = { all: true } | { aspects: string[]; one?: boolean }

/**
 * How a `playCardFrom` play differs from a plain one, and what follows it once the card is in play
 * or its event has resolved.
 */
export interface PlayFromTail {
  /** "If you do, that player resources the top card of their deck" (Smuggle, Plot, LAW_066). */
  resourceTop?: PlayerId
  /** "If you do, you may resource a card from your hand" (Osha). */
  mayResourceFromHand?: boolean
  /** "Play each … (one at a time)": re-offer whatever is left of the same candidates (SHD_109). */
  again?: boolean
  /**
   * How many plays `again` has left, where the card caps them ("up to 3", Dathomiri Magicks). Absent
   * is uncapped, which is what "play EACH unit revealed this way" means.
   */
  againLimit?: number
  /** "If you don't, you may discard it" (LAW_242): offered on a decline, never on a play. */
  elseMayDiscardTop?: boolean
  /** "It enters play ready" (Nightbrother, Unnatural Life). A played unit is exhausted otherwise. */
  entersReady?: boolean
  /**
   * The card whose text this tail is. It attributes the tail's damage and dispatches its delayed
   * effect, both of which have to name a card rather than the play that caused them.
   */
  sourceCardId?: string
  /**
   * "At the start of the next regroup phase, defeat it" (Nightbrother, Unnatural Life, Salvaged
   * Materials): the same `DelayedEffect` Sneak Attack leaves, about the card this play put into play.
   */
  delay?: DelayedEffect['when']
  /** "Then, deal N damage to it" (Salvage): the unit just played, so it needs no target pick. */
  damageIt?: number
  /** "And give an Experience token to it" (Mechanize): token card ids for the unit just played. */
  tokens?: string[]
}

/** A follow-up "deal N damage to a unit or a base" selection. */
export interface DamageTargetSpec {
  amount: number
  /** Instance ids of units that may take the damage. */
  unitTargets: string[]
  /** Owners whose base may take the damage. */
  baseTargets: PlayerId[]
}

export interface ChooseOption {
  label: string
  kind: 'arenaLastingBuff'
  arena: Arena
  power?: number
  hp?: number
  keywords?: KeywordInstance[]
}

/** A transient modifier targeting a single unit. Omitted stats = 0. */
export interface LastingEffect {
  targetInstanceId: string
  power?: number
  hp?: number
  keywords?: KeywordInstance[]
  /**
   * Scoped to a single attack rather than the phase (Mando's N-1 Starfighter and Razor Crest both
   * read "this unit gets +2/+0 for this attack"). Cleared by `clearAttackGrants` alongside the other
   * per-attack grants; everything else lives until the regroup phase.
   */
  untilEndOfAttack?: boolean
  /**
   * Card ids whose triggered abilities the unit gains for the duration (Treacherous Minefield hands
   * every unit in an arena an "On Attack" for the phase). Gathered by `runUnitTrigger` exactly like
   * a printed or upgrade-granted ability.
   */
  abilityCardIds?: string[]
  /** The unit can't attack for the duration (Chaotic Diversion). Read by `unitCannotAttack`. */
  cannotAttack?: boolean
  /** The unit can't attack bases for the duration (Fly Casual). Read by `unitCannotAttackBases`. */
  cannotAttackBases?: boolean
  /**
   * The unit can't be attacked for the duration (Dooku), or not while it lacks Sentinel when
   * `unlessSentinel` is set (On Top of Things). Read by `unitCannotBeAttacked`.
   */
  cannotBeAttacked?: boolean
  unlessSentinel?: boolean
  /** Keyword names the unit loses for the duration (SpecForce Soldier: Sentinel). Read by `unitKeywords`. */
  removeKeywords?: string[]
  /** The unit deals no combat damage for the duration (Betrayed Trust). */
  noCombatDamage?: boolean
  /** Units attacking this unit get this much power for the duration (I Have the High Ground: -4). */
  attackersPower?: number
  /** The next time the unit would be dealt damage, prevent this much of it; then the effect is spent (Shien Flurry). */
  preventNext?: number
  /** Each time the unit would be dealt damage for the duration, prevent this much of it (Finn). Never spent. */
  preventEach?: number
  /** The unit can't be defeated by having no remaining HP for the duration (The Tragedy of Plagueis). */
  survivesNoHp?: boolean
  /** The unit can't ready for the duration (No Good to Me Dead). Read by `unitCannotReady`. */
  cannotReady?: boolean
  /**
   * Lasts to the end of the round, through the regroup phase's ready step, rather than to the start of
   * the regroup phase ("this round (including during the regroup phase)"). Dropped as the next round starts.
   */
  untilRoundEnd?: boolean
  /**
   * The unit doesn't ready during the next regroup phase (Carbonite Chamber). Narrower than `cannotReady`:
   * an ability may still ready it. Set with `untilRoundEnd`, so it lasts through that ready step and no longer.
   */
  skipsRegroupReady?: boolean
}

/**
 * An effect a card leaves to happen later: at the start of the regroup phase (Sneak Attack, Final
 * Showdown), at the start of the next action phase (The Eye of Aldhani), or the next time `owner` takes
 * the initiative this phase (Premonition of Doom). Run once, by the card's `delayed` hook, then dropped.
 * A `takeInitiative` effect that never ran is dropped as the regroup phase starts.
 */
/**
 * "For this phase, you may play that card from <a> discard pile" (Boga, Tireless Magnaguard, Cobb
 * Vanth, Stolen AT-Hauler, Aid from the Innocent).
 *
 * **This is the one play-from-discard shape `playCardFrom` cannot express**, and the reason is not
 * the zone: it is a standing permission on the **Play a Card action**, taken later, on a turn of the
 * player's own, among their normal moves. A pending choice is answered now or declined now, so it is
 * the wrong instrument. The permission still *resolves* through `playFromZone`, so pay / take out of
 * the zone / hand to the door for the card's type is stated exactly once either way.
 *
 * A grant names one card in one pile. It is spent when used, and cleared unused as the regroup phase
 * starts, like `bannedNames`.
 */
export interface DiscardPlayGrant {
  /** Who may take the play. Not always the pile's owner: Stolen AT-Hauler hands it to an opponent. */
  player: PlayerId
  /** Whose discard pile the card is in, and who still owns the card (CR 1.5.2). */
  owner: PlayerId
  cardId: string
  free?: boolean
  costDelta?: number
  waive?: AspectWaiver
  /** Tokens for the unit once it is in play (Tireless Magnaguard's 2 Weakness). */
  tokens?: string[]
}

export interface DelayedEffect {
  cardId: string
  owner: PlayerId
  when: 'regroupStart' | 'actionPhaseStart' | 'takeInitiative'
  /** The unit the effect is about, when it has one (the unit Sneak Attack played). */
  unitId?: string
  /**
   * The upgrade the effect is about, where it is an upgrade rather than the unit itself (Salvaged
   * Materials defeats the upgrade it played, not its host). `unitId` is then the host it went onto.
   */
  upgradeCardId?: string
  /** The arena the effect is about, when it has one (the arena Seismic Detonation chose). */
  arena?: Arena
}

/**
 * Which units an "attack with a … unit" may use. Every set field must hold. `exclude` drops units
 * already used by the same card ("then attack with another unit"), and `only` names the one unit a
 * card has already chosen (Hotshot Maneuver).
 */
export interface AttackerFilter {
  trait?: string
  arena?: Arena
  damaged?: boolean
  nonLeader?: boolean
  unique?: boolean
  exclude?: string[]
  only?: string[]
}

/** Per-phase event counters. `enteredPlay` holds instance ids (still-in-play
 *  units), `defeated` holds card ids (so trait conditions like "Imperial" can check). */
export interface PhaseEvents {
  enteredPlay: Record<PlayerId, string[]>
  defeated: Record<PlayerId, string[]>
  /** Players whose base was attacked this phase (Greef Karga). */
  basesAttacked: PlayerId[]
  /** Instance ids of the units that attacked each player's base this phase (Qui-Gon Jinn). */
  baseAttackers?: Partial<Record<PlayerId, string[]>>
  /** Players whose base was DEALT DAMAGE this phase — combat or ability (Baylan Skoll). */
  basesDamaged: PlayerId[]
  /** Players who had an upgrade defeated this phase (Baylan Skoll). */
  upgradesDefeated: PlayerId[]
  /** Instance ids of units dealt damage this phase, whether or not they survived (Galvanized Leap). */
  damagedUnits: string[]
  /** Card ids of units that LEFT PLAY this phase — defeated, bounced, or otherwise (Fateful Goodbye). */
  leftPlay: Record<PlayerId, string[]>
  /** Players whose LEADER unit left play this phase (Fateful Goodbye pays out more). */
  leaderLeftPlay: PlayerId[]
  /** Card ids each player has played this phase, in order — "the first X you play each phase". */
  played: Record<PlayerId, string[]>
  /**
   * Instance ids of units that have ATTACKED this phase (Anakin's Podracer strikes first while no
   * other unit has attacked). Recorded as the attack is declared, so the attacker is already in the
   * list while its own combat resolves: a card reading it means "no OTHER unit".
   */
  attackedUnits?: string[]
  /** Instance ids of units healed this phase (Barriss Offee). */
  healedUnits?: string[]
  /**
   * Instance ids whose incoming damage a prevention effect has stopped this phase, for the
   * once-a-phase preventions (Umbaran Mobile Cannon). Recorded for every prevention, since only a
   * card that limits itself reads it.
   */
  damagePrevented?: string[]
  /** How many cards each player has drawn this phase (Beilert Valance). */
  cardsDrawn?: Partial<Record<PlayerId, number>>
  /** How much damage each player's base has been dealt this phase (Cassian Andor). */
  baseDamageTaken?: Partial<Record<PlayerId, number>>
  /**
   * Instance ids of units that have dealt COMBAT damage to a base this phase (Moff Gideon, whose
   * surcharge lasts the phase rather than the attack). Distinct from `baseAttackers`, which records
   * the declaration: an attack a prevention soaked entirely attacked the base but dealt it nothing.
   */
  baseCombatDamagers?: string[]
  /**
   * Players who created a token this phase (The Client). A token upgrade is credited to the controller of
   * the unit it lands on, which is who created it for every card that gives one to its own side.
   */
  tokensCreated?: PlayerId[]
  /**
   * Base action abilities each player has used this phase, as `${cardId}#${index}` once per use (Heavy
   * Ion Cannon: "Use this ability only once each phase"). Counted against the copies on the base.
   */
  baseActionsUsed?: Partial<Record<PlayerId, string[]>>
}

/**
 * One triggered ability, owed but not yet resolved.
 *
 * Plain data so it survives the `initialState + moves` replay contract: everything the dispatcher
 * needs to run the ability later is either an id or a value already in state. The context fields are
 * the ones the defeat batch supplies; a trigger point that needs more adds its own here rather than
 * smuggling a closure through.
 */
/**
 * What an ability's effect reads about the event that triggered it, beyond who controls it and which
 * card it is on. Carried on a `PendingTrigger` so a collected ability resolves with the context it
 * triggered with, however long it waits to be ordered.
 *
 * One shape rather than a field per trigger point: a new trigger point adds a member here and needs no
 * change to the queue, and `EffectContext` extends it so an effect reads the same names either way.
 * Every member must stay JSON-serialisable, since the queue lives on the game state.
 */
export interface TriggerContext {
  /** `onAttackEnd`: the target of the attack that just ended. */
  attackTarget?: AttackTarget
  /** `onAttackEnd` / `whenEnemyAttacksBase`: the unit that made the attack. */
  attackerInstanceId?: string
  /**
   * `onAttackEnd`: the attacker's card, readable after the combat defeated it ("another unit that
   * costs less than it", Colonel Yularen), when its instance is no longer there to look up.
   */
  attackerCardId?: string
  /** `onAttackEnd`: combat damage dealt to the opponent's base this attack (0 if none). */
  combatDamageToBase?: number
  /** `onAttackEnd`: the defending unit was defeated during this attack. */
  defenderDefeated?: boolean
  /** `onAttackEnd`, when the combat defeated the defender: that unit as it was going into the damage step. */
  defeatedDefender?: UnitState
  /** `onAttackEnd`, when the combat defeated the defender: the attacker's damage past its remaining HP. */
  excessCombatDamage?: number
  /** `onAttackEnd`: combat damage the attacker dealt to the defending unit (0 if a base attack). */
  combatDamageToDefender?: number
  /** `whenDefeated`: the unit as it was at the moment of defeat (it has left play). */
  defeatedUnit?: UnitState
  /** `whenDefeated`: the defeat was caused by combat damage. */
  defeatedByCombat?: boolean
  /** A unit the event is *about*: the one just played, readied, or chosen. */
  targetInstanceId?: string
  /** `whenUpgradeAttached`: the upgrade was played (from any zone) rather than created or moved by an ability. */
  upgradePlayed?: boolean
  /** `whenPlayUpgrade`: the upgrade card just played. */
  playedCardId?: string
  /** `whenFriendlyDamagedSurvives`: each unit that was dealt damage and survived, with how much (Jabba the Hutt). */
  damagedSurvivors?: { instanceId: string; amount: number }[]
  /**
   * `whenFriendlyDamagedSurvives` / `whenOwnBaseDamaged`: the damage was **combat** damage.
   *
   * Cards are printed both ways at both points and the two readings are not interchangeable:
   * "dealt damage and survives" (Arena Acklay) fires on an ability's ping, "dealt combat damage and
   * isn't defeated" (Tarfful) does not. The flag is the one already threaded through
   * `applyUnitDamage`, surfaced rather than recomputed.
   */
  byCombat?: boolean
  /**
   * `whenDrawCards`: who drew. The point fires on **both** players' units, because a card reads it
   * either about itself ("when you draw", Axe Woves) or about the other side ("when an opponent
   * draws", Crosshair), and a listener that only ever saw its own controller could not express the
   * second. Every registration therefore compares this against `ctx.owner`.
   */
  drawingPlayer?: PlayerId
  /**
   * `whenPlayCard`: who played the card. Like `drawingPlayer`, the point fires on both players, so
   * every registration compares this against `ctx.owner` ("when you play" or "when an opponent plays").
   * Also on a played upgrade's `whenUpgradeAttached`, since an opponent can play one on your unit.
   */
  playingPlayer?: PlayerId
  /**
   * `whenUnitAttacks`: whose unit is attacking. The point fires on both players, so every
   * registration compares this against `ctx.owner` ("a friendly unit attacks" or "an enemy unit attacks").
   */
  attackingPlayer?: PlayerId
  /** `whenHealed`: how much damage the heal actually removed from the unit. */
  amountHealed?: number
  /** `whenDrawCards`: how many cards that one draw event drew. Fires once per event, not per card. */
  cardsDrawn?: number
}

export interface PendingTrigger {
  id: string
  /** Whose ability it is, and therefore whose order it is (CR 7.6.9). */
  controller: PlayerId
  point: TriggerPoint
  /**
   * The card the ability belongs to. An upgrade's ability is attributed to the **upgrade**, not to
   * the unit hosting it, which is what lets a prompt tell one owed ability from another.
   */
  cardId: string
  /** Index into that card's registered abilities, since one card may carry two at the same point. */
  abilityIndex: number
  /**
   * Nesting depth (CR 7.6.11). A batch that fires together shares a layer; anything triggered *while*
   * resolving one of them sits one deeper and resolves first.
   *
   * The layer is what makes a nested ability un-orderable against the batch it interrupted: the rules
   * say it "must be resolved next", so only abilities that triggered at the same time are ever offered
   * as a choice. Ordering questions are therefore asked within a layer, never across two.
   */
  layer: number
  /** The in-play instance the ability fires from, when it still exists. */
  sourceInstanceId?: string
  /**
   * The controller has already named this one as the next to resolve (CR 7.6.9), so the dispatcher
   * runs it instead of asking again. Without it, moving the pick to the front is invisible to a
   * dispatcher that only counts how many are owed, and the same question repeats forever.
   */
  picked?: boolean
  /**
   * The ability is on the controller's **undeployed leader** (its front side) rather than on a unit or
   * an upgrade, so it is looked up in `leaderAbilities` rather than in the card's unit abilities.
   */
  fromLeader?: boolean
  /** The event details the ability triggered with, replayed into its effect when it resolves. */
  ctx?: TriggerContext
}

/**
 * Every pending choice also carries `source`: the card that RAISED it, so a prompt can say why the
 * player is being asked (#374). It is stamped automatically by the ability dispatcher rather than
 * passed at each of the ~185 `pushChoice` call sites, and inherited by follow-up choices.
 *
 * A distributive conditional, not a plain intersection: `(A | B) & C` collapses the union, which
 * would break the ~19 `Extract<PendingChoice, { kind: 'x' }>` lookups across the UI and tests.
 * Distributing keeps `PendingChoice` a genuine union of already-stamped variants, so `Extract`,
 * `switch (choice.kind)` narrowing and exhaustiveness all keep working.
 */
export type PendingChoice = WithChoiceSource<ChoiceVariant>
type WithChoiceSource<T> = T extends unknown ? T & { source?: DamageSource } : never

/**
 * A decision the resolver pauses on until its `controller` picks an option or skips.
 * `id` addresses the choice so the controller can resolve several simultaneous ones
 * in an order of their choosing (CR: the active player orders simultaneous triggers).
 * `resumeAtInitiative` marks choices raised at round-start readying (`whenReadies`) —
 * once the queue drains, play resumes with the initiative holder, not `advanceTurn`.
 */
type ChoiceVariant =
  | { kind: 'ambush'; id: string; controller: PlayerId; unitId: string }
  | { kind: 'support'; id: string; controller: PlayerId; unitId: string }
  | { kind: 'payOrExhaust'; id: string; controller: PlayerId; unitId: string; cost: number; resumeAtInitiative?: boolean }
  | { kind: 'mayPlayTopFree'; id: string; controller: PlayerId; unitId: string; cardId: string }
  | { kind: 'mayDamageExhaust'; id: string; controller: PlayerId; unitId: string; arena: Arena }
  // Improvised Identity: search the revealed top cards for a ground unit to
  // discard (`revealed` are the top-of-deck ids, pickable by deck index), then a
  // `mayAttack` follows, granting the discarded card's abilities for that attack.
  | { kind: 'search'; id: string; controller: PlayerId; unitId: string; revealed: string[] }
  | { kind: 'mayAttack'; id: string; controller: PlayerId; unitId: string; grantCardId?: string }
  // Optional targeted effects, e.g. from an On Attack ability: `targets` are the
  // eligible unit instance ids; the controller picks one or declines.
  // `rewardIfDefeated`: if the damage defeats the target, give `count` Advantage to `instanceId`
  // (Imposing Scout Walker → its own unit).
  // `rewardIfDefeated`: if the damage defeats the target, either give `count` Advantage to a fixed
  // `instanceId` (Imposing Scout Walker), or let the controller give `chooseAdvantage` Advantage to a
  // chosen unit (Justifier).
  // `thenSearchDraw` chains "if you do, search the top N for a unit and draw it" (8D8).
  | { kind: 'mayDamage'; id: string; controller: PlayerId; unitId: string; targets: string[]; amount: number; optional?: boolean; rewardIfDefeated?: { instanceId: string; count: number } | { chooseAdvantage: number }; thenSearchDraw?: number; source?: DamageSource }
  // Give `count` of a token to a chosen target. `optional` (default true) offers a decline.
  // `thenBuff` is the card's separate second sentence, with a target of its own: Mislead shields one
  // unit and then debuffs any unit, which is two picks rather than one effect on one unit.
  | { kind: 'mayGiveTokens'; id: string; controller: PlayerId; token: string; count: number; targets: string[]; optional?: boolean; thenBuff?: { power?: number; hp?: number } }
  | { kind: 'mayAdvantageEach'; id: string; controller: PlayerId; unitId: string; targets: string[] }
  // Vane: defeat a friendly upgrade (chosen from `candidates`, cards or tokens); then the
  // `then` damage-target selection follows. `optional` = the deployed "may" version (a Cancel is
  // offered); the front action is mandatory. Each candidate is the exact upgrade (unit + index).
  // Vane chains 2 damage via `then`; Clan Vizsla Soldier just defeats the upgrade (`then` omitted).
  // `thenReadyUnit` readies that unit instead — "if you do, ready this unit" (Pegasus Tri-Wing).
  // `thenSearchUpgrade` searches the top N for an upgrade that can attach to the unit the defeated
  // one was on, at `discount` off its cost (Reforge).
  | { kind: 'selectUpgradeToDefeat'; id: string; controller: PlayerId; candidates: UpgradeRef[]; optional: boolean; then?: DamageTargetSpec; thenReadyUnit?: string; thenDraw?: number; thenSearchUpgrade?: { depth: number; discount: number } }
  // Reforge: play one of the revealed upgrades onto `unitId`, paying `discount` less than its cost.
  // `revealed` are held out of the deck; the leftovers go to the bottom when this resolves.
  | { kind: 'searchPlayUpgrade'; id: string; controller: PlayerId; unitId: string; revealed: string[]; eligibleIndices: number[]; discount: number }
  // Return a chosen card from your discard to your hand (Moff Gideon). `candidates` are the
  // eligible discard-pile card ids; `acceptChoice`'s `optionIndex` picks one. Optional.
  // `then: 'discardFate'` chains the bottom-and-heal / return-to-hand modal (Trask Walker)
  // instead of the default return-to-hand.
  // `owners`, index for index with `candidates`, names whose discard pile each card is in when the
  // choice reaches both (Bounty Hunter Crew); absent, every candidate is the controller's own.
  | { kind: 'selectFromDiscard'; id: string; controller: PlayerId; candidates: string[]; optional: boolean; then?: 'discardFate'; owners?: PlayerId[] }
  // Trask Walker: optionIndex 0 = bottom the card and heal `heal` from your base,
  // 1 = return it to your hand. Mandatory once a card is chosen.
  | { kind: 'chooseDiscardFate'; id: string; controller: PlayerId; cardId: string; heal: number }
  // Pick one friendly and one enemy unit, then apply `mode` to both. Resolved in two accepts: the
  // first records `chosenFriendly` and re-offers with the enemy targets. Mandatory unless `optional`:
  // Chimaera prints "may", Diplomatic Pageantry does not.
  // `thenAdvantage` gives that many Advantage tokens to a friendly unit afterwards (Diplomatic Pageantry).
  | { kind: 'selectPair'; id: string; controller: PlayerId; friendlyTargets: string[]; enemyTargets: string[]; chosenFriendly?: string; mode: 'defeat' | 'exhaust'; optional?: boolean; thenAdvantage?: number }
  // Return one of `candidates` (upgrades in play) to its owner's hand. Mandatory unless `optional`:
  // Jabba the Hutt prints "may", Full of Surprises does not. `replayFree` is Jabba's own "if it's
  // returned to your hand, you may play it for free"; Junior Senator and Criminal Muscle print no such
  // thing.
  | { kind: 'selectUpgradeToReturn'; id: string; controller: PlayerId; candidates: UpgradeRef[]; optional?: boolean; thenShield?: boolean; replayFree?: boolean }
  // Choose one of `candidates` (upgrades in play) for the card's `ifYouDo` hook (Jocasta Nu).
  // `hookOnDecline` runs the hook with no upgrade on a decline, at the step `then` carries (Jump to Lightspeed).
  | { kind: 'selectUpgradeThen'; id: string; controller: PlayerId; candidates: UpgradeRef[]; optional?: boolean; text: string; then: IfYouDo; hookOnDecline?: boolean }
  // Choose one of your hand cards at `handIndices` for the card's `ifYouDo` hook, which is told the
  // card and its hand index (Cin Drallig). The card stays in hand until the hook moves it.
  | { kind: 'selectHandCardThen'; id: string; controller: PlayerId; handIndices: number[]; optional?: boolean; text: string; then: IfYouDo }
  // Jabba the Hutt: having returned `cardId` to your own hand, may attach it free to a unit.
  | { kind: 'mayPlayUpgradeFree'; id: string; controller: PlayerId; cardId: string; targets: string[] }
  // Jod Na Nawood: may pay `cost`, then exhaust every unit in the chosen arena
  // (optionIndex 0 = ground, 1 = space).
  | { kind: 'mayPayExhaustArena'; id: string; controller: PlayerId; cost: number }
  // Queen Soruna: may reveal a unit from hand (`handIndices`); the revealed card's cost
  // then picks out the units that can be damaged.
  | { kind: 'revealUnitFromHand'; id: string; controller: PlayerId; handIndices: number[]; amount: number }
  // Choose where to deal a fixed amount of damage: a unit (`unitTargets`) or a base
  // (`baseTargets`, by owner). Mandatory. Vane's "deal 2 to a base / the defending unit or a base".
  // `thenHealBase` is the tail of a card that damages and then heals (Grassroots Resistance), so
  // the target is picked in the order the card reads rather than after its own second sentence.
  // `thenReadyIfTrait` readies the unit just hit when it has that trait ("If it's a Clone, ready it",
  // Remove the Chip). `thenDamage` is a SECOND pick: "and 1 damage to another enemy unit" (I'll Cover
  // For You), or "you may deal damage equal to the number of damaged enemy units" (Backed by Black
  // Sun), whose amount can only be counted once the first hit has landed.
  | { kind: 'selectDamageTarget'; id: string; controller: PlayerId; amount: number; unitTargets: string[]; baseTargets: PlayerId[]; optional?: boolean; source?: DamageSource; thenHealBase?: number
      thenReadyIfTrait?: string
      thenDamage?: { amount?: number; perDamagedEnemy?: boolean; scope: 'anotherEnemy' | 'anyUnit'; optional?: boolean }
      // "…and attack with it" (Fiery Alliance): the unit just damaged attacks, if it still can.
      thenAttackWithIt?: boolean
      // "If you do, that base's controller draws a card" (R2-D2, Getting His Chance).
      thenBaseOwnerDraws?: boolean
      // "…and ready it" (Academy Disciplinarian): the unit just damaged readies, if it survived.
      thenReadyIt?: boolean }
  // Greef Karga front: on playing a unit, may exhaust the leader to give it an Advantage token.
  // `unitId` is the just-played unit to receive the token.
  | { kind: 'mayExhaustLeaderForAdvantage'; id: string; controller: PlayerId; unitId: string }
  // "This phase" buff: pick a unit among `targets` and grant it the given power/HP/keywords for the
  // phase. Mandatory unless `optional`: Baylan's On Attack prints "may", Display of Strength does not.
  // `thenMayAttack` chains "you may attack with that unit" (T-6 Shuttle 1974).
  // `thenExhaustWeakerEnemiesInArena` exhausts each enemy unit in the buffed unit's arena with less power
  // than it has once buffed (Prime Minister Almec).
  | { kind: 'mayLastingBuff'; id: string; controller: PlayerId; targets: string[]; optional?: boolean; power?: number; hp?: number; keywords?: KeywordInstance[]; thenMayAttack?: boolean
      thenExhaustWeakerEnemiesInArena?: boolean
      // The Student Guides the Master: power is +1 per friendly unit weaker than the chosen one,
      // so it can only be worked out once a target is picked.
      powerPerWeakerFriendly?: boolean }
  // Ezra front: on a friendly attack ending, may exhaust the leader to give an Advantage
  // token to one of `targets` (a unit other than the attacker), or decline.
  | { kind: 'mayExhaustLeaderGiveAdvantage'; id: string; controller: PlayerId; targets: string[] }
  // Ezra deployed: may give an Advantage token to one of `targets`, or decline (no cost).
  | { kind: 'mayGiveAdvantage'; id: string; controller: PlayerId; targets: string[] }
  // Shin Hati front: on a friendly attack ending, may exhaust the leader to exhaust one of
  // `targets` (a ready unit cheaper than the base damage dealt), or decline.
  | { kind: 'mayExhaustLeaderExhaustUnit'; id: string; controller: PlayerId; targets: string[] }
  // Exhaust one of `targets`. Mandatory unless `optional`: Shin Hati deployed prints "may", Evasive
  // Maneuver does not. `markUsed`, when set, marks a once-per-round triggered ability as spent on acceptance.
  // `thenAttackWithAnother` chains "if you do, attack with another unit", lending that attack the
  // carrier's rider (Accelerate Our Plans).
  | { kind: 'mayExhaustUnit'; id: string; controller: PlayerId; targets: string[]; optional?: boolean; markUsed?: { instanceId: string; key: string }; thenAttackWithAnother?: { grantCardId: string } }
  // Choose-one / modal: pick exactly one of `options` (Sloane). Each option is a small
  // serialisable effect descriptor, resolved by index; mandatory (no decline).
  | { kind: 'chooseOne'; id: string; controller: PlayerId; options: ChooseOption[] }
  /**
   * CR 7.6.10: with triggers owed on BOTH sides, the **active player** chooses which player resolves
   * theirs first. Option 0 is us, option 1 is them.
   *
   * They choose the player and nothing else. The opponent's internal order stays the opponent's
   * (CR 7.6.9), which is why this carries no target and no list: offering anything finer would be
   * offering a decision that is not theirs to make.
   */
  | { kind: 'chooseTriggerOrder'; id: string; controller: PlayerId }
  /**
   * CR 7.6.9: a player with several of their own abilities owed at once chooses the order.
   *
   * `cardId` rides alongside the trigger id so a prompt can name the card each waiting ability came
   * from. Two abilities off one unit are otherwise indistinguishable, and one of them is routinely an
   * upgrade's rather than the host's.
   *
   * Only raised for two or more: a single owed ability is not a decision.
   */
  // `sourceInstanceId` is what tells two copies of one card apart: the same ability on two units is a
  // real ordering decision, and without the instance the prompt would offer two identical buttons.
  | { kind: 'chooseNextTrigger'; id: string; controller: PlayerId; candidates: { triggerId: string; cardId: string; sourceInstanceId?: string }[] }
  // Luke front: may exhaust the (undeployed) leader to heal `amount` from `unitId`, or decline.
  | { kind: 'mayExhaustLeaderHealUnit'; id: string; controller: PlayerId; unitId: string; amount: number }
  // Luke deployed: heal `amount` from a chosen unit (`unitTargets`) or base (`baseTargets`). Mandatory.
  // `thenShield` gives the healed unit a Shield token as part of the same effect (Perserverance).
  | { kind: 'selectHealTarget'; id: string; controller: PlayerId; amount: number; unitTargets: string[]; baseTargets: PlayerId[]; optional?: boolean; thenShield?: boolean }
  // Play a unit from hand as part of an ability: pick one of `candidates` (affordable hand
  // units), paying its cost + `costDelta`, entering ready if `entersReady` (Fennec, Moff Gideon).
  // `thenDamageIt` deals that much to the unit just played — "Play a unit from your hand. It costs 4
  // less. Deal 4 damage to it" (Reckless Landing), which can only be aimed once it is on the board.
  // `thenTokens` lists the tokens the unit just played receives, attaching together as one grant: a
  // Shield (Rio Durant's "it gains Shielded", Soresu Stance), Experience tokens (Phantom, The Burden
  // of Masters), or one of each (Three Lessons).
  // `thenDamageOwnBase` deals the played unit's printed cost to its controller's base (Galactic Ambition).
  // `thenDelay` leaves a delayed effect about the played unit (Sneak Attack defeats it at the regroup phase).
  // `thenLasting` gives the played unit a lasting effect (Shien Flurry's prevention). `thenDefeat` defeats
  // these units once the play is settled, played or declined (Consolidation of Power).
  // `then` is the card's own follow-up, run once the unit is on the board and paid for, with the
  // played card in `cardChosen` ("Play 2 units from your hand, one at a time" — General Grievous
  // offers the second play from the state the first one left, so its cost is read against what is
  // still ready). It does not run when the play is declined.
  | { kind: 'playUnitFromHand'; id: string; controller: PlayerId; candidates: HandCardRef[]; costDelta: number; entersReady: boolean; optional?: boolean; thenDamageIt?: number; thenTokens?: string[]; thenDamageOwnBase?: boolean; thenDelay?: { cardId: string; when: DelayedEffect['when'] }; thenLasting?: Omit<LastingEffect, 'targetInstanceId'>; thenDefeat?: string[]; then?: IfYouDo }
  // Additional cost "exhaust a friendly unit": pick one of `targets` to exhaust, then the
  // `then` play-from-hand step follows (Fennec). Mandatory.
  | { kind: 'selectUnitToExhaust'; id: string; controller: PlayerId; targets: string[]; then: PlayFromHandSpec }
  // The one door for playing a card out of somewhere other than the Play a Card action: any card
  // type, out of `zone`, answered by `optionIndex` into `candidates`. `free` bypasses the cost and
  // the aspect penalty (CR 8.5); `costDelta` adjusts it; `waive` forgives aspect penalties. An
  // upgrade cannot be priced until its host is known, so it goes on to `attachPlayedCard`.
  // `markUsed` spends a limited triggered ability on acceptance, before the play, so the play's own
  // triggers already see it spent (L3-37 replaying an event does not offer a third play).
  | { kind: 'playCardFrom'; id: string; controller: PlayerId; zone: PlayFromZone; candidates: PlayFromRef[]; optional?: boolean; free?: boolean; costDelta?: number; waive?: AspectWaiver; targetUnits?: string[]; then?: PlayFromTail; markUsed?: { instanceId: string; key: string } }
  // Follow-up: attach the upgrade picked above to one of `targets`, paying for it there. Mandatory.
  // `candidates` is the list the `playCardFrom` above offered, carried through so a `then.again`
  // re-offer can re-index what is left: an upgrade's play finishes HERE, not at the pick, so the
  // re-offer has to be able to fire from this step too (Kylo Ren's "any number of upgrades").
  | { kind: 'attachPlayedCard'; id: string; controller: PlayerId; zone: PlayFromZone; index: number; cardId: string; targets: string[]; candidates?: PlayFromRef[]; targetUnits?: string[]; free?: boolean; costDelta?: number; waive?: AspectWaiver; then?: PlayFromTail }
  // "You may resource a card from your hand" (Osha), answered by `handIndex`. Always a may.
  | { kind: 'mayResourceFromHand'; id: string; controller: PlayerId }
  // Optionally pay `cost` to draw `draw` cards (Mandalorian). `cost` 0 = a free "may draw".
  // `thenDiscard` (Mos Espa Watermonger): after drawing, discard that many cards from hand —
  // but only if a card was actually drawn ("you may draw a card. If you do, discard a card").
  | { kind: 'mayPayToDraw'; id: string; controller: PlayerId; cost: number; draw: number; thenDiscard?: number }
  // Discard `count` cards from your own hand, one at a time. Mandatory unless `optional`.
  // Resolved by an `acceptChoice` carrying the hand index. `then` runs after the last discard: Ninth
  // Sister distributes the discarded card's cost as damage (`distributeDamageTo`); Razor Crest gives a
  // unit a "this phase" buff (`buffUnit`).
  // `buffFor` is the other half of "an opponent may discard a card. If they do, give a non-Vehicle
  // unit -8/-8" (Kouhun Assassination): the OPPONENT answers this discard, and the debuff pick then
  // goes to `buffFor`, who is the player that played the card.
  // `ifYouDo` hands the discarded card to the card's own `ifYouDo` hook (R2-D2, Ahsoka Tano).
  | { kind: 'selectDiscard'; id: string; controller: PlayerId; count: number; optional?: boolean; then?: { distributeDamageTo: PlayerId } | { buffUnit: string; power?: number; hp?: number } | { dealDamage: number; costlierThanDiscard?: boolean } | { exhaustUnit: true } | { buffFor: PlayerId; power?: number; hp?: number; nonVehicleOnly?: boolean } | { ifYouDo: IfYouDo } }
  // "You may <cost>. If you do, <effect>": a yes/no that pays `cost` resources, or deals `damageSelf`
  // to the source, or only reveals an event (`revealEvent`, which costs nothing and leaves the card in
  // hand), and then runs the card's `ifYouDo` hook. `text` is the effect, for the prompt.
  // `declineStep` runs the hook on a decline too, at that step, for an ability that goes on either way
  // ("you may deal 5 instead", "unless its controller says no").
  | { kind: 'mayPayThen'; id: string; controller: PlayerId; cost: number; damageSelf?: number; revealEvent?: boolean; text: string; then: IfYouDo; declineStep?: string }
  // Choose one of `targets` and hand it to the card's `ifYouDo` hook, for an ability that does more
  // than one thing to the unit it picks, or whose effect depends on it. Mandatory unless `optional`.
  // `text` names what the pick is for, for the prompt.
  // `hookOnDecline` runs the hook with no unit when the choice is declined, for an ability that goes on
  // after its picks stop ("If no friendly units were damaged by this ability", AAT Incinerator).
  | { kind: 'selectUnitThen'; id: string; controller: PlayerId; targets: string[]; optional?: boolean; text: string; then: IfYouDo; hookOnDecline?: boolean }
  // "Choose a player": option 0 is the controller's opponent, option 1 the controller. Never optional.
  // The chosen player reaches the card's `ifYouDo` hook as `playerChosen`. `text` is the effect.
  | { kind: 'choosePlayerThen'; id: string; controller: PlayerId; text: string; then: IfYouDo }
  // Pick one of `candidates` (card ids: cards in a discard pile, or revealed from a deck) for the card's
  // `ifYouDo` hook, which is told the card and its option index and decides what happens to it. A deck
  // holds duplicates, so a hook that needs a position reads the index. `hookOnDecline` runs the hook with
  // no card when the pick is declined, for an ability that goes on after its picks stop.
  | { kind: 'selectCardThen'; id: string; controller: PlayerId; candidates: string[]; optional?: boolean; text: string; then: IfYouDo; hookOnDecline?: boolean }
  // "Choose an arena": option 0 is ground, option 1 space. Never optional. The arena reaches the card's
  // `ifYouDo` hook as `arenaChosen`.
  | { kind: 'chooseArenaThen'; id: string; controller: PlayerId; text: string; then: IfYouDo }
  // Heal 1 at a time from `unitTargets` / `baseTargets` until `remaining` is spent or Done, then deal
  // what was healed to `damageUnit`, when there is one (Redemption). `oneUnit` keeps every point on the first unit picked
  // (Kashyyyk Defender's "from another unit").
  | { kind: 'distributeHealing'; id: string; controller: PlayerId; remaining: number; healed: number; unitTargets: string[]; baseTargets: PlayerId[]; damageUnit?: string; oneUnit?: boolean }
  // Leia Organa: a yes/no — deal `selfDamage` to `unitId`, then heal `healBase` from your base.
  | { kind: 'maySelfDamageHealBase'; id: string; controller: PlayerId; unitId: string; selfDamage: number; healBase: number }
  // Mando's N-1: a yes/no — exhaust your (ready) leader to give `unitId` a "+power/+hp this phase" buff.
  | { kind: 'mayExhaustLeaderBuffSelf'; id: string; controller: PlayerId; unitId: string; power: number; hp: number }
  // Deal `total` damage spread among any units (Ninth Sister), one point per pick until
  // `remaining` reaches 0. `targets` are the currently-eligible unit instance ids (both sides,
  // recomputed as units are defeated). Always optional — the controller may stop early (a "may").
  // `enemiesOf` keeps the re-offers to that player's enemy units, and makes the whole amount mandatory
  // while any remain (Emperor Palpatine's "deal 6 damage divided as you choose among enemy units").
  | { kind: 'distributeDamage'; id: string; controller: PlayerId; remaining: number; total: number; targets: string[]; enemiesOf?: PlayerId }
  // Distribute `total` tokens among `targets`, one per pick until `remaining` reaches 0. Unlike
  // `multiPick`'s give-advantage, targets stay eligible so tokens can stack. Every token is placed
  // (Fateful Goodbye) unless `upTo`, which may stop at any point (Elzar Mann), or `optional`, which may
  // decline before the first token only (Helgait's "you may").
  // `exclude` keeps a unit out of the target list across re-offers ("other friendly units"), and
  // `then` chains once distribution finishes, by exhausting the pool or stopping (Elzar Mann).
  // Re-offers go to the controller's own units unless `anyUnit` ("among any number of units", Ravage).
  | { kind: 'distributeTokens'; id: string; controller: PlayerId; token: string; remaining: number; total: number; targets: string[]; optional?: boolean; upTo?: boolean; exclude?: string; then?: 'opponentSearchEvent'; anyUnit?: boolean }
  // Enoch: deal up to `max` damage to your own base, one at a time (`dealt` so far); stopping
  // (or reaching `max`) grants "next unit costs 1 less per 2 damage dealt". Each accept deals 1 more.
  | { kind: 'dealOwnBaseForDiscount'; id: string; controller: PlayerId; dealt: number; max: number }
  // Return a chosen friendly non-leader unit (`targets`) to hand, then the `then` follow-up:
  // 'damageEqualToCost' (Purrgil Ultra) or 'returnEnemyUnit' (Far Far Away). Mandatory unless
  // `optional`: Purrgil Ultra prints "may", Far Far Away does not.
  | { kind: 'returnFriendlyUnit'; id: string; controller: PlayerId; targets: string[]; optional?: boolean; then?: 'damageEqualToCost' | 'returnEnemyUnit' }
  // Return one of `targets` to its owner's hand. Distinct from returnFriendlyUnit in that the card
  // supplies the eligible units, which may be the opponent's. Mandatory unless `optional`, as are the
  // ready, steal and distribute-source picks below.
  // `thenExhaustOtherEnemiesInArena` exhausts every OTHER enemy unit standing in the returned unit's
  // arena (Watch This) — which arena that is depends on the pick, so it cannot be decided up front.
  // `thenWipeNonLeaders` is Rhydonium Detonation: both players are offered their save at once, and the
  // wipe follows once neither offer is still outstanding.
  | { kind: 'selectUnitToReturn'; id: string; controller: PlayerId; targets: string[]; optional?: boolean; thenExhaustOtherEnemiesInArena?: boolean; thenWipeNonLeaders?: boolean }
  // Galvanized Leap: ready one of `targets`.
  // `thenDamage` is the card's second sentence, with a target of its own (Fervor).
  // `thenCannotAttack` is "if you do, it can't attack your base or units you control for this phase"
  // (Chaotic Diversion). With two players that is every attack the unit could make.
  | { kind: 'selectUnitToReady'; id: string; controller: PlayerId; targets: string[]; optional?: boolean; thenDamage?: { amount: number }; thenCannotAttack?: boolean }
  // Choose a friendly unit, for a follow-up named by `then` (Hotshot Maneuver).
  | { kind: 'selectFriendlyUnit'; id: string; controller: PlayerId; targets: string[]; then: 'hotshotManeuver' }
  // Rehabilitation: take control of one of `targets` until the regroup phase, debuffing it by
  // `power`/`hp` for this phase.
  | { kind: 'selectUnitToSteal'; id: string; controller: PlayerId; targets: string[]; optional?: boolean; power?: number; hp?: number }
  // Play a unit from your discard for free (One Must Destroy to Create, Dathomiri Magicks).
  // `candidates` are discard-pile card ids; `acceptChoice`'s `optionIndex` picks one. `remaining`
  // counts how many more may be played after this one, so the offer re-raises until the pool runs out.
  // "Choose one:", a modal effect. `modes` holds only the options the card allows right now, so a
  // mode whose condition isn't met is never offered. Mandatory: "choose one" is never optional.
  // With `then`, the card resolves the mode itself: its `ifYouDo` runs with the picked mode as `step`,
  // and `labels` (one per mode) name the buttons. Without it, the mode is one of the engine's own keys.
  | { kind: 'chooseMode'; id: string; controller: PlayerId; modes: string[]; labels?: string[]; then?: IfYouDo }
  // Treacherous Minefield: pick an arena (optionIndex 0 = ground, 1 = space); every unit there
  // gains `grantCardId`'s abilities for the phase.
  | { kind: 'selectArenaToGrant'; id: string; controller: PlayerId; grantCardId: string }
  // Sense Through the Force: name a number from 0 to `max`, then search — the guess is checked
  // against the drawn card's cost.
  // `then` is Sense Through the Force's search, or the card's `ifYouDo` hook, told the number as `optionIndex`.
  | { kind: 'chooseNumber'; id: string; controller: PlayerId; max: number; then: 'senseThroughTheForce' | IfYouDo; text?: string }
  // Hold Them Off: pick the unit that will deal the damage; its power becomes the pool to spread
  // among units in its own arena.
  | { kind: 'selectDistributeSource'; id: string; controller: PlayerId; targets: string[]; optional?: boolean }
  // Reanimated Night Trooper, stage 1 (#388): choose which deck to look at (`acceptChoice`'s
  // `baseTarget` picks one of `decks`), or decline outright. Choosing a deck reveals its top card
  // rather than discarding it — that decision is the follow-up `mayDiscardTop` choice below.
  | { kind: 'peekTopDiscard'; id: string; controller: PlayerId; decks: PlayerId[] }
  // Reanimated Night Trooper, stage 2: the top card of `deck` (`cardId`) is now revealed. Accept
  // discards it; decline leaves it on top.
  | { kind: 'mayDiscardTop'; id: string; controller: PlayerId; deck: PlayerId; cardId: string }
  // Look at `target`'s hand (Imperial Defector / Remnant Lookouts) — the controller sees it
  // revealed. View-only unless `mayDiscard`, when the controller may discard one of the target's
  // cards (an `acceptChoice` with its hand index); `thenDraw` then has the target draw a card.
  // `mustDiscard` removes the Done, for a card that says "discards a card" rather than "may discard"
  // (Reveal Intentions). The view-only and "may" forms keep it.
  // `discardFilter` narrows what may be taken — Bodhi Rook discards "a non-unit card", so only
  // those hand indices are offered; Jam Communications takes only an event. `discardAspects` keeps
  // the cards sharing one of those aspects (Hold For Questioning). A hand with nothing eligible keeps
  // its Done even under `mustDiscard`, or the choice would have no legal move.
  // `thenNameCard` raises a `nameCard` once the look is done (Qi'ra looks, then names).
  | { kind: 'lookAtHand'; id: string; controller: PlayerId; target: PlayerId; mayDiscard?: boolean; thenDraw?: boolean; mustDiscard?: boolean; discardFilter?: 'nonUnit' | 'event'; discardAspects?: string[]; thenNameCard?: { unitId: string; surcharge: number } }
  // Search the revealed top cards (Clan Wren Loyalist): pick one of the `eligibleIndices`
  // (indices into `revealed`) to draw; the rest go to the bottom of the deck. Resolved by an
  // `acceptChoice` carrying the `deckIndex` (0-based within `revealed`). Mandatory when eligible.
  // `guessedCost` carries Sense Through the Force's named number: if the drawn card's cost matches,
  // the follow-up Advantage offer fires.
  // `discardRest` sends the cards not drawn to the discard pile instead of the deck bottom — "draw a
  // unit revealed this way, then discard the other revealed cards" (I've Found Them).
  // `remaining` draws more than one from the same window (Grand Moff Tarkin: "up to 2"), re-offering
  // itself until it runs out or the player stops. `upTo` is what allows stopping (CR 8.30.1); without
  // it a search is mandatory while anything matches. `held` says the revealed cards have been pulled
  // OUT of the deck by an earlier pass, so they are bottomed by appending rather than by rotating the
  // top — getting that wrong either duplicates or deletes them.
  // `resourceIt` puts the chosen card into play as a resource, exhausted, instead of drawing it
  // (Jendirian Valley).
  // `shuffle` shuffles the deck once the card is drawn, for a search of the whole deck (Search Your Feelings).
  // `then` is the rest of the ability once the search is settled, drawn or not (Captain Vaughn).
  // `discardIt` discards the found card instead of drawing it, and `grantPlay` then leaves a
  // `DiscardPlayGrant` for it on those terms: "search …, discard it, and for this phase you may play
  // that card from your discard pile" (Cobb Vanth, Aid from the Innocent).
  | { kind: 'searchDraw'; id: string; controller: PlayerId; revealed: string[]; eligibleIndices: number[]; guessedCost?: number; discardRest?: boolean; remaining?: number; upTo?: boolean; held?: boolean; resourceIt?: boolean; shuffle?: boolean; discardIt?: boolean; grantPlay?: Omit<DiscardPlayGrant, 'player' | 'owner' | 'cardId'>; then?: IfYouDo }
  // The Cyborg Mech: deal `undamagedAmount` to a chosen undamaged target, or `damagedAmount`
  // to a damaged one (the amount is decided by the picked unit's damage). Mandatory board-target.
  | { kind: 'variableStrike'; id: string; controller: PlayerId; targets: string[]; undamagedAmount: number; damagedAmount: number }
  // Barriss Offee: heal up to `maxHeal` from a chosen unit and give it that many Advantage
  // tokens (one per damage healed). Optional board-target — only damaged units are eligible.
  | { kind: 'healForAdvantage'; id: string; controller: PlayerId; targets: string[]; maxHeal: number }
  // Moff Jerjerrod: after creating `count` tokens, you may defeat `unitId` to create `count`
  // more (equivalent to "create twice that number instead"). A yes/no.
  | { kind: 'mayDoubleTokens'; id: string; controller: PlayerId; unitId: string; token: string; count: number }
  // Name a card (Ryder Azadi) — resolved by an `acceptChoice` carrying `cardName`; the name is
  // recorded on `unitId` (a `namedCard`), forbidding the opponent from playing cards with that name
  // while it's in play. Mandatory.
  // `surcharge` names the card for a COST INCREASE instead of a prohibition (Qi'ra: "each card with
  // that name costs 3 more for your opponents"). The two are mutually exclusive on a unit.
  // `phaseBan` records the name on the game instead, so nobody can play it this phase (Transmission Jamming).
  // `then` hands the name to the card's `ifYouDo` hook as `nameChosen` instead of recording it (Zuckuss, Chimaera).
  | { kind: 'nameCard'; id: string; controller: PlayerId; unitId: string; surcharge?: number; phaseBan?: boolean; then?: IfYouDo }
  // "You may put the top card of your deck into play as a resource" (Resupply Carrier, Cham
  // Syndulla) — a yes/no, raised only when there is a card to take.
  | { kind: 'mayResourceTop'; id: string; controller: PlayerId }
  // "You may defeat this unit. If you do, [search]" (Admiral Ackbar) — a yes/no. Accept defeats
  // `unitId` and starts the search-and-play-free (below); skip leaves the unit in play.
  | { kind: 'mayDefeatSelfSearch'; id: string; controller: PlayerId; unitId: string }
  // Search the revealed cards (held out of the deck) and play space units for free while a combined-cost
  // `budget` lasts (Admiral Ackbar). Pick one `eligibleIndices` (indices into `revealed`) at a time
  // via an `acceptChoice`'s `deckIndex`; skip (Done) stops. Leftover revealed cards return to the bottom.
  // `playOne` stops after a single pick rather than spending the whole budget, and `entersReady`
  // brings it in ready — "play it for free. It enters play ready" (Eye of Sion).
  // `filter` says what the card is looking for — Ackbar's space units, L3-37's Droids, Darth Vader's
  // Villainy units. It is carried on the choice because the re-offer after each play has to apply the
  // SAME filter; hardcoding one card's made every other search offer the wrong cards.
  // `costDelta` makes the play a paid one at a discount instead of free (Kelleran Beq: "it costs 3
  // less"), and then eligibility is what the player can afford rather than what fits `budget`.
  // `thenDelay` leaves a delayed effect about the unit played (Triple Dark Raid returns it to hand).
  // `maxPlays` caps how many units the budget may buy (U-Wing Reinforcement's "up to 3").
  // `filter.maxCost` caps each unit's own cost, for a search with no combined budget ("up to 2 units that
  // each cost 4 or less"), and `thenDamage` deals that much to each unit as it is played (Darth Vader).
  | { kind: 'searchPlayFree'; id: string; controller: PlayerId; revealed: string[]; eligibleIndices: number[]; budget: number; playOne?: boolean; entersReady?: boolean; filter?: { trait?: string; aspect?: string; arena?: Arena; maxCost?: number }; costDelta?: number; thenDelay?: { cardId: string; when: DelayedEffect['when'] }; maxPlays?: number; thenDamage?: number }
  // Rancor Keeper: "deal 1 damage to any number of bases" — repeatable, each base at most
  // once; `remaining` are the bases not yet picked. Skip finishes. `heal` heals each picked base
  // instead ("heal 2 damage from each of any number of bases", Coruscanti Spy).
  | { kind: 'damageAnyBases'; id: string; controller: PlayerId; remaining: PlayerId[]; amount: number; source?: DamageSource; heal?: boolean }
  /**
   * The Mandalorian: may defeat a Shield on `preventerId` to prevent `amount` damage headed
   * for `targetId`. A yes/no. Raised on two paths:
   *  - combat, at the `prevent` attack stage, before any damage is calculated — accepting records
   *    the target on `pendingAttack.prevented` and the normal damage step skips it;
   *  - ability damage, where `dealDamageToUnit` defers instead of applying, and this choice's
   *    resolution applies it (declined) or drops it (accepted).
   * `followUp` carries the damage-dealing choice whose "if you do …" tail must only run when the
   * damage actually lands.
   */
  | { kind: 'mayPreventDamage'; id: string; controller: PlayerId; preventerId: string; targetId: string; amount: number; source?: DamageSource; combat?: boolean; followUp?: PendingChoice }
  // Bothan-5: may capture `cardId` from your discard under `unitId`. A yes/no;
  // `markUsed` records the once-each-round use when accepted.
  | { kind: 'mayCapture'; id: string; controller: PlayerId; unitId: string; cardId: string; markUsed?: { instanceId: string; key: string } }
  // Cobb Vanth: may deal `amount` to `selfId`; if you do, give a Shield to `targetId`. A yes/no.
  | { kind: 'maySelfDamageShield'; id: string; controller: PlayerId; selfId: string; targetId: string; amount: number }
  // Gar Saxon: may create `count` of a token unit. A yes/no; `markUsed` records the
  // once-each-round use on the source unit when accepted.
  | { kind: 'mayCreateToken'; id: string; controller: PlayerId; token: string; count: number; markUsed?: { instanceId: string; key: string } }
  // Optionally deploy your leader via a triggered epic action (Grogu). A yes/no.
  | { kind: 'mayDeployLeader'; id: string; controller: PlayerId }
  // Unique rule (CR): a player controlling two upgrades with the same title defeats one (their
  // choice). `candidates` are the duplicate instances; picking one defeats it. Mandatory.
  | { kind: 'selectUniqueToDefeat'; id: string; controller: PlayerId; cardId: string; candidates: UpgradeRef[] }
  | { kind: 'selectUniqueUnitToDefeat'; id: string; controller: PlayerId; cardId: string; candidates: string[] }
  // Attack with any ready unit (Thrawn, Grogu); it gains Restore `restore` for that attack, which is
  // 0 when nothing grants it. Resolved by making the attack on the board — skipping declines it.
  // Mandatory unless `optional`: Thrawn and the attack-granting events print "Attack with a unit",
  // so once their cost is paid the attack is compulsory, while Grogu prints "You **may** attack".
  // `grantCardId` lends the chosen attacker a carrier card's abilities for that attack — how the
  // attack-granting events (Rash Action, Follow Me, Masterstroke, Wipe Them Out) add their rider.
  // `attacker` narrows who may attack ("attack with a Vehicle unit"), and `exhausted` lets an
  // exhausted unit attack too ("even if it's exhausted", Dogfight).
  | { kind: 'mayAttackAnyUnit'; id: string; controller: PlayerId; restore: number; optional?: boolean; grantCardId?: string; attacker?: AttackerFilter; exhausted?: boolean }
  // Defeat one of `targets`. The card supplies the eligible units, so this covers "a non-leader enemy
  // unit" (Thrawn), "an upgraded non-leader unit" (Get Lost), and so on. Mandatory unless `optional`:
  // Thrawn prints "you may defeat", Get Lost does not.
  // `thenResource` chains "if you do, resource the top card of your deck" (Long Live the Empire).
  // `thenReplayFromDiscard` offers the defeated unit straight back from the discard, free
  // (One Must Destroy to Create).
  // `thenReadyFriendlyMaxPower` chains "if you do, ready a friendly unit with N or less power"
  // (You Have Failed Me).
  | { kind: 'selectUnitToDefeat'; id: string; controller: PlayerId; targets: string[]; optional?: boolean; thenResource?: boolean; thenReplayFromDiscard?: boolean; thenReadyFriendlyMaxPower?: number }
  // Sabine front: the opponent (`controller`) must give `count` Advantage tokens to one of
  // their units (`targets`). Mandatory when able — an opponent-interjected choice (pendingResumeActive).
  | { kind: 'opponentGivesAdvantage'; id: string; controller: PlayerId; count: number; targets: string[] }
  // Repeatable board-target pick: click eligible `targets` one at a time (each applies `spec`
  // immediately and re-offers), or Done (skipTrigger). Inspiring Veteran (up to N Advantage) / Pre
  // Vizsla (defeat non-leaders within an HP budget, a token each).
  | {
      kind: 'multiPick'; id: string; controller: PlayerId; targets: string[]
      // Once the picks are over, however they end, attack with this unit (Hotshot Maneuver).
      thenAttackWith?: string
      // `defeat` is a plain count ("defeat up to 2 enemy units", The Desolation of Hoth), where
      // `defeatForToken` spends an HP budget and pays a token per kill (Pre Vizsla).
      spec: { mode: 'giveAdvantage'; remaining: number } | { mode: 'defeatForToken'; budget: number; token: string } | { mode: 'dealEach'; amount: number; remaining: number } | { mode: 'exhaust'; remaining: number } | { mode: 'defeat'; remaining: number }
    }

/** The choice currently awaiting a decision (head of the queue), if any. */
export function activeChoice(state: GameState): PendingChoice | undefined {
  return state.pendingChoices?.[0]
}

/** True while any choice is pending (normal moves are suppressed). */
export function hasPendingChoices(state: GameState): boolean {
  return (state.pendingChoices?.length ?? 0) > 0
}

/** Find a pending choice by id. */
export function findChoice(state: GameState, id: string): PendingChoice | undefined {
  return state.pendingChoices?.find(c => c.id === id)
}

/**
 * Remove a specific choice by id; the queue becomes `undefined` when it empties.
 *
 * Always by id. A player may answer any of their outstanding choices, not just the one at the
 * head, so a "remove the head" helper silently consumed the wrong choice (#376 item 5) and is
 * deliberately not offered.
 */
export function removeChoice(state: GameState, id: string): GameState {
  const rest = (state.pendingChoices ?? []).filter(c => c.id !== id)
  return { ...state, pendingChoices: rest.length > 0 ? rest : undefined }
}

/** Append a choice to the pending queue (order = trigger order; the controller reorders). */
export function pushChoice(state: GameState, choice: PendingChoice): GameState {
  // A decided game resolves nothing (CR 6.6.2: once a player's base has 0 remaining HP they "cannot
  // resolve any abilities or effects"). Guarded HERE rather than at each caller because whether a
  // trigger is raised before or after the win check varies by card and by code path: Camtono revealed a
  // card on top of the game-over screen after an attack that won the game, and the player could neither
  // answer it nor dismiss it, since a decided game offers no legal moves.
  if (state.winner !== null) return state
  // Guarantee a unique id among pending choices — different triggers on the same played
  // unit (e.g. Support + Greef Karga) would otherwise collide and mislabel each other.
  const existing = state.pendingChoices ?? []
  let id = choice.id
  let n = 1
  while (existing.some(c => c.id === id)) id = `${choice.id}#${n++}`
  return { ...state, pendingChoices: [...existing, id === choice.id ? choice : { ...choice, id }] }
}

// ---------------------------------------------------------------------------
// Lasting effects + phase-event tracking
// ---------------------------------------------------------------------------

/** Add a transient modifier aimed at a unit — "this phase" unless it says `untilEndOfAttack`. */
export function addLastingEffect(state: GameState, effect: LastingEffect): GameState {
  return { ...state, lastingEffects: [...(state.lastingEffects ?? []), effect] }
}

/**
 * Drop the "this phase" lasting effects (called at the start of the regroup phase), and the phase's
 * banned names, shielded bases and discard-pile play permissions. A `untilRoundEnd` effect stays
 * until `clearRoundEffects`.
 */
export function clearLastingEffects(state: GameState): GameState {
  if (!state.lastingEffects && !state.bannedNames && !state.shieldedBases && !state.basesUnhealable && !state.discardPlayGrants) return state
  const kept = (state.lastingEffects ?? []).filter(e => e.untilRoundEnd)
  return {
    ...state, lastingEffects: kept.length > 0 ? kept : undefined,
    bannedNames: undefined, shieldedBases: undefined, basesUnhealable: undefined, discardPlayGrants: undefined,
  }
}

/** Add a "for this phase, you may play that card from <a> discard pile" permission. */
export function addDiscardPlayGrant(state: GameState, grant: DiscardPlayGrant): GameState {
  return { ...state, discardPlayGrants: [...(state.discardPlayGrants ?? []), grant] }
}

/** Drop the grant at `index` — it has been taken, or its card has left the pile. */
export function dropDiscardPlayGrant(state: GameState, index: number): GameState {
  const left = (state.discardPlayGrants ?? []).filter((_, i) => i !== index)
  return { ...state, discardPlayGrants: left.length > 0 ? left : undefined }
}

/** Leave an effect to happen later (`DelayedEffect`). */
export function addDelayedEffect(state: GameState, effect: DelayedEffect): GameState {
  return { ...state, delayedEffects: [...(state.delayedEffects ?? []), effect] }
}

/** Drop the lasting effects that last the round (called as the next round starts). */
export function clearRoundEffects(state: GameState): GameState {
  return state.lastingEffects ? { ...state, lastingEffects: undefined } : state
}

/** Clear both players' "next unit you play this phase" grants — a phase-boundary reset. */
export function clearNextUnitGrants(state: GameState): GameState {
  return {
    ...state,
    players: {
      player: { ...state.players.player, nextUnitGrants: undefined },
      opponent: { ...state.players.opponent, nextUnitGrants: undefined },
    },
  }
}

function emptyPhaseEvents(): PhaseEvents {
  return { enteredPlay: { player: [], opponent: [] }, defeated: { player: [], opponent: [] }, basesAttacked: [], basesDamaged: [], upgradesDefeated: [], damagedUnits: [], leftPlay: { player: [], opponent: [] }, leaderLeftPlay: [], played: { player: [], opponent: [] } }
}

/** Clear the tracked per-phase events (called whenever the phase changes). */
export function resetPhaseEvents(state: GameState): GameState {
  return state.phaseEvents ? { ...state, phaseEvents: undefined } : state
}

/** Note that `instanceId` entered play under `owner` this phase. */
export function recordUnitEntered(state: GameState, owner: PlayerId, instanceId: string): GameState {
  const events = state.phaseEvents ?? emptyPhaseEvents()
  return { ...state, phaseEvents: { ...events, enteredPlay: { ...events.enteredPlay, [owner]: [...events.enteredPlay[owner], instanceId] } } }
}

/** Note that `owner` played `cardId` this phase — recorded after its cost is paid. */
export function recordCardPlayed(state: GameState, owner: PlayerId, cardId: string): GameState {
  const events = state.phaseEvents ?? emptyPhaseEvents()
  return { ...state, phaseEvents: { ...events, played: { ...events.played, [owner]: [...events.played[owner], cardId] } } }
}

/** Card ids `owner` has played this phase, in order ("the first X you play each phase"). */
export function cardsPlayedThisPhase(state: GameState, owner: PlayerId): string[] {
  return state.phaseEvents?.played[owner] ?? []
}

/** Note that a unit with card id `cardId` was defeated under `owner` this phase. */
export function recordUnitDefeated(state: GameState, owner: PlayerId, cardId: string): GameState {
  const events = state.phaseEvents ?? emptyPhaseEvents()
  return { ...state, phaseEvents: { ...events, defeated: { ...events.defeated, [owner]: [...events.defeated[owner], cardId] } } }
}

/** Note that `attackerId` attacked `owner`'s base this phase (Greef Karga, Qui-Gon Jinn). */
export function recordBaseAttacked(state: GameState, owner: PlayerId, attackerId: string): GameState {
  const events = state.phaseEvents ?? emptyPhaseEvents()
  const basesAttacked = events.basesAttacked.includes(owner) ? events.basesAttacked : [...events.basesAttacked, owner]
  const attackers = events.baseAttackers?.[owner] ?? []
  const baseAttackers = attackers.includes(attackerId) ? events.baseAttackers : { ...events.baseAttackers, [owner]: [...attackers, attackerId] }
  return { ...state, phaseEvents: { ...events, basesAttacked, baseAttackers } }
}

/** Instance ids of the units that attacked `owner`'s base this phase. */
export function baseAttackersThisPhase(state: GameState, owner: PlayerId): string[] {
  return state.phaseEvents?.baseAttackers?.[owner] ?? []
}

/** Record that `attackerId` dealt combat damage to a base this phase (Moff Gideon). */
export function recordBaseCombatDamage(state: GameState, attackerId: string): GameState {
  const events = state.phaseEvents ?? emptyPhaseEvents()
  const dealers = events.baseCombatDamagers ?? []
  return dealers.includes(attackerId) ? state : { ...state, phaseEvents: { ...events, baseCombatDamagers: [...dealers, attackerId] } }
}

/** Whether `instanceId` has dealt combat damage to a base this phase. */
export function dealtBaseCombatDamageThisPhase(state: GameState, instanceId: string): boolean {
  return state.phaseEvents?.baseCombatDamagers?.includes(instanceId) ?? false
}

/** Record that `owner`'s base took `amount` damage this phase. */
export function recordBaseDamaged(state: GameState, owner: PlayerId, amount = 0): GameState {
  const events = state.phaseEvents ?? emptyPhaseEvents()
  const basesDamaged = events.basesDamaged.includes(owner) ? events.basesDamaged : [...events.basesDamaged, owner]
  const baseDamageTaken = { ...events.baseDamageTaken, [owner]: (events.baseDamageTaken?.[owner] ?? 0) + amount }
  return { ...state, phaseEvents: { ...events, basesDamaged, baseDamageTaken } }
}

/** How much damage `owner`'s base has been dealt this phase. */
export function baseDamageThisPhase(state: GameState, owner: PlayerId): number {
  return state.phaseEvents?.baseDamageTaken?.[owner] ?? 0
}

/** Record that `owner` created a token this phase. Idempotent. */
export function recordTokenCreated(state: GameState, owner: PlayerId): GameState {
  const events = state.phaseEvents ?? emptyPhaseEvents()
  const created = events.tokensCreated ?? []
  return created.includes(owner) ? state : { ...state, phaseEvents: { ...events, tokensCreated: [...created, owner] } }
}

/** Note one use of a base action this phase, for "use this ability only once each phase" (Heavy Ion Cannon). */
export function recordBaseActionUsed(state: GameState, owner: PlayerId, key: string): GameState {
  const events = state.phaseEvents ?? emptyPhaseEvents()
  const used = events.baseActionsUsed ?? {}
  return { ...state, phaseEvents: { ...events, baseActionsUsed: { ...used, [owner]: [...(used[owner] ?? []), key] } } }
}

/** Whether `owner` created a token this phase (The Client). */
export function tokenCreatedThisPhase(state: GameState, owner: PlayerId): boolean {
  return state.phaseEvents?.tokensCreated?.includes(owner) ?? false
}

/** Whether `owner`'s base was dealt damage this phase (Baylan Skoll). */
export function baseDamagedThisPhase(state: GameState, owner: PlayerId): boolean {
  return state.phaseEvents?.basesDamaged.includes(owner) ?? false
}

/** Record that `owner` had an upgrade defeated this phase. Idempotent. */
export function recordUpgradeDefeated(state: GameState, owner: PlayerId): GameState {
  const events = state.phaseEvents ?? emptyPhaseEvents()
  return events.upgradesDefeated.includes(owner) ? state : { ...state, phaseEvents: { ...events, upgradesDefeated: [...events.upgradesDefeated, owner] } }
}

/** Record that `instanceId` was dealt damage this phase. Idempotent. */
export function recordUnitDamaged(state: GameState, instanceId: string): GameState {
  const events = state.phaseEvents ?? emptyPhaseEvents()
  return events.damagedUnits.includes(instanceId) ? state : { ...state, phaseEvents: { ...events, damagedUnits: [...events.damagedUnits, instanceId] } }
}

/** Instance ids of units dealt damage this phase (Galvanized Leap). */
export function damagedThisPhase(state: GameState): string[] {
  return state.phaseEvents?.damagedUnits ?? []
}

/** Note that `instanceId` attacked this phase. Idempotent: a unit that attacks twice counts once. */
export function recordUnitAttacked(state: GameState, instanceId: string): GameState {
  const events = state.phaseEvents ?? emptyPhaseEvents()
  const attacked = events.attackedUnits ?? []
  return attacked.includes(instanceId) ? state : { ...state, phaseEvents: { ...events, attackedUnits: [...attacked, instanceId] } }
}

/** Note that `owner` drew `n` cards this phase. */
export function recordCardsDrawn(state: GameState, owner: PlayerId, n: number): GameState {
  const events = state.phaseEvents ?? emptyPhaseEvents()
  return { ...state, phaseEvents: { ...events, cardsDrawn: { ...events.cardsDrawn, [owner]: (events.cardsDrawn?.[owner] ?? 0) + n } } }
}

/** How many cards `owner` has drawn this phase (Beilert Valance). */
export function cardsDrawnThisPhase(state: GameState, owner: PlayerId): number {
  return state.phaseEvents?.cardsDrawn?.[owner] ?? 0
}

/** Instance ids of units that attacked this phase (Anakin's Podracer). */
export function attackedThisPhase(state: GameState): string[] {
  return state.phaseEvents?.attackedUnits ?? []
}

/** Note that `instanceId` was healed this phase. Idempotent. */
export function recordUnitHealed(state: GameState, instanceId: string): GameState {
  const events = state.phaseEvents ?? emptyPhaseEvents()
  const healed = events.healedUnits ?? []
  return healed.includes(instanceId) ? state : { ...state, phaseEvents: { ...events, healedUnits: [...healed, instanceId] } }
}

/** Instance ids of units healed this phase (Barriss Offee). */
export function healedThisPhase(state: GameState): string[] {
  return state.phaseEvents?.healedUnits ?? []
}

/** Note that damage headed for `instanceId` was prevented this phase. Idempotent. */
export function recordDamagePrevented(state: GameState, instanceId: string): GameState {
  const events = state.phaseEvents ?? emptyPhaseEvents()
  const prevented = events.damagePrevented ?? []
  return prevented.includes(instanceId) ? state : { ...state, phaseEvents: { ...events, damagePrevented: [...prevented, instanceId] } }
}

/** Whether a prevention has already stopped damage to `instanceId` this phase (Umbaran Mobile Cannon). */
export function damagePreventedThisPhase(state: GameState, instanceId: string): boolean {
  return state.phaseEvents?.damagePrevented?.includes(instanceId) ?? false
}

/** Record that a unit left play under `owner` this phase — defeated, bounced, or otherwise. */
export function recordUnitLeftPlay(state: GameState, owner: PlayerId, cardId: string, isLeader: boolean): GameState {
  const events = state.phaseEvents ?? emptyPhaseEvents()
  return {
    ...state,
    phaseEvents: {
      ...events,
      leftPlay: { ...events.leftPlay, [owner]: [...events.leftPlay[owner], cardId] },
      leaderLeftPlay: isLeader && !events.leaderLeftPlay.includes(owner) ? [...events.leaderLeftPlay, owner] : events.leaderLeftPlay,
    },
  }
}

/** Card ids of `owner`'s units that left play this phase (Fateful Goodbye). */
export function leftPlayThisPhase(state: GameState, owner: PlayerId): string[] {
  return state.phaseEvents?.leftPlay[owner] ?? []
}

/** Whether `owner`'s leader unit left play this phase. */
export function leaderLeftPlayThisPhase(state: GameState, owner: PlayerId): boolean {
  return state.phaseEvents?.leaderLeftPlay.includes(owner) ?? false
}

/** Whether `owner` had an upgrade defeated this phase (Baylan Skoll). */
export function upgradeDefeatedThisPhase(state: GameState, owner: PlayerId): boolean {
  return state.phaseEvents?.upgradesDefeated.includes(owner) ?? false
}

/** Whether `owner`'s base was attacked this phase. */
export function baseAttackedThisPhase(state: GameState, owner: PlayerId): boolean {
  return state.phaseEvents?.basesAttacked.includes(owner) ?? false
}

/** Instance ids of units that entered play under `owner` this phase. */
export function enteredPlayThisPhase(state: GameState, owner: PlayerId): string[] {
  return state.phaseEvents?.enteredPlay[owner] ?? []
}

/** Card ids of units defeated under `owner` this phase. */
export function defeatedThisPhase(state: GameState, owner: PlayerId): string[] {
  return state.phaseEvents?.defeated[owner] ?? []
}

/** Mark a once-per-round ability (`key`) as spent on the unit `instanceId` under `owner`.
 *  Cleared when the unit readies at regroup (shared with activated abilities). */
export function markAbilityUsed(state: GameState, owner: PlayerId, instanceId: string, key: string): GameState {
  return updatePlayer(state, owner, {
    units: state.players[owner].units.map(u =>
      u.instanceId === instanceId && !(u.usedAbilities ?? []).includes(key)
        ? { ...u, usedAbilities: [...(u.usedAbilities ?? []), key] }
        : u,
    ),
  })
}

/** Total power/HP and keywords a unit gains from all lasting effects aimed at it. */
export function lastingEffectTotals(state: GameState, instanceId: string): { power: number; hp: number; keywords: KeywordInstance[] } {
  let power = 0
  let hp = 0
  const keywords: KeywordInstance[] = []
  for (const e of state.lastingEffects ?? []) {
    if (e.targetInstanceId !== instanceId) continue
    power += e.power ?? 0
    hp += e.hp ?? 0
    if (e.keywords) keywords.push(...e.keywords)
  }
  return { power, hp, keywords }
}

export function opponentOf(player: PlayerId): PlayerId {
  return player === 'player' ? 'opponent' : 'player'
}

/** Immutably patch one player's state, returning a new GameState. */
export function updatePlayer(state: GameState, id: PlayerId, patch: Partial<PlayerState>): GameState {
  return {
    ...state,
    players: { ...state.players, [id]: { ...state.players[id], ...patch } },
  }
}
