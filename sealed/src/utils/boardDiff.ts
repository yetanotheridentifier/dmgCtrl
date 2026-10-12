import type { Action } from '../engine/actions'
import type { GameState, PlayerId, UnitState, UpgradeAttachment } from '../engine/types'
import { physicalCardOf } from '../engine/types'
import { isTokenCard } from '../engine/tokenUnits'
import { describeActionParts, partsText } from './describeAction'
import type { DescribePart } from './describeAction'
import type { LogEntry } from '../hooks/useGame'

/**
 * What an action changed on the board, read off the state either side of it.
 *
 * The engine keeps no record of the effects it applies, so the log line for an action says what was
 * chosen and nothing about what then happened. This compares the two states and says the rest: base
 * damage and healing, damage and healing on units, upgrades and tokens gained or lost, units taken,
 * leaving and entering play, and cards arriving in a discard pile.
 *
 * **It can say what changed and never why.** It cannot name the card that caused a change, cannot
 * separate two effects inside one action, and sees only the net: a unit damaged and healed by the
 * same amount in one action changed nothing. It is a view for the player, built in the UI, and
 * nothing in the engine or the AI calls it.
 *
 * **It names only what is face up.** Every card a line links was a unit, an upgrade or a token in
 * play, or is a card that arrived in a discard pile. Hands, decks and resources are never read for
 * a name, so a card that moves between them leaves no line at all.
 */

const SIDES: PlayerId[] = ['player', 'opponent']

type CardRef = Exclude<DescribePart, string>

const cardRef = (state: GameState, cardId: string, controller: PlayerId): CardRef =>
  ({ cardId, controller, text: state.cards[cardId]?.name ?? cardId })

/** Remove one `id` from `ids`, saying whether there was one to remove. */
function takeOne(ids: string[], id: string): boolean {
  const at = ids.indexOf(id)
  if (at !== -1) ids.splice(at, 1)
  return at !== -1
}

/** The ids in `now` that `then` does not account for, one for one. */
function added(then: readonly string[], now: readonly string[]): string[] {
  const left = [...then]
  return now.filter(id => !takeOne(left, id))
}

/** `ids` as one entry per distinct id with how many there were, in first-seen order. */
function counted(ids: readonly string[]): [string, number][] {
  const counts = new Map<string, number>()
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
  return [...counts]
}

const unitsOf = (state: GameState) => SIDES.flatMap(controller => state.players[controller].units.map(unit => ({ unit, controller })))

/**
 * The changes between two states, one line each, in a fixed order: damage and healing on units,
 * then on bases, upgrades gained and lost, units taken, units leaving, units entering, and cards
 * reaching a discard pile. The player's side comes first within each.
 *
 * `named` is the action's own line. **Numbers are always stated**, even where that line already
 * promised them, because it says what was chosen and these say what happened (a Shield may have
 * taken the damage). **A card that line links is not reported again for arriving**: the unit that
 * was played entering play, the event that was played reaching the discard pile, the upgrade that
 * was played being gained. One link accounts for one card.
 */
export function boardChanges(before: GameState, after: GameState, named: readonly DescribePart[] = []): DescribePart[][] {
  const spoken = named.flatMap(p => (typeof p === 'string' ? [] : [p.cardId]))
  const arrived: Record<PlayerId, string[]> = {
    player: added(before.players.player.discard, after.players.player.discard),
    opponent: added(before.players.opponent.discard, after.players.opponent.discard),
  }
  /** A card that left play accounts for one arrival in a discard pile: its owner's, when it has one. */
  const reachedDiscard = (cardId: string, owner: PlayerId) =>
    takeOne(arrived[owner], cardId) || takeOne(arrived[owner === 'player' ? 'opponent' : 'player'], cardId)

  const now = new Map(unitsOf(after).map(entry => [entry.unit.instanceId, entry]))
  const then = new Map(unitsOf(before).map(entry => [entry.unit.instanceId, entry]))
  const stayed = unitsOf(before).flatMap(was => {
    const is = now.get(was.unit.instanceId)
    return is ? [{ was, is }] : []
  })

  const damage: DescribePart[][] = []
  for (const { was, is } of stayed) {
    const delta = is.unit.damage - was.unit.damage
    const unit = cardRef(after, is.unit.cardId, is.controller)
    if (delta > 0) damage.push([unit, ` takes ${delta} damage`])
    if (delta < 0) damage.push([unit, ` heals ${-delta}`])
  }
  for (const side of SIDES) {
    const delta = after.players[side].base.damage - before.players[side].base.damage
    const base = side === 'player' ? 'Your base' : "Opponent's base"
    if (delta > 0) damage.push([`${base} takes ${delta} damage`])
    if (delta < 0) damage.push([`${base} heals ${-delta}`])
  }

  const upgrades: DescribePart[][] = []
  const attachments = (host: DescribePart, was: readonly UpgradeAttachment[], is: readonly UpgradeAttachment[]) => {
    const owner = (list: readonly UpgradeAttachment[], cardId: string) => list.find(u => u.cardId === cardId)!.owner
    const gained = added(was.map(u => u.cardId), is.map(u => u.cardId)).filter(cardId => !takeOne(spoken, cardId))
    for (const [cardId, n] of counted(gained)) upgrades.push([host, n > 1 ? ` gains ${n} ` : ' gains ', cardRef(after, cardId, owner(is, cardId))])
    const lost = added(is.map(u => u.cardId), was.map(u => u.cardId))
    for (const cardId of lost) reachedDiscard(cardId, owner(was, cardId))
    for (const [cardId, n] of counted(lost)) upgrades.push([host, n > 1 ? ` loses ${n} ` : ' loses ', cardRef(before, cardId, owner(was, cardId))])
  }
  for (const { was, is } of stayed) attachments(cardRef(after, is.unit.cardId, is.controller), was.unit.upgrades, is.unit.upgrades)
  for (const side of SIDES) {
    attachments(side === 'player' ? 'Your base' : "Opponent's base", before.players[side].base.upgrades ?? [], after.players[side].base.upgrades ?? [])
  }

  const taken: DescribePart[][] = stayed
    .filter(({ was, is }) => was.controller !== is.controller)
    .map(({ is }) => [is.controller === 'player' ? 'You take control of ' : 'Opponent takes control of ', cardRef(after, is.unit.cardId, is.controller)])

  const left: DescribePart[][] = []
  for (const { unit, controller } of unitsOf(before)) {
    if (now.has(unit.instanceId)) continue
    for (const upgrade of unit.upgrades) reachedDiscard(upgrade.cardId, upgrade.owner)
    left.push([cardRef(before, unit.cardId, controller), wasDefeated(unit, controller, reachedDiscard) ? ' is defeated' : ' leaves play'])
  }

  const entered: DescribePart[][] = []
  for (const { unit, controller } of unitsOf(after)) {
    if (then.has(unit.instanceId)) continue
    if (takeOne(spoken, unit.cardId) || takeOne(spoken, physicalCardOf(unit))) continue
    entered.push([cardRef(after, unit.cardId, controller), ' enters play'])
  }

  const discarded: DescribePart[][] = []
  for (const side of SIDES) {
    for (const cardId of arrived[side]) {
      if (takeOne(spoken, cardId)) continue
      discarded.push([cardRef(after, cardId, side), side === 'player' ? ' goes to your discard pile' : " goes to opponent's discard pile"])
    }
  }

  return [...damage, ...upgrades, ...taken, ...left, ...entered, ...discarded]
}

/**
 * Whether a unit that is gone was defeated, as far as two states can show: its card is in a discard
 * pile that it was not in before. A token has no pile to arrive in and ceases to exist however it
 * leaves play, so a token that is gone is called defeated, which is the one inference made here. A
 * leader goes back to its base, so it is only ever said to leave play.
 */
function wasDefeated(unit: UnitState, controller: PlayerId, reachedDiscard: (cardId: string, owner: PlayerId) => boolean): boolean {
  if (unit.isLeader) return false
  const card = physicalCardOf(unit)
  return isTokenCard(card) || reachedDiscard(card, unit.owner ?? controller)
}

/**
 * The log entries for one action: its own line, then what it changed, marked `outcome` so they
 * render under it. The opponent's line is redacted, since the log is the player's view of the game.
 */
export function logEntries(before: GameState, after: GameState, by: PlayerId, action: Action): LogEntry[] {
  const parts = describeActionParts(before, by, action, { redact: by === 'opponent' })
  return [
    { by, text: partsText(parts), parts },
    ...boardChanges(before, after, parts).map(change => ({ by, text: partsText(change), parts: change, outcome: true as const })),
  ]
}
