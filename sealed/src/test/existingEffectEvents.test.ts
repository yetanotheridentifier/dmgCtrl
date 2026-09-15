import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { unitHasKeyword, unitKeywordValue } from '../engine/keywords'
import { effectiveHp, effectivePower } from '../engine/stats'
import { reprintCanonicalId } from '../data/reprints'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { TOKEN_SHIELD } from '../engine/tokenUpgrades'
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import type { EngineCard, GameState, PendingChoice, PhaseEvents, UnitState } from '../engine/types'

/**
 * Events from the sealed sets beyond ASH whose whole effect is an existing primitive or pending choice.
 * Grouped by shape: a group shares one choice kind, so the table asserts what differs per card (the
 * eligible targets and the amounts) and one case per group asserts that answering it does the thing.
 */

const ev = (id: string, cost = 1) => card({ id, type: 'event', cost })
const F = {
  ...CARDS,
  GRD: card({ id: 'GRD', arena: 'ground', cost: 2, power: 2, hp: 6, aspects: ['Command'] }),
  TOUGH: card({ id: 'TOUGH', arena: 'ground', cost: 4, power: 2, hp: 20 }),
  SPACE: card({ id: 'SPACE', arena: 'space', cost: 3, power: 2, hp: 6 }),
  BIG: card({ id: 'BIG', arena: 'ground', cost: 6, power: 5, hp: 8 }),
  CHEAP: card({ id: 'CHEAP', arena: 'ground', cost: 2, power: 1, hp: 3 }),
  FRAIL: card({ id: 'FRAIL', arena: 'ground', cost: 1, power: 1, hp: 1 }),
  VEH: card({ id: 'VEH', arena: 'ground', cost: 5, power: 3, hp: 9, traits: ['VEHICLE'] }),
  VILLAIN: card({ id: 'VILLAIN', arena: 'ground', cost: 3, power: 2, hp: 4, aspects: ['Villainy', 'Villainy'] }),
  FORCE: card({ id: 'FORCE', arena: 'ground', cost: 3, power: 3, hp: 5, traits: ['FORCE'], aspects: ['Vigilance', 'Villainy'] }),
  FORCEBIG: card({ id: 'FORCEBIG', arena: 'ground', cost: 5, power: 5, hp: 5, traits: ['FORCE'] }),
  FIGHTER: card({ id: 'FIGHTER', arena: 'space', cost: 2, power: 2, hp: 3, traits: ['FIGHTER'] }),
  TRANSPORT: card({ id: 'TRANSPORT', arena: 'space', cost: 6, power: 6, hp: 6, traits: ['TRANSPORT'] }),
  CREATURE: card({ id: 'CREATURE', arena: 'ground', cost: 2, power: 2, hp: 4, traits: ['CREATURE'] }),
  TROOPER: card({ id: 'TROOPER', arena: 'ground', cost: 2, power: 2, hp: 4, traits: ['TROOPER'] }),
  JEDI: card({ id: 'JEDI', arena: 'ground', cost: 2, power: 2, hp: 4, traits: ['JEDI'] }),
  OFFICIAL: card({ id: 'OFFICIAL', arena: 'ground', cost: 2, power: 1, hp: 4, traits: ['OFFICIAL'] }),
  SENTINEL: card({ id: 'SENTINEL', arena: 'ground', cost: 2, power: 1, hp: 9, keywords: [{ name: 'Sentinel' }] }),
  STRIKER: card({ id: 'STRIKER', arena: 'ground', cost: 2, power: 5, hp: 3 }),
  UPG: card({ id: 'UPG', type: 'upgrade', cost: 1, power: 1, hp: 1 }),
  SOR_172: ev('SOR_172', 3), SHD_178: ev('SHD_178'), JTL_125: ev('JTL_125'),
  SOR_078: ev('SOR_078', 5), LOF_264: ev('LOF_264'), SHD_079: ev('SHD_079'), LOF_077: ev('LOF_077'), SHD_078: ev('SHD_078'),
  SOR_077: ev('SOR_077'), JTL_078: ev('JTL_078'), SEC_247: ev('SEC_247'),
  SOR_251: ev('SOR_251'), SOR_074: ev('SOR_074'), SOR_073: ev('SOR_073'), JTL_262: ev('JTL_262'),
  SOR_169: ev('SOR_169'), LOF_174: ev('LOF_174'), JTL_179: ev('JTL_179'), JTL_209: ev('JTL_209'),
  SOR_222: ev('SOR_222'), LAW_246: ev('LAW_246'), SHD_233: ev('SHD_233'),
  SOR_124: ev('SOR_124'), SHD_130: ev('SHD_130'), LAW_131: ev('LAW_131'), JTL_079: ev('JTL_079'), SOR_216: ev('SOR_216'),
  LOF_126: ev('LOF_126'), JTL_229: ev('JTL_229'), SOR_076: ev('SOR_076'), SEC_075: ev('SEC_075'), LOF_217: ev('LOF_217'),
  TWI_052: ev('TWI_052'), SHD_051: ev('SHD_051'), LOF_078: ev('LOF_078'), LAW_167: ev('LAW_167'), TWI_074: ev('TWI_074'),
  TWI_175: ev('TWI_175'), SEC_125: ev('SEC_125'), TWI_100: ev('TWI_100'), SHD_159: ev('SHD_159'),
  TWI_173: ev('TWI_173'), LOF_141: ev('LOF_141'), TWI_126: ev('TWI_126'), TWI_075: ev('TWI_075'), LOF_127: ev('LOF_127'),
  SOR_154: ev('SOR_154'), LOF_152: ev('LOF_152'), TWI_250: ev('TWI_250'),
  SOR_220: ev('SOR_220'), TWI_224: ev('TWI_224'), SOR_168: ev('SOR_168'), SOR_217: ev('SOR_217'),
}

/** The fixture helper reads a unit's arena from the shared pool, which does not hold these cards. */
const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: (F as Record<string, EngineCard>)[cardId]?.arena ?? 'ground', ...over })
const all = (s: GameState) => [...s.players.player.units, ...s.players.opponent.units]
const U = (s: GameState, id: string) => all(s).find(u => u.instanceId === id)
const rich = (over: Parameters<typeof player>[0] = {}) => player({ resources: ready(20), ...over })
const play = (s: GameState) => resolve(s, { type: 'playEvent', handIndex: 0 })
const choice = (s: GameState): PendingChoice => s.pendingChoices![0]
const noChoice = (s: GameState) => expect(s.pendingChoices ?? []).toHaveLength(0)
const targetsOf = (c: PendingChoice): string[] => {
  const t = 'unitTargets' in c ? c.unitTargets : 'targets' in c ? c.targets : []
  return [...t].sort()
}
const accept = (s: GameState, extra: { targetInstanceId?: string; baseTarget?: 'player' | 'opponent'; optionIndex?: number }) =>
  resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, ...extra })
const skippable = (s: GameState) => legalMoves(s).some(m => m.type === 'skipTrigger')
const phaseEvents = (over: Partial<PhaseEvents>): PhaseEvents => ({
  enteredPlay: { player: [], opponent: [] }, defeated: { player: [], opponent: [] }, basesAttacked: [], basesDamaged: [],
  upgradesDefeated: [], damagedUnits: [], leftPlay: { player: [], opponent: [] }, leaderLeftPlay: [], played: { player: [], opponent: [] },
  ...over,
})

/** Play `eventId` with these boards. */
const board = (eventId: string, mine: ReturnType<typeof unit>[], theirs: ReturnType<typeof unit>[], over: Partial<GameState> = {}) =>
  state({ cards: F, players: { player: rich({ hand: [eventId], units: mine }), opponent: player({ units: theirs }) }, ...over })

describe('damage events', () => {
  const mine = [unit('a', 'GRD')]
  const theirs = [unit('e', 'TOUGH')]

  it('Open Fire (SOR_172) deals 4 to any unit, and no base', () => {
    const played = play(board('SOR_172', mine, theirs))
    expect(choice(played)).toMatchObject({ kind: 'selectDamageTarget', amount: 4, baseTargets: [] })
    expect(targetsOf(choice(played))).toEqual(['a', 'e'])
    expect(skippable(played)).toBe(false)
    expect(U(accept(played, { targetInstanceId: 'e' }), 'e')!.damage).toBe(4)
  })

  it('Daring Raid (SHD_178) deals 2 to a unit or either base', () => {
    const played = play(board('SHD_178', mine, theirs))
    expect(choice(played)).toMatchObject({ kind: 'selectDamageTarget', amount: 2, baseTargets: ['player', 'opponent'] })
    expect(targetsOf(choice(played))).toEqual(['a', 'e'])
    expect(accept(played, { baseTarget: 'opponent' }).players.opponent.base.damage).toBe(2)
  })

  it('Air Superiority (JTL_125) deals 4 to an enemy ground unit only while you have more space units', () => {
    const ahead = play(board('JTL_125', [unit('s1', 'SPACE'), unit('s2', 'SPACE')], [unit('s3', 'SPACE'), unit('g', 'GRD')]))
    expect(choice(ahead)).toMatchObject({ kind: 'selectDamageTarget', amount: 4, baseTargets: [] })
    expect(targetsOf(choice(ahead))).toEqual(['g'])
    noChoice(play(board('JTL_125', [unit('s1', 'SPACE')], [unit('s3', 'SPACE'), unit('g', 'GRD')])))
  })
})

describe('defeat events: which units each one may defeat', () => {
  // Two Villainy icons among friendly units; the leader unit has 5 HP remaining; BIG has 5 remaining.
  const mine = [unit('a', 'VILLAIN'), unit('L', 'TST_L', { isLeader: true, damage: 2 })]
  const theirs = [unit('c', 'CHEAP'), unit('b', 'BIG', { damage: 3 }), unit('v', 'VEH')]

  it.each([
    ['SOR_078', 'Vanquish: a non-leader unit', ['a', 'b', 'c', 'v']],
    ['LOF_264', "It's Worse: a non-leader unit", ['a', 'b', 'c', 'v']],
    ['SHD_079', "Rival's Fall: any unit, leaders included", ['L', 'a', 'b', 'c', 'v']],
    ['LOF_077', 'Crushing Blow: a non-leader costing 2 or less', ['c']],
    ['SHD_078', 'Fell the Dragon: a non-leader with 5 or more power', ['b']],
    ['SOR_077', 'Takedown: 5 or less remaining HP, leaders included', ['L', 'a', 'b', 'c']],
    ['JTL_078', 'Direct Hit: a non-leader Vehicle', ['v']],
    ['SEC_247', 'Evil is Everywhere: cost no more than the friendly Villainy icons', ['c']],
  ])('%s %s', (id, _label, expected) => {
    const played = play(board(id, mine, theirs))
    expect(choice(played).kind).toBe('selectUnitToDefeat')
    expect(targetsOf(choice(played))).toEqual(expected)
  })

  it('defeats the chosen unit', () => {
    const played = play(board('SOR_078', mine, theirs))
    const done = accept(played, { targetInstanceId: 'b' })
    expect(U(done, 'b')).toBeUndefined()
    expect(done.players.opponent.discard).toContain('BIG')
  })

  it('raises nothing when no unit qualifies', () => {
    noChoice(play(board('JTL_078', mine, [unit('c', 'CHEAP')])))
  })
})

describe('single-target utility events', () => {
  it('Confiscate (SOR_251) defeats any upgrade on either side, and must', () => {
    const s = board('SOR_251', [unit('a', 'GRD', { upgrades: [{ cardId: 'UPG', owner: 'player' }] })], [unit('e', 'GRD', { upgrades: [{ cardId: 'UPG', owner: 'opponent' }] })])
    const played = play(s)
    expect(choice(played)).toMatchObject({ kind: 'selectUpgradeToDefeat', optional: false })
    expect(choice(played).kind === 'selectUpgradeToDefeat' && choice(played)).toMatchObject({ candidates: [{ unitId: 'a' }, { unitId: 'e' }] })
    expect(skippable(played)).toBe(false)
    const done = accept(played, { optionIndex: 1 })
    expect(U(done, 'e')!.upgrades).toHaveLength(0)
    expect(done.players.opponent.discard).toContain('UPG')
  })

  it('Repair (SOR_074) heals 3 from a unit or either base', () => {
    const s = board('SOR_074', [unit('a', 'GRD', { damage: 4 })], [], {})
    s.players.player.base.damage = 5
    const played = play(s)
    expect(choice(played)).toMatchObject({ kind: 'selectHealTarget', amount: 3, unitTargets: ['a'], baseTargets: ['player', 'opponent'] })
    expect(accept(played, { baseTarget: 'player' }).players.player.base.damage).toBe(2)
    expect(U(accept(played, { targetInstanceId: 'a' }), 'a')!.damage).toBe(1)
  })

  it('Moment of Peace (SOR_073) gives a Shield token to any unit, and must', () => {
    const played = play(board('SOR_073', [unit('a', 'GRD')], [unit('e', 'GRD')]))
    expect(choice(played)).toMatchObject({ kind: 'mayGiveTokens', token: TOKEN_SHIELD, count: 1, optional: false })
    expect(targetsOf(choice(played))).toEqual(['a', 'e'])
    expect(skippable(played)).toBe(false)
    expect(U(accept(played, { targetInstanceId: 'e' }), 'e')!.upgrades).toEqual([{ cardId: TOKEN_SHIELD, owner: 'opponent' }])
  })

  it('Evasive Maneuver (JTL_262) exhausts any unit', () => {
    const played = play(board('JTL_262', [unit('a', 'GRD')], [unit('e', 'GRD')]))
    expect(choice(played).kind).toBe('mayExhaustUnit')
    expect(targetsOf(choice(played))).toEqual(['a', 'e'])
    expect(U(accept(played, { targetInstanceId: 'e' }), 'e')!.exhausted).toBe(true)
  })
})

describe('ready events', () => {
  const mine = [
    unit('f', 'FORCE', { exhausted: true }), unit('fb', 'FORCEBIG', { exhausted: true }), unit('fi', 'FIGHTER', { exhausted: true }),
    unit('tr', 'TRANSPORT', { exhausted: true }), unit('b', 'BIG', { exhausted: true }),
  ]
  const theirs = [unit('e', 'CHEAP', { exhausted: true })]

  it.each([
    ['SOR_169', 'Keep Fighting: 3 or less power', ['e', 'f', 'fi']],
    ['LOF_174', 'Ataru Onslaught: a Force unit with 4 or less power', ['f']],
    ['JTL_179', 'Koiogran Turn: a Fighter or Transport with 6 or less power', ['fi', 'tr']],
  ])('%s %s', (id, _label, expected) => {
    const played = play(board(id, mine, theirs))
    expect(choice(played).kind).toBe('selectUnitToReady')
    expect(targetsOf(choice(played))).toEqual(expected)
  })

  it('readies the chosen unit', () => {
    const played = play(board('SOR_169', mine, theirs))
    expect(U(accept(played, { targetInstanceId: 'fi' }), 'fi')!.exhausted).toBe(false)
  })

  it("It's a Trap (JTL_209) readies each friendly space unit while the opponent has more space units", () => {
    const mineHere = [unit('s', 'SPACE', { exhausted: true }), unit('g', 'GRD', { exhausted: true })]
    const behind = play(board('JTL_209', mineHere, [unit('x', 'SPACE'), unit('y', 'SPACE')]))
    expect(U(behind, 's')!.exhausted).toBe(false)
    expect(U(behind, 'g')!.exhausted).toBe(true)
    const level = play(board('JTL_209', mineHere, [unit('x', 'SPACE')]))
    expect(U(level, 's')!.exhausted).toBe(true)
  })
})

describe('return-to-hand events', () => {
  const mine = [unit('a', 'VILLAIN'), unit('L', 'TST_L', { isLeader: true })]
  const theirs = [unit('c', 'CHEAP'), unit('b', 'BIG')]

  it.each([
    ['SOR_222', 'Waylay: a non-leader unit', ['a', 'b', 'c']],
    ['LAW_246', 'The Axe Forgets: a non-leader costing 3 or less', ['a', 'c']],
  ])('%s %s', (id, _label, expected) => {
    const played = play(board(id, mine, theirs))
    expect(choice(played).kind).toBe('selectUnitToReturn')
    expect(targetsOf(choice(played))).toEqual(expected)
  })

  it("returns the chosen unit to its owner's hand", () => {
    const done = accept(play(board('SOR_222', mine, theirs)), { targetInstanceId: 'b' })
    expect(U(done, 'b')).toBeUndefined()
    expect(done.players.opponent.hand).toContain('BIG')
  })

  it("Evacuate (SHD_233) returns every non-leader unit to its owner's hand, and leaves leaders", () => {
    const done = play(board('SHD_233', mine, theirs))
    expect(all(done).map(u => u.instanceId)).toEqual(['L'])
    expect(done.players.player.hand).toEqual(['VILLAIN'])
    expect(done.players.opponent.hand.slice().sort()).toEqual(['BIG', 'CHEAP'])
  })
})

describe('"for this phase" buffs and debuffs on one unit', () => {
  // A friendly Force unit is present, so the Force-conditional cards take their larger form.
  const mine = [unit('a', 'GRD'), unit('f', 'FORCE', { exhausted: true })]
  const theirs = [unit('e', 'TOUGH'), unit('n', 'TOUGH')]
  const entered = { phaseEvents: phaseEvents({ enteredPlay: { player: [], opponent: ['n'] } }) }

  it.each([
    ['SOR_124', 'Tactical Advantage', ['a', 'e', 'f', 'n'], { power: 2, hp: 2 }],
    ['SHD_130', 'Moment of Glory', ['a', 'e', 'f', 'n'], { power: 4, hp: 4 }],
    ['LAW_131', 'Incapacitate', ['a', 'e', 'f', 'n'], { power: -2, hp: -2 }],
    ['JTL_079', 'Out the Airlock', ['a', 'e', 'f', 'n'], { power: -5, hp: -5 }],
    ['SOR_216', 'Disarm: an enemy unit', ['e', 'n'], { power: -4 }],
    ['LOF_126', 'Overpower', ['a', 'e', 'f', 'n'], { power: 3, hp: 3, keywords: [{ name: 'Overwhelm' }] }],
    ['JTL_229', 'Diversion', ['a', 'e', 'f', 'n'], { keywords: [{ name: 'Sentinel' }] }],
    ['SOR_076', 'Make an Opening', ['a', 'e', 'f', 'n'], { power: -2, hp: -2 }],
    ['SEC_075', 'Knowledge and Defense', ['a', 'e', 'f', 'n'], { power: -2, hp: -2 }],
    ['LOF_217', 'Force Slow: an exhausted unit', ['f'], { power: -8 }],
    ['TWI_052', 'Hello There: a unit that entered play this phase', ['n'], { power: -4, hp: -4 }],
    ['SHD_051', 'Mystic Reflection: an enemy unit, -2/-2 with a Force unit', ['e', 'n'], { power: -2, hp: -2 }],
    ['LOF_078', 'Whirlwind of Power: -3/-3 with a Force unit', ['a', 'e', 'f', 'n'], { power: -3, hp: -3 }],
    ['LAW_167', 'Common Cause: +1/+1 per aspect among your units (Command, Vigilance, Villainy)', ['a', 'e', 'f', 'n'], { power: 3, hp: 3 }],
    ['TWI_074', 'Guarding the Way: Sentinel, and +2/+2 with the initiative', ['a', 'e', 'f', 'n'], { power: 2, hp: 2, keywords: [{ name: 'Sentinel' }] }],
  ])('%s %s', (id, _label, expected, buff) => {
    const played = play(board(id, mine, theirs, entered))
    expect(choice(played)).toMatchObject({ kind: 'mayLastingBuff', ...buff })
    expect(targetsOf(choice(played))).toEqual(expected)
  })

  it('takes the smaller form without a Force unit or the initiative', () => {
    const noForce = [unit('a', 'GRD')]
    const mystic = choice(play(board('SHD_051', noForce, theirs)))
    expect(mystic).toMatchObject({ kind: 'mayLastingBuff', power: -2 })
    expect('hp' in mystic ? mystic.hp : undefined).toBeUndefined()
    expect(choice(play(board('LOF_078', noForce, theirs)))).toMatchObject({ power: -2, hp: -2 })
    const guard = choice(play(board('TWI_074', noForce, theirs, { initiative: 'opponent' })))
    expect(guard).toMatchObject({ keywords: [{ name: 'Sentinel' }] })
    expect('power' in guard ? guard.power : undefined).toBeUndefined()
  })

  it('applies the buff for the phase, and a debuff to 0 HP defeats the unit', () => {
    const buffed = accept(play(board('LOF_126', mine, theirs)), { targetInstanceId: 'a' })
    expect(effectivePower(buffed, U(buffed, 'a')!)).toBe(5)
    expect(effectiveHp(buffed, U(buffed, 'a')!)).toBe(9)
    expect(unitHasKeyword(buffed, U(buffed, 'a')!, 'Overwhelm')).toBe(true)
    const killed = accept(play(board('LAW_131', mine, [unit('x', 'FRAIL')])), { targetInstanceId: 'x' })
    expect(U(killed, 'x')).toBeUndefined()
  })

  it('Make an Opening (SOR_076) also heals 2 from your base, and Knowledge and Defense (SEC_075) draws a card', () => {
    const s = board('SOR_076', mine, theirs)
    s.players.player.base.damage = 5
    expect(play(s).players.player.base.damage).toBe(3)
    const drew = play(board('SEC_075', mine, theirs))
    expect(drew.players.player.hand).toEqual(['TST_U1'])
  })
})

describe('draw and base events', () => {
  it('Strategic Analysis (TWI_175) draws 3', () => {
    expect(play(board('TWI_175', [], [])).players.player.hand).toHaveLength(3)
  })

  it('Reconnaissance (SEC_125) draws 2 only with both a ground and a space unit', () => {
    expect(play(board('SEC_125', [unit('g', 'GRD'), unit('s', 'SPACE')], [])).players.player.hand).toHaveLength(2)
    expect(play(board('SEC_125', [unit('g', 'GRD')], [])).players.player.hand).toHaveLength(0)
  })

  it('Petition the Senate (TWI_100) draws 3 only with 3 or more Official units', () => {
    const officials = (n: number) => Array.from({ length: n }, (_, i) => unit(`o${i}`, 'OFFICIAL'))
    expect(play(board('TWI_100', officials(3), [])).players.player.hand).toHaveLength(3)
    expect(play(board('TWI_100', officials(2), [])).players.player.hand).toHaveLength(0)
  })

  it("The Chaos of War (SHD_159) damages each base by its player's hand size, after this event has left the hand", () => {
    const s = state({
      cards: F,
      players: { player: rich({ hand: ['SHD_159', 'GRD', 'GRD'] }), opponent: player({ hand: ['GRD', 'GRD', 'GRD'] }) },
    })
    const done = play(s)
    expect(done.players.player.base.damage).toBe(2)
    expect(done.players.opponent.base.damage).toBe(3)
  })
})

describe('board-wide events', () => {
  it('Blood Sport (TWI_173) deals 2 to each ground unit, on both sides', () => {
    const done = play(board('TWI_173', [unit('g', 'GRD'), unit('s', 'SPACE')], [unit('e', 'TOUGH')]))
    expect(U(done, 'g')!.damage).toBe(2)
    expect(U(done, 'e')!.damage).toBe(2)
    expect(U(done, 's')!.damage).toBe(0)
  })

  it('Death Field (LOF_141) deals 2 to each non-Vehicle enemy, drawing only with a Force unit', () => {
    const done = play(board('LOF_141', [unit('f', 'FORCE')], [unit('e', 'TOUGH'), unit('v', 'VEH')]))
    expect(U(done, 'e')!.damage).toBe(2)
    expect(U(done, 'v')!.damage).toBe(0)
    expect(U(done, 'f')!.damage).toBe(0)
    expect(done.players.player.hand).toHaveLength(1)
    expect(play(board('LOF_141', [unit('g', 'GRD')], [unit('e', 'TOUGH')])).players.player.hand).toHaveLength(0)
  })

  it('Encouraging Leadership (TWI_126) gives each friendly unit +1/+1, and no enemy', () => {
    const done = play(board('TWI_126', [unit('a', 'GRD'), unit('b', 'GRD')], [unit('e', 'GRD')]))
    for (const id of ['a', 'b']) expect(effectivePower(done, U(done, id)!)).toBe(3)
    expect(effectiveHp(done, U(done, 'a')!)).toBe(7)
    expect(effectivePower(done, U(done, 'e')!)).toBe(2)
  })

  it('Disruptive Burst (TWI_075) gives each enemy -1/-1, defeating a 1 HP one', () => {
    const done = play(board('TWI_075', [unit('a', 'GRD')], [unit('e', 'GRD'), unit('x', 'FRAIL')]))
    expect(effectivePower(done, U(done, 'e')!)).toBe(1)
    expect(U(done, 'x')).toBeUndefined()
    expect(effectivePower(done, U(done, 'a')!)).toBe(2)
  })

  it('Rampage (LOF_127) gives each friendly Creature +2/+2', () => {
    const done = play(board('LOF_127', [unit('c', 'CREATURE'), unit('g', 'GRD')], [unit('e', 'CREATURE')]))
    expect(effectivePower(done, U(done, 'c')!)).toBe(4)
    expect(effectivePower(done, U(done, 'g')!)).toBe(2)
    expect(effectivePower(done, U(done, 'e')!)).toBe(2)
  })

  it('Rallying Cry (SOR_154) gives each friendly unit Raid 2', () => {
    const done = play(board('SOR_154', [unit('a', 'GRD')], [unit('e', 'GRD')]))
    expect(unitKeywordValue(done, U(done, 'a')!, 'Raid')).toBe(2)
    expect(unitKeywordValue(done, U(done, 'e')!, 'Raid')).toBe(0)
  })

  it('Focus Determines Reality (LOF_152) gives each friendly Force unit Raid 1 and Saboteur', () => {
    const done = play(board('LOF_152', [unit('f', 'FORCE'), unit('g', 'GRD')], []))
    expect(unitKeywordValue(done, U(done, 'f')!, 'Raid')).toBe(1)
    expect(unitHasKeyword(done, U(done, 'f')!, 'Saboteur')).toBe(true)
    expect(unitHasKeyword(done, U(done, 'g')!, 'Saboteur')).toBe(false)
  })

  it('Sword and Shield Maneuver (TWI_250) gives Troopers Raid 1 and Jedi Sentinel', () => {
    const done = play(board('TWI_250', [unit('t', 'TROOPER'), unit('j', 'JEDI')], []))
    expect(unitKeywordValue(done, U(done, 't')!, 'Raid')).toBe(1)
    expect(unitHasKeyword(done, U(done, 't')!, 'Sentinel')).toBe(false)
    expect(unitHasKeyword(done, U(done, 'j')!, 'Sentinel')).toBe(true)
    expect(unitKeywordValue(done, U(done, 'j')!, 'Raid')).toBe(0)
  })
})

describe('attack events', () => {
  it('Surprise Strike (SOR_220) attacks with +3/+0 for that attack only', () => {
    const played = play(board('SOR_220', [unit('a', 'GRD')], []))
    expect(choice(played)).toMatchObject({ kind: 'mayAttackAnyUnit' })
    expect(skippable(played)).toBe(false)
    const done = resolve(played, { type: 'attack', attackerId: 'a', choiceId: choice(played).id, target: { kind: 'base' } })
    expect(done.players.opponent.base.damage).toBe(5)
    expect(effectivePower(done, U(done, 'a')!)).toBe(2)
  })

  it('Breaking In (TWI_224) attacks with +2/+0 and Saboteur, so past a Sentinel', () => {
    const played = play(board('TWI_224', [unit('a', 'GRD')], [unit('s', 'SENTINEL')]))
    const baseAttack = legalMoves(played).find(m => m.type === 'attack' && m.target.kind === 'base')
    expect(baseAttack).toBeDefined()
    expect(resolve(played, baseAttack!).players.opponent.base.damage).toBe(4)
  })

  it('Precision Fire (SOR_168) grants Saboteur, and +2/+0 only to a Trooper', () => {
    const trooper = play(board('SOR_168', [unit('t', 'TROOPER')], [unit('s', 'SENTINEL')]))
    const hit = legalMoves(trooper).find(m => m.type === 'attack' && m.target.kind === 'base')
    expect(hit).toBeDefined()
    expect(resolve(trooper, hit!).players.opponent.base.damage).toBe(4)
    const other = play(board('SOR_168', [unit('g', 'GRD')], []))
    const plain = resolve(other, { type: 'attack', attackerId: 'g', choiceId: choice(other).id, target: { kind: 'base' } })
    expect(plain.players.opponent.base.damage).toBe(2)
  })

  it('Shoot First (SOR_217) attacks with +1/+0 and deals its damage first', () => {
    const played = play(board('SOR_217', [unit('a', 'GRD')], [unit('x', 'STRIKER')])) // 3 HP, 5 power
    const done = resolve(played, { type: 'attack', attackerId: 'a', choiceId: choice(played).id, target: { kind: 'unit', instanceId: 'x' } })
    expect(U(done, 'x')).toBeUndefined()
    expect(U(done, 'a')!.damage).toBe(0)
  })
})

describe('cross-set reprints of this batch collapse onto the implemented printing', () => {
  it.each([
    ['TWI_174', 'SOR_172'], // Open Fire
    ['TWI_170', 'SHD_178'], // Daring Raid
    ['TWI_077', 'SOR_078'], // Vanquish
    ['SHD_262', 'SOR_251'], // Confiscate
    ['JTL_075', 'SOR_074'], // Repair
    ['TWI_226', 'SOR_222'], // Waylay
    ['TWI_124', 'SOR_124'], // Tactical Advantage
    ['SHD_231', 'SOR_220'], // Surprise Strike
  ])('%s plays as %s', (printing, canonical) => {
    expect(reprintCanonicalId(printing)).toBe(canonical)
  })
})
