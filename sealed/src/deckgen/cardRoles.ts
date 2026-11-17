import type { SwuCard } from '../data/cards'
import { TOKEN_UNIT_CARDS } from '../engine/tokenUnits'
import { unpaidIcons } from './rules'

/**
 * What a deck builder reads off a card beyond its cost and type: whether it removes an enemy unit, and
 * whether it is a play for the first turn. Read from the printed text (`FrontText`), since a registered
 * ability is a closure that says nothing about what it does until it runs.
 *
 * **Removal** is an event, or a unit's When Played ability, that deals damage to, defeats, captures or
 * returns to hand an enemy unit, or "a unit" that need not be friendly. Conditional removal counts.
 * **Exhausting** one is the weak kind: it lasts a turn, where removal lasts. Upgrades are never
 * removal, even one that deals damage when played: it costs a unit to carry it.
 *
 * Text classification is approximate by nature. Its accuracy is measured (`experiments.md`), not
 * assumed: it reads clauses, splits their objects on "and", "or" and commas, and follows "it" and
 * "that unit" back to the last unit named as an object.
 */

export type RemovalKind = 'removal' | 'exhaust'

/** What exhaust counts for against real removal, in the fill's removal count. */
export const EXHAUST_WEIGHT = 0.5

/** Resources each missing aspect icon adds to a card's cost. */
const ASPECT_PENALTY = 2
/** A turn-1 play costs less than this, as played. */
const TURN_ONE_COST = 3

/** A card's cost as played under a leader and base: printed, plus the penalty for each missing icon. */
export function playedCost(card: SwuCard, leader: SwuCard, base: SwuCard): number {
  return Number(card.Cost ?? 0) + ASPECT_PENALTY * unpaidIcons(card, leader, base).length
}

/**
 * A play for the first turn: a unit costing less than 3 as played, or an event costing less than 3 that
 * is guaranteed to put a unit token into play. Cheap removal is not one, since it answers a unit rather
 * than putting one down, and an empty board on turn 1 hands the opponent the tempo.
 */
export function isTurnOnePlay(card: SwuCard, leader: SwuCard, base: SwuCard): boolean {
  if (playedCost(card, leader, base) >= TURN_ONE_COST) return false
  return card.Type === 'Unit' || (card.Type === 'Event' && createsUnitToken(card))
}

const printed = (card: SwuCard): string => (card.FrontText ?? '').replace(/\([^)]*\)/g, '')
const sentences = (text: string): string[] => text.split(/[.\n;]/).map(s => s.trim()).filter(Boolean)

const UNIT_TOKEN = new RegExp(`^create (?:a|an|\\d+|two|three) (?:${Object.values(TOKEN_UNIT_CARDS).map(c => c.name).join('|')}) tokens?\\b`, 'i')

/**
 * Whether the card is guaranteed to create a unit token for its player: a sentence of its own opening
 * "Create ...". One behind a condition ("If you do, create"), a count that can be none ("for each unit
 * exhausted this way"), a mode of a choice, or a token for the opponent is not guaranteed.
 */
export function createsUnitToken(card: SwuCard): boolean {
  const text = printed(card)
  if (/\bchoose (?:one|two)\b/i.test(text)) return false
  return sentences(text).some(s => UNIT_TOKEN.test(s))
}

/**
 * The text a card removes with: an event's, or a unit's When Played abilities and any lines under
 * them (a "Choose two:" list), up to the next ability. Nothing for an upgrade, a leader or a base.
 */
function removalText(card: SwuCard): string {
  const text = printed(card)
  if (card.Type === 'Event') return text
  if (card.Type !== 'Unit') return ''
  const kept: string[] = []
  let inWhenPlayed = false
  for (const line of text.split('\n')) {
    const head = /^\s*([A-Z][^.:]*):(.*)$/.exec(line)
    // A keyword may lead the head in ("Coordinate - When Played:").
    if (head) inWhenPlayed = /^(?:[A-Z][\w']*(?:\s+\d+)?\s+[-‐-―]\s+)?When Played(?!\s+as an upgrade)/i.test(head[1])
    if (inWhenPlayed) kept.push(head ? head[2] : line)
  }
  return kept.join('\n')
}

const REMOVAL_VERBS: readonly RegExp[] = [/\bdeals?\b[^.]*?\bdamage\b/gi, /\bdefeats?\b/gi, /\bcaptures?\b/gi, /\breturns?\b/gi]
const EXHAUST_VERB = /\bexhausts?\b/gi
const TO_HAND = /\bowners?'?s?'?\s+hands?\b/i
// Opening the phrase, or as what damage is dealt to ("equal to its power to the other").
const PRONOUN = /(?:^\s*|\bto\s+)(?:it|them|each of them|that unit|those units|the other)\b/i
// "unit" but not "unit's": a possessive names something of the unit's, not the unit.
const UNIT = /\bunits?\b(?!')/i
/** Words before "unit" that make it not an enemy unit, or not a unit at all. */
const NOT_ENEMY = /\b(?:friendly|this|your|you control|upgrades?|tokens?|resources?)\b/i
/** A clause naming a unit that is yours however it is described: one you attack with, or take from your own cards. */
const YOURS = /\battack with\b|\byour (?:deck|discard pile|hand)\b/i

/** Whether a noun phrase names a unit that may be an enemy's, read from the words before "unit" and just after. */
function enemyUnit(phrase: string): boolean | undefined {
  const m = UNIT.exec(phrase)
  if (!m) return undefined
  const after = phrase.slice(m.index + m[0].length)
  // A possessive ("equal to this unit's power") names a quantity, not the target.
  const before = phrase.slice(0, m.index).replace(/\b\w+\s+unit'\w*/gi, '')
  return !NOT_ENEMY.test(before) && !/^\s*(?:that\s+)?you control\b/i.test(after)
}

/**
 * Whether a unit opens its sentence as the subject: a determiner and at most two more words before it
 * ("Each friendly Vehicle unit", "A friendly unit"), as against an object ("Choose a unit").
 */
const opensSentence = (prefix: string): boolean =>
  /^(?:each|a|an|the|another|any)\b/i.test(prefix) && prefix.trim().split(/\s+/).length <= 3

/**
 * Where the noun phrase ending at `end` starts: after the last comma, conjunction or preposition, so
 * "Defeat all Shield tokens on a unit" names "a unit" rather than the tokens.
 */
function phraseStart(sentence: string, end: number): number {
  const before = sentence.slice(0, end)
  const cut = /.*(?:,|\b(?:and|or|on|to|from|with|of|at|in|choose|chooses)\s)/i.exec(before)
  return cut ? cut[0].length : 0
}

/**
 * Whether any `verb` in the text acts on an enemy unit. Each verb's object, the rest of its sentence, is
 * split into phrases; a phrase naming a unit is judged by its words, and a pronoun by its antecedent:
 * the last unit named before it, in its sentence or an earlier one, other than the verb's own subject
 * ("this unit captures that unit").
 */
function actsOnEnemyUnit(text: string, verbs: readonly RegExp[], needs?: RegExp): boolean {
  let antecedent: boolean | undefined
  for (const sentence of sentences(text)) {
    const hits = verbs.flatMap(v => [...sentence.matchAll(v)])
    const prior = antecedent
    // The sentence's unit mentions in order, for a later pronoun to point back to.
    const mentions: { at: number; end: number; enemy: boolean; subject: boolean }[] = []
    for (const m of sentence.matchAll(new RegExp(UNIT.source, 'gi'))) {
      const end = m.index + m[0].length
      const phrase = sentence.slice(phraseStart(sentence, m.index), end)
      const clause = sentence.slice(sentence.lastIndexOf(',', m.index) + 1, m.index)
      const rest = sentence.slice(end).split(',')[0]
      // "That unit" refers back rather than naming a unit. One you attack with, or take from your own
      // deck, discard pile or hand, is yours.
      const enemy = /\b(?:that|those)\s+units?$/i.test(phrase) ? antecedent ?? false
        : YOURS.test(clause) || /^\s*(?:from|in) your\b/i.test(rest) ? false
          : enemyUnit(phrase) ?? false
      mentions.push({ at: m.index, end, enemy, subject: opensSentence(sentence.slice(0, m.index)) })
      antecedent = enemy
    }
    for (const hit of hits.sort((a, b) => a.index - b.index)) {
      const span = sentence.slice(hit.index + hit[0].length)
      if (needs && !needs.test(span)) continue
      // Split on commas, but not within a noun phrase ("a friendly non-Vehicle, non-leader unit").
      for (const phrase of span.split(/,(?!\s*non-)|\band\b|\bor\b|\bthen\b/i)) {
        if (PRONOUN.test(phrase)) {
          // Not the verb's own subject, whether it opens the sentence or stands just before the verb.
          const before = mentions.filter(o => o.at < hit.index && !o.subject && sentence.slice(o.end, hit.index).trim() !== '').pop()
          if ((before ? before.enemy : prior) === true) return true
          continue
        }
        if (enemyUnit(phrase) === true) return true
      }
    }
  }
  return false
}

// Read once a card: the builder asks for every candidate at every slot.
const kinds = new WeakMap<SwuCard, RemovalKind | null>()

/** Whether a card is removal, the weak kind (exhaust), or neither. */
export function removalKind(card: SwuCard): RemovalKind | null {
  if (kinds.has(card)) return kinds.get(card)!
  const text = removalText(card)
  const kind = !text ? null
    : actsOnEnemyUnit(text, REMOVAL_VERBS.slice(0, 3)) || actsOnEnemyUnit(text, REMOVAL_VERBS.slice(3), TO_HAND) ? 'removal'
      : actsOnEnemyUnit(text, [EXHAUST_VERB]) ? 'exhaust' : null
  kinds.set(card, kind)
  return kind
}

/** What a card counts for toward a deck's removal: 1, {@link EXHAUST_WEIGHT} for exhaust, else 0. */
export function removalWeight(card: SwuCard): number {
  const kind = removalKind(card)
  return kind === 'removal' ? 1 : kind === 'exhaust' ? EXHAUST_WEIGHT : 0
}
