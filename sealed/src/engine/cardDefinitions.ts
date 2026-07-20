import type { EffectContext } from './abilities'
import { registerCard } from './abilities'
import { giveToken, exhaustUnit, drawCards, returnOtherUpgradesToHand, returnUpgradeFromDiscardToHand, defeatUpgrade, defeatUpgradeAt, createTokenUnit, createTokenUnits, findUnit, searchCount, grantNextUnit, healUnit, healBase, dealDamageToBase, bottomTopCards, exhaustReadyResource, readyResource, readyUnit } from './effects'
import { dealDamageToUnit, defeatUnit } from './combat'
import { effectiveHp, effectivePower } from './stats'
import { TOKEN_SHIELD, TOKEN_ADVANTAGE } from './tokenUpgrades'
import { TOKEN_MANDALORIAN, isTokenCard } from './tokenUnits'
import { opponentOf, pushChoice, addLastingEffect, defeatedThisPhase, enteredPlayThisPhase, baseAttackedThisPhase, baseDamagedThisPhase, upgradeDefeatedThisPhase, cardsPlayedThisPhase, markAbilityUsed } from './types'
import { affordableHandUnits, resourceUpgradeCandidates, enemyAttackTargets } from './legalMoves'
import { canAfford } from './resources'
import { unitHasTrait, unitTraits, isLeaderUnit, nonAuraKeywordNames, unitHasKeyword, unitKeywords } from './keywords'
import type { EngineCard, GameState, PlayerId, UnitState, UpgradeRef } from './types'

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

registerCard('ASH_014', { // The Mandalorian — front take-initiative draw; deployed on-attack draw (#348)
  // Front (undeployed): when you take the initiative, may pay 1 to draw.
  leaderAbilities: {
    abilities: [{
      trigger: 'whenTakeInitiative',
      description: 'You may pay 1 to draw a card.',
      effect: (s, ctx) =>
        s.players[ctx.owner].resources.some(r => !r.exhausted)
          ? pushChoice(s, { kind: 'mayPayToDraw', id: `${ctx.cardId}-init`, controller: ctx.owner, cost: 1, draw: 1 })
          : s,
    }],
  },
  // Deployed (back): On Attack, if you have the initiative, may draw a card (free). Support keyword
  // comes from the card DB; Support-on-deploy (attack with another unit) is deferred — shared with Ahsoka.
  abilities: [{
    trigger: 'onAttack',
    description: 'If you have the initiative, you may draw a card.',
    effect: (s, ctx) => (s.initiative === ctx.owner ? pushChoice(s, { kind: 'mayPayToDraw', id: ctx.sourceInstanceId!, controller: ctx.owner, cost: 0, draw: 1 }) : s),
  }],
})

// Every upgrade the player controls — card upgrades AND tokens — as defeatable candidates (#348).
const friendlyUpgradeCandidates = (s: GameState, owner: PlayerId): UpgradeRef[] =>
  s.players[owner].units.flatMap(u => u.upgrades.map((up, i) => ({ unitId: u.instanceId, upgradeIndex: i, cardId: up.cardId })))

const BOTH_BASES: PlayerId[] = ['player', 'opponent']

registerCard('ASH_012', { // Vane — front (undeployed) + deployed (On Attack) (#348)
  // The player chooses which upgrade to defeat (any upgrade, token or card), then where the 2 damage
  // lands: front = "a base" (either); deployed = "the defending unit or a base".
  leaderAbilities: {
    actions: [{
      description: 'Defeat a friendly upgrade; deal 2 damage to a base.',
      usable: (s, owner) => friendlyUpgradeCandidates(s, owner).length > 0,
      effect: (s, ctx) =>
        pushChoice(s, {
          kind: 'selectUpgradeToDefeat',
          id: `${ctx.cardId}-defeatUpgrade`,
          controller: ctx.owner,
          candidates: friendlyUpgradeCandidates(s, ctx.owner),
          optional: false,
          then: { amount: 2, unitTargets: [], baseTargets: BOTH_BASES },
        }),
    }],
  },
  abilities: [{
    trigger: 'onAttack',
    description: 'You may defeat a friendly upgrade to deal 2 to the defending unit or a base.',
    effect: (s, ctx) => {
      const candidates = friendlyUpgradeCandidates(s, ctx.owner)
      if (candidates.length === 0) return s
      // "The defending unit or a base" — the defender is the attack's target when it's a unit.
      const unitTargets = ctx.attackTarget?.kind === 'unit' ? [ctx.attackTarget.instanceId] : []
      return pushChoice(s, {
        kind: 'selectUpgradeToDefeat',
        id: ctx.sourceInstanceId!,
        controller: ctx.owner,
        candidates,
        optional: true,
        then: { amount: 2, unitTargets, baseTargets: BOTH_BASES },
      })
    },
  }],
})

registerCard('ASH_001', { // The Armorer — play an upgrade from your resources, then resource the top of your deck (#348)
  // Front (undeployed): pay the upgrade's cost, target a unit that entered play this phase.
  leaderAbilities: {
    actions: [{
      description: 'Play an upgrade from your resources on a unit that entered play this phase (paying its cost); resource the top of your deck.',
      usable: (s, owner) => resourceUpgradeCandidates(s, owner, true, enteredPlayThisPhase(s, owner)).length > 0,
      effect: (s, ctx) => pushChoice(s, {
        kind: 'selectResourceUpgrade',
        id: `${ctx.cardId}-resUpgrade`,
        controller: ctx.owner,
        candidates: resourceUpgradeCandidates(s, ctx.owner, true, enteredPlayThisPhase(s, ctx.owner)),
        optional: false,
        then: { payCost: true, targetUnits: enteredPlayThisPhase(s, ctx.owner) },
      }),
    }],
  },
  // Deployed (back): When Attack Ends, may play an upgrade from resources on any friendly unit,
  // paying its cost (the default — a free play would be spelled out on the card).
  abilities: [{
    trigger: 'onAttackEnd',
    description: 'You may play an upgrade from your resources (paying its cost) on a friendly unit; resource the top of your deck.',
    effect: (s, ctx) => {
      const friendly = s.players[ctx.owner].units.map(u => u.instanceId)
      const candidates = resourceUpgradeCandidates(s, ctx.owner, true, friendly)
      return candidates.length === 0
        ? s
        : pushChoice(s, { kind: 'selectResourceUpgrade', id: ctx.sourceInstanceId!, controller: ctx.owner, candidates, optional: true, then: { payCost: true, targetUnits: friendly } })
    },
  }],
})

const imperialDefeatedThisPhase = (s: GameState, owner: PlayerId): boolean =>
  defeatedThisPhase(s, owner).some(id => (s.cards[id]?.traits ?? []).some(t => t.toLowerCase() === 'imperial'))

// Deployed Moff Gideon collects keywords from the fallen: for each of these eight, if an
// Imperial unit in your discard pile has it, this unit gains it too (#348).
const MOFF_KEYWORDS = ['Ambush', 'Grit', 'Hidden', 'Overwhelm', 'Saboteur', 'Sentinel', 'Shielded', 'Support']
const cardHasKeyword = (c: EngineCard | undefined, name: string): boolean => (c?.keywords ?? []).some(k => k.name === name)
const isImperialUnitCard = (c: EngineCard | undefined): boolean =>
  c?.type === 'unit' && (c.traits ?? []).some(t => t.toLowerCase() === 'imperial')

registerCard('ASH_008', { // Moff Gideon — front: play a unit costing 1 less if a friendly Imperial died this phase (#348)
  leaderAbilities: {
    actions: [{
      description: 'If a friendly Imperial unit was defeated this phase, play a unit from your hand costing 1 less.',
      usable: (s, owner) => imperialDefeatedThisPhase(s, owner) && affordableHandUnits(s, owner, 0, -1).length > 0,
      effect: (s, ctx) => pushChoice(s, {
        kind: 'playUnitFromHand',
        id: `${ctx.cardId}-play`,
        controller: ctx.owner,
        candidates: affordableHandUnits(s, ctx.owner, 0, -1),
        costDelta: -1,
        entersReady: false,
      }),
    }],
  },
  // Deployed (back): gain each listed keyword an Imperial unit in your discard pile has.
  conditionalKeywords: (s, u) => {
    const owner = findUnit(s, u.instanceId)?.owner
    if (!owner) return []
    const discardImperials = s.players[owner].discard.map(id => s.cards[id]).filter(isImperialUnitCard)
    return MOFF_KEYWORDS.filter(kw => discardImperials.some(c => cardHasKeyword(c, kw))).map(name => ({ name }))
  },
})

registerCard('ASH_002', { // Fennec Shand — front leader action; deployed unit action (Saboteur from card data) (#348)
  // Front (undeployed): [C=1, Exhaust, exhaust a friendly unit] → play a unit from hand ready.
  leaderAbilities: {
    actions: [{
      description: 'Exhaust a friendly unit and pay 1: play a unit from your hand; it enters ready.',
      cost: 1,
      // Needs a ready friendly unit to exhaust and a hand unit affordable after paying the C=1.
      usable: (s, owner) => s.players[owner].units.some(u => !u.exhausted) && affordableHandUnits(s, owner, 1, 0).length > 0,
      effect: (s, ctx) => pushChoice(s, {
        kind: 'selectUnitToExhaust',
        id: `${ctx.cardId}-exhaust`,
        controller: ctx.owner,
        targets: s.players[ctx.owner].units.filter(u => !u.exhausted).map(u => u.instanceId),
        then: { costDelta: 0, entersReady: true },
      }),
    }],
  },
  // Deployed (back): [C=1, exhaust a friendly unit] → play a unit from hand ready. No self-exhaust,
  // so it works even after Fennec attacks; she counts as an exhaustable friendly unit herself.
  actionAbilities: [{
    description: 'Pay 1 and exhaust a friendly unit: play a unit from your hand; it enters ready.',
    cost: 1,
    usable: (s, u) => {
      const owner = findUnit(s, u.instanceId)?.owner
      if (!owner) return false
      return s.players[owner].units.some(x => !x.exhausted) && affordableHandUnits(s, owner, 1, 0).length > 0
    },
    effect: (s, ctx) => pushChoice(s, {
      kind: 'selectUnitToExhaust',
      id: `${ctx.cardId}-exhaust`,
      controller: ctx.owner,
      targets: s.players[ctx.owner].units.filter(u => !u.exhausted).map(u => u.instanceId),
      then: { costDelta: 0, entersReady: true },
    }),
  }],
})

registerCard('ASH_006', { // Sabine Wren — front: opponent gives 2 Advantage, grant Shielded; back: On Attack grant Shielded (#348)
  leaderAbilities: {
    actions: [{
      description: 'An opponent gives 2 Advantage tokens to a unit they control. If they do, the next unit you play this phase gains Shielded.',
      // "If they do" resolves only when the opponent has a unit to receive the tokens — gate on it.
      usable: (s, owner) => s.players[opponentOf(owner)].units.length > 0,
      effect: (s, ctx) => {
        const opp = opponentOf(ctx.owner)
        const targets = s.players[opp].units.map(u => u.instanceId)
        if (targets.length === 0) return s
        // Grant Shielded to our next unit now (the opponent's giving is mandatory when able), then
        // hand the "which unit gets the tokens" choice to the opponent (useLeaderAbility hands off).
        const granted = grantNextUnit(s, ctx.owner, { keywords: [{ name: 'Shielded' }] })
        return pushChoice(granted, { kind: 'opponentGivesAdvantage', id: `${ctx.cardId}-adv`, controller: opp, count: 2, targets })
      },
    }],
  },
  // Deployed (back): On Attack, the next unit you play this phase gains Shielded.
  abilities: [{
    trigger: 'onAttack',
    description: 'The next unit you play this phase gains Shielded.',
    effect: (s, ctx) => grantNextUnit(s, ctx.owner, { keywords: [{ name: 'Shielded' }] }),
  }],
})

registerCard('ASH_005', { // Luke Skywalker — front/back heal on a friendly attack ending (#348)
  // Front (undeployed): may exhaust the leader to heal 1 from the attacker.
  leaderAbilities: {
    abilities: [{
      trigger: 'whenFriendlyAttackEnds',
      description: 'You may exhaust this leader to heal 1 damage from the attacking unit.',
      effect: (s, ctx) => {
        const attacker = s.players[ctx.owner].units.find(u => u.instanceId === ctx.attackerInstanceId)
        if (s.players[ctx.owner].leader.exhausted || !attacker || attacker.damage === 0) return s
        return pushChoice(s, { kind: 'mayExhaustLeaderHealUnit', id: `${ctx.cardId}-heal`, controller: ctx.owner, unitId: ctx.attackerInstanceId!, amount: 1 })
      },
    }],
  },
  // Deployed (back): heal 2 from the attacking unit or your base (mandatory — pick a damaged target).
  abilities: [{
    trigger: 'whenFriendlyAttackEnds',
    description: 'Heal 2 damage from the attacking unit or from your base.',
    effect: (s, ctx) => {
      const attacker = s.players[ctx.owner].units.find(u => u.instanceId === ctx.attackerInstanceId)
      const unitTargets = attacker && attacker.damage > 0 ? [attacker.instanceId] : []
      const baseTargets = s.players[ctx.owner].base.damage > 0 ? [ctx.owner] : []
      return unitTargets.length === 0 && baseTargets.length === 0
        ? s
        : pushChoice(s, { kind: 'selectHealTarget', id: ctx.sourceInstanceId!, controller: ctx.owner, amount: 2, unitTargets, baseTargets })
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

const controlsUnitInEachArena = (s: GameState, owner: PlayerId): boolean =>
  s.players[owner].units.some(u => u.arena === 'ground') && s.players[owner].units.some(u => u.arena === 'space')

registerCard('ASH_010', { // Bo-Katan Kryze — front/back create a Mandalorian token (#348) + deploy gate (#309) + aura (#346)
  deployCondition: (s, owner) =>
    s.players[owner].resources.length + s.players[owner].units.filter(u => unitHasTrait(s, u, 'Mandalorian')).length >= 10,
  leaderAbilities: {
    actions: [{
      description: 'If you control a unit in each arena, create a Mandalorian token.',
      cost: 2,
      usable: (s, owner) => controlsUnitInEachArena(s, owner),
      effect: (s, ctx) => createTokenUnit(s, ctx.owner, TOKEN_MANDALORIAN),
    }],
  },
  // Deployed: On Attack, create a token under the same condition (mandatory).
  abilities: [{
    trigger: 'onAttack',
    description: 'If you control a unit in each arena, create a Mandalorian token.',
    effect: (s, ctx) => (controlsUnitInEachArena(s, ctx.owner) ? createTokenUnit(s, ctx.owner, TOKEN_MANDALORIAN) : s),
  }],
  // Deployed: other friendly Mandalorian units get +1/+0 (#346).
  aura: (s, src, tgt, friendly) => (friendly && tgt.instanceId !== src.instanceId && unitHasTrait(s, tgt, 'Mandalorian') ? { power: 1 } : undefined),
})

const canAnyUnitAttack = (s: GameState, owner: PlayerId): boolean =>
  s.players[owner].units.some(u => {
    if (u.exhausted) return false
    const { targets, sentinelLocked } = enemyAttackTargets(s, u)
    return targets.length > 0 || !sentinelLocked
  })

registerCard('ASH_004', { // Grand Admiral Thrawn — front attack + conditional Restore; deployed On Attack conditional defeat (#348)
  leaderAbilities: {
    actions: [{
      description: 'Attack with a unit; it gains Restore 2 for this attack if you control as many units as the defending player.',
      usable: (s, owner) => canAnyUnitAttack(s, owner),
      effect: (s, ctx) => {
        const restore = s.players[ctx.owner].units.length === s.players[opponentOf(ctx.owner)].units.length ? 2 : 0
        return pushChoice(s, { kind: 'mayAttackAnyUnit', id: `${ctx.cardId}-attack`, controller: ctx.owner, restore })
      },
    }],
  },
  // Deployed: On Attack, if you control more units than the defending player, may defeat a non-leader enemy unit.
  abilities: [{
    trigger: 'onAttack',
    description: 'If you control more units than the defending player, you may defeat a non-leader unit they control.',
    effect: (s, ctx) => {
      const enemy = opponentOf(ctx.owner)
      if (s.players[ctx.owner].units.length <= s.players[enemy].units.length) return s
      const targets = s.players[enemy].units.filter(u => !isLeaderUnit(s, u)).map(u => u.instanceId)
      return targets.length === 0 ? s : pushChoice(s, { kind: 'mayDefeatEnemyUnit', id: ctx.sourceInstanceId!, controller: ctx.owner, targets })
    },
  }],
})

registerCard('ASH_018', { // Grogu — triggered deploy on a Unique 4+ unit; combat-conditional aura (#346/#348)
  deployCondition: () => false, // never deploys via the normal epic action — only via the trigger below
  leaderAbilities: {
    abilities: [{
      trigger: 'whenPlayOrCreateUnit',
      description: 'When you play a Unique unit costing 4 or more, if Grogu is ready you may deploy him.',
      effect: (s, ctx) => {
        const played = allUnits(s).find(u => u.instanceId === ctx.targetInstanceId)
        const card = played ? s.cards[played.cardId] : undefined
        const leader = s.players[ctx.owner].leader
        // "If this leader is ready" — deployable while undeployed and not exhausted. Grogu's deploy
        // isn't the once-per-game epic action, so a defeated-then-readied Grogu can deploy again.
        if (!card || !card.unique || card.cost < 4 || leader.deployed || leader.exhausted) return s
        return pushChoice(s, { kind: 'mayDeployLeader', id: `${ctx.cardId}-deploy`, controller: ctx.owner })
      },
    }],
  },
  // Deployed: the current combat's defender gets +1/0 if it's another friendly unit (defending), or
  // -1/0 if it's the enemy defender while another friendly unit (not Grogu) attacks.
  aura: (_s, src, tgt, sameController, combat) => {
    if (!combat || tgt.instanceId !== combat.defenderInstanceId) return undefined
    if (sameController) return tgt.instanceId !== src.instanceId ? { power: 1 } : undefined
    return combat.attackerInstanceId !== src.instanceId ? { power: -1 } : undefined
  },
})

const SLOANE_KEYWORDS = [{ name: 'Sentinel' }, { name: 'Overwhelm' }]
registerCard('ASH_007', { // Grand Admiral Sloane — front Choose One arena buff (#348) + deployed aura (#346)
  leaderAbilities: {
    actions: [{
      // "Give each ground/space unit Sentinel and Overwhelm for this phase" — every unit in the
      // chosen arena, both players' (the card says "each ... unit", not "friendly").
      description: 'Choose one: give each ground unit, or each space unit, Sentinel and Overwhelm for this phase.',
      effect: (s, ctx) => pushChoice(s, {
        kind: 'chooseOne',
        id: `${ctx.cardId}-arena`,
        controller: ctx.owner,
        options: [
          { label: 'Ground units: Sentinel + Overwhelm', kind: 'arenaLastingBuff', arena: 'ground', keywords: SLOANE_KEYWORDS },
          { label: 'Space units: Sentinel + Overwhelm', kind: 'arenaLastingBuff', arena: 'space', keywords: SLOANE_KEYWORDS },
        ],
      }),
    }],
  },
  // Deployed: each other friendly unit gains Overwhelm and Sentinel (#346).
  aura: (_s, src, tgt, friendly) => (friendly && tgt.instanceId !== src.instanceId ? { keywords: [{ name: 'Overwhelm' }, { name: 'Sentinel' }] } : undefined),
})

// A friendly NON-leader unit that is the only non-leader unit you control in its arena
// (Baylan's condition). The front says "the only unit", the deployed back "the only non-leader
// unit" — but the front is used while undeployed (no leader unit is on the board), so the
// non-leader test is equivalent there and correct for both. `isLeaderUnit` also excludes a unit
// made a leader by The Darksaber (#343).
const soleNonLeaderInArena = (s: GameState, owner: PlayerId, u: UnitState): boolean =>
  !isLeaderUnit(s, u) && s.players[owner].units.filter(x => x.arena === u.arena && !isLeaderUnit(s, x)).length === 1

const baylanTargets = (s: GameState, owner: PlayerId): string[] =>
  s.players[owner].units.filter(u => soleNonLeaderInArena(s, owner, u)).map(u => u.instanceId)

registerCard('ASH_003', { // Baylan Skoll — front +2/+2 this phase to a lone unit; deployed On Attack +2/+2 & Sentinel (#347)
  leaderAbilities: {
    actions: [{
      description: 'Give a friendly unit +2/+2 for this phase if it is the only unit you control in its arena.',
      cost: 1,
      targets: (s, owner) => baylanTargets(s, owner),
      effect: (s, ctx) => addLastingEffect(s, { targetInstanceId: ctx.targetInstanceId!, power: 2, hp: 2 }),
    }],
  },
  abilities: [{
    trigger: 'onAttack',
    description: 'You may give a friendly non-leader unit +2/+2 and Sentinel for this phase if it is the only non-leader unit you control in its arena.',
    effect: (s, ctx) => {
      const targets = baylanTargets(s, ctx.owner)
      return targets.length === 0 ? s : pushChoice(s, { kind: 'mayLastingBuff', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, power: 2, hp: 2, keywords: [{ name: 'Sentinel' }] })
    },
  }],
})

registerCard('ASH_009', { // Ahsoka Tano — front +2/+0 to a unit weaker than a friendly one; deployed On Attack +2/+0 (#347/#348)
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
  // Deployed (back): On Attack, may give a unit with less power than THIS unit +2/+0 for the phase.
  abilities: [{
    trigger: 'onAttack',
    description: 'You may give a unit with less power than this unit +2/+0 for this phase.',
    effect: (s, ctx) => {
      const self = allUnits(s).find(u => u.instanceId === ctx.sourceInstanceId)
      if (!self) return s
      const selfPower = effectivePower(s, self)
      const targets = allUnits(s).filter(u => effectivePower(s, u) < selfPower).map(u => u.instanceId)
      return targets.length === 0 ? s : pushChoice(s, { kind: 'mayLastingBuff', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, power: 2, hp: 0 })
    },
  }],
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

// Ready units cheaper than the base damage dealt this attack — Shin Hati's targets (#347).
const cheaperReadyUnits = (s: GameState, dmg: number): string[] =>
  allUnits(s).filter(u => !u.exhausted && (s.cards[u.cardId]?.cost ?? 0) < dmg).map(u => u.instanceId)

const SHIN_ROUND_KEY = 'ASH_016#friendlyAttackEnd' // deployed Shin's "once each round" marker

registerCard('ASH_016', { // Shin Hati — on a friendly base hit, exhaust a cheaper unit (#347)
  // Front (undeployed): exhaust the leader as the additional cost; no round limit.
  leaderAbilities: {
    abilities: [{
      trigger: 'whenFriendlyAttackEnds',
      description: 'You may exhaust this leader to exhaust a unit that costs less than the combat damage dealt to a base this attack.',
      effect: (s, ctx) => {
        const dmg = ctx.combatDamageToBase ?? 0
        if (dmg <= 0 || s.players[ctx.owner].leader.exhausted) return s
        const targets = cheaperReadyUnits(s, dmg)
        return targets.length === 0 ? s : pushChoice(s, { kind: 'mayExhaustLeaderExhaustUnit', id: `${ctx.cardId}-attackEnd`, controller: ctx.owner, targets })
      },
    }],
  },
  // Deployed (back): no leader-exhaust cost, but usable only once each round.
  abilities: [{
    trigger: 'whenFriendlyAttackEnds',
    description: 'You may exhaust a unit that costs less than the combat damage dealt to a base this attack. Once each round.',
    effect: (s, ctx) => {
      const dmg = ctx.combatDamageToBase ?? 0
      const self = allUnits(s).find(u => u.instanceId === ctx.sourceInstanceId)
      if (dmg <= 0 || !self || (self.usedAbilities ?? []).includes(SHIN_ROUND_KEY)) return s
      const targets = cheaperReadyUnits(s, dmg)
      return targets.length === 0 ? s : pushChoice(s, { kind: 'mayExhaustUnit', id: `${ctx.cardId}-attackEnd`, controller: ctx.owner, targets, markUsed: { instanceId: ctx.sourceInstanceId!, key: SHIN_ROUND_KEY } })
    },
  }],
})

// ── Units (#306) ─────────────────────────────────────────────────────────────
// Group B1 (#353): conditional self keyword grants — "While <condition>, this unit gains <keyword>".
// The conditional keyword is stripped from the card's base keywords (cardDataCorrections) and
// re-granted here only when the condition holds. Shared condition helpers keep the predicates reusable.
const unitOwner = (s: GameState, u: UnitState): PlayerId | undefined => findUnit(s, u.instanceId)?.owner
const controlsAnother = (s: GameState, u: UnitState, pred: (s: GameState, x: UnitState) => boolean): boolean => {
  const o = unitOwner(s, u)
  return o !== undefined && s.players[o].units.some(x => x.instanceId !== u.instanceId && pred(s, x))
}
const enemyControlsUpgradedUnit = (s: GameState, u: UnitState): boolean => {
  const o = unitOwner(s, u)
  return o !== undefined && s.players[opponentOf(o)].units.some(x => x.upgrades.length > 0)
}
const leaderUnitDefeatedThisPhase = (s: GameState): boolean =>
  (['player', 'opponent'] as PlayerId[]).some(p => defeatedThisPhase(s, p).some(id => s.cards[id]?.type === 'leader'))

registerCard('ASH_243', { conditionalKeywords: (_s, u) => (u.exhausted ? [] : [{ name: 'Sentinel' }]) }) // Darth Vader — Sentinel while ready
registerCard('ASH_122', { conditionalKeywords: (s, u) => (unitOwner(s, u) === s.initiative ? [{ name: 'Restore', value: 2 }] : []) }) // Consortium StarViper — Restore 2 while you have the initiative
registerCard('ASH_057', { conditionalKeywords: (s, u) => (enemyControlsUpgradedUnit(s, u) ? [{ name: 'Restore', value: 2 }] : []) }) // Lothal E-Wing — Restore 2 while an enemy unit is upgraded
registerCard('ASH_105', { conditionalKeywords: (s, u) => (controlsAnother(s, u, (st, x) => unitHasTrait(st, x, 'Mandalorian')) ? [{ name: 'Raid', value: 2 }] : []) }) // Bo-Katan Kryze — Raid 2 while you control another Mandalorian
registerCard('ASH_078', { conditionalKeywords: (s, u) => { const o = unitOwner(s, u); return o !== undefined && s.players[o].units.some(x => x.arena === 'ground') ? [{ name: 'Sentinel' }] : [] } }) // B-Wing Rearguard — Sentinel while you control a ground unit
registerCard('ASH_098', { conditionalKeywords: (s, u) => (controlsAnother(s, u, (st, x) => !st.cards[x.cardId]?.unique) ? [{ name: 'Ambush' }] : []) }) // AT-ST Raider — Ambush while you control another non-unique unit
registerCard('ASH_120', { conditionalKeywords: (s, u) => (controlsAnother(s, u, (_st, x) => x.exhausted) ? [{ name: 'Sentinel' }] : []) }) // Warrior of Clan Kryze — Sentinel while you control another exhausted unit
registerCard('ASH_049', { conditionalKeywords: (s, u) => { const o = unitOwner(s, u); return o !== undefined && soleNonLeaderInArena(s, o, u) ? [{ name: 'Sentinel' }] : [] } }) // Shin Hati — Sentinel while she is the only friendly non-leader ground unit
registerCard('ASH_093', { conditionalKeywords: s => (leaderUnitDefeatedThisPhase(s) ? [{ name: 'Raid', value: 3 }] : []) }) // Captain Pellaeon — Raid 3 while a leader unit was defeated this phase

// Group B2 (#353): conditional stat buffs — "While <condition>, this unit gets +X/+Y" via statModifier.
const controlsLeaderUnit = (s: GameState, u: UnitState): boolean => {
  const o = unitOwner(s, u)
  return o !== undefined && s.players[o].units.some(x => isLeaderUnit(s, x))
}
registerCard('ASH_240', { statModifier: (s, u) => (controlsLeaderUnit(s, u) ? { power: 2 } : {}) }) // Mandalorian Super Commandos — +2/+0 while you control a leader unit
registerCard('ASH_125', { statModifier: (s, u) => (unitOwner(s, u) === s.initiative ? { power: 2 } : {}) }) // Stolen Eta Shuttle — +2/+0 while you have the initiative
registerCard('ASH_113', { // Mandalorian Flagship — Ambush while you control a leader; +1/+0 per other friendly Mandalorian
  conditionalKeywords: (s, u) => (controlsLeaderUnit(s, u) ? [{ name: 'Ambush' }] : []),
  statModifier: (s, u) => {
    const o = unitOwner(s, u)
    if (o === undefined) return {}
    const others = s.players[o].units.filter(x => x.instanceId !== u.instanceId && unitHasTrait(s, x, 'Mandalorian')).length
    return others > 0 ? { power: others } : {}
  },
})

// Group B3 (#353): conditional keyword swap. Marrok's Sentinel is his base keyword; while upgraded he
// loses it (suppressedKeywords) and gains Saboteur (conditionalKeywords).
const isUpgraded = (u: UnitState): boolean => u.upgrades.length > 0
registerCard('ASH_030', { // Marrok
  conditionalKeywords: (_s, u) => (isUpgraded(u) ? [{ name: 'Saboteur' }] : []),
  suppressedKeywords: (_s, u) => (isUpgraded(u) ? ['Sentinel'] : []),
})

// Group C (#354): constant effects on OTHER units — the `aura` hook, now with keyword removal.
registerCard('ASH_177', { // Onyx Cinder — other friendly units gain Hidden
  aura: (_s, src, tgt, friendly) => (friendly && tgt.instanceId !== src.instanceId ? { keywords: [{ name: 'Hidden' }] } : undefined),
})
registerCard('ASH_100', { // Gallius Rax — other friendly units with 2+ different keywords get +2/+2
  aura: (s, src, tgt, friendly) =>
    friendly && tgt.instanceId !== src.instanceId && nonAuraKeywordNames(s, tgt).size >= 2 ? { power: 2, hp: 2 } : undefined,
})
registerCard('ASH_068', { // Domesticated Loth-Cat — enemy units lose Ambush and Support
  aura: (_s, _src, _tgt, friendly) => (friendly ? undefined : { removeKeywords: ['Ambush', 'Support'] }),
})
registerCard('ASH_040', { // Poe Dameron — all units lose Sentinel
  aura: () => ({ removeKeywords: ['Sentinel'] }),
})

// ── Units (#306) — Group D: "When Played" effects (#355) ─────────────────────
/** Give `n` copies of a token to a unit. */
const giveTokens = (s: GameState, id: string, token: string, n: number): GameState => {
  let next = s
  for (let i = 0; i < n; i++) next = giveToken(next, id, token)
  return next
}
const whenPlayed = (description: string, effect: (s: GameState, ctx: { owner: PlayerId; cardId: string; sourceInstanceId?: string }) => GameState) => ({
  abilities: [{ trigger: 'whenPlayed' as const, description, effect }],
})

/** whenDefeated ability (#356). `ctx.defeatedUnit` is the unit captured at the moment of defeat
 *  (it has already left play) — use it for its power/upgrades or as a stable choice id. */
const whenDefeated = (description: string, effect: (s: GameState, ctx: { owner: PlayerId; sourceInstanceId?: string; defeatedUnit?: UnitState; defeatedByCombat?: boolean }) => GameState) => ({
  abilities: [{ trigger: 'whenDefeated' as const, description, effect }],
})

// D1 — self / no-target effects.
registerCard('ASH_218', whenPlayed('Give 4 Advantage tokens to this unit.', (s, ctx) => giveTokens(s, ctx.sourceInstanceId!, TOKEN_ADVANTAGE, 4))) // Ferry Droid
registerCard('ASH_251', whenPlayed('Give an Advantage token to this unit.', (s, ctx) => giveToken(s, ctx.sourceInstanceId!, TOKEN_ADVANTAGE))) // Zealous Soldier
registerCard('ASH_178', whenPlayed('Give an Advantage token to this unit for each enemy unit.', (s, ctx) => giveTokens(s, ctx.sourceInstanceId!, TOKEN_ADVANTAGE, s.players[opponentOf(ctx.owner)].units.length))) // Knobby White Ice Spider
registerCard('ASH_221', whenPlayed('If an opponent controls a space unit, give a Shield to this; otherwise 2 Advantage.', (s, ctx) => // Helix Starfighter
  s.players[opponentOf(ctx.owner)].units.some(u => u.arena === 'space')
    ? giveToken(s, ctx.sourceInstanceId!, TOKEN_SHIELD)
    : giveTokens(s, ctx.sourceInstanceId!, TOKEN_ADVANTAGE, 2)))
registerCard('ASH_111', whenPlayed('Create 2 Mandalorian tokens.', (s, ctx) => createTokenUnits(s, ctx.owner, TOKEN_MANDALORIAN, 2))) // Children of the Watch
registerCard('ASH_124', whenPlayed('If you control a unique unit, create a Mandalorian token.', (s, ctx) => // Protectorate Fighter
  s.players[ctx.owner].units.some(u => s.cards[u.cardId]?.unique) ? createTokenUnit(s, ctx.owner, TOKEN_MANDALORIAN) : s))
registerCard('ASH_065', whenPlayed('Heal all damage from each friendly unit.', (s, ctx) => // Home One
  s.players[ctx.owner].units.reduce((acc, u) => healUnit(acc, u.instanceId, u.damage), s)))
registerCard('ASH_064', whenPlayed('Give a Shield token to each friendly unit with Shielded.', (s, ctx) => // The Armorer
  s.players[ctx.owner].units.filter(u => unitHasKeyword(s, u, 'Shielded')).reduce((acc, u) => giveToken(acc, u.instanceId, TOKEN_SHIELD), s)))

// D2 — single-target "When Played" effects (reuse mayDamage / mayGiveTokens / mayExhaustUnit /
// selectHealTarget). Each guards on having a target: no eligible target → the effect just does nothing.
const groundUnits = (s: GameState) => allUnits(s).filter(u => u.arena === 'ground')
const spaceUnits = (s: GameState) => allUnits(s).filter(u => u.arena === 'space')

registerCard('ASH_259', whenPlayed('You may deal 1 damage to a ground unit.', (s, ctx) => { // LEP Ratcatcher
  const targets = groundUnits(s).map(u => u.instanceId)
  return targets.length ? pushChoice(s, { kind: 'mayDamage', id: ctx.sourceInstanceId!, controller: ctx.owner, unitId: ctx.sourceInstanceId!, targets, amount: 1 }) : s
}))
registerCard('ASH_170', whenPlayed('You may deal 2 damage to an upgraded ground unit.', (s, ctx) => { // Desert Sharpshooter
  const targets = groundUnits(s).filter(u => u.upgrades.length > 0).map(u => u.instanceId)
  return targets.length ? pushChoice(s, { kind: 'mayDamage', id: ctx.sourceInstanceId!, controller: ctx.owner, unitId: ctx.sourceInstanceId!, targets, amount: 2 }) : s
}))
registerCard('ASH_174', whenPlayed('You may deal 6 damage to a non-unique ground unit.', (s, ctx) => { // StarFortress Heavy Bomber
  const targets = groundUnits(s).filter(u => !s.cards[u.cardId]?.unique).map(u => u.instanceId)
  return targets.length ? pushChoice(s, { kind: 'mayDamage', id: ctx.sourceInstanceId!, controller: ctx.owner, unitId: ctx.sourceInstanceId!, targets, amount: 6 }) : s
}))
registerCard('ASH_081', whenPlayed('You may heal 3 damage from a unit or base.', (s, ctx) => { // Nebulon-C Frigate
  const unitTargets = allUnits(s).filter(u => u.damage > 0).map(u => u.instanceId)
  const baseTargets = (['player', 'opponent'] as PlayerId[]).filter(p => s.players[p].base.damage > 0)
  return unitTargets.length || baseTargets.length
    ? pushChoice(s, { kind: 'selectHealTarget', id: ctx.sourceInstanceId!, controller: ctx.owner, amount: 3, unitTargets, baseTargets, optional: true })
    : s
}))
registerCard('ASH_051', whenPlayed('You may exhaust a unit.', (s, ctx) => { // Reinforcing Light Cruiser
  const targets = allUnits(s).map(u => u.instanceId)
  return targets.length ? pushChoice(s, { kind: 'mayExhaustUnit', id: ctx.sourceInstanceId!, controller: ctx.owner, targets }) : s
}))
registerCard('ASH_214', whenPlayed('You may exhaust a unit with one or more keywords.', (s, ctx) => { // Amnesty Officer
  const targets = allUnits(s).filter(u => unitKeywords(s, u).length > 0).map(u => u.instanceId)
  return targets.length ? pushChoice(s, { kind: 'mayExhaustUnit', id: ctx.sourceInstanceId!, controller: ctx.owner, targets }) : s
}))
registerCard('ASH_238', whenPlayed('You may give 2 Advantage tokens to a space unit.', (s, ctx) => { // Attendant Navigator
  const targets = spaceUnits(s).map(u => u.instanceId)
  return targets.length ? pushChoice(s, { kind: 'mayGiveTokens', id: ctx.sourceInstanceId!, controller: ctx.owner, token: TOKEN_ADVANTAGE, count: 2, targets }) : s
}))
registerCard('ASH_255', whenPlayed('Give a Shield token to another friendly unit.', (s, ctx) => { // Anakin Skywalker
  const targets = s.players[ctx.owner].units.filter(u => u.instanceId !== ctx.sourceInstanceId).map(u => u.instanceId)
  return targets.length ? pushChoice(s, { kind: 'mayGiveTokens', id: ctx.sourceInstanceId!, controller: ctx.owner, token: TOKEN_SHIELD, count: 1, targets, optional: false }) : s
}))
registerCard('ASH_082', whenPlayed('You may give a Shield token to a unit that costs 3 or less.', (s, ctx) => { // Trexler Armored Marauder
  const targets = allUnits(s).filter(u => (s.cards[u.cardId]?.cost ?? 0) <= 3).map(u => u.instanceId)
  return targets.length ? pushChoice(s, { kind: 'mayGiveTokens', id: ctx.sourceInstanceId!, controller: ctx.owner, token: TOKEN_SHIELD, count: 1, targets }) : s
}))
registerCard('ASH_194', whenPlayed('Deal 1 damage to a space unit.', (s, ctx) => { // Snub Fighter Squadron
  const targets = spaceUnits(s).map(u => u.instanceId)
  return targets.length ? pushChoice(s, { kind: 'mayDamage', id: `${ctx.sourceInstanceId!}-wp`, controller: ctx.owner, unitId: ctx.sourceInstanceId!, targets, amount: 1, optional: false, source: { cardId: ctx.cardId, controller: ctx.owner } }) : s
}))

// D3 — multi-step "When Played" effects (self-damage sequences, area damage, damage-then-reward).
registerCard('ASH_071', whenPlayed('Deal 1 damage to this unit and 1 damage to an enemy space unit.', (s, ctx) => { // Battered Haulcraft
  const next = dealDamageToUnit(s, ctx.sourceInstanceId!, 1)
  const targets = next.players[opponentOf(ctx.owner)].units.filter(u => u.arena === 'space').map(u => u.instanceId)
  return targets.length ? pushChoice(next, { kind: 'mayDamage', id: `${ctx.sourceInstanceId!}-wp`, controller: ctx.owner, unitId: ctx.sourceInstanceId!, targets, amount: 1, optional: false }) : next
}))
registerCard('ASH_158', whenPlayed('Deal 3 damage to this unit. Give 3 Advantage tokens to a unit.', (s, ctx) => { // Han Solo
  const next = dealDamageToUnit(s, ctx.sourceInstanceId!, 3)
  const targets = allUnits(next).map(u => u.instanceId)
  return targets.length ? pushChoice(next, { kind: 'mayGiveTokens', id: `${ctx.sourceInstanceId!}-wp`, controller: ctx.owner, token: TOKEN_ADVANTAGE, count: 3, targets, optional: false }) : next
}))
registerCard('ASH_112', whenPlayed('If you control at least 4 units, deal 3 damage to each enemy unit.', (s, ctx) => { // Luke Skywalker
  if (s.players[ctx.owner].units.length < 4) return s
  const enemies = s.players[opponentOf(ctx.owner)].units.map(u => u.instanceId)
  return enemies.reduce((acc, id) => dealDamageToUnit(acc, id, 3), s)
}))
registerCard('ASH_176', whenPlayed('You may deal 3 damage to a ground unit; if defeated this way, give 3 Advantage to this unit.', (s, ctx) => { // Imposing Scout Walker
  const targets = allUnits(s).filter(u => u.arena === 'ground').map(u => u.instanceId)
  return targets.length ? pushChoice(s, { kind: 'mayDamage', id: ctx.sourceInstanceId!, controller: ctx.owner, unitId: ctx.sourceInstanceId!, targets, amount: 3, rewardIfDefeated: { instanceId: ctx.sourceInstanceId!, count: 3 } }) : s
}))

// D4 — "next unit you play this phase" grants with filters (generalised next-unit grant, #355).
registerCard('ASH_237', whenPlayed('The next Imperial unit you play this phase costs 1 less.', (s, ctx) => grantNextUnit(s, ctx.owner, { costDelta: -1, trait: 'Imperial' }))) // Mouse Droid
registerCard('ASH_248', { // Neel — the next ≤1-power unit you play this phase enters play ready
  abilities: [
    { trigger: 'whenPlayed', description: 'The next unit you play this phase with 1 or less power enters play ready.', effect: (s, ctx) => grantNextUnit(s, ctx.owner, { entersReady: true, maxPower: 1 }) },
    { trigger: 'onAttack', description: 'The next unit you play this phase with 1 or less power enters play ready.', effect: (s, ctx) => grantNextUnit(s, ctx.owner, { entersReady: true, maxPower: 1 }) },
  ],
})

// Phase 2 — repeatable multi-target picks (#355).
registerCard('ASH_205', whenPlayed('Give an Advantage token to each of up to 3 exhausted units.', (s, ctx) => { // Inspiring Veteran
  const targets = allUnits(s).filter(u => u.exhausted).map(u => u.instanceId)
  return targets.length ? pushChoice(s, { kind: 'multiPick', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, spec: { mode: 'giveAdvantage', remaining: 3 } }) : s
}))
registerCard('ASH_053', whenPlayed('Defeat any number of non-leader units with a total of 6 or less remaining HP; create a Mandalorian token for each.', (s, ctx) => { // Pre Vizsla
  const targets = allUnits(s).filter(u => !isLeaderUnit(s, u) && effectiveHp(s, u) - u.damage <= 6).map(u => u.instanceId)
  return targets.length ? pushChoice(s, { kind: 'multiPick', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, spec: { mode: 'defeatForToken', budget: 6, token: TOKEN_MANDALORIAN } }) : s
}))

registerCard('ASH_260', whenPlayed('You may draw a card. If you do, discard a card.', (s, ctx) => // Mos Espa Watermonger
  pushChoice(s, { kind: 'mayPayToDraw', id: ctx.sourceInstanceId!, controller: ctx.owner, cost: 0, draw: 1, thenDiscard: 1 })))

registerCard('ASH_148', whenPlayed('An opponent discards a card from their hand. You may deal damage equal to its cost divided as you choose among any number of units.', (s, ctx) => { // Ninth Sister
  const opp = opponentOf(ctx.owner)
  if (s.players[opp].hand.length === 0) return s // no card to discard → the whole ability does nothing
  return pushChoice(s, { kind: 'selectDiscard', id: ctx.sourceInstanceId!, controller: opp, count: 1, then: { distributeDamageTo: ctx.owner } })
}))

registerCard('ASH_250', whenPlayed("Look at an opponent's hand.", (s, ctx) => // Imperial Defector
  pushChoice(s, { kind: 'lookAtHand', id: ctx.sourceInstanceId!, controller: ctx.owner, target: opponentOf(ctx.owner) })))

registerCard('ASH_220', whenPlayed("Look at an opponent's hand. You may discard a card from it. If you do, they draw a card.", (s, ctx) => // Remnant Lookouts
  pushChoice(s, { kind: 'lookAtHand', id: ctx.sourceInstanceId!, controller: ctx.owner, target: opponentOf(ctx.owner), mayDiscard: true, thenDraw: true })))

/** Number of arenas (ground/space) in which `owner` controls strictly more units than the opponent (#355, Crix Madine). */
function arenasControllingMost(s: GameState, owner: PlayerId): number {
  const opp = opponentOf(owner)
  return (['ground', 'space'] as const).filter(arena =>
    s.players[owner].units.filter(u => u.arena === arena).length > s.players[opp].units.filter(u => u.arena === arena).length,
  ).length
}

registerCard('ASH_110', whenPlayed('You may defeat this unit. If you do, search the top 10 cards of your deck for any number of space units with combined cost 5 or less and play each of them for free.', (s, ctx) => // Admiral Ackbar
  pushChoice(s, { kind: 'mayDefeatSelfSearch', id: ctx.sourceInstanceId!, controller: ctx.owner, unitId: ctx.sourceInstanceId! })))

registerCard('ASH_077', whenPlayed("Name a card. While this unit is in play, opponents can't play cards with that name.", (s, ctx) => // Ryder Azadi
  pushChoice(s, { kind: 'nameCard', id: ctx.sourceInstanceId!, controller: ctx.owner, unitId: ctx.sourceInstanceId! })))

registerCard('ASH_147', whenPlayed('Either deal 2 damage to an undamaged ground unit or 5 damage to a damaged ground unit.', (s, ctx) => { // The Cyborg Mech
  const targets = groundUnits(s).map(u => u.instanceId)
  return targets.length ? pushChoice(s, { kind: 'variableStrike', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, undamagedAmount: 2, damagedAmount: 5 }) : s
}))

registerCard('ASH_044', whenPlayed('Heal up to 2 damage from a unit. Give an Advantage token to it for each damage healed this way.', (s, ctx) => { // Barriss Offee
  const targets = allUnits(s).filter(u => u.damage > 0).map(u => u.instanceId)
  return targets.length ? pushChoice(s, { kind: 'healForAdvantage', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, maxHeal: 2 }) : s
}))

registerCard('ASH_108', whenPlayed('You may play a Heroism unit from your hand. It costs 2 less for each arena in which you control the most units.', (s, ctx) => { // Crix Madine
  const costDelta = -2 * arenasControllingMost(s, ctx.owner)
  const candidates = affordableHandUnits(s, ctx.owner, 0, costDelta).filter(ref => (s.cards[ref.cardId]?.aspects ?? []).some(a => a.toLowerCase() === 'heroism'))
  if (candidates.length === 0) return s
  return pushChoice(s, { kind: 'playUnitFromHand', id: ctx.sourceInstanceId!, controller: ctx.owner, candidates, costDelta, entersReady: false, optional: true })
}))

registerCard('ASH_107', whenPlayed('Search the top 5 cards of your deck for a card that shares a Trait with a unit you control, reveal it, and draw it.', (s, ctx) => { // Clan Wren Loyalist
  const owner = ctx.owner
  const revealed = s.players[owner].deck.slice(0, 5)
  const myTraits = new Set(s.players[owner].units.flatMap(u => unitTraits(s, u).map(t => t.toLowerCase())))
  const eligibleIndices = revealed.flatMap((cardId, i) => (s.cards[cardId]?.traits.some(t => myTraits.has(t.toLowerCase())) ? [i] : []))
  // No trait match among the top cards → they all go to the bottom and nothing is drawn.
  if (eligibleIndices.length === 0) return bottomTopCards(s, owner, revealed.length)
  return pushChoice(s, { kind: 'searchDraw', id: ctx.sourceInstanceId!, controller: owner, revealed, eligibleIndices })
}))

// ── Group E (#356): whenDefeated ────────────────────────────────────────────
registerCard('ASH_116', whenDefeated('Draw a card.', (s, ctx) => drawCards(s, ctx.owner, 1))) // Ant Droid
registerCard('ASH_080', whenDefeated('Create a Mandalorian token.', (s, ctx) => createTokenUnit(s, ctx.owner, TOKEN_MANDALORIAN))) // Covert Believers
registerCard('ASH_058', whenDefeated('Create a Mandalorian token.', (s, ctx) => createTokenUnit(s, ctx.owner, TOKEN_MANDALORIAN))) // Duchess's Protector
registerCard('ASH_216', whenDefeated('Exhaust a ready friendly resource.', (s, ctx) => exhaustReadyResource(s, ctx.owner))) // Mandalorian Scout

registerCard('ASH_153', whenDefeated('You may deal 2 damage to a unit.', (s, ctx) => { // Green Leader
  const targets = allUnits(s).map(u => u.instanceId)
  return targets.length ? pushChoice(s, { kind: 'mayDamage', id: ctx.defeatedUnit!.instanceId, controller: ctx.owner, unitId: ctx.defeatedUnit!.instanceId, targets, amount: 2, optional: true }) : s
}))

registerCard('ASH_254', whenDefeated('Give 2 Advantage tokens to a friendly unit.', (s, ctx) => { // Gallofree Transport
  const targets = s.players[ctx.owner].units.map(u => u.instanceId)
  return targets.length ? pushChoice(s, { kind: 'mayGiveTokens', id: ctx.defeatedUnit!.instanceId, controller: ctx.owner, token: TOKEN_ADVANTAGE, count: 2, targets, optional: false }) : s
}))

registerCard('ASH_028', whenDefeated("If this unit wasn't defeated by combat damage, create 2 Mandalorian tokens.", (s, ctx) => // Paz Vizsla
  ctx.defeatedByCombat ? s : createTokenUnits(s, ctx.owner, TOKEN_MANDALORIAN, 2)))

registerCard('ASH_191', whenDefeated('You may give 2 Advantage tokens to a unit. If this unit was not defeated by combat damage, give 3 instead.', (s, ctx) => { // Shin Hati's Fiend Fighter
  const targets = allUnits(s).map(u => u.instanceId)
  return targets.length ? pushChoice(s, { kind: 'mayGiveTokens', id: ctx.sourceInstanceId!, controller: ctx.owner, token: TOKEN_ADVANTAGE, count: ctx.defeatedByCombat ? 2 : 3, targets, optional: true }) : s
}))

// Flarestar Attack Shuttle (167): the same "may give an Advantage token" on both When Played and When Defeated.
const flarestarGiveAdvantage = (s: GameState, ctx: { owner: PlayerId; sourceInstanceId?: string }): GameState => {
  const targets = allUnits(s).map(u => u.instanceId)
  return targets.length ? pushChoice(s, { kind: 'mayGiveTokens', id: ctx.sourceInstanceId!, controller: ctx.owner, token: TOKEN_ADVANTAGE, count: 1, targets, optional: true }) : s
}
registerCard('ASH_167', {
  abilities: [
    { trigger: 'whenPlayed', description: 'You may give an Advantage token to a unit.', effect: flarestarGiveAdvantage },
    { trigger: 'whenDefeated', description: 'You may give an Advantage token to a unit.', effect: flarestarGiveAdvantage },
  ],
})

registerCard('ASH_195', whenDefeated("You may distribute Advantage tokens equal to this unit's power among friendly units.", (s, ctx) => { // Helgait
  const power = ctx.defeatedUnit ? effectivePower(s, ctx.defeatedUnit) : 0
  const targets = s.players[ctx.owner].units.map(u => u.instanceId)
  return power > 0 && targets.length ? pushChoice(s, { kind: 'distributeTokens', id: ctx.sourceInstanceId!, controller: ctx.owner, token: TOKEN_ADVANTAGE, remaining: power, total: power, targets }) : s
}))

registerCard('ASH_043', { // Corona Four — On Attack debuff + When Defeated defeat a 0-power unit
  abilities: [
    {
      trigger: 'onAttack',
      description: 'You may give a unit -2/-0 for this phase.',
      effect: (s, ctx) => {
        const targets = allUnits(s).map(u => u.instanceId)
        return targets.length ? pushChoice(s, { kind: 'mayLastingBuff', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, power: -2, hp: 0 }) : s
      },
    },
    {
      trigger: 'whenDefeated',
      description: 'You may defeat a non-leader unit with 0 power.',
      effect: (s, ctx) => {
        const targets = allUnits(s).filter(u => !isLeaderUnit(s, u) && effectivePower(s, u) === 0).map(u => u.instanceId)
        return targets.length ? pushChoice(s, { kind: 'mayDefeatEnemyUnit', id: ctx.sourceInstanceId!, controller: ctx.owner, targets }) : s
      },
    },
  ],
})

// Every upgrade in play (both sides) — the "defeat an upgrade" candidate set (#356, Clan Vizsla Soldier).
const allUpgradeCandidates = (s: GameState): UpgradeRef[] =>
  allUnits(s).flatMap(u => u.upgrades.map((up, i) => ({ unitId: u.instanceId, upgradeIndex: i, cardId: up.cardId })))

registerCard('ASH_165', whenDefeated('You may defeat an upgrade.', (s, ctx) => { // Clan Vizsla Soldier
  const candidates = allUpgradeCandidates(s)
  return candidates.length ? pushChoice(s, { kind: 'selectUpgradeToDefeat', id: ctx.sourceInstanceId!, controller: ctx.owner, candidates, optional: true }) : s
}))

registerCard('ASH_097', whenDefeated("You may return a non-unique Imperial unit from your discard pile to your hand.", (s, ctx) => { // Moff Gideon
  const seen = new Set<string>()
  const candidates = s.players[ctx.owner].discard.filter(id => {
    const c = s.cards[id]
    if (!c || c.type !== 'unit' || c.unique || !c.traits.some(t => t.toLowerCase() === 'imperial')) return false
    if (seen.has(id)) return false // list each distinct title once
    seen.add(id)
    return true
  })
  return candidates.length ? pushChoice(s, { kind: 'selectFromDiscard', id: ctx.sourceInstanceId!, controller: ctx.owner, candidates, optional: true }) : s
}))

registerCard('ASH_027', whenDefeated('You may deal up to 6 damage to your base. The next unit you play this phase costs 1 less for every 2 damage dealt this way.', (s, ctx) => // Enoch
  pushChoice(s, { kind: 'dealOwnBaseForDiscount', id: ctx.sourceInstanceId!, controller: ctx.owner, dealt: 0, max: 6 })))

// Purrgil Ultra (038): the same "return a friendly unit, deal its cost" on both When Played and When Defeated.
const purrgilReturn = (s: GameState, ctx: { owner: PlayerId; sourceInstanceId?: string }): GameState => {
  const targets = s.players[ctx.owner].units.filter(u => !isLeaderUnit(s, u) && u.instanceId !== ctx.sourceInstanceId).map(u => u.instanceId)
  return targets.length ? pushChoice(s, { kind: 'returnFriendlyUnit', id: ctx.sourceInstanceId!, controller: ctx.owner, targets }) : s
}
registerCard('ASH_038', {
  abilities: [
    { trigger: 'whenPlayed', description: "You may return another friendly non-leader unit to its owner's hand. If you do, deal damage to a unit equal to the returned unit's cost.", effect: purrgilReturn },
    { trigger: 'whenDefeated', description: "You may return another friendly non-leader unit to its owner's hand. If you do, deal damage to a unit equal to the returned unit's cost.", effect: purrgilReturn },
  ],
})

registerCard('ASH_045', whenDefeated('Look at the top card of a deck. You may discard it.', (s, ctx) => { // Reanimated Night Trooper
  const decks = (['player', 'opponent'] as PlayerId[]).filter(d => s.players[d].deck.length > 0)
  return decks.length ? pushChoice(s, { kind: 'peekTopDiscard', id: ctx.sourceInstanceId!, controller: ctx.owner, decks }) : s
}))

// ── Group E (#356): onAttack — batch A ──────────────────────────────────────
registerCard('ASH_157', { abilities: [{ trigger: 'onAttack', description: 'You may give an Advantage token to another unit.', effect: (s, ctx) => { // Danger Squadron Wingmen
  const targets = allUnits(s).filter(u => u.instanceId !== ctx.sourceInstanceId).map(u => u.instanceId)
  return targets.length ? pushChoice(s, { kind: 'mayGiveTokens', id: ctx.sourceInstanceId!, controller: ctx.owner, token: TOKEN_ADVANTAGE, count: 1, targets, optional: true }) : s
} }] })

registerCard('ASH_189', { abilities: [{ trigger: 'onAttack', description: 'Ready a resource.', effect: (s, ctx) => readyResource(s, ctx.owner) }] }) // Emperor's Messenger

registerCard('ASH_056', { abilities: [{ trigger: 'onAttack', description: 'You may give an upgraded unit -4/-0 for this phase.', effect: (s, ctx) => { // Huyang
  const targets = allUnits(s).filter(u => u.upgrades.length > 0).map(u => u.instanceId)
  return targets.length ? pushChoice(s, { kind: 'mayLastingBuff', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, power: -4, hp: 0 }) : s
} }] })

registerCard('ASH_168', { abilities: [{ trigger: 'onAttack', description: 'Deal 1 damage to the defending unit; 2 instead if this unit is upgraded.', effect: (s, ctx) => { // Migs Mayfeld
  if (ctx.attackTarget?.kind !== 'unit') return s
  const attacker = allUnits(s).find(u => u.instanceId === ctx.sourceInstanceId)
  return dealDamageToUnit(s, ctx.attackTarget.instanceId, attacker && attacker.upgrades.length > 0 ? 2 : 1)
} }] })

registerCard('ASH_083', { abilities: [{ trigger: 'onAttack', description: 'Defeat all other space units.', effect: (s, ctx) => { // Summa-verminoth
  let next = s
  for (const id of allUnits(s).filter(u => u.arena === 'space' && u.instanceId !== ctx.sourceInstanceId).map(u => u.instanceId)) next = defeatUnit(next, id)
  return next
} }] })

registerCard('ASH_156', { abilities: [{ trigger: 'onAttack', description: 'Defeat all upgrades on the defending unit.', effect: (s, ctx) => { // R5-D4
  const target = ctx.attackTarget
  if (target?.kind !== 'unit') return s
  const u = allUnits(s).find(x => x.instanceId === target.instanceId)
  if (!u) return s
  let next = s
  for (let i = u.upgrades.length - 1; i >= 0; i--) next = defeatUpgradeAt(next, u.instanceId, i) // last→first keeps indices valid
  return next
} }] })

// ── Group E (#356): onAttack — batch B1 (conditional / self) ────────────────
registerCard('ASH_072', { abilities: [{ trigger: 'onAttack', description: 'If this unit has 3 or more remaining HP, draw a card.', effect: (s, ctx) => { // Doctor Pershing
  const u = allUnits(s).find(x => x.instanceId === ctx.sourceInstanceId)
  return u && remainingHp(s, u) >= 3 ? drawCards(s, ctx.owner, 1) : s
} }] })

registerCard('ASH_099', { abilities: [{ trigger: 'onAttack', description: 'This unit gains Sentinel for this phase.', effect: (s, ctx) => // Gozanti Assault Carrier
  addLastingEffect(s, { targetInstanceId: ctx.sourceInstanceId!, keywords: [{ name: 'Sentinel' }] }) }] })

registerCard('ASH_209', { abilities: [{ trigger: 'onAttack', description: 'If this unit is upgraded, you may give a unit -3/-0 for this phase.', effect: (s, ctx) => { // Ezra Bridger
  const u = allUnits(s).find(x => x.instanceId === ctx.sourceInstanceId)
  if (!u || !isUpgraded(u)) return s
  const targets = allUnits(s).map(x => x.instanceId)
  return targets.length ? pushChoice(s, { kind: 'mayLastingBuff', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, power: -3, hp: 0 }) : s
} }] })

registerCard('ASH_253', { abilities: [{ trigger: 'onAttack', description: 'If this unit is upgraded, deal 2 damage to a base.', effect: (s, ctx) => { // Yellow Aces Bomber
  const u = allUnits(s).find(x => x.instanceId === ctx.sourceInstanceId)
  if (!u || !isUpgraded(u)) return s
  return pushChoice(s, { kind: 'selectDamageTarget', id: ctx.sourceInstanceId!, controller: ctx.owner, amount: 2, unitTargets: [], baseTargets: ['player', 'opponent'] })
} }] })

// ── Group E (#356): onAttack — batch B2 (self-cost choices) ─────────────────
registerCard('ASH_059', { abilities: [{ trigger: 'onAttack', description: 'You may deal 1 damage to this unit. If you do, heal 2 damage from your base.', effect: (s, ctx) => // Leia Organa
  pushChoice(s, { kind: 'maySelfDamageHealBase', id: ctx.sourceInstanceId!, controller: ctx.owner, unitId: ctx.sourceInstanceId!, selfDamage: 1, healBase: 2 }) }] })

registerCard('ASH_172', { abilities: [{ trigger: 'onAttack', description: 'You may discard a card from your hand. If you do, this unit gets +2/+0 for this attack.', effect: (s, ctx) => // Razor Crest
  s.players[ctx.owner].hand.length > 0 ? pushChoice(s, { kind: 'selectDiscard', id: ctx.sourceInstanceId!, controller: ctx.owner, count: 1, optional: true, then: { buffUnit: ctx.sourceInstanceId!, power: 2, hp: 0 } }) : s }] })

registerCard('ASH_203', { abilities: [{ trigger: 'onAttack', description: 'You may exhaust a friendly leader. If you do, this unit gets +2/+0 for this attack.', effect: (s, ctx) => // Mando's N-1 Starfighter
  !s.players[ctx.owner].leader.exhausted ? pushChoice(s, { kind: 'mayExhaustLeaderBuffSelf', id: ctx.sourceInstanceId!, controller: ctx.owner, unitId: ctx.sourceInstanceId!, power: 2, hp: 0 }) : s }] })

// ── Group E (#356): When Attack Ends ────────────────────────────────────────
registerCard('ASH_033', { abilities: [{ trigger: 'onAttackEnd', description: 'If the defending unit was defeated, ready this unit.', effect: (s, ctx) => // Grand Admiral Thrawn
  ctx.defenderDefeated ? readyUnit(s, ctx.sourceInstanceId!) : s }] })

registerCard('ASH_223', { abilities: [{ trigger: 'onAttackEnd', description: 'If the defending unit was defeated, give a Shield token to this unit.', effect: (s, ctx) => // Halo
  ctx.defenderDefeated ? giveToken(s, ctx.sourceInstanceId!, TOKEN_SHIELD) : s }] })

registerCard('ASH_036', { abilities: [{ trigger: 'onAttackEnd', description: 'If the defending unit was defeated, you may give 3 Advantage tokens to a unit.', effect: (s, ctx) => { // Rukh
  if (!ctx.defenderDefeated) return s
  const targets = allUnits(s).map(u => u.instanceId)
  return targets.length ? pushChoice(s, { kind: 'mayGiveTokens', id: ctx.sourceInstanceId!, controller: ctx.owner, token: TOKEN_ADVANTAGE, count: 3, targets, optional: true }) : s
} }] })

registerCard('ASH_101', { abilities: [{ trigger: 'onAttackEnd', description: 'If this unit dealt combat damage to a non-leader unit, defeat that unit.', effect: (s, ctx) => { // The Great Mothers
  if (!ctx.combatDamageToDefender || ctx.attackTarget?.kind !== 'unit') return s
  const d = allUnits(s).find(u => u.instanceId === (ctx.attackTarget as { instanceId: string }).instanceId)
  return d && !isLeaderUnit(s, d) ? defeatUnit(s, d.instanceId) : s // already gone if combat killed it
} }] })

registerCard('ASH_031', { abilities: [{ trigger: 'onAttackEnd', description: 'If this unit dealt combat damage to a base, heal that much damage from your base.', effect: (s, ctx) => // Hera Syndulla
  (ctx.combatDamageToBase ?? 0) > 0 ? healBase(s, ctx.owner, ctx.combatDamageToBase!) : s }] })

// ── Group E (#356): multi-trigger onAttack + action abilities ───────────────
const justifierPing = (s: GameState, ctx: { owner: PlayerId; cardId: string; sourceInstanceId?: string }): GameState => { // Justifier
  const targets = allUnits(s).map(u => u.instanceId)
  return targets.length ? pushChoice(s, { kind: 'mayDamage', id: ctx.sourceInstanceId!, controller: ctx.owner, unitId: ctx.sourceInstanceId!, targets, amount: 1, optional: true, rewardIfDefeated: { chooseAdvantage: 1 }, source: { cardId: ctx.cardId, controller: ctx.owner } }) : s
}
registerCard('ASH_146', {
  abilities: [
    { trigger: 'whenPlayed', description: 'You may deal 1 damage to a unit. If that unit is defeated this way, give an Advantage token to a unit.', effect: justifierPing },
    { trigger: 'onAttack', description: 'You may deal 1 damage to a unit. If that unit is defeated this way, give an Advantage token to a unit.', effect: justifierPing },
  ],
})

registerCard('ASH_123', { actionAbilities: [{ // Lang
  description: "Deal damage equal to this unit's power to a ground unit.",
  exhaustCost: true,
  usable: (s) => groundUnits(s).length > 0,
  effect: (s, ctx) => {
    const u = allUnits(s).find(x => x.instanceId === ctx.sourceInstanceId)
    const power = u ? effectivePower(s, u) : 0
    const next = s
    const targets = groundUnits(next).map(x => x.instanceId)
    return targets.length ? pushChoice(next, { kind: 'selectDamageTarget', id: ctx.sourceInstanceId!, controller: ctx.owner, amount: power, unitTargets: targets, baseTargets: [] }) : next
  },
}] })

registerCard('ASH_142', { actionAbilities: [{ // Mortar Trooper
  description: 'Deal 1 damage to each of up to 3 ground units.',
  exhaustCost: true,
  usable: (s) => groundUnits(s).length > 0,
  effect: (s, ctx) => {
    const next = s
    const targets = groundUnits(next).map(x => x.instanceId)
    return targets.length ? pushChoice(next, { kind: 'multiPick', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, spec: { mode: 'dealEach', amount: 1, remaining: 3 } }) : next
  },
}] })

registerCard('ASH_179', { // Boba Fett's Rancor
  abilities: [
    { trigger: 'whenPlayed', description: 'Deal 5 damage to your base. Then deal 10 damage to an enemy ground unit.', effect: (s, ctx) => {
      const next = dealDamageToBase(s, ctx.owner, 5)
      const enemyGround = next.players[opponentOf(ctx.owner)].units.filter(u => u.arena === 'ground').map(u => u.instanceId)
      return enemyGround.length ? pushChoice(next, { kind: 'selectDamageTarget', id: ctx.sourceInstanceId!, controller: ctx.owner, amount: 10, unitTargets: enemyGround, baseTargets: [], source: { cardId: ctx.cardId, controller: ctx.owner } }) : next
    } },
    { trigger: 'onAttack', description: 'You may deal 1 damage to a base for every 5 damage on your base.', effect: (s, ctx) => {
      const count = Math.floor(s.players[ctx.owner].base.damage / 5)
      return count > 0 ? pushChoice(s, { kind: 'selectDamageTarget', id: ctx.sourceInstanceId!, controller: ctx.owner, amount: count, unitTargets: [], baseTargets: ['player', 'opponent'], optional: true, source: { cardId: ctx.cardId, controller: ctx.owner } }) : s
    } },
  ],
})

registerCard('ASH_119', { actionAbilities: [{ // Greef Karga (unit)
  description: 'If your base was attacked this phase, create a Mandalorian token.',
  cost: 1,
  exhaustCost: true,
  usable: (s, u) => { const owner = findUnit(s, u.instanceId)?.owner; return owner !== undefined && baseAttackedThisPhase(s, owner) },
  effect: (s, ctx) => createTokenUnit(s, ctx.owner, TOKEN_MANDALORIAN),
}] })

// ── Group F (#357): combat-role + static statModifiers ──────────────────────
registerCard('ASH_073', { statModifier: (_s, _u, ctx) => (ctx.defending ? { power: 2 } : {}) }) // Palace Chef Droid — +2/+0 while defending

registerCard('ASH_241', { statModifier: (_s, _u, ctx) => (ctx.attacking && ctx.defenderDamaged ? { power: 2 } : {}) }) // Marrok's Fiend Fighter — +2/+0 attacking a damaged unit

registerCard('ASH_206', { statModifier: (s, u) => // Kelleran Beq — +1/+0 per other unit (either side) with 0 power
  ({ power: allUnits(s).filter(x => x.instanceId !== u.instanceId && effectivePower(s, x) === 0).length }) })

registerCard('ASH_197', { // Executor
  statModifier: (s, u) => {
    const owner = findUnit(s, u.instanceId)?.owner
    if (!owner) return {}
    return { power: s.players[owner].units.filter(x => x.instanceId !== u.instanceId).reduce((sum, x) => sum + x.upgrades.length, 0) }
  },
  abilities: [{ trigger: 'whenPlayed', description: 'Give an Advantage token to each other friendly unit.', effect: (s, ctx) => {
    let next = s
    for (const x of s.players[ctx.owner].units) if (x.instanceId !== ctx.sourceInstanceId) next = giveToken(next, x.instanceId, TOKEN_ADVANTAGE)
    return next
  } }],
})

registerCard('ASH_226', { // Qi'ra
  statModifier: (s, u) => { const owner = findUnit(s, u.instanceId)?.owner; return owner ? { power: -s.players[owner].hand.length } : {} },
  abilities: [{ trigger: 'whenPlayed', description: 'You may discard a card from your hand. If you do, deal 3 damage to a unit.', effect: (s, ctx) =>
    s.players[ctx.owner].hand.length > 0 ? pushChoice(s, { kind: 'selectDiscard', id: ctx.sourceInstanceId!, controller: ctx.owner, count: 1, optional: true, then: { dealDamage: 3 } }) : s }],
})

// ── Group F (#357): new triggers ────────────────────────────────────────────
// The Twins (127): a Sentinel grant on play/attack, plus a base heal whenever another friendly dies.
const twinsGrantSentinel = (s: GameState, ctx: { owner: PlayerId; sourceInstanceId?: string }): GameState => {
  const targets = s.players[ctx.owner].units.filter(u => u.instanceId !== ctx.sourceInstanceId).map(u => u.instanceId)
  return targets.length ? pushChoice(s, { kind: 'mayLastingBuff', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, keywords: [{ name: 'Sentinel' }] }) : s
}
registerCard('ASH_127', {
  abilities: [
    { trigger: 'whenPlayed', description: 'You may give another friendly unit Sentinel for this phase.', effect: twinsGrantSentinel },
    { trigger: 'onAttack', description: 'You may give another friendly unit Sentinel for this phase.', effect: twinsGrantSentinel },
    { trigger: 'whenFriendlyUnitDefeated', description: 'Heal 1 damage from your base.', effect: (s, ctx) => healBase(s, ctx.owner, 1) },
  ],
})

const KACHIRHO_ROUND_KEY = 'ASH_160#round'
registerCard('ASH_160', { abilities: [{ trigger: 'whenEnemyAttacksBase', description: 'Ready this unit. Once each round.', effect: (s, ctx) => { // Kachirho Militia
  const self = allUnits(s).find(u => u.instanceId === ctx.sourceInstanceId)
  if (!self || (self.usedAbilities ?? []).includes(KACHIRHO_ROUND_KEY)) return s
  // Only an enemy GROUND unit attacking your base triggers it.
  const attacker = ctx.attackerInstanceId ? allUnits(s).find(u => u.instanceId === ctx.attackerInstanceId) : undefined
  if (attacker?.arena !== 'ground') return s
  return markAbilityUsed(readyUnit(s, self.instanceId), ctx.owner, self.instanceId, KACHIRHO_ROUND_KEY)
} }] })

registerCard('ASH_208', { abilities: [{ trigger: 'whenUpgradeAttached', description: 'You may exhaust a ground unit.', effect: (s, ctx) => { // Sabine Wren (unit)
  const targets = groundUnits(s).map(u => u.instanceId)
  return targets.length ? pushChoice(s, { kind: 'mayExhaustUnit', id: ctx.sourceInstanceId!, controller: ctx.owner, targets }) : s
} }] })

// ── Group F (#357): once-per-phase cost reductions ──────────────────────────
registerCard('ASH_075', { // Pit Droid Team — the first upgrade you play on ANOTHER friendly unit each phase costs 1 less
  costDiscount: (s, source, ctx) => {
    if (ctx.card.type !== 'upgrade') return 0
    const t = ctx.target
    if (!t || t.instanceId === source.instanceId) return 0 // "another" — not onto Pit Droid Team itself
    if (!s.players[ctx.owner].units.some(u => u.instanceId === t.instanceId)) return 0 // friendly only
    if (cardsPlayedThisPhase(s, ctx.owner).some(id => s.cards[id]?.type === 'upgrade')) return 0 // already used this phase
    return -1
  },
})

registerCard('ASH_212', { // Peli Motto — ignore the aspect penalties of the first non-unit card you play each phase
  waivesAspectPenalty: (s, _source, ctx) =>
    ctx.card.type !== 'unit' && !cardsPlayedThisPhase(s, ctx.owner).some(id => s.cards[id]?.type !== 'unit'),
})

// ── Group F (#357): targeting rules ─────────────────────────────────────────
registerCard('ASH_034', { cannotAttackBases: () => true }) // Wicket

registerCard('ASH_037', { attacksEitherArena: () => true }) // Red Leader — may attack units in either arena

registerCard('ASH_035', { // Tatooine Repulsor Train
  // Can't be attacked while its controller has 2+ exhausted units — unless it has Sentinel.
  cannotBeAttacked: (s, u) => {
    if (unitHasKeyword(s, u, 'Sentinel')) return false
    const owner = findUnit(s, u.instanceId)?.owner
    return owner !== undefined && s.players[owner].units.filter(x => x.exhausted).length >= 2
  },
  abilities: [{ trigger: 'onAttack', description: 'Deal 2 damage to a ground unit for each friendly exhausted unit.', effect: (s, ctx) => {
    const amount = 2 * s.players[ctx.owner].units.filter(u => u.exhausted).length
    const targets = groundUnits(s).map(u => u.instanceId)
    return amount > 0 && targets.length ? pushChoice(s, { kind: 'selectDamageTarget', id: ctx.sourceInstanceId!, controller: ctx.owner, amount, unitTargets: targets, baseTargets: [], source: { cardId: ctx.cardId, controller: ctx.owner } }) : s
  } }],
})

// ── Group F (#357): HP-reduction defeats (state-based + combat-only) ────────
registerCard('ASH_050', whenDefeated('You may give a unit -2/-2 for this phase.', (s, ctx) => { // Morgan Elsbeth
  const targets = allUnits(s).map(u => u.instanceId)
  return targets.length ? pushChoice(s, { kind: 'mayLastingBuff', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, power: -2, hp: -2 }) : s
}))

// Scion Shuttle (046): while it attacks, the DEFENDING unit gets -1/-1 — a combat-conditional aura.
registerCard('ASH_046', {
  aura: (_s, source, target, _sameController, combat) =>
    combat && combat.attackerInstanceId === source.instanceId && combat.defenderInstanceId === target.instanceId
      ? { power: -1, hp: -1 }
      : undefined,
})

// ── Group F (#357): damage prevention ───────────────────────────────────────
// At Attin Safety Droid (070): "if your base would be dealt more than 4 damage, prevent all but 4".
registerCard('ASH_070', { preventBaseDamage: (_s, _source, amount) => Math.min(amount, 4) })

// Moff Jerjerrod (094): "if you would create a number of tokens, you may defeat this unit to create
// twice that number instead" — offered by `createTokenUnits` as a top-up (see its note).
registerCard('ASH_094', { doublesTokenCreation: () => true })

// ── Tier 1 (#357): cards the existing hooks already cover ───────────────────
registerCard('ASH_144', { abilities: [{ trigger: 'whenFriendlyAttackEnds', description: "If the attack dealt combat damage to a base, give an Advantage token to this unit.", effect: (s, ctx) => // Vane's Snub Fighter
  (ctx.combatDamageToBase ?? 0) > 0 ? giveToken(s, ctx.sourceInstanceId!, TOKEN_ADVANTAGE) : s }] })

registerCard('ASH_041', { // Outcast — "when a friendly unit enters play (including this one)"
  abilities: [
    // `whenPlayOrCreateUnit` fires on the controller's OTHER units, so the "including this one" half
    // is covered by its own whenPlayed.
    { trigger: 'whenPlayed', description: 'This unit gets +1/+0 for this phase.', effect: (s, ctx) => addLastingEffect(s, { targetInstanceId: ctx.sourceInstanceId!, power: 1 }) },
    { trigger: 'whenPlayOrCreateUnit', description: 'A friendly unit entering play gets +1/+0 for this phase.', effect: (s, ctx) => ctx.targetInstanceId ? addLastingEffect(s, { targetInstanceId: ctx.targetInstanceId, power: 1 }) : s },
  ],
})

registerCard('ASH_102', { abilities: [{ trigger: 'whenPlayOrCreateUnit', description: 'You may have the entering unit deal damage equal to its power to a unit in the same arena.', effect: (s, ctx) => { // Ravager
  const entered = ctx.targetInstanceId ? allUnits(s).find(u => u.instanceId === ctx.targetInstanceId) : undefined
  if (!entered) return s
  const amount = effectivePower(s, entered)
  const targets = allUnits(s).filter(u => u.arena === entered.arena).map(u => u.instanceId)
  return amount > 0 && targets.length ? pushChoice(s, { kind: 'mayDamage', id: ctx.sourceInstanceId!, controller: ctx.owner, unitId: ctx.sourceInstanceId!, targets, amount, optional: true }) : s
} }] })

registerCard('ASH_079', { // Koska Reeves
  conditionalKeywords: (s, u) => {
    const owner = findUnit(s, u.instanceId)?.owner
    return owner !== undefined && s.players[owner].units.some(x => isTokenCard(x.cardId)) ? [{ name: 'Sentinel' }] : []
  },
  abilities: [{ trigger: 'whenPlayed', description: 'If a friendly unit was defeated this phase, create a Mandalorian token.', effect: (s, ctx) =>
    defeatedThisPhase(s, ctx.owner).length > 0 ? createTokenUnit(s, ctx.owner, TOKEN_MANDALORIAN) : s }],
})

// ── Units needing a chained follow-up choice or a real "[Exhaust]" action cost (#357) ──────────

registerCard('ASH_171', whenPlayed('You may defeat a friendly upgrade. If you do, ready this unit.', (s, ctx) => { // Pegasus Tri-Wing
  const candidates = s.players[ctx.owner].units.flatMap(u => u.upgrades.map((up, i) => ({ unitId: u.instanceId, upgradeIndex: i, cardId: up.cardId })))
  return candidates.length === 0 ? s : pushChoice(s, {
    kind: 'selectUpgradeToDefeat',
    id: ctx.sourceInstanceId!,
    controller: ctx.owner,
    candidates,
    optional: true,
    thenReadyUnit: ctx.sourceInstanceId!,
  })
}))

registerCard('ASH_060', { // Cobb Vanth
  abilities: [{
    trigger: 'whenPlayOrCreateUnit',
    description: 'You may deal 2 damage to this unit. If you do, give a Shield token to that unit.',
    effect: (s, ctx) => (ctx.targetInstanceId && findUnit(s, ctx.sourceInstanceId!) ? pushChoice(s, {
      kind: 'maySelfDamageShield',
      id: `${ctx.sourceInstanceId}-${ctx.targetInstanceId}`,
      controller: ctx.owner,
      selfId: ctx.sourceInstanceId!,
      targetId: ctx.targetInstanceId,
      amount: 2,
    }) : s),
  }],
})

const GAR_SAXON_KEY = 'ASH_047#token'
registerCard('ASH_047', { // Gar Saxon
  abilities: [{
    trigger: 'whenUpgradeAttached',
    description: 'When you play an upgrade on this unit: You may create a Mandalorian token. Use this ability only once each round.',
    effect: (s, ctx) => {
      const self = findUnit(s, ctx.sourceInstanceId!)?.unit
      // Only a *played* upgrade counts, and only once each round.
      if (!ctx.upgradePlayed || !self || self.usedAbilities?.includes(GAR_SAXON_KEY)) return s
      return pushChoice(s, {
        kind: 'mayCreateToken',
        id: ctx.sourceInstanceId!,
        controller: ctx.owner,
        token: TOKEN_MANDALORIAN,
        count: 1,
        markUsed: { instanceId: ctx.sourceInstanceId!, key: GAR_SAXON_KEY },
      })
    },
  }],
})

registerCard('ASH_155', { // Grogu (unit)
  abilities: [{
    trigger: 'whenTakeInitiative',
    description: 'You may attack with a unit.',
    effect: (s, ctx) => (s.players[ctx.owner].units.some(u => !u.exhausted)
      ? pushChoice(s, { kind: 'mayAttackAnyUnit', id: `${ctx.sourceInstanceId}-attack`, controller: ctx.owner, restore: 0 })
      : s),
  }],
})

registerCard('ASH_118', { // 8D8
  actionAbilities: [{
    description: 'Deal 1 damage to another friendly unit. If you do, search the top 5 cards of your deck for a unit, reveal it, and draw it.',
    exhaustCost: true,
    usable: (s, u) => s.players[findUnit(s, u.instanceId)!.owner].units.some(x => x.instanceId !== u.instanceId),
    effect: (s, ctx) => {
      const targets = s.players[ctx.owner].units.filter(u => u.instanceId !== ctx.sourceInstanceId).map(u => u.instanceId)
      return targets.length === 0 ? s : pushChoice(s, {
        kind: 'mayDamage',
        id: ctx.sourceInstanceId!,
        controller: ctx.owner,
        unitId: ctx.sourceInstanceId!,
        targets,
        amount: 1,
        thenSearchDraw: 5,
        source: { cardId: ctx.cardId, controller: ctx.owner },
      })
    },
  }],
})

registerCard('ASH_109', { // T-6 Shuttle 1974
  actionAbilities: [{
    description: 'Give another unit +2/+2 for this phase. You may attack with that unit.',
    exhaustCost: true,
    effect: (s, ctx) => {
      const targets = allUnits(s).filter(u => u.instanceId !== ctx.sourceInstanceId).map(u => u.instanceId)
      return targets.length === 0 ? s : pushChoice(s, {
        kind: 'mayLastingBuff',
        id: ctx.sourceInstanceId!,
        controller: ctx.owner,
        targets,
        power: 2,
        hp: 2,
        thenMayAttack: true,
      })
    },
  }],
})

registerCard('ASH_245', { // Eye of Sion
  actionAbilities: [{
    description: "Search the top 8 cards of your deck for a unit that costs the same as or less than this unit's power. Play it for free. It enters play ready.",
    exhaustCost: true,
    effect: (s, ctx) => {
      const self = findUnit(s, ctx.sourceInstanceId!)?.unit
      if (!self) return s
      const budget = effectivePower(s, self)
      const revealed = s.players[ctx.owner].deck.slice(0, searchCount(s, self, 8))
      const eligibleIndices = revealed.flatMap((cardId, i) => {
        const c = s.cards[cardId]
        return c?.type === 'unit' && c.cost <= budget ? [i] : []
      })
      if (eligibleIndices.length === 0) return bottomTopCards(s, ctx.owner, revealed.length)
      return pushChoice(s, {
        kind: 'searchPlayFree',
        id: ctx.sourceInstanceId!,
        controller: ctx.owner,
        revealed,
        eligibleIndices,
        budget,
        playOne: true,
        entersReady: true,
      })
    },
  }],
})

// ── Reactive triggers + phase conditions (#357 mechanic tier) ──────────────────────────────────

registerCard('ASH_169', { // Axe Woves
  abilities: [{ trigger: 'whenDrawCards', description: 'Give an Advantage token to this unit.', effect: (s, ctx) => giveToken(s, ctx.sourceInstanceId!, TOKEN_ADVANTAGE) }],
})

registerCard('ASH_204', { // Blade Three
  abilities: [{ trigger: 'whenOwnBaseDamaged', description: 'Give an Advantage token to this unit.', effect: (s, ctx) => giveToken(s, ctx.sourceInstanceId!, TOKEN_ADVANTAGE) }],
})

registerCard('ASH_161', { // Zeb Orrelios
  abilities: [
    { trigger: 'whenPlayed', description: 'Give 3 Advantage tokens to another unit.', effect: (s, ctx) => {
      const targets = allUnits(s).filter(u => u.instanceId !== ctx.sourceInstanceId).map(u => u.instanceId)
      return targets.length ? pushChoice(s, { kind: 'mayGiveTokens', id: ctx.sourceInstanceId!, controller: ctx.owner, token: TOKEN_ADVANTAGE, count: 3, targets, optional: false }) : s
    } },
    { trigger: 'whenFriendlyUpgradeDefeated', description: 'Deal 1 damage to a base.', effect: (s, ctx) =>
      pushChoice(s, { kind: 'selectDamageTarget', id: `${ctx.sourceInstanceId}-base`, controller: ctx.owner, amount: 1, unitTargets: [], baseTargets: ['player', 'opponent'] }) },
  ],
})

const RANCOR_KEEPER_KEY = 'ASH_032#round'
registerCard('ASH_032', { // Rancor Keeper
  abilities: [{
    trigger: 'whenFriendlyDamagedSurvives',
    description: 'Deal 1 damage to any number of bases. Use this ability only once each round.',
    effect: (s, ctx) => {
      const self = findUnit(s, ctx.sourceInstanceId!)?.unit
      if (!self || self.usedAbilities?.includes(RANCOR_KEEPER_KEY)) return s
      const marked = markAbilityUsed(s, ctx.owner, ctx.sourceInstanceId!, RANCOR_KEEPER_KEY)
      return pushChoice(marked, { kind: 'damageAnyBases', id: ctx.sourceInstanceId!, controller: ctx.owner, remaining: ['player', 'opponent'], amount: 1, source: { cardId: ctx.cardId, controller: ctx.owner } })
    },
  }],
})

registerCard('ASH_039', { // Baylan Skoll
  abilities: (['whenPlayed', 'onAttackEnd'] as const).map(trigger => ({
    trigger,
    description: 'If an enemy base was damaged this phase, give an Advantage token to a unit. If a friendly upgrade was defeated this phase, you may exhaust a unit.',
    effect: (s: GameState, ctx: EffectContext) => {
      let next = s
      const targets = allUnits(next).map(u => u.instanceId)
      if (targets.length === 0) return next
      if (baseDamagedThisPhase(next, opponentOf(ctx.owner))) {
        next = pushChoice(next, { kind: 'mayGiveTokens', id: `${ctx.sourceInstanceId}-adv`, controller: ctx.owner, token: TOKEN_ADVANTAGE, count: 1, targets, optional: false })
      }
      if (upgradeDefeatedThisPhase(next, ctx.owner)) {
        next = pushChoice(next, { kind: 'mayExhaustUnit', id: `${ctx.sourceInstanceId}-exh`, controller: ctx.owner, targets })
      }
      return next
    },
  })),
})

registerCard('ASH_202', { dealsDamageFirst: () => true }) // Carson Teva — deals combat damage before the defender

registerCard('ASH_207', { // Heroic Purrgil — +2/+0 while attacking using Ambush
  statModifier: (_s, _u, ctx) => (ctx.attacking && ctx.viaAmbush ? { power: 2 } : {}),
})

// ── Multi-step choice chains (#357 mechanic tier) ──────────────────────────────────────────────

registerCard('ASH_052', { // Chimaera
  abilities: [
    { trigger: 'whenPlayed', description: 'You may choose a friendly unit and an enemy non-leader unit. If you do, defeat those units.', effect: (s, ctx) => {
      const friendlyTargets = s.players[ctx.owner].units.map(u => u.instanceId)
      const enemyTargets = s.players[opponentOf(ctx.owner)].units.filter(u => !u.isLeader).map(u => u.instanceId)
      return friendlyTargets.length && enemyTargets.length
        ? pushChoice(s, { kind: 'selectPairToDefeat', id: ctx.sourceInstanceId!, controller: ctx.owner, friendlyTargets, enemyTargets })
        : s
    } },
    { trigger: 'whenEnemyUnitDefeated', description: 'Heal 2 damage from your base.', effect: (s, ctx) => healBase(s, ctx.owner, 2) },
  ],
})

registerCard('ASH_042', { // Jabba the Hutt
  abilities: [{ trigger: 'whenPlayed', description: "You may return an upgrade to its owner's hand. If it's returned to your hand, you may play it for free.", effect: (s, ctx) => {
    // Token upgrades can't go to a hand, so only card upgrades are candidates.
    const candidates = allUnits(s).flatMap(u => u.upgrades.flatMap((up, i) =>
      s.cards[up.cardId]?.type === 'upgrade' ? [{ unitId: u.instanceId, upgradeIndex: i, cardId: up.cardId }] : []))
    return candidates.length ? pushChoice(s, { kind: 'selectUpgradeToReturn', id: ctx.sourceInstanceId!, controller: ctx.owner, candidates }) : s
  } }],
})

registerCard('ASH_219', { // Jod Na Nawood
  abilities: [{ trigger: 'whenPlayed', description: 'You may pay 4. If you do, choose an arena. Exhaust each unit in that arena.', effect: (s, ctx) =>
    // Don't raise a choice the player can't act on — the cost is checked after paying for Jod himself.
    canAfford(s.players[ctx.owner], 4) ? pushChoice(s, { kind: 'mayPayExhaustArena', id: ctx.sourceInstanceId!, controller: ctx.owner, cost: 4 }) : s }],
})

registerCard('ASH_132', { // Queen Soruna
  abilities: (['whenPlayed', 'onAttack'] as const).map(trigger => ({
    trigger,
    description: 'You may reveal a unit from your hand. If you do, deal 3 damage to a unit with the same cost as the revealed unit.',
    effect: (s: GameState, ctx: EffectContext) => {
      const handIndices = s.players[ctx.owner].hand.flatMap((cardId, i) => (s.cards[cardId]?.type === 'unit' ? [i] : []))
      return handIndices.length ? pushChoice(s, { kind: 'revealUnitFromHand', id: `${ctx.sourceInstanceId}-${trigger}`, controller: ctx.owner, handIndices, amount: 3 }) : s
    },
  })),
})

registerCard('ASH_133', { // Trask Walker
  abilities: (['whenPlayed', 'onAttack'] as const).map(trigger => ({
    trigger,
    description: 'Choose a unit in your discard pile that costs 7 or less. Either put that card on the bottom of your deck and heal 3 damage from your base, or return it to your hand.',
    effect: (s: GameState, ctx: EffectContext) => {
      const candidates = [...new Set(s.players[ctx.owner].discard.filter(id => {
        const c = s.cards[id]
        return c?.type === 'unit' && c.cost <= 7
      }))]
      return candidates.length
        ? pushChoice(s, { kind: 'selectFromDiscard', id: `${ctx.sourceInstanceId}-${trigger}`, controller: ctx.owner, candidates, optional: false, then: 'discardFate' })
        : s
    },
  })),
})

// ── Action-ability costs, regroup-phase choices, token suppression (#357 mechanic tier) ────────

registerCard('ASH_217', { // Mayor's Majordomo
  actionAbilities: [{
    description: 'Exhaust and discard a card from your hand: Exhaust a unit.',
    exhaustCost: true,
    // The discard is a COST, so with an empty hand (or no target) the ability can't be used at all.
    usable: (s, u) => {
      const owner = findUnit(s, u.instanceId)?.owner
      return owner !== undefined && s.players[owner].hand.length > 0 && allUnits(s).length > 0
    },
    effect: (s, ctx) => pushChoice(s, {
      kind: 'selectDiscard',
      id: ctx.sourceInstanceId!,
      controller: ctx.owner,
      count: 1,
      optional: false,
      then: { exhaustUnit: true },
    }),
  }],
})

registerCard('ASH_159', { // Alphabet Squadron U-Wing
  abilities: [{ trigger: 'whenRegroupStarts', description: 'Give an Advantage token to a unit.', effect: (s, ctx) => {
    const targets = allUnits(s).map(u => u.instanceId)
    return targets.length ? pushChoice(s, { kind: 'mayGiveTokens', id: ctx.sourceInstanceId!, controller: ctx.owner, token: TOKEN_ADVANTAGE, count: 1, targets, optional: false }) : s
  } }],
})

registerCard('ASH_149', { // Eviscerator
  suppressesFriendlyAdvantage: () => true,
  abilities: (['whenPlayed', 'onAttack'] as const).map(trigger => ({
    trigger,
    description: 'Give 2 Advantage tokens to each other friendly unit.',
    effect: (s: GameState, ctx: EffectContext) => {
      let next = s
      for (const u of next.players[ctx.owner].units) {
        if (u.instanceId === ctx.sourceInstanceId) continue
        next = giveToken(giveToken(next, u.instanceId, TOKEN_ADVANTAGE), u.instanceId, TOKEN_ADVANTAGE)
      }
      return next
    },
  })),
})

// ── Subsystem tier (#357): aura-granted abilities, capture, Elzar Mann ─────────────────────────

/**
 * Not a real card — a carrier for the ability Bo-Katan's Gauntlet lends to other units. Deliberately
 * NOT `ASH_`-prefixed: the manifest drift test treats every registered ASH id as an implemented card.
 */
const GRANT_MANDO_ON_DEFEAT = 'GRANT_MANDO_ON_DEFEAT'
registerCard(GRANT_MANDO_ON_DEFEAT, {
  abilities: [{ trigger: 'whenDefeated', description: 'Create a Mandalorian token.', effect: (s, ctx) => createTokenUnit(s, ctx.owner, TOKEN_MANDALORIAN) }],
})

registerCard('ASH_063', { // Bo-Katan's Gauntlet
  grantsAbilities: (_s, source, target, friendly) =>
    friendly && target.instanceId !== source.instanceId && !isTokenCard(target.cardId) ? [GRANT_MANDO_ON_DEFEAT] : [],
})

const BOTHAN_KEY = 'ASH_128#round'
registerCard('ASH_128', { // Bothan-5
  abilities: [{
    trigger: 'whenFriendlyUnitDefeated',
    description: 'You may have this unit capture that unit from your discard pile. Use this ability only once each round.',
    effect: (s, ctx) => {
      const self = findUnit(s, ctx.sourceInstanceId!)?.unit
      const dead = ctx.defeatedUnit
      if (!self || !dead || self.usedAbilities?.includes(BOTHAN_KEY)) return s
      // "another friendly non-Vehicle unit" — and only a card that actually reached the discard
      // (a token unit ceases to exist, so there's nothing to capture).
      if (dead.instanceId === self.instanceId) return s
      if (unitTraits(s, dead).some(t => t.toLowerCase() === 'vehicle')) return s
      if (!s.players[ctx.owner].discard.includes(dead.cardId)) return s
      return pushChoice(s, {
        kind: 'mayCapture',
        id: `${ctx.sourceInstanceId}-capture`,
        controller: ctx.owner,
        unitId: ctx.sourceInstanceId!,
        cardId: dead.cardId,
        markUsed: { instanceId: ctx.sourceInstanceId!, key: BOTHAN_KEY },
      })
    },
  }],
})

registerCard('ASH_224', { // Elzar Mann
  // "While you control a Force leader, this unit enters play ready."
  entersReady: (s, owner) => (s.cards[s.players[owner].leader.cardId]?.traits ?? []).some(t => t.toLowerCase() === 'force'),
  abilities: [{
    trigger: 'whenPlayed',
    description: 'Distribute up to 5 Advantage tokens among other friendly units. Then, an opponent searches twice that many cards from the top of their deck for an event, reveals it, and draws it.',
    effect: (s, ctx) => {
      const targets = s.players[ctx.owner].units.filter(u => u.instanceId !== ctx.sourceInstanceId).map(u => u.instanceId)
      return targets.length ? pushChoice(s, {
        kind: 'distributeTokens',
        id: ctx.sourceInstanceId!,
        controller: ctx.owner,
        token: TOKEN_ADVANTAGE,
        remaining: 5,
        total: 5,
        targets,
        exclude: ctx.sourceInstanceId!,
        then: 'opponentSearchEvent',
      }) : s
    },
  }],
})

registerCard('ASH_196', { // Gorian Shard's Corsair
  // "Damage dealt by friendly Underworld cards is unpreventable."
  makesDamageUnpreventable: (s, self, source) =>
    source.controller === findUnit(s, self.instanceId)?.owner
    && (s.cards[source.cardId]?.traits ?? []).some(t => t.toLowerCase() === 'underworld'),
  abilities: (['whenPlayed', 'onAttack'] as const).map(trigger => ({
    trigger,
    description: 'You may deal 2 damage to a unit.',
    effect: (s: GameState, ctx: EffectContext) => {
      const targets = allUnits(s).map(u => u.instanceId)
      return targets.length ? pushChoice(s, {
        kind: 'mayDamage',
        id: `${ctx.sourceInstanceId}-${trigger}`,
        controller: ctx.owner,
        unitId: ctx.sourceInstanceId!,
        targets,
        amount: 2,
        optional: true,
        source: { cardId: ctx.cardId, controller: ctx.owner },
      }) : s
    },
  })),
})
