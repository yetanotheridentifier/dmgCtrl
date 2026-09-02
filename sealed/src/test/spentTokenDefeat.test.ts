import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { replayWith, pickTrigger, loadReport } from './helpers/replayReport'
import { dealDamageToUnit, defeatUnit } from '../engine/combat'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { TOKEN_ADVANTAGE, TOKEN_SHIELD } from '../engine/tokenUpgrades'
import { upgradeDefeatedThisPhase } from '../engine/types'
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import type { GameState, UpgradeAttachment } from '../engine/types'

/**
 * A SPENT token is a DEFEATED upgrade (#419, #376 item 4).
 *
 * Both token cards say so: a Shield that soaks damage is defeated, and an Advantage token is
 * defeated once its unit finishes attacking or defending. Three sites removed them by filtering the
 * `upgrades` array directly and so settled none of the consequences: the phase was never marked for
 * Baylan Skoll's "if a friendly upgrade was defeated this phase", and Zeb Orrelios never reacted.
 *
 * Same class as #401 (`returnUpgradeToHand` deleting tokens silently) and #417 (many hand-written
 * spellings of one operation, only some of them complete). `fireUpgradesDefeated` is the single
 * place that settles an upgrade being defeated; every removal must go through it.
 */
const T = {
  ...CARDS,
  ASH_039: card({ id: 'ASH_039', name: 'Baylan Skoll', type: 'unit', arena: 'ground', cost: 6, power: 6, hp: 6, keywords: [{ name: 'Overwhelm' }] }),
  ASH_149: card({ id: 'ASH_149', name: 'Eviscerator', type: 'unit', arena: 'space', cost: 7, power: 6, hp: 6 }),
  ASH_161: card({ id: 'ASH_161', name: 'Zeb Orrelios', type: 'unit', arena: 'ground', cost: 7, power: 5, hp: 7 }),
  BODY: card({ id: 'BODY', name: 'Body', type: 'unit', arena: 'ground', power: 2, hp: 8 }),
  SABO: card({ id: 'SABO', name: 'Saboteur Body', type: 'unit', arena: 'ground', power: 2, hp: 8, keywords: [{ name: 'Saboteur' }] }),
}

const tok = (cardId: string, owner: 'player' | 'opponent'): UpgradeAttachment => ({ cardId, owner })
const zebChoice = (s: GameState) => s.pendingChoices?.find(c => c.kind === 'selectDamageTarget')

/** Zeb watches the player's side; `mine` carries whatever tokens the test needs. */
function board(mineUpgrades: UpgradeAttachment[], theirsUpgrades: UpgradeAttachment[] = [], extra: Partial<GameState> = {}): GameState {
  return state({
    phase: 'action',
    activePlayer: 'player',
    cards: T,
    players: {
      player: player({ resources: ready(8), units: [unit('zeb', 'ASH_161', { arena: 'ground' }), unit('mine', 'BODY', { arena: 'ground', upgrades: mineUpgrades })] }),
      opponent: player({ units: [unit('theirs', 'BODY', { arena: 'ground', upgrades: theirsUpgrades })] }),
    },
    ...extra,
  })
}

describe('a Shield token that soaks damage is defeated', () => {
  it('marks the phase, so Baylan Skoll sees "a friendly upgrade was defeated"', () => {
    const soaked = dealDamageToUnit(board([tok(TOKEN_SHIELD, 'player')]), 'mine', 3)
    expect(soaked.players.player.units.find(u => u.instanceId === 'mine')!.upgrades).toEqual([])
    expect(upgradeDefeatedThisPhase(soaked, 'player')).toBe(true)
  })

  it('fires "when a friendly upgrade is defeated" for the shield owner', () => {
    const soaked = dealDamageToUnit(board([tok(TOKEN_SHIELD, 'player')]), 'mine', 3)
    expect(zebChoice(soaked)).toMatchObject({ kind: 'selectDamageTarget', amount: 1, controller: 'player' })
  })

  it('does not fire when the shield is not spent', () => {
    const hit = dealDamageToUnit(board([]), 'mine', 3)
    expect(upgradeDefeatedThisPhase(hit, 'player')).toBe(false)
    expect(zebChoice(hit)).toBeUndefined()
  })
})

describe('Advantage tokens spent completing a combat are defeated', () => {
  /** The attacker's Advantage is consumed when the attack completes, base or unit alike. */
  it('marks the phase when the attacker spends its Advantage on a base attack', () => {
    const attacked = resolve(board([tok(TOKEN_ADVANTAGE, 'player'), tok(TOKEN_ADVANTAGE, 'player')]), {
      type: 'attack', attackerId: 'mine', target: { kind: 'base' },
    })
    expect(attacked.players.player.units.find(u => u.instanceId === 'mine')!.upgrades).toEqual([])
    expect(upgradeDefeatedThisPhase(attacked, 'player')).toBe(true)
  })

  it("marks the phase for the DEFENDER's owner when the defender spends its Advantage", () => {
    const attacked = resolve(board([], [tok(TOKEN_ADVANTAGE, 'opponent')]), {
      type: 'attack', attackerId: 'mine', target: { kind: 'unit', instanceId: 'theirs' },
    })
    expect(upgradeDefeatedThisPhase(attacked, 'opponent')).toBe(true)
    expect(upgradeDefeatedThisPhase(attacked, 'player')).toBe(false)
  })

  /** Eviscerator: "(They aren't defeated after combat.)", so never spent and nothing to settle. */
  it('does not fire while an Eviscerator keeps friendly Advantage inert', () => {
    const withEvis = board([tok(TOKEN_ADVANTAGE, 'player')])
    const s: GameState = {
      ...withEvis,
      players: { ...withEvis.players, player: { ...withEvis.players.player, units: [...withEvis.players.player.units, unit('evis', 'ASH_149', { arena: 'space' })] } },
    }
    const attacked = resolve(s, { type: 'attack', attackerId: 'mine', target: { kind: 'base' } })
    expect(attacked.players.player.units.find(u => u.instanceId === 'mine')!.upgrades).toHaveLength(1)
    expect(upgradeDefeatedThisPhase(attacked, 'player')).toBe(false)
  })
})

/**
 * "When a friendly upgrade is defeated" triggers once per UPGRADE, not once per event.
 *
 * Zeb Orrelios reads "When a friendly upgrade is defeated: Deal 1 damage to a base" with no
 * once-each-round clause, and this set spells that limit out when it applies, so three upgrades
 * going at once is three separate triggers. `fireUpgradesDefeated` used to collapse them to one per
 * owner. `pushChoice` already de-collides repeated ids, so each firing gets its own answerable
 * choice.
 */
/**
 * The firings arrive **one at a time**: they are simultaneous triggers, and an ability resolves fully
 * before the next begins (CR 7.6.12), so the count is what the batch pays out in total rather than how
 * many choices sit on the board at once. Ordering is not asked, because one ability on one unit firing
 * three times for one event offers the player nothing to choose between.
 */
describe('one trigger per upgrade defeated, not one per event', () => {
  const damageChoices = (s: GameState) => (s.pendingChoices ?? []).filter(c => c.kind === 'selectDamageTarget')

  /** Answer every Zeb choice the batch owes, in turn, and count them. */
  function payOut(from: GameState): { fired: number; state: GameState } {
    let s: GameState = { ...from, activePlayer: 'player' }
    let fired = 0
    for (let guard = 0; guard < 10 && damageChoices(s).length > 0; guard++) {
      fired++
      s = resolve(s, { type: 'acceptChoice', choiceId: damageChoices(s)[0].id, baseTarget: 'opponent' })
      s = { ...s, activePlayer: 'player' }
    }
    return { fired, state: s }
  }

  it('fires three times when a host dies carrying three upgrades', () => {
    const three = [tok(TOKEN_ADVANTAGE, 'player'), tok(TOKEN_SHIELD, 'player'), tok(TOKEN_ADVANTAGE, 'player')]
    // A targeted defeat, so the shield has no damage to soak and simply goes down with its host.
    const dead = defeatUnit(board(three), 'mine')
    expect(dead.players.player.units.some(u => u.instanceId === 'mine')).toBe(false)
    expect(payOut(dead).fired).toBe(3)
  })

  it('fires three times when three Advantage tokens are spent on one attack', () => {
    const attacked = resolve(board([tok(TOKEN_ADVANTAGE, 'player'), tok(TOKEN_ADVANTAGE, 'player'), tok(TOKEN_ADVANTAGE, 'player')]), {
      type: 'attack', attackerId: 'mine', target: { kind: 'base' },
    })
    expect(payOut(attacked).fired).toBe(3)
  })

  it('gives each firing its own answerable choice', () => {
    const attacked = resolve(board([tok(TOKEN_ADVANTAGE, 'player'), tok(TOKEN_ADVANTAGE, 'player')]), {
      type: 'attack', attackerId: 'mine', target: { kind: 'base' },
    })
    // Both are answerable in turn, so two lots of 1 damage land on top of the attack's own.
    const before = attacked.players.opponent.base.damage
    const { fired, state: s } = payOut(attacked)
    expect(fired).toBe(2)
    expect(damageChoices(s)).toHaveLength(0)
    expect(s.players.opponent.base.damage).toBe(before + 2)
  })

  /** Ownership is per upgrade, so a mixed stack reaches each side's watchers separately. */
  it('counts an enemy-owned upgrade on your unit against the enemy', () => {
    const dead = resolve(board([tok(TOKEN_ADVANTAGE, 'player'), tok(TOKEN_ADVANTAGE, 'opponent')]), {
      type: 'attack', attackerId: 'mine', target: { kind: 'unit', instanceId: 'theirs' },
    })
    // Only the player has a Zeb, so only the player-owned token produces a choice.
    expect(damageChoices(dead)).toHaveLength(1)
    expect(upgradeDefeatedThisPhase(dead, 'player')).toBe(true)
    expect(upgradeDefeatedThisPhase(dead, 'opponent')).toBe(true)
  })
})

describe('Saboteur defeating the defending shields is a defeat', () => {
  it("marks the phase for the DEFENDER, who owned the shield", () => {
    const s = board([], [tok(TOKEN_SHIELD, 'opponent')])
    const withSabo: GameState = {
      ...s,
      players: { ...s.players, player: { ...s.players.player, units: [s.players.player.units[0], unit('sabo', 'SABO', { arena: 'ground' })] } },
    }
    const attacked = resolve(withSabo, { type: 'attack', attackerId: 'sabo', target: { kind: 'unit', instanceId: 'theirs' } })
    expect(attacked.players.opponent.units.find(u => u.instanceId === 'theirs')!.upgrades).toEqual([])
    expect(upgradeDefeatedThisPhase(attacked, 'opponent')).toBe(true)
  })
})

/**
 * #419 as reported: a friendly token was defeated earlier in the phase, so Baylan's second half
 * ("you may exhaust a unit") must be offered alongside the Advantage half.
 */
describe('Baylan Skoll sees a spent token as a defeated upgrade (#419)', () => {
  /** Move 69 of the filed report ("You Play Baylan Skoll (6)"), so 69 moves replayed. */
  const PLAYS_BAYLAN = 69

  it('offers the exhaust half after a friendly Advantage token was spent this phase', () => {
    const s = board([tok(TOKEN_ADVANTAGE, 'player')])
    const withBaylan: GameState = { ...s, players: { ...s.players, player: { ...s.players.player, hand: ['ASH_039'] } } }
    // The attack damages the enemy base (Advantage half) and spends the token (exhaust half).
    const attacked = resolve(withBaylan, { type: 'attack', attackerId: 'mine', target: { kind: 'base' } })
    // Clear Zeb's reaction to the spent token first, so only Baylan's own choices remain.
    const zeb = zebChoice(attacked)!
    const settled = resolve(attacked, { type: 'acceptChoice', choiceId: zeb.id, baseTarget: 'opponent' })

    // The attack handed the turn over; the reported game came back round to the player before
    // Baylan was played, which is the position under test.
    const played = resolve({ ...settled, activePlayer: 'player' }, { type: 'playUnit', handIndex: 0 })
    expect(played.pendingChoices?.map(c => c.kind)).toEqual(expect.arrayContaining(['mayGiveTokens', 'mayExhaustUnit']))
  })

  /**
   * The filed report itself, replayed up to the move that plays Baylan (#419). Helix Starfighter
   * had attacked the enemy base carrying three Advantage tokens: the base damage armed the
   * Advantage half, and the tokens spent on that attack should have armed the exhaust half. Only
   * the first was offered, and the reporter's next move is recorded against that, which is why this
   * stops here rather than replaying to the end.
   */
  it('replays the reported game and offers both halves (#419)', () => {
    // Taking the initiative triggers both their leader's ability and a unit's, so the batch is now
    // ordered first, a question the reporter was never asked. They answered the leader's, so that is
    // the order injected here; everything after it is their own recorded moves.
    const played = replayWith(loadReport('baylanExhaust'), { 36: s => pickTrigger(s, 'ASH_014') }, PLAYS_BAYLAN)
    expect(upgradeDefeatedThisPhase(played, 'player'), 'three Advantage tokens were spent this phase').toBe(true)
    expect(played.players.player.units.some(u => u.cardId === 'ASH_039'), 'Baylan Skoll is in play').toBe(true)
    expect(played.pendingChoices?.map(c => c.kind)).toEqual(['mayGiveTokens', 'mayExhaustUnit'])
  })
})
