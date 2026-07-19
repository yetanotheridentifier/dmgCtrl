
describe('Group E — onAttack, self-cost choices (batch B2) (#356)', () => {
  it('Leia Organa (059): may deal 1 to herself to heal 2 from your base', () => {
    const s0 = state({ cards: E, players: { player: player({ units: [unit('a', 'ASH_059', { arena: 'ground' })], base: { cardId: 'TST_B', damage: 3 } }), opponent: player({}) } })
    const atk = resolve(s0, { type: 'attack', attackerId: 'a', target: { kind: 'base' } })
    expect(atk.pendingChoices?.[0]).toMatchObject({ kind: 'maySelfDamageHealBase', selfDamage: 1, healBase: 2 })
    const done = resolve(atk, { type: 'acceptChoice', choiceId: atk.pendingChoices![0].id })
    expect(U(done, 'a').damage).toBe(1)
    expect(done.players.player.base.damage).toBe(1) // 3 - 2 healed
  })

  it('Razor Crest (172): may discard a card for +2/+0 this attack', () => {
    const s0 = state({ cards: E, players: { player: player({ units: [unit('a', 'ASH_172', { arena: 'space' })], hand: ['FILLER'] }), opponent: player({}) } })
    const atk = resolve(s0, { type: 'attack', attackerId: 'a', target: { kind: 'base' } })
    expect(atk.pendingChoices?.[0]).toMatchObject({ kind: 'selectDiscard' })
    const done = resolve(atk, { type: 'acceptChoice', choiceId: atk.pendingChoices![0].id, handIndex: 0 })
    expect(done.players.player.hand).not.toContain('FILLER')
    expect(done.players.opponent.base.damage).toBe(5) // power 3 + 2 buff
  })

  it("Mando's N-1 Starfighter (203): may exhaust the leader for +2/+0 this attack", () => {
    const s0 = state({ cards: E, players: { player: player({ units: [unit('a', 'ASH_203', { arena: 'space' })] }), opponent: player({}) } })
    const atk = resolve(s0, { type: 'attack', attackerId: 'a', target: { kind: 'base' } })
    expect(atk.pendingChoices?.[0]).toMatchObject({ kind: 'mayExhaustLeaderBuffSelf', power: 2 })
    const done = resolve(atk, { type: 'acceptChoice', choiceId: atk.pendingChoices![0].id })
    expect(done.players.player.leader.exhausted).toBe(true)
    expect(done.players.opponent.base.damage).toBe(3) // power 1 + 2 buff
  })
})
