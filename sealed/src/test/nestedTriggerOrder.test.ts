import { describe, it, expect, afterEach } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { registerCard, unregisterAbility } from '../engine/abilities'
import { makeBeamAi, lastSearchTrace, clearSearchTrace } from '../ai/search'
import { BEAM_REPLY_LIMITS } from '../ai/greedyAi'
import { evaluate } from '../ai/evaluate'
import { pushChoice } from '../engine/types'
import { state, player, unit, card, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'
import '../engine/cardDefinitions'

/**
 * Nested abilities resolve before the layer that spawned them (#525).
 *
 * **CR 7.6.11** After resolving a triggered ability "A", if any new abilities were triggered while
 * resolving it, the new abilities are considered "nested abilities" and must be resolved **before any
 * other abilities triggered at the same time as ability "A"**.
 *
 * The comprehensive rules give the scenario, so it is built here rather than invented:
 *
 * > Grayson attacks Mimi's Vanguard Infantry with his Greedo. Both units are defeated, simultaneously
 * > triggering the When Defeated abilities on each. Since Grayson is the active player, he decides which
 * > player resolves first. He chooses himself, and uses Greedo's ability to defeat another of Mimi's
 * > units, Admiral Motti, which has its own When Defeated. Admiral Motti's ability is a nested ability,
 * > so it must be resolved next. **Only after** that may Mimi resolve Vanguard Infantry's ability.
 *
 * `pushChoice` appends, so the suspicion recorded on the ticket was that a nested ability lands at the
 * BACK of the queue, behind the opponent's simultaneous trigger, which is the opposite of the rule.
 * This test exists to settle that either way: passing retires the suspicion, failing scopes the fix.
 */

/** Ids are distinctive so the queue can be read by which card raised each entry. */
const GREEDO = 'TEST_GREEDO'
const VANGUARD = 'TEST_VANGUARD'
const MOTTI = 'TEST_MOTTI'

const cards = {
  ...CARDS,
  [GREEDO]: card({ id: GREEDO, type: 'unit', arena: 'ground', cost: 1, power: 3, hp: 3 }),
  [VANGUARD]: card({ id: VANGUARD, type: 'unit', arena: 'ground', cost: 1, power: 3, hp: 3 }),
  [MOTTI]: card({ id: MOTTI, type: 'unit', arena: 'ground', cost: 1, power: 1, hp: 1 }),
}

/** Both fighters raise a `mayDamage` choice on defeat; Greedo's can reach Motti, whose own defeat
 *  raises a third. That chain is what makes the ordering observable. */
function registerAll(): void {
  const damageChoice = (s: GameState, ctx: { owner: 'player' | 'opponent'; defeatedUnit?: { instanceId: string } }): GameState => {
    const targets = [...s.players.player.units, ...s.players.opponent.units].map(u => u.instanceId)
    return targets.length === 0 ? s : pushChoice(s, {
      kind: 'mayDamage', id: ctx.defeatedUnit!.instanceId, controller: ctx.owner,
      unitId: ctx.defeatedUnit!.instanceId, targets, amount: 3, optional: true,
    })
  }
  for (const id of [GREEDO, VANGUARD, MOTTI]) {
    registerCard(id, { abilities: [{ trigger: 'whenDefeated', description: 'damage', effect: damageChoice }] })
  }
}

/** Our Greedo attacks their Vanguard; both are 3/3 so both die. Motti sits behind, defeatable by the
 *  3 damage Greedo's trigger offers. */
const board = (): GameState => state({
  cards,
  phase: 'action',
  activePlayer: 'player',
  players: {
    // `bystander` is a 1/9 that nothing here can kill. Without a survivor, every unit is dead by the
    // time Motti's trigger fires, so a "damage a unit" ability has no legal target and raises no
    // choice at all: the queue would look correct for the wrong reason.
    player: player({ units: [unit('greedo', GREEDO), unit('bystander', 'TST_U4')] }),
    opponent: player({ units: [unit('vanguard', VANGUARD), unit('motti', MOTTI)] }),
  },
})

describe('nested triggered abilities (CR 7.6.11)', () => {
  afterEach(() => {
    for (const id of [GREEDO, VANGUARD, MOTTI]) unregisterAbility(id)
  })

  it('sets up the CR scenario: both fighters die and both triggers are owed', () => {
    registerAll()
    const traded = resolve(board(), { type: 'attack', attackerId: 'greedo', target: { kind: 'unit', instanceId: 'vanguard' } })
    expect(traded.players.player.units.find(u => u.instanceId === 'greedo'), 'Greedo dies').toBeUndefined()
    expect(traded.players.opponent.units.find(u => u.instanceId === 'vanguard'), 'Vanguard dies').toBeUndefined()
    const owed = (traded.pendingChoices ?? []).map(c => c.controller)
    expect(owed, 'both sides owe a trigger').toContain('player')
    expect(owed).toContain('opponent')
  })

  /**
   * The rule itself. Resolving OUR trigger onto Motti raises Motti's own, which must come before the
   * opponent's Vanguard trigger that was waiting all along.
   */
  it('resolves a nested trigger before the opponent trigger it interrupted', () => {
    registerAll()
    const fought = resolve(board(), { type: 'attack', attackerId: 'greedo', target: { kind: 'unit', instanceId: 'vanguard' } })
    // Both sides owe triggers, so the order question comes first (CR 7.6.10). Take ourselves, which is
    // what the CR's Grayson does, then resolve our own trigger onto Motti.
    const order = fought.pendingChoices!.find(c => c.kind === 'chooseTriggerOrder')!
    const traded = resolve(fought, { type: 'acceptChoice', choiceId: order.id, optionIndex: 0 })
    const ours = (traded.pendingChoices ?? []).find(c => c.controller === 'player')
    expect(ours, 'we should have a trigger to resolve').toBeDefined()

    const killedMotti = resolve(traded, { type: 'acceptChoice', choiceId: ours!.id, targetInstanceId: 'motti' })
    expect(killedMotti.players.opponent.units.find(u => u.instanceId === 'motti'), 'Motti dies to it').toBeUndefined()

    // Keyed on `id`, which these fixtures set to the defeated unit's instance id. `unitId` is not on
    // every choice variant, so it cannot be read off the queue generically.
    const queue = (killedMotti.pendingChoices ?? []).map(c => c.id)
    expect(queue, 'both the nested trigger and the waiting one are owed').toEqual(
      expect.arrayContaining(['motti', 'vanguard']),
    )
    expect(queue.indexOf('motti'), 'the nested ability resolves FIRST (CR 7.6.11)')
      .toBeLessThan(queue.indexOf('vanguard'))
  })
})

/**
 * Who goes first, when both sides owe triggers (CR 7.6.10).
 *
 * > the active player chooses one player at a time to resolve abilities. When chosen, that player
 * > resolves all abilities triggered on cards they control in the order of their choice, and once they
 * > finish, the other player does the same.
 *
 * The engine used to make the active player go first, full stop: the right mechanism with the decision
 * hardcoded. They now get asked.
 *
 * **They choose the player and nothing else.** The opponent's internal order stays theirs (7.6.9), so
 * this choice carries no target and no list; offering anything finer would be offering a decision that
 * is not the active player's to make.
 */
describe('choosing which player resolves first (CR 7.6.10)', () => {
  afterEach(() => {
    for (const id of [GREEDO, VANGUARD, MOTTI]) unregisterAbility(id)
  })

  const traded = (): GameState => {
    registerAll()
    return resolve(board(), { type: 'attack', attackerId: 'greedo', target: { kind: 'unit', instanceId: 'vanguard' } })
  }

  it('asks the active player, and asks first', () => {
    const s = traded()
    const queue = s.pendingChoices ?? []
    expect(queue[0]?.kind, 'it gates the rest of the queue, so it leads it').toBe('chooseTriggerOrder')
    expect(queue[0]?.controller, 'the ACTIVE player decides, not the initiative holder').toBe('player')
    expect(s.activePlayer).toBe('player')
  })

  /**
   * Two answers, no decline, and **nothing else on offer**. The gate matters as much as the options:
   * without it the player could answer one of their own triggers instead and settle the order by
   * accident, choosing themselves without ever being asked.
   */
  it('offers exactly two answers and gates the rest of the queue', () => {
    const s = traded()
    const moves = legalMoves(s)
    expect(moves).toHaveLength(2)
    expect(moves.every(m => m.type === 'acceptChoice' && m.choiceId === s.pendingChoices![0].id)).toBe(true)
    expect(moves.some(m => m.type === 'skipTrigger'), 'someone has to go first').toBe(false)
  })

  it('keeps the turn when we choose ourselves', () => {
    const s = traded()
    const mine = resolve(s, { type: 'acceptChoice', choiceId: s.pendingChoices![0].id, optionIndex: 0 })
    expect(mine.activePlayer).toBe('player')
    expect((mine.pendingChoices ?? []).some(c => c.kind === 'chooseTriggerOrder'), 'asked once').toBe(false)
  })

  it('hands the turn over when we choose them, and takes it back after', () => {
    const s = traded()
    const theirs = resolve(s, { type: 'acceptChoice', choiceId: s.pendingChoices![0].id, optionIndex: 1 })
    expect(theirs.activePlayer).toBe('opponent')

    const oursLeft = (theirs.pendingChoices ?? []).filter(c => c.controller === 'player')
    expect(oursLeft.length, 'our trigger is still owed').toBeGreaterThan(0)

    const theirChoice = (theirs.pendingChoices ?? []).find(c => c.controller === 'opponent')!
    const drained = resolve(theirs, { type: 'skipTrigger', choiceId: theirChoice.id })
    expect(drained.activePlayer, 'the turn comes back once their side is clear').toBe('player')
  })

  /**
   * **The bot has to answer this too**, and it is a decision that did not exist before.
   *
   * Both options barely change the board: one sets `activePlayer` and neither moves a card. That is the
   * shape of decision the evaluation is blind to, so the question is whether the search reaches past it.
   * It should: quiescent scoring drives an owed choice chain to completion before scoring, so each
   * option is priced by the boards its chain actually reaches rather than by the board it starts from.
   */
  it('is answerable by the shipped bot, and priced by what follows it', () => {
    const s = traded()
    clearSearchTrace()
    const chosen = makeBeamAi(evaluate, { ...BEAM_REPLY_LIMITS, nodes: 200_000 })(s)
    expect(chosen, 'the bot must produce a move').not.toBeNull()
    expect(legalMoves(s), 'and a legal one').toContainEqual(chosen)

    const values = lastSearchTrace()!.candidates
    expect(values).toHaveLength(2)
    expect(values.every(v => Number.isFinite(v)), 'both options must score').toBe(true)
  })

  /**
   * **And when it cannot separate them, it resolves first.**
   *
   * On this position both options score identically, so without a preference the seeded pick would
   * decide. That would be a regression: before the ordering choice existed the active player always
   * went first, and asking the question must not turn a fixed sensible answer into a coin flip.
   *
   * Tie-only, so the search still overrules it wherever it can see a difference, which is the reason
   * for asking at all.
   */
  it('resolves first when the search rates both options equal', () => {
    const s = traded()
    clearSearchTrace()
    const chosen = makeBeamAi(evaluate, { ...BEAM_REPLY_LIMITS, nodes: 200_000 })(s)
    const values = lastSearchTrace()!.candidates
    expect(values[0], 'this position is the tied case').toBe(values[1])
    expect(chosen).toMatchObject({ type: 'acceptChoice', optionIndex: 0 })
  })

  /** It must not fire when only one side owes anything, or every ordinary trigger grows a prompt. */
  it('does not ask when only one player owes a trigger', () => {
    registerCard(GREEDO, { abilities: [{ trigger: 'whenDefeated', description: 'none', effect: s => s }] })
    registerCard(VANGUARD, { abilities: [{ trigger: 'whenDefeated', description: 'none', effect: s => s }] })
    const s = resolve(board(), { type: 'attack', attackerId: 'greedo', target: { kind: 'unit', instanceId: 'vanguard' } })
    expect((s.pendingChoices ?? []).some(c => c.kind === 'chooseTriggerOrder')).toBe(false)
  })
})
