import { registerCard } from './abilities'
import { giveToken, exhaustUnit, drawCards, returnOtherUpgradesToHand, returnUpgradeFromDiscardToHand, defeatUpgrade, createTokenUnit, findUnit, searchCount, dealDamageToBase, firstCardUpgrade } from './effects'
import { dealDamageToUnit } from './combat'
import { effectiveHp, effectivePower } from './stats'
import { TOKEN_SHIELD, TOKEN_ADVANTAGE } from './tokenUpgrades'
import { TOKEN_MANDALORIAN } from './tokenUnits'
import { opponentOf, pushChoice, addLastingEffect } from './types'
import { unitHasTrait } from './keywords'
import type { EngineCard, GameState, PlayerId, UnitState } from './types'

/**
 * Real card definitions (#341+). Side-effect module: importing it registers every
 * card's behaviour into the ability registry. Built card-type-agnostic — the same
 * hooks and primitives serve units, leaders, events and upgrades.
 *
 * ASH upgrades whose effects need infrastructure not yet built (deck search, token
 * units, damage-dealing/replacement, the pending-choice mechanism) register only
 * their attach restriction here; their abilities land with Tier 2/3.
 */

const cardOf = (state: GameState, unit: UnitState): EngineCard | undefined => state.cards[unit.cardId]
// Trait checks go through `unitHasTrait` so granted traits count (The Darksaber → Mandalorian, #343).
const nonVehicle = (state: GameState, target: UnitState): boolean => !unitHasTrait(state, target, 'Vehicle')

// ── Stat / damage modifiers ─────────────────────────────────────────────────
registerCard('ASH_054', { statModifier: (_s, _u, ctx) => (ctx.attackingBase ? { power: -3 } : {}) }) // Pointless to Resist — −3 power attacking a base
registerCard('ASH_150', { // Deadly Vulnerability — takes double damage; attacker loses Overwhelm while it defends
  damageMultiplier: () => 2,
  negatesOverwhelm: () => true,
})

// ── Cost modifiers ──────────────────────────────────────────────────────────
registerCard('ASH_262', { costModifier: (s, _p, target) => (target && unitHasTrait(s, target, 'Imperial') ? -1 : 0) }) // Faith in the Empire
registerCard('ASH_263', { costModifier: (s, _p, target) => (target && unitHasTrait(s, target, 'Mandalorian') ? -1 : 0) }) // The Way of the Mand'alor

// ── Attach restrictions + conditional keywords ─────────────────────────────
registerCard('ASH_066', { // Luke's Jedi Lightsaber — Sentinel if attached to Luke Skywalker
  attachRestriction: nonVehicle,
  conditionalKeywords: (s, u) => (cardOf(s, u)?.name === 'Luke Skywalker' ? [{ name: 'Sentinel' }] : []),
})
registerCard('ASH_114', { // Sabine's Lightsaber — Restore 2 if Sabine Wren or a Force unit
  attachRestriction: nonVehicle,
  conditionalKeywords: (s, u) => (cardOf(s, u)?.name === 'Sabine Wren' || unitHasTrait(s, u, 'Force') ? [{ name: 'Restore', value: 2 }] : []),
})
registerCard('ASH_181', { attachRestriction: (_s, t) => t.damage > 0 }) // Mark My Words — attach to a damaged unit (Overwhelm from keyword data)
registerCard('ASH_198', { conditionalKeywords: () => [{ name: 'Sentinel' }] }) // Nowhere to Hide — attached unit gains Sentinel
registerCard('ASH_084', { searchModifier: () => 2 }) // Arcana Star Map — searches look at twice as many cards
registerCard('ASH_135', { // The Darksaber — attach to a unique non-Vehicle unit
  attachRestriction: (s, t) => Boolean(cardOf(s, t)?.unique) && !unitHasTrait(s, t, 'Vehicle'),
  grantedTraits: () => ['Mandalorian'], // attached unit gains the Mandalorian trait
  makesLeaderUnit: () => true, // attached unit is a leader unit
  providesAspects: (s, u) => cardOf(s, u)?.aspects ?? [], // provides its aspect icons while paying costs
})
registerCard('ASH_230', { // Improvised Identity — attach to a ground unit
  attachRestriction: (_s, t) => t.arena === 'ground',
  actionAbilities: [{
    description: 'Search the top 3 of your deck for a ground unit and discard it; then you may attack with this unit, gaining that unit’s abilities for the attack.',
    oncePerRound: true,
    effect: (s, ctx) => {
      const found = findUnit(s, ctx.sourceInstanceId!)
      if (!found) return s
      const owner = ctx.owner
      const revealed = s.players[owner].deck.slice(0, searchCount(s, found.unit, 3))
      const groundUnit = (cardId: string) => { const c = s.cards[cardId]; return c?.type === 'unit' && c.arena === 'ground' }
      // No ground unit revealed → skip the discard, straight to the optional attack (no grant).
      if (!revealed.some(groundUnit)) {
        return pushChoice(s, { kind: 'mayAttack', id: ctx.sourceInstanceId!, controller: owner, unitId: ctx.sourceInstanceId! })
      }
      return pushChoice(s, { kind: 'search', id: ctx.sourceInstanceId!, controller: owner, unitId: ctx.sourceInstanceId!, revealed })
    },
  }],
})

// ── whenPlayed effects ──────────────────────────────────────────────────────
registerCard('ASH_086', { // Durasteel Plating — no attach restriction
  abilities: [{ trigger: 'whenPlayed', description: 'Give a Shield token to attached unit.', effect: (s, ctx) => giveToken(s, ctx.sourceInstanceId!, TOKEN_SHIELD) }],
})
registerCard('ASH_087', { // Cybernetic Enhancements
  abilities: [{ trigger: 'whenPlayed', description: 'Draw a card.', effect: (s, ctx) => drawCards(s, ctx.owner, 1) }],
})
registerCard('ASH_228', { // Preparation
  abilities: [{ trigger: 'whenPlayed', description: 'Exhaust attached unit.', effect: (s, ctx) => exhaustUnit(s, ctx.sourceInstanceId!) }],
})
registerCard('ASH_182', { // Unfettered Ambition — Advantage per non-Advantage upgrade (including this one)
  abilities: [{
    trigger: 'whenPlayed',
    description: 'Give an Advantage token per non-Advantage upgrade on the unit.',
    effect: (s, ctx) => {
      const found = findUnit(s, ctx.sourceInstanceId!)
      if (!found) return s
      const n = found.unit.upgrades.filter(u => s.cards[u.cardId]?.name !== 'Advantage').length
      let next = s
      for (let i = 0; i < n; i++) next = giveToken(next, ctx.sourceInstanceId!, TOKEN_ADVANTAGE)
      return next
    },
  }],
})
registerCard('ASH_199', { // There Is No Conflict — return other upgrades to owners' hands (MVP: all others)
  abilities: [{ trigger: 'whenPlayed', description: "Return other upgrades on attached unit to their owners' hands.", effect: (s, ctx) => returnOtherUpgradesToHand(s, ctx.sourceInstanceId!, ctx.cardId) }],
})

// ── Granted triggers ────────────────────────────────────────────────────────
registerCard('ASH_180', { // Bokken Saber — Advantage token when attack ends
  attachRestriction: nonVehicle,
  abilities: [{ trigger: 'onAttackEnd', description: 'Give an Advantage token to this unit.', effect: (s, ctx) => giveToken(s, ctx.sourceInstanceId!, TOKEN_ADVANTAGE) }],
})
registerCard('ASH_227', { // Heightened Awareness — Advantage token when the regroup phase starts
  abilities: [{ trigger: 'whenRegroupStarts', description: 'Give an Advantage token to this unit.', effect: (s, ctx) => giveToken(s, ctx.sourceInstanceId!, TOKEN_ADVANTAGE) }],
})

// ── onAttackEnd combat effects (#342) ───────────────────────────────────────
registerCard('ASH_085', { // Grav Charge — deal 4 to attached unit, then defeat this upgrade
  abilities: [{
    trigger: 'onAttackEnd',
    description: "Deal 4 damage to attached unit and defeat this upgrade.",
    effect: (s, ctx) => defeatUpgrade(dealDamageToUnit(s, ctx.sourceInstanceId!, 4), ctx.sourceInstanceId!, ctx.cardId),
  }],
})
registerCard('ASH_183', { // Whistling Birds — on a base hit, 2 damage to each enemy unit in this arena
  attachRestriction: nonVehicle,
  abilities: [{
    trigger: 'onAttackEnd',
    description: "If this unit damaged the opponent's base, deal 2 to each enemy unit in its arena.",
    effect: (s, ctx) => {
      if (!ctx.combatDamageToBase) return s
      const found = findUnit(s, ctx.sourceInstanceId!)
      if (!found) return s
      const enemy = opponentOf(ctx.owner)
      const targets = s.players[enemy].units.filter(u => u.arena === found.unit.arena).map(u => u.instanceId)
      return targets.reduce((acc, id) => dealDamageToUnit(acc, id, 2), s)
    },
  }],
})

// ── whenDefeated token creation (#342) ──────────────────────────────────────
registerCard('ASH_134', { // Warrior's Legacy — attached unit gains "When Defeated: Create a Mandalorian token."
  abilities: [{ trigger: 'whenDefeated', description: 'Create a Mandalorian token.', effect: (s, ctx) => createTokenUnit(s, ctx.owner, TOKEN_MANDALORIAN) }],
})

// ── whenDefeated self-return (#342) ─────────────────────────────────────────
registerCard('ASH_055', { // Blade of Talzin — return from discard to hand if it was on a friendly Night unit
  attachRestriction: nonVehicle,
  abilities: [{
    trigger: 'whenDefeated',
    description: 'If this was on a friendly Night unit, return it from your discard to your hand.',
    effect: (s, ctx) => {
      const host = ctx.defeatedUnit
      if (!host || !unitHasTrait(s, host, 'Night')) return s
      // "Your" discard = the upgrade's owner; only return if it was friendly (host controlled by that owner).
      const owner = host.upgrades.find(u => u.cardId === ctx.cardId)?.owner ?? ctx.owner
      if (owner !== ctx.owner) return s
      return returnUpgradeFromDiscardToHand(s, owner, ctx.cardId)
    },
  }],
})

// ── whenReadies optional cost (#342 group B) ────────────────────────────────
registerCard('ASH_088', { // The Conflict Within — "When this unit readies: you may pay 3, else exhaust it."
  abilities: [{
    trigger: 'whenReadies',
    description: 'You may pay 3, otherwise exhaust this unit.',
    effect: (s, ctx) => pushChoice(s, {
      kind: 'payOrExhaust', id: ctx.sourceInstanceId!, controller: ctx.owner, unitId: ctx.sourceInstanceId!, cost: 3, resumeAtInitiative: true,
    }),
  }],
})

// ── onAttackEnd optional free play (#342 group B) ───────────────────────────
registerCard('ASH_229', { // Camtono — "When Attack Ends: look at top card; if it costs ≤2 you may play it free."
  abilities: [{
    trigger: 'onAttackEnd',
    description: 'Look at the top card of your deck; if it costs 2 or less you may play it for free.',
    effect: (s, ctx) => {
      // Always "look at" the top card (shown to the controller); playing it is gated to
      // cost ≤ 2 in legalMoves, so a costlier card is revealed but can't be played (#309 fix).
      const topId = s.players[ctx.owner].deck[0]
      if (!topId) return s
      return pushChoice(s, { kind: 'mayPlayTopFree', id: ctx.sourceInstanceId!, controller: ctx.owner, unitId: ctx.sourceInstanceId!, cardId: topId })
    },
  }],
})

// ── onDefense mid-combat optional (#342 phase 2) ────────────────────────────
registerCard('ASH_210', { // DDC Defender — "On Defense: you may deal 1 to a unit in this arena and exhaust it."
  attachRestriction: nonVehicle,
  abilities: [{
    trigger: 'onDefense',
    description: 'You may deal 1 damage to a unit in this arena and exhaust it.',
    effect: (s, ctx) => {
      const found = findUnit(s, ctx.sourceInstanceId!)
      if (!found) return s
      return pushChoice(s, { kind: 'mayDamageExhaust', id: ctx.sourceInstanceId!, controller: ctx.owner, unitId: ctx.sourceInstanceId!, arena: found.unit.arena })
    },
  }],
})

// ── Leaders (#309) ──────────────────────────────────────────────────────────
const allUnits = (s: GameState): UnitState[] => [...s.players.player.units, ...s.players.opponent.units]
const remainingHp = (s: GameState, u: UnitState): number => effectiveHp(s, u) - u.damage

registerCard('ASH_011', { // Cad Bane — front (undeployed) + deployed (Overwhelm from data + On Attack)
  leaderAbilities: {
    actions: [{
      description: 'Deal 1 damage to a unit with 2 or more remaining HP.',
      targets: s => allUnits(s).filter(u => remainingHp(s, u) >= 2).map(u => u.instanceId),
      effect: (s, ctx) => dealDamageToUnit(s, ctx.targetInstanceId!, 1),
    }],
  },
  abilities: [{
    trigger: 'onAttack',
    description: 'You may deal 1 damage to a unit with 2 or more remaining HP.',
    effect: (s, ctx) => {
      const targets = allUnits(s).filter(u => remainingHp(s, u) >= 2).map(u => u.instanceId)
      return targets.length === 0 ? s : pushChoice(s, { kind: 'mayDamage', id: ctx.sourceInstanceId!, controller: ctx.owner, unitId: ctx.sourceInstanceId!, targets, amount: 1 })
    },
  }],
})

registerCard('ASH_015', { // Emperor Palpatine — front (undeployed) + deployed (On Attack)
  leaderAbilities: {
    actions: [{
      description: 'Choose an exhausted friendly unit; give it an Advantage token for each other friendly unit.',
      targets: (s, owner) => s.players[owner].units.filter(u => u.exhausted).map(u => u.instanceId),
      effect: (s, ctx) => {
        const others = s.players[ctx.owner].units.filter(u => u.instanceId !== ctx.targetInstanceId).length
        let next = s
        for (let i = 0; i < others; i++) next = giveToken(next, ctx.targetInstanceId!, TOKEN_ADVANTAGE)
        return next
      },
    }],
  },
  abilities: [{
    trigger: 'onAttack',
    description: 'You may choose another exhausted friendly unit; give it an Advantage token for each other friendly unit.',
    effect: (s, ctx) => {
      const targets = s.players[ctx.owner].units.filter(u => u.exhausted && u.instanceId !== ctx.sourceInstanceId).map(u => u.instanceId)
      return targets.length === 0 ? s : pushChoice(s, { kind: 'mayAdvantageEach', id: ctx.sourceInstanceId!, controller: ctx.owner, unitId: ctx.sourceInstanceId!, targets })
    },
  }],
})

registerCard('ASH_012', { // Vane — front (undeployed) + deployed (On Attack)
  // NOTE: "Deal 2 to a base" / "...to the defending unit or a base" are simplified to the
  // enemy base for now (the sensible default); the full target choice can be added later.
  leaderAbilities: {
    actions: [{
      description: 'Defeat a friendly upgrade; deal 2 damage to the enemy base.',
      targets: (s, owner) => s.players[owner].units.filter(u => firstCardUpgrade(s, u)).map(u => u.instanceId),
      effect: (s, ctx) => {
        const host = s.players[ctx.owner].units.find(u => u.instanceId === ctx.targetInstanceId)!
        const next = defeatUpgrade(s, host.instanceId, firstCardUpgrade(s, host)!)
        return dealDamageToBase(next, opponentOf(ctx.owner), 2)
      },
    }],
  },
  abilities: [{
    trigger: 'onAttack',
    description: 'You may defeat a friendly upgrade to deal 2 to the enemy base.',
    effect: (s, ctx) => {
      const targets = s.players[ctx.owner].units.filter(u => firstCardUpgrade(s, u)).map(u => u.instanceId)
      return targets.length === 0 ? s : pushChoice(s, { kind: 'mayDefeatUpgradeForBase', id: ctx.sourceInstanceId!, controller: ctx.owner, unitId: ctx.sourceInstanceId!, targets })
    },
  }],
})

registerCard('ASH_017', { // Greef Karga — front (undeployed, optional) + deployed (mandatory)
  leaderAbilities: {
    abilities: [{
      trigger: 'whenPlayOrCreateUnit',
      description: 'You may exhaust this leader to give the played unit an Advantage token.',
      effect: (s, ctx) =>
        s.players[ctx.owner].leader.exhausted
          ? s
          : pushChoice(s, { kind: 'mayExhaustLeaderForAdvantage', id: ctx.targetInstanceId!, controller: ctx.owner, unitId: ctx.targetInstanceId! }),
    }],
  },
  abilities: [{
    trigger: 'whenPlayOrCreateUnit',
    description: 'Give the played unit an Advantage token.',
    effect: (s, ctx) => giveToken(s, ctx.targetInstanceId!, TOKEN_ADVANTAGE),
  }],
})

registerCard('ASH_010', { // Bo-Katan Kryze — deploy gate + deployed aura (front create-token is #309/#348)
  deployCondition: (s, owner) =>
    s.players[owner].resources.length + s.players[owner].units.filter(u => unitHasTrait(s, u, 'Mandalorian')).length >= 10,
  // Deployed: other friendly Mandalorian units get +1/+0 (#346).
  aura: (s, src, tgt, friendly) => (friendly && tgt.instanceId !== src.instanceId && unitHasTrait(s, tgt, 'Mandalorian') ? { power: 1 } : undefined),
})

registerCard('ASH_007', { // Grand Admiral Sloane — deployed aura (front choose-one is #347/#348)
  // Deployed: each other friendly unit gains Overwhelm and Sentinel (#346).
  aura: (_s, src, tgt, friendly) => (friendly && tgt.instanceId !== src.instanceId ? { keywords: [{ name: 'Overwhelm' }, { name: 'Sentinel' }] } : undefined),
})

// A friendly unit that is the only one you control in its arena (Baylan's condition).
const aloneInArena = (s: GameState, owner: PlayerId, u: UnitState): boolean =>
  s.players[owner].units.filter(x => x.arena === u.arena).length === 1

registerCard('ASH_003', { // Baylan Skoll — front +2/+2 this phase to a lone unit; deployed On Attack +2/+2 & Sentinel (#347)
  leaderAbilities: {
    actions: [{
      description: 'Give a friendly unit +2/+2 for this phase if it is the only unit you control in its arena.',
      cost: 1,
      targets: (s, owner) => s.players[owner].units.filter(u => aloneInArena(s, owner, u)).map(u => u.instanceId),
      effect: (s, ctx) => addLastingEffect(s, { targetInstanceId: ctx.targetInstanceId!, power: 2, hp: 2 }),
    }],
  },
  abilities: [{
    trigger: 'onAttack',
    description: 'You may give a friendly unit +2/+2 and Sentinel for this phase.',
    effect: (s, ctx) => {
      const targets = s.players[ctx.owner].units.map(u => u.instanceId)
      return targets.length === 0 ? s : pushChoice(s, { kind: 'mayLastingBuff', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, power: 2, hp: 2, keywords: [{ name: 'Sentinel' }] })
    },
  }],
})

registerCard('ASH_009', { // Ahsoka Tano — front +2/+0 this phase to a unit weaker than a friendly one (#347)
  leaderAbilities: {
    actions: [{
      description: 'Choose a unit with less power than a friendly unit; it gets +2/+0 for this phase.',
      targets: (s, owner) => {
        const friendlyPowers = s.players[owner].units.map(u => effectivePower(s, u))
        return allUnits(s).filter(u => friendlyPowers.some(p => p > effectivePower(s, u))).map(u => u.instanceId)
      },
      effect: (s, ctx) => addLastingEffect(s, { targetInstanceId: ctx.targetInstanceId!, power: 2 }),
    }],
  },
})

// Units other than the just-ended attacker — Ezra's "a different unit" (#347).
const unitsOtherThanAttacker = (s: GameState, attackerId?: string): string[] =>
  allUnits(s).filter(u => u.instanceId !== attackerId).map(u => u.instanceId)

registerCard('ASH_013', { // Ezra Bridger — on a friendly 3+ base hit, Advantage to a different unit (#347)
  // Front (undeployed): exhaust the leader as an additional cost.
  leaderAbilities: {
    abilities: [{
      trigger: 'whenFriendlyAttackEnds',
      description: 'If that attack dealt 3+ combat damage to a base, you may exhaust this leader to give an Advantage token to a different unit.',
      effect: (s, ctx) => {
        if ((ctx.combatDamageToBase ?? 0) < 3 || s.players[ctx.owner].leader.exhausted) return s
        const targets = unitsOtherThanAttacker(s, ctx.attackerInstanceId)
        return targets.length === 0 ? s : pushChoice(s, { kind: 'mayExhaustLeaderGiveAdvantage', id: `${ctx.cardId}-attackEnd`, controller: ctx.owner, targets })
      },
    }],
  },
  // Deployed (back): no leader-exhaust cost — just the optional token.
  abilities: [{
    trigger: 'whenFriendlyAttackEnds',
    description: 'If that attack dealt 3+ combat damage to a base, you may give an Advantage token to a different unit.',
    effect: (s, ctx) => {
      if ((ctx.combatDamageToBase ?? 0) < 3) return s
      const targets = unitsOtherThanAttacker(s, ctx.attackerInstanceId)
      return targets.length === 0 ? s : pushChoice(s, { kind: 'mayGiveAdvantage', id: `${ctx.cardId}-attackEnd`, controller: ctx.owner, targets })
    },
  }],
})

registerCard('ASH_016', { // Shin Hati — front: on a friendly base hit, may exhaust leader → exhaust a cheaper unit (#347)
  // Deployed (back) adds "once per round" — deferred until triggered abilities support that.
  leaderAbilities: {
    abilities: [{
      trigger: 'whenFriendlyAttackEnds',
      description: 'You may exhaust this leader to exhaust a unit that costs less than the combat damage dealt to a base this attack.',
      effect: (s, ctx) => {
        const dmg = ctx.combatDamageToBase ?? 0
        if (dmg <= 0 || s.players[ctx.owner].leader.exhausted) return s
        const targets = allUnits(s).filter(u => !u.exhausted && (s.cards[u.cardId]?.cost ?? 0) < dmg).map(u => u.instanceId)
        return targets.length === 0 ? s : pushChoice(s, { kind: 'mayExhaustLeaderExhaustUnit', id: `${ctx.cardId}-attackEnd`, controller: ctx.owner, targets })
      },
    }],
  },
})
