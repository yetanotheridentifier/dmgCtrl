import { describe, it, expect } from 'vitest'
import ashSet from './fixtures/ashSet.json'
import type { SwuCard } from '../data/cards'
import { SWU_DB_API } from '../data/cards'
import { printingKey } from '../data/printings'
import {
  IMPLEMENTED_KEYWORDS,
  TRIAGE_API_BASE,
  identityKey,
  normalPrintings,
  residualAbility,
  triage,
  triggerHeads,
} from '../bench/triage'

/**
 * Card-pool triage: classify a set by what the engine cannot yet express, so a newly released set
 * can be sized without reading 260 cards by hand.
 *
 * The setup panel's "plays as printed" counts are checked against this tool for every set's fixture in
 * `implementedCards.test.ts`, which is where a drift between the two shows up.
 */

const ASH = ashSet as unknown as SwuCard[]

const card = (over: Partial<SwuCard>): SwuCard => ({
  Set: 'TST', Number: '1', Name: 'Test', Type: 'Unit', ...over,
})

describe('residualAbility', () => {
  it('is empty for a card whose only text is its keywords and their reminders', () => {
    expect(residualAbility(card({
      Keywords: ['Sentinel', 'Raid'],
      FrontText: 'Sentinel (Enemy units must attack this unit if able.)\nRaid 2',
    }))).toBe('')
  })

  it('keeps text that is a real ability', () => {
    expect(residualAbility(card({
      Keywords: ['Sentinel'],
      FrontText: 'Sentinel\nWhen Played: Draw a card.',
    }))).not.toBe('')
  })

  it('is empty for a card with no text at all', () => {
    expect(residualAbility(card({}))).toBe('')
  })
})

describe('normalPrintings', () => {
  it('drops non-Normal variants', () => {
    const pool = [
      card({ Number: '1', VariantType: 'Normal' }),
      card({ Number: '2', Name: 'Hyper', VariantType: 'Hyperspace' }),
    ]
    expect(normalPrintings(pool).map(c => c.Number)).toEqual(['1'])
  })

  it('de-duplicates a card reprinted at several collector numbers, keeping the lowest', () => {
    // IBH reprints the same card at up to three numbers; 104 printed slots are 51 real cards.
    const pool = [
      card({ Number: '103', Name: 'Blizzard Force AT-ST' }),
      card({ Number: '70', Name: 'Blizzard Force AT-ST' }),
      card({ Number: '89', Name: 'Blizzard Force AT-ST' }),
    ]
    const out = normalPrintings(pool)
    expect(out).toHaveLength(1)
    expect(out[0].Number).toBe('70')
  })

  it('keeps a card reprinted in a later set as a separate card', () => {
    // Different set means a different card id, and abilities register per id. Collapsing these
    // would undercount the work.
    const pool = [
      card({ Set: 'SOR', Number: '10', Name: 'Vanguard Infantry' }),
      card({ Set: 'LAW', Number: '55', Name: 'Vanguard Infantry' }),
    ]
    expect(normalPrintings(pool)).toHaveLength(2)
  })

  it('keeps two cards that share a name but differ by subtitle', () => {
    const pool = [
      card({ Number: '1', Name: 'Grogu', Subtitle: 'Found' }),
      card({ Number: '2', Name: 'Grogu', Subtitle: 'Irresistible' }),
    ]
    expect(normalPrintings(pool)).toHaveLength(2)
  })
})

describe('triage buckets', () => {
  const report = triage([
    card({ Number: '1', Name: 'Plain' }),
    card({ Number: '2', Name: 'Keyworded', Keywords: ['Sentinel'], FrontText: 'Sentinel' }),
    card({ Number: '3', Name: 'Plotter', Keywords: ['Plot'], FrontText: 'Plot' }),
    card({ Number: '4', Name: 'Abilitied', FrontText: 'When Played: Draw a card.' }),
    card({ Number: '5', Name: 'Chief', Type: 'Leader', FrontText: 'Action: Draw a card.' }),
    card({ Number: '6', Name: 'Shield', Type: 'Token' }),
  ])

  it('sorts each card into exactly one bucket', () => {
    expect(report.buckets.vanilla).toBe(1)
    expect(report.buckets['existing-keyword']).toBe(1)
    expect(report.buckets['new-keyword-only']).toBe(1)
    expect(report.buckets.ability).toBe(2) // the ability card plus the leader
  })

  it('excludes tokens entirely and counts leaders separately', () => {
    expect(report.cards).toBe(5)
    expect(report.leaders).toBe(1)
  })

  it('treats a leader as never vanilla, since its deployed side always carries an ability', () => {
    const leaderOnly = triage([card({ Type: 'Leader', Name: 'Blankfront' })])
    expect(leaderOnly.buckets.vanilla).toBe(0)
    expect(leaderOnly.buckets.ability).toBe(1)
  })
})

describe('triage blockers', () => {
  it('reports a card blocked by nothing as having no blockers', () => {
    const r = triage([card({ FrontText: 'When Played: Draw a card.' })])
    expect(r.triaged[0].blockers).toEqual([])
  })

  it('counts a sole blocker as unlocking its card on its own', () => {
    const r = triage([card({ FrontText: 'When Played: Give a Force token to a friendly unit.' })])
    const force = r.blockers.find(b => b.name === 'force-token')
    expect(force).toBeDefined()
    expect(force!.sole).toBe(1)
    expect(force!.touched).toBe(1)
  })

  it('stops blocking on a mechanic that has shipped: an Experience token grant is buildable', () => {
    const r = triage([card({ FrontText: 'When Played: Give an Experience token to a friendly unit.' })])
    expect(r.triaged[0].blockers).toEqual([])
  })

  it('credits neither blocker with a sole unlock when a card needs two', () => {
    // Bounty is gated behind capture: "when this unit is defeated OR CAPTURED".
    const r = triage([card({
      Keywords: ['Bounty'],
      FrontText: 'Bounty - Draw a card. (When this unit is defeated or captured, your opponent collects its bounty.)',
    })])
    const bounty = r.blockers.find(b => b.name === 'kw:Bounty')!
    const capture = r.blockers.find(b => b.name === 'capture')!
    expect(bounty.touched).toBe(1)
    expect(bounty.sole).toBe(0)
    expect(capture.touched).toBe(1)
    expect(capture.sole).toBe(0)
  })

  /**
   * Mechanics printed across whole sets that the engine has no primitive for. Each text is the real
   * card's, chosen because the mechanic is the only thing it needs.
   */
  it.each([
    ['credit-token', 'LAW Credit', 'When Played: Create a Credit token.'],
    ['disclose', 'SEC_062 Bardottan Ornithopter', 'When Played: You may disclose Vigilance (reveal a card from your hand with this aspect icon). If you do, draw a card.'],
    ['indirect-damage', 'JTL_234 Torpedo Barrage', 'Deal 5 indirect damage to a player. (They assign 5 unpreventable damage among their base and units.)'],
  ])('reports %s as the blocker on %s', (name, _card, text) => {
    const r = triage([card({ FrontText: text })])
    expect(r.triaged[0].blockers).toEqual([name])
    expect(r.blockers).toEqual([{ name, sole: 1, touched: 1 }])
  })

  it.each([
    ['the Mandalorian token unit', 'When Played: Create a Mandalorian token.'],
    ['a Battle Droid token unit', 'Create 2 Battle Droid tokens.'],
    ['a Clone Trooper token unit', 'When Played: Create a Clone Trooper token.'],
    ['a Spy token unit', 'When Defeated: Create a Spy token.'],
    ['an X-Wing token unit', 'When Played: Create an X-Wing token.'],
    ['a TIE Fighter token unit', 'When Played: Create a TIE Fighter token.'],
    ['a Beast token unit', 'Create 2 Beast tokens and ready 1 of them.'],
    ['a Shield token', 'When Played: Give a Shield token to a unit.'],
    ['an Advantage token', 'When Played: Give an Advantage token to a unit.'],
    ['direct damage', 'Deal 5 damage to a unit.'],
  ])('does not block a card on %s, which the engine has', (_what, text) => {
    expect(triage([card({ FrontText: text })]).triaged[0].blockers).toEqual([])
  })

  it('counts a card needing both Disclose and Indirect damage as touched by each, sole for neither', () => {
    const r = triage([card({ FrontText: 'You may disclose Aggression (reveal a card from your hand with this aspect icon). If you do, deal 2 indirect damage to a player.' })])
    expect(r.triaged[0].blockers.sort()).toEqual(['disclose', 'indirect-damage'])
    expect(r.blockers.every(b => b.sole === 0 && b.touched === 1)).toBe(true)
  })

  it('reads the Fortify keyword as implemented, and the cards that read a base\'s upgrades as buildable', () => {
    // HMW_037 Bacta Tank, and the base-reading texts of HMW_061, HMW_066, HMW_260, HMW_270 and HMW_004.
    const r = triage([
      card({ Type: 'Upgrade', Keywords: ['Fortify'], FrontText: 'Fortify\nWhen Played: Heal up to 3 damage from a non-Vehicle unit.' }),
      ...['On Attack: If your base is upgraded, draw a card.',
        'For each upgrade on your base, this unit gets +1/+0 and gains Restore 1.',
        'If you control an upgraded base, this unit costs 2 less to play.',
        'When Played: You may defeat an upgrade on a base.',
        'Ignore the aspect penalties on upgrades with Fortify you play.'].map((FrontText, i) => card({ Number: String(i + 2), Name: `Test ${i + 2}`, FrontText })),
    ])
    expect(r.triaged.map(t => t.blockers)).toEqual([[], [], [], [], [], []])
    expect(IMPLEMENTED_KEYWORDS.has('Fortify')).toBe(true)
  })

  it('reads "Attached base gains:" as a base upgrade\'s ability, not a unit\'s granted ability block', () => {
    // HMW_070 Dark Sanctum.
    const r = triage([card({ Type: 'Upgrade', Keywords: ['Fortify'], FrontText: 'Fortify (Attach this to your base, not a unit.)\nAttached base gains: "When the regroup phase starts: Draw a card and deal 2 damage to this base."' })])
    expect(r.triaged[0].blockers).toEqual([])
  })

  it('does not treat an implemented keyword as a blocker', () => {
    const r = triage([card({ Keywords: ['Sentinel'], FrontText: 'Sentinel\nWhen Played: Draw a card.' })])
    expect(r.triaged[0].blockers).toEqual([])
    expect(IMPLEMENTED_KEYWORDS.has('Sentinel')).toBe(true)
  })
})

describe('trigger heads', () => {
  /**
   * A head is the text before the first colon on a line that starts with a capital, however long.
   * Each text is the real card's FrontText; a head read as none would put the card in the
   * constant-abilities batch and never raise the trigger blocker it needs.
   */
  it.each([
    ['SEC_093 C-3P0', "Action [Exhaust, return this unit to its owner's hand]: Give a unit +2/+2 for this phase.", 'Action'],
    ['SHD_028 Doctor Pershing', 'Action [Exhaust, deal 1 damage to a friendly unit]: Draw a card.', 'Action'],
    ['JTL_089 The Invisible Hand', 'When Played/When this unit completes an attack (and survives): You may search the top 8 cards of your deck for a Droid unit, reveal it, and draw it.', 'When Played/When this unit completes an attack (and survives)'],
    ['SEC_041 Populist Advisor', 'When an enemy unit deals combat damage to your base: This unit gains Sentinel for this phase.', 'When an enemy unit deals combat damage to your base'],
    ['JTL_188 Moff Gideon', "When this unit deals combat damage to an opponent's base: Each unit that opponent plays this phase costs 1 more.", "When this unit deals combat damage to an opponent's base"],
    ['SHD_250 Tarfful', "Restore 2 \nWhen a friendly Wookiee unit is dealt combat damage and isn't defeated: That unit deals that much damage to an enemy ground unit.", "When a friendly Wookiee unit is dealt combat damage and isn't defeated"],
    ['SOR_085 Rukh', 'SHIELDED (When you play this unit, give a Shield token to it.)\nWhen this unit deals combat damage to a non-leader unit while attacking: Defeat that unit.', 'When this unit deals combat damage to a non-leader unit while attacking'],
    ['SOR_133 Seventh Sister', "SABOTEUR (When this unit attacks, ignore Sentinel and defeat the defender's Shields.)\nWhen this unit deals combat damage to an opponent's base: You may deal 3 damage to a ground unit that opponent controls.", "When this unit deals combat damage to an opponent's base"],
  ])('reads the whole head on %s', (_card, text, head) => {
    expect(triggerHeads(text)).toEqual([head])
  })

  it('reads no head from keyword reminder text, which carries no colon', () => {
    expect(triggerHeads('SHIELDED (When you play this unit, give a Shield token to it.)')).toEqual([])
  })

  it('batches an Action with a long bracketed cost under Action, not as a constant ability', () => {
    // SEC_093 C-3P0.
    const r = triage([card({ FrontText: "Action [Exhaust, return this unit to its owner's hand]: Give a unit +2/+2 for this phase." })])
    expect(r.triaged[0].blockers).toEqual([])
    expect(r.batches).toEqual([{ head: 'Action', cards: 1 }])
  })

  /**
   * A slash joins two trigger points, and the card is blocked by whichever of them the engine does not
   * dispatch, not by the join. One ability block registered at several points is what the engine does,
   * so a head whose every part is dispatched blocks on nothing at all.
   */
  it.each([
    ['SOR_040 Avenger', 'When Played/On Attack: An opponent chooses a non-leader unit they control. Defeat that unit.'],
    ['SOR_147 Black One', 'When Played/When Defeated: You may discard your hand. If you do, draw 3 cards.'],
    ['JTL_090 Executor', 'When Played/On Attack/When Defeated: Create 3 TIE Fighter tokens.'],
    ['SEC_048 Captain Rex', 'When Played/When this unit completes an attack: Give this unit and an enemy unit Sentinel for this phase.'],
    ['TWI_033 Calculating MagnaGuard', 'When Played/When a friendly unit is defeated: This unit gains Sentinel for this phase.'],
  ])('blocks %s on nothing: every part of its compound head is a dispatched trigger point', (_card, text) => {
    expect(triage([card({ FrontText: text })]).triaged[0].blockers).toEqual([])
  })

  it('reads a trailing parenthetical on a head as reminder text, not as part of the trigger point', () => {
    // JTL_089 The Invisible Hand. "(and survives)" restates when onAttackEnd fires, which it already does.
    const text = 'When Played/When this unit completes an attack (and survives): You may search the top 8 cards of your deck for a Droid unit, reveal it, and draw it. If it costs 2 or less, you may play it for free. (Put the other cards on the bottom of your deck in a random order.)'
    expect(triage([card({ FrontText: text })]).triaged[0].blockers).toEqual([])
  })

  it('blocks a compound head on the half the engine cannot dispatch, not on the join', () => {
    // SEC_143 The Elite Squad. "When Played" is dispatched; damage dealt to this unit is not a trigger
    // point at all, so that half is what holds the card back and the report has to name it. Three cards,
    // because a trigger blocker on fewer than ONE_OFF_THRESHOLD cards folds into trigger:one-off.
    // The blocker names the missing half alone, so cards waiting on the same point group together
    // however their compound heads are spelled.
    const r = triage([1, 2, 3].map(n => card({ Number: String(n), Name: `Squad ${n}`, FrontText: 'When Played/When damage is dealt to this unit: You may deal 2 damage to another unique unit.' })))
    const missing = ['trigger:When damage is dealt to this unit']
    expect(r.triaged.map(c => c.blockers)).toEqual([missing, missing, missing])
  })

  /**
   * A head ending in "gains", or in "gains <a keyword or trait> and", hands a quoted ability to a unit.
   * It is a granted-ability lead-in, not a trigger point, however it is spelled. Read as a trigger
   * point, each spelling was a head of its own and folded into trigger:one-off, undercounting the
   * granted-ability work. Each text is the real card's.
   */
  it.each([
    ['SOR_121 Hardpoint Heavy Blaster', "Attach to a VEHICLE unit.\nAttached unit gains: \"On Attack: If this unit isn't attacking a base, you may deal 2 damage to a unit in the defender's arena.\""],
    ['SOR_105 General Krell', 'Each other friendly unit gains:\n"When Defeated: You may draw a card."'],
    ['SOR_054 Jedi Lightsaber', 'Attach to a non-VEHICLE unit.\nIf attached unit is a FORCE unit, it gains: "On Attack: Give the defender -2/-2 for this phase."'],
    ['TWI_121 General\'s Blade', 'Attach to a non-Vehicle unit. \nIf attached unit is a Jedi, it gains: "On Attack: The next unit you play this phase costs 2 less."'],
    ['TWI_103 Pyrrhic Assault', 'For this phase, each friendly unit gains: "When Defeated: Deal 2 damage to an enemy unit."'],
    ['TWI_047 Satine Kryze', "Each unit (including enemy units) gains: \"Action [exhaust]: Discard cards from an opponent's deck equal to half this unit's remaining HP, rounded up.\""],
    ['LOF_205 Force Speed', "Attack with a unit. For this attack, it gains: “On Attack: Return any number of non-unique (non-unique) upgrades attached to the defender to their owners' hands.”"],
    ['SOR_150 Heroic Sacrifice', 'Draw a card, then attack with a unit. For this attack, it gets +2/+0 and gains: "When this unit deals combat damage: Defeat it."'],
    ['LAW_077 Shadow of Stygeon Prime', 'Attach to a non-leader unit. \nAttached unit can\'t ready. It gains: "When the regroup phase starts: Deal 2 damage to your base."'],
    ['SEC_156 Nemik\'s Manifesto', 'Attach to a non-Vehicle unit.\nAttached unit gains the Rebel trait and: “When Defeated: Deal 1 damage to each enemy base for each other friendly Rebel unit.”'],
    ['SEC_231 Implicate', 'Choose a unit. For this phase, it gains Sentinel and: “When this unit is attacked: Create a Spy token.”'],
    ['TWI_129 In Defense of Kamino', 'For this phase, each friendly Republic unit gains Restore 2 and: "When Defeated: Create a Clone Trooper token."'],
  ])('reads the lead-in on %s as granted-ability-block alone', (_card, text) => {
    expect(triage([card({ FrontText: text })]).triaged[0].blockers).toEqual(['granted-ability-block'])
  })

  it.each([
    ['LOF_098 Leia Organa', 'force-token', 'While this unit is in the space arena, she can\'t ready and gains: "Action [use the Force]: Move this unit to the ground arena and give each friendly Heroism unit +2/+2 for this phase."'],
  ])('reads the lead-in on %s as granted-ability-block beside its %s blocker', (_card, other, text) => {
    expect(triage([card({ FrontText: text })]).triaged[0].blockers.sort()).toEqual([other, 'granted-ability-block'].sort())
  })

  it('counts three lead-ins sharing a stat notation as granted-ability-block, not as compound or one-off', () => {
    // JTL_177 Stay on Target, JTL_156 Trench Run, SOR_150 Heroic Sacrifice. "+2/+0" is a stat line, not
    // a second trigger point.
    const r = triage([
      card({ Number: '1', Type: 'Event', Name: 'Stay on Target', FrontText: 'Attack with a Vehicle unit. For this attack, it gets +2/+0 and gains: "When this unit deals damage to a base: Draw a card."' }),
      card({ Number: '2', Type: 'Event', Name: 'Trench Run', FrontText: "Attack with a Fighter unit. For this attack, it gets +4/+0 and gains: \"On Attack: Discard 2 cards from the defending player's deck. Deal unpreventable damage equal to the difference in the discarded cards' costs to this unit.\"" }),
      card({ Number: '3', Type: 'Event', Name: 'Heroic Sacrifice', FrontText: 'Draw a card, then attack with a unit. For this attack, it gets +2/+0 and gains: "When this unit deals combat damage: Defeat it."' }),
    ])
    expect(r.triaged.map(c => c.blockers)).toEqual([['granted-ability-block'], ['granted-ability-block'], ['granted-ability-block']])
    expect(r.blockers).toEqual([{ name: 'granted-ability-block', sole: 3, touched: 3 }])
  })

  it('keeps a printed trigger head beside a lead-in on the same card', () => {
    // JTL_260 Death Star Plans: "When attached unit is attacked" is a real trigger point.
    const r = triage([card({ FrontText: 'When attached unit is attacked: The attacking player takes control of this upgrade and attaches it to a unit they control. \nAttached unit gains: "The first unit you play each round costs 2 less."' })])
    expect(r.triaged[0].blockers.sort()).toEqual(['granted-ability-block', 'trigger:one-off'])
  })

  it('blocks a card on a long head the framework does not dispatch', () => {
    // SEC_081 Major Partagaz: alone in the pool, so the head folds into the one-off bucket. No point
    // raises "when another friendly unit attacks": `onAttack` is heard by the attacker alone.
    const r = triage([card({ FrontText: 'When another friendly Official unit attacks: This unit gets +2/+2 for this phase.' })])
    expect(r.triaged[0].blockers).toEqual(['trigger:one-off'])
    expect(r.batches).toEqual([])
  })
})

describe('triage fallout probes', () => {
  // The probes exist because the blocker list catches new NOUNS but not familiar nouns in an
  // unfamiliar SHAPE. This card is the real SEC_145, which reads as ordinary text and is not.
  const confidenceInVictory = card({
    Set: 'SEC', Number: '145', Type: 'Event', Name: 'Confidence in Victory',
    FrontText: 'Play only as your first action in the action phase.\nChoose an arena. At the start of the regroup phase, if you are the only player who controls units in that arena, you win the game.',
  })

  it('flags a card that needs engine work no blocker probe can see', () => {
    const r = triage([confidenceInVictory])
    expect(r.triaged[0].blockers).toEqual([]) // classified free ...
    expect(r.triaged[0].suspects).toEqual(   // ... but flagged for reading
      expect.arrayContaining(['alternate-win', 'play-restriction', 'delayed-effect']),
    )
    expect(r.suspectCards).toBe(1)
  })

  it('does not flag an ordinary card', () => {
    const r = triage([card({ FrontText: 'When Played: Draw a card.' })])
    expect(r.triaged[0].suspects).toEqual([])
    expect(r.suspectCards).toBe(0)
  })
})

describe('the ASH anchor', () => {
  const report = triage(ASH)

  it('finds every ASH leader', () => {
    expect(report.leaders).toBe(18)
  })

  it('finds no unimplemented keyword in ASH', () => {
    // ASH uses none of Bounty, Coordinate, Exploit, Piloting, Plot or Smuggle.
    expect(report.buckets['new-keyword-only']).toBe(0)
    expect(report.blockers.filter(b => b.name.startsWith('kw:'))).toEqual([])
  })

  it('finds no mechanic ASH plays without, since every ASH card is built', () => {
    // A blocker firing on the implemented set is a false positive in its pattern.
    const mechanics = ['token-unit', 'credit-token', 'disclose', 'indirect-damage']
    expect(report.blockers.filter(b => mechanics.includes(b.name))).toEqual([])
  })

  it('finds no card granting an Experience token, which is why ASH reads 3 of 4 tokens', () => {
    // The token is printed in the set; no ASH card grants one, so nothing is blocked on it.
    expect(report.blockers.some(b => b.name === 'experience-token')).toBe(false)
  })
})

describe('card identity', () => {
  it('matches the printing key the app canonicalises with, so the two cannot drift', () => {
    const c = card({ Type: 'Unit', Name: 'Grogu', Subtitle: 'Irresistible' })
    expect(identityKey(c)).toBe(printingKey(c))
  })

  it('separates a leader from a unit that shares its name with no subtitle', () => {
    // ASH has 13 unit names that collide with leader names. Without Type in the key one is lost.
    const pool = [
      card({ Set: 'ASH', Number: '18', Type: 'Leader', Name: 'Grogu' }),
      card({ Set: 'ASH', Number: '155', Type: 'Unit', Name: 'Grogu' }),
    ]
    expect(normalPrintings(pool)).toHaveLength(2)
  })
})

describe('cross-set reprints', () => {
  const reprinted = {
    Type: 'Unit', Name: 'Vanguard Infantry',
    FrontText: 'When Played: Draw a card.',
  }

  it('reports a card printed in two sets, and the ids one registration covers', () => {
    const r = triage([
      card({ ...reprinted, Set: 'SOR', Number: '10' }),
      card({ ...reprinted, Set: 'LAW', Number: '55' }),
    ])
    expect(r.reprints).toHaveLength(1)
    expect(r.reprints[0].ids).toEqual(['LAW_55', 'SOR_10'])
    // Two ids, one behaviour: the saving is the extra id, not the card.
    expect(r.reprintSavings).toBe(1)
  })

  it('counts both printings as work, since abilities register per card id', () => {
    const r = triage([
      card({ ...reprinted, Set: 'SOR', Number: '10' }),
      card({ ...reprinted, Set: 'LAW', Number: '55' }),
    ])
    expect(r.cards).toBe(2)
    expect(r.buckets.ability).toBe(2)
  })

  it('ignores a card printed once', () => {
    expect(triage([card({ ...reprinted, Set: 'SOR', Number: '10' })]).reprints).toEqual([])
  })

  /**
   * The reprint table (`data/reprints.ts`) is declared by hand, so triage is where a new set's
   * reprints get noticed: a pair it does not collapse onto one id is a line still to add (#551).
   */
  it('marks a pair the reprint table already collapses onto one implementation', () => {
    const r = triage([
      card({ ...reprinted, Set: 'ASH', Number: '258' }),
      card({ ...reprinted, Set: 'SEC', Number: '258' }),
    ])
    expect(r.reprints[0].registered).toBe(true)
  })

  it('marks a pair the table does not cover, which is the work it is reporting', () => {
    const r = triage([
      card({ ...reprinted, Set: 'SOR', Number: '10' }),
      card({ ...reprinted, Set: 'LAW', Number: '55' }),
    ])
    expect(r.reprints[0].registered).toBe(false)
  })

  it('does not treat a same-set reprint at another collector number as cross-set', () => {
    // IBH prints one card at up to three numbers. That collapses in normalPrintings instead.
    const r = triage([
      card({ ...reprinted, Set: 'IBH', Number: '70' }),
      card({ ...reprinted, Set: 'IBH', Number: '89' }),
    ])
    expect(r.cards).toBe(1)
    expect(r.reprints).toEqual([])
  })
})

describe('the fetch endpoint', () => {
  it('uses the same origin as the app, so the two cannot drift', () => {
    expect(TRIAGE_API_BASE).toBe(SWU_DB_API)
  })
})
