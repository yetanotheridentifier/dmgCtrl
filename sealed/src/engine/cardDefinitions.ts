import type { AbilityDef, AuraContribution, CardDefinition, EffectContext, IfYouDoContext } from './abilities'
import { registerCard, getCardDefinition, collectUnitTriggers } from './abilities'
import { fireBatch, takeControlOfUnit, giveToken, giveTokens, giveMixedTokens, moveUnitToArena, attachUpgrades, fireUpgradeAttached, exhaustUnit, returnUpgradeToHand, drawCards, discardFromHand, returnUnitToHand, returnOtherUpgradesToHand, returnCardFromDiscardToHand, defeatUpgrade, defeatUpgradeAt, createTokenUnit, createTokenUnits, findUnit, searchCount, grantNextUnit, healUnit, healBase, dealDamageToBase, exhaustReadyResource, readyResource, readyUnit, openSupportChoice, leaderCanExhaust, resourceTopOfDeck, defeatBaseUpgrade } from './effects'
import { dealDamageToUnit, defeatUnit, defeatUnits } from './combat'
import { seededUnit, nextSeed, seededShuffle } from './rng'
import { effectiveHp, effectivePower } from './stats'
import { TOKEN_SHIELD, TOKEN_ADVANTAGE, TOKEN_EXPERIENCE, TOKEN_WEAKNESS, hasToken } from './tokenUpgrades'
import { discardUnitsMatching, playUpgradeOnto } from './resolve'
import { TOKEN_MANDALORIAN, TOKEN_SPY, TOKEN_X_WING, TOKEN_TIE_FIGHTER, TOKEN_CLONE_TROOPER, TOKEN_BATTLE_DROID, TOKEN_BEAST, isTokenCard } from './tokenUnits'
import { baseHostId, isFortify, opponentOf, pushChoice, addLastingEffect, addDelayedEffect, baseDamageThisPhase, tokenCreatedThisPhase, defeatedThisPhase, damagedThisPhase, leftPlayThisPhase, leaderLeftPlayThisPhase, enteredPlayThisPhase, baseAttackedThisPhase, baseDamagedThisPhase, upgradeDefeatedThisPhase, cardsPlayedThisPhase, attackedThisPhase, healedThisPhase, damagePreventedThisPhase, cardsDrawnThisPhase, markAbilityUsed, updatePlayer } from './types'
import { affordableHandUnits, resourceUpgradeCandidates, enemyAttackTargets, effectiveCost, eligibleAttacker, canAttackSomething, offerAttack } from './legalMoves'
import type { AttackOffer } from './legalMoves'
import { canAfford } from './resources'
import { unitHasTrait, unitTraits, isLeaderUnit, nonAuraKeywordNames, nonAuraKeywordValue, unitHasKeyword, unitKeywords } from './keywords'
import type { CombatContext, EngineCard, GameState, IfYouDo, KeywordInstance, LastingEffect, PendingChoice, PlayerId, UnitState, UpgradeAttachment, UpgradeRef } from './types'

/**
 * Real card definitions. Side-effect module: importing it registers every
 * card's behaviour into the ability registry. Built card-type-agnostic — the same
 * hooks and primitives serve units, leaders, events and upgrades.
 *
 * An upgrade whose whole behaviour comes from its printed stats and keywords registers only its
 * attach restriction here — there is nothing else for the engine to do.
 */

const cardOf = (state: GameState, unit: UnitState): EngineCard | undefined => state.cards[unit.cardId]
// Trait checks go through `unitHasTrait` so granted traits count (The Darksaber → Mandalorian).
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
      const revealed = s.players[owner].deck.slice(0, searchCount(s, owner, 3))
      // Always reveal, even when no ground unit is among them (#413): the player looked at these
      // cards and is entitled to see them. Acknowledging without a pick goes straight on to the
      // optional attack with no grant, which is what used to happen silently.
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
      next = giveTokens(next, ctx.sourceInstanceId!, TOKEN_ADVANTAGE, n)
      return next
    },
  }],
})
registerCard('ASH_199', { // There Is No Conflict — return other upgrades to owners' hands
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

// ── onAttackEnd combat effects ───────────────────────────────────────
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

// ── whenDefeated token creation ──────────────────────────────────────
registerCard('ASH_134', { // Warrior's Legacy — attached unit gains "When Defeated: Create a Mandalorian token."
  abilities: [{ trigger: 'whenDefeated', description: 'Create a Mandalorian token.', effect: (s, ctx) => createTokenUnit(s, ctx.owner, TOKEN_MANDALORIAN) }],
})

// ── whenDefeated self-return ─────────────────────────────────────────
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
      return returnCardFromDiscardToHand(s, owner, ctx.cardId)
    },
  }],
})

// ── whenReadies optional cost (group B) ────────────────────────────────
registerCard('ASH_088', { // The Conflict Within — "When this unit readies: you may pay 3, else exhaust it."
  abilities: [{
    trigger: 'whenReadies',
    description: 'You may pay 3, otherwise exhaust this unit.',
    effect: (s, ctx) => pushChoice(s, {
      kind: 'payOrExhaust', id: ctx.sourceInstanceId!, controller: ctx.owner, unitId: ctx.sourceInstanceId!, cost: 3, resumeAtInitiative: true,
    }),
  }],
})

// ── onAttackEnd optional free play (group B) ───────────────────────────
registerCard('ASH_229', { // Camtono — "When Attack Ends: look at top card; if it costs ≤2 you may play it free."
  abilities: [{
    trigger: 'onAttackEnd',
    description: 'Look at the top card of your deck; if it costs 2 or less you may play it for free.',
    effect: (s, ctx) => {
      // Always "look at" the top card (shown to the controller); playing it is gated to
      // cost ≤ 2 in legalMoves, so a costlier card is revealed but can't be played (fix).
      const topId = s.players[ctx.owner].deck[0]
      if (!topId) return s
      return pushChoice(s, { kind: 'mayPlayTopFree', id: ctx.sourceInstanceId!, controller: ctx.owner, unitId: ctx.sourceInstanceId!, cardId: topId })
    },
  }],
})

// ── onDefense mid-combat optional (phase 2) ────────────────────────────
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

// ── Leaders ──────────────────────────────────────────────────────────
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
        next = giveTokens(next, ctx.targetInstanceId!, TOKEN_ADVANTAGE, others)
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

registerCard('ASH_014', { // The Mandalorian — front take-initiative draw; deployed on-attack draw
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

/**
 * Which upgrades in play an effect may target. The ONE place that question is answered, because
 * card text asks it three different ways and hand-rolled scans kept conflating them (#401):
 *
 * - "a friendly upgrade"          → `owner`, the player who PLAYED it (#378)
 * - "an upgrade on a friendly unit" → `hostController`, whoever controls the host (Reforge)
 * - "an upgrade"                  → neither filter: anything in play, either side
 *
 * Ownership and host controller genuinely differ: an opponent can attach an upgrade to your unit
 * (Deadly Vulnerability) and it stays theirs, which is why `UpgradeAttachment` carries `owner` and
 * why it returns to THEIR discard when defeated.
 *
 * Token upgrades (Shield / Advantage / Experience) are always included: they are upgrades, they
 * cost 0, and "defeat an upgrade" can legally take one. No card in the set says otherwise, so there
 * is no cards-only option to get wrong.
 *
 * An upgrade on a base (Fortify) is an upgrade too, named by the host `baseHostId(owner)`, so it is
 * offered unless the text says where the upgrade is: `on: 'unit'` for "an upgrade on a unit" or
 * "attached to a unit", `on: 'base'` for "an upgrade on a base". `hostController` names a unit's
 * controller, so it takes units only.
 */
interface UpgradeFilter {
  /** The player who played the upgrade. */
  owner?: PlayerId
  /** The controller of the unit the upgrade is attached to. */
  hostController?: PlayerId
  /** Printed cost cap. Tokens are cost 0, so they always satisfy one. */
  maxCost?: number
  /** Only upgrades on a unit, or only those on a base. Omitted, both. */
  on?: 'unit' | 'base'
}

const upgradeCandidates = (s: GameState, filter: UpgradeFilter = {}): UpgradeRef[] => {
  const out: UpgradeRef[] = []
  const add = (hostId: string, ups: readonly UpgradeAttachment[]) => ups.forEach((up, i) => {
    if (filter.owner !== undefined && up.owner !== filter.owner) return
    const c = s.cards[up.cardId]
    if (filter.maxCost !== undefined && (c?.cost ?? 0) > filter.maxCost) return
    out.push({ unitId: hostId, upgradeIndex: i, cardId: up.cardId })
  })
  const units = filter.on !== 'base'
  const bases = filter.on !== 'unit' && filter.hostController === undefined
  for (const side of ['player', 'opponent'] as PlayerId[]) {
    if (units && (filter.hostController === undefined || side === filter.hostController)) {
      for (const u of s.players[side].units) add(u.instanceId, u.upgrades)
    }
    if (bases) add(baseHostId(side), s.players[side].base.upgrades ?? [])
  }
  return out
}

/** "A friendly upgrade": every upgrade the player OWNS, card upgrades and tokens alike, on a unit or a base. */
const friendlyUpgradeCandidates = (s: GameState, owner: PlayerId, on?: 'unit'): UpgradeRef[] =>
  upgradeCandidates(s, { owner, on })

const BOTH_BASES: PlayerId[] = ['player', 'opponent']

registerCard('ASH_012', { // Vane — front (undeployed) + deployed (On Attack)
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

registerCard('ASH_001', { // The Armorer — play an upgrade from your resources, then resource the top of your deck
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
// Imperial unit in your discard pile has it, this unit gains it too.
const MOFF_KEYWORDS = ['Ambush', 'Grit', 'Hidden', 'Overwhelm', 'Saboteur', 'Sentinel', 'Shielded', 'Support']
const cardHasKeyword = (c: EngineCard | undefined, name: string): boolean => (c?.keywords ?? []).some(k => k.name === name)
const isImperialUnitCard = (c: EngineCard | undefined): boolean =>
  c?.type === 'unit' && (c.traits ?? []).some(t => t.toLowerCase() === 'imperial')

registerCard('ASH_008', { // Moff Gideon — front: play a unit costing 1 less if a friendly Imperial died this phase
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

registerCard('ASH_002', { // Fennec Shand — front leader action; deployed unit action (Saboteur from card data)
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

registerCard('ASH_006', { // Sabine Wren — front: opponent gives 2 Advantage, grant Shielded; back: On Attack grant Shielded
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

registerCard('ASH_005', { // Luke Skywalker — front/back heal on a friendly attack ending
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

// "When you play or create a unit" is one ability on two trigger points.
const onPlayOrCreate = (ability: Omit<AbilityDef, 'trigger'>): AbilityDef[] =>
  (['whenPlayUnit', 'whenCreateUnit'] as const).map(trigger => ({ ...ability, trigger }))

registerCard('ASH_017', { // Greef Karga — front (undeployed, optional) + deployed (mandatory)
  leaderAbilities: {
    abilities: onPlayOrCreate({
      description: 'You may exhaust this leader to give that unit an Advantage token.',
      effect: (s, ctx) =>
        s.players[ctx.owner].leader.exhausted
          ? s
          : pushChoice(s, { kind: 'mayExhaustLeaderForAdvantage', id: ctx.targetInstanceId!, controller: ctx.owner, unitId: ctx.targetInstanceId! }),
    }),
  },
  abilities: onPlayOrCreate({
    description: 'Give that unit an Advantage token.',
    effect: (s, ctx) => giveToken(s, ctx.targetInstanceId!, TOKEN_ADVANTAGE),
  }),
})

const controlsUnitInEachArena = (s: GameState, owner: PlayerId): boolean =>
  s.players[owner].units.some(u => u.arena === 'ground') && s.players[owner].units.some(u => u.arena === 'space')

registerCard('ASH_010', { // Bo-Katan Kryze — front/back create a Mandalorian token + deploy gate + aura
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
  // Deployed: other friendly Mandalorian units get +1/+0.
  aura: (s, src, tgt, friendly) => (friendly && tgt.instanceId !== src.instanceId && unitHasTrait(s, tgt, 'Mandalorian') ? { power: 1 } : undefined),
})

/**
 * Whether any ready unit could legally attack something. The gate on every ability that grants a
 * MANDATORY attack: their choice has no decline, so raising one with nothing to attack would leave
 * the player no legal move at all.
 */
const canAnyUnitAttack = (s: GameState, owner: PlayerId): boolean =>
  s.players[owner].units.some(u => eligibleAttacker(s, u) && canAttackSomething(s, u))

registerCard('ASH_004', { // Grand Admiral Thrawn — front attack + conditional Restore; deployed On Attack conditional defeat
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
      return targets.length === 0 ? s : pushChoice(s, { kind: 'selectUnitToDefeat', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, optional: true })
    },
  }],
})

registerCard('ASH_018', { // Grogu — triggered deploy on a Unique 4+ unit; combat-conditional aura
  deployCondition: () => false, // never deploys via the normal epic action — only via the trigger below
  leaderAbilities: {
    abilities: [{
      trigger: 'whenPlayUnit',
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
registerCard('ASH_007', { // Grand Admiral Sloane — front Choose One arena buff + deployed aura
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
  // Deployed: each other friendly unit gains Overwhelm and Sentinel.
  aura: (_s, src, tgt, friendly) => (friendly && tgt.instanceId !== src.instanceId ? { keywords: [{ name: 'Overwhelm' }, { name: 'Sentinel' }] } : undefined),
})

// A friendly NON-leader unit that is the only non-leader unit you control in its arena
// (Baylan's condition). The front says "the only unit", the deployed back "the only non-leader
// unit" — but the front is used while undeployed (no leader unit is on the board), so the
// non-leader test is equivalent there and correct for both. `isLeaderUnit` also excludes a unit
// made a leader by The Darksaber.
const soleNonLeaderInArena = (s: GameState, owner: PlayerId, u: UnitState): boolean =>
  !isLeaderUnit(s, u) && s.players[owner].units.filter(x => x.arena === u.arena && !isLeaderUnit(s, x)).length === 1

const baylanTargets = (s: GameState, owner: PlayerId): string[] =>
  s.players[owner].units.filter(u => soleNonLeaderInArena(s, owner, u)).map(u => u.instanceId)

registerCard('ASH_003', { // Baylan Skoll — front +2/+2 this phase to a lone unit; deployed On Attack +2/+2 & Sentinel
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
      return targets.length === 0 ? s : pushChoice(s, { kind: 'mayLastingBuff', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, power: 2, hp: 2, keywords: [{ name: 'Sentinel' }], optional: true })
    },
  }],
})

registerCard('ASH_009', { // Ahsoka Tano — front +2/+0 to a unit weaker than a friendly one; deployed On Attack +2/+0
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
      return targets.length === 0 ? s : pushChoice(s, { kind: 'mayLastingBuff', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, power: 2, hp: 0, optional: true })
    },
  }],
})

// Units other than the just-ended attacker — Ezra's "a different unit".
const unitsOtherThanAttacker = (s: GameState, attackerId?: string): string[] =>
  allUnits(s).filter(u => u.instanceId !== attackerId).map(u => u.instanceId)

registerCard('ASH_013', { // Ezra Bridger — on a friendly 3+ base hit, Advantage to a different unit
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

// Ready units cheaper than the base damage dealt this attack — Shin Hati's targets.
const cheaperReadyUnits = (s: GameState, dmg: number): string[] =>
  allUnits(s).filter(u => !u.exhausted && (s.cards[u.cardId]?.cost ?? 0) < dmg).map(u => u.instanceId)

const SHIN_ROUND_KEY = 'ASH_016#friendlyAttackEnd' // deployed Shin's "once each round" marker

registerCard('ASH_016', { // Shin Hati — on a friendly base hit, exhaust a cheaper unit
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
      return targets.length === 0 ? s : pushChoice(s, { kind: 'mayExhaustUnit', id: `${ctx.cardId}-attackEnd`, controller: ctx.owner, targets, optional: true, markUsed: { instanceId: ctx.sourceInstanceId!, key: SHIN_ROUND_KEY } })
    },
  }],
})

// ── Units ─────────────────────────────────────────────────────────────
// Conditional self keyword grants — "While <condition>, this unit gains <keyword>".
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

// Conditional stat buffs — "While <condition>, this unit gets +X/+Y" via statModifier.
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

// Conditional keyword swap. Marrok's Sentinel is his base keyword; while upgraded he
// loses it (suppressedKeywords) and gains Saboteur (conditionalKeywords).
const isUpgraded = (u: UnitState): boolean => u.upgrades.length > 0
registerCard('ASH_030', { // Marrok
  conditionalKeywords: (_s, u) => (isUpgraded(u) ? [{ name: 'Saboteur' }] : []),
  suppressedKeywords: (_s, u) => (isUpgraded(u) ? ['Sentinel'] : []),
})

// Constant effects on OTHER units — the `aura` hook, including keyword removal.
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

// ── Units — "When Played" effects ──────────────────────────────
const whenPlayed = (description: string, effect: (s: GameState, ctx: { owner: PlayerId; cardId: string; sourceInstanceId?: string }) => GameState) => ({
  abilities: [{ trigger: 'whenPlayed' as const, description, effect }],
})

/** whenDefeated ability. `ctx.defeatedUnit` is the unit captured at the moment of defeat
 *  (it has already left play) — use it for its power/upgrades or as a stable choice id. */
const whenDefeated = (description: string, effect: (s: GameState, ctx: { owner: PlayerId; sourceInstanceId?: string; defeatedUnit?: UnitState; defeatedByCombat?: boolean }) => GameState) => ({
  abilities: [{ trigger: 'whenDefeated' as const, description, effect }],
})

// Self / no-target effects.
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

// Single-target "When Played" effects (reuse mayDamage / mayGiveTokens / mayExhaustUnit /
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
  return targets.length ? pushChoice(s, { kind: 'mayExhaustUnit', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, optional: true }) : s
}))
registerCard('ASH_214', whenPlayed('You may exhaust a unit with one or more keywords.', (s, ctx) => { // Amnesty Officer
  const targets = allUnits(s).filter(u => unitKeywords(s, u).length > 0).map(u => u.instanceId)
  return targets.length ? pushChoice(s, { kind: 'mayExhaustUnit', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, optional: true }) : s
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

// Multi-step "When Played" effects (self-damage sequences, area damage, damage-then-reward).
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

// "Next unit you play this phase" grants, with filters.
registerCard('ASH_237', whenPlayed('The next Imperial unit you play this phase costs 1 less.', (s, ctx) => grantNextUnit(s, ctx.owner, { costDelta: -1, trait: 'Imperial' }))) // Mouse Droid
registerCard('ASH_248', { // Neel — the next ≤1-power unit you play this phase enters play ready
  abilities: [
    { trigger: 'whenPlayed', description: 'The next unit you play this phase with 1 or less power enters play ready.', effect: (s, ctx) => grantNextUnit(s, ctx.owner, { entersReady: true, maxPower: 1 }) },
    { trigger: 'onAttack', description: 'The next unit you play this phase with 1 or less power enters play ready.', effect: (s, ctx) => grantNextUnit(s, ctx.owner, { entersReady: true, maxPower: 1 }) },
  ],
})

// Repeatable multi-target picks.
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

/** Number of arenas (ground/space) in which `owner` controls strictly more units than the opponent (Crix Madine). */
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
  const revealed = s.players[owner].deck.slice(0, searchCount(s, owner, 5))
  const myTraits = new Set(s.players[owner].units.flatMap(u => unitTraits(s, u).map(t => t.toLowerCase())))
  const eligibleIndices = revealed.flatMap((cardId, i) => (s.cards[cardId]?.traits.some(t => myTraits.has(t.toLowerCase())) ? [i] : []))
  // Reveal even with no trait match (#413): acknowledging bottoms them all and draws nothing, but
  // the player gets to see which five went to the bottom. Only an empty deck reveals nothing.
  if (revealed.length === 0) return s
  return pushChoice(s, { kind: 'searchDraw', id: ctx.sourceInstanceId!, controller: owner, revealed, eligibleIndices })
}))

// ── When Defeated ────────────────────────────────────────────────────
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
  return power > 0 && targets.length ? pushChoice(s, { kind: 'distributeTokens', id: ctx.sourceInstanceId!, controller: ctx.owner, token: TOKEN_ADVANTAGE, remaining: power, total: power, targets, optional: true }) : s
}))

registerCard('ASH_043', { // Corona Four — On Attack debuff + When Defeated defeat a 0-power unit
  abilities: [
    {
      trigger: 'onAttack',
      description: 'You may give a unit -2/-0 for this phase.',
      effect: (s, ctx) => {
        const targets = allUnits(s).map(u => u.instanceId)
        return targets.length ? pushChoice(s, { kind: 'mayLastingBuff', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, power: -2, hp: 0, optional: true }) : s
      },
    },
    {
      trigger: 'whenDefeated',
      description: 'You may defeat a non-leader unit with 0 power.',
      effect: (s, ctx) => {
        const targets = allUnits(s).filter(u => !isLeaderUnit(s, u) && effectivePower(s, u) === 0).map(u => u.instanceId)
        return targets.length ? pushChoice(s, { kind: 'selectUnitToDefeat', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, optional: true }) : s
      },
    },
  ],
})

// "An upgrade": every upgrade in play, either side, tokens included (Clan Vizsla Soldier).
const allUpgradeCandidates = (s: GameState): UpgradeRef[] => upgradeCandidates(s)

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
  return targets.length ? pushChoice(s, { kind: 'returnFriendlyUnit', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, optional: true, then: 'damageEqualToCost' }) : s
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

// ── On Attack ────────────────────────────────────────────────────────
registerCard('ASH_157', { abilities: [{ trigger: 'onAttack', description: 'You may give an Advantage token to another unit.', effect: (s, ctx) => { // Danger Squadron Wingmen
  const targets = allUnits(s).filter(u => u.instanceId !== ctx.sourceInstanceId).map(u => u.instanceId)
  return targets.length ? pushChoice(s, { kind: 'mayGiveTokens', id: ctx.sourceInstanceId!, controller: ctx.owner, token: TOKEN_ADVANTAGE, count: 1, targets, optional: true }) : s
} }] })

registerCard('ASH_189', { abilities: [{ trigger: 'onAttack', description: 'Ready a resource.', effect: (s, ctx) => readyResource(s, ctx.owner) }] }) // Emperor's Messenger

registerCard('ASH_056', { abilities: [{ trigger: 'onAttack', description: 'You may give an upgraded unit -4/-0 for this phase.', effect: (s, ctx) => { // Huyang
  const targets = allUnits(s).filter(u => u.upgrades.length > 0).map(u => u.instanceId)
  return targets.length ? pushChoice(s, { kind: 'mayLastingBuff', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, power: -4, hp: 0, optional: true }) : s
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

// ── On Attack — conditional on the board or on this unit ─────────────
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
  return targets.length ? pushChoice(s, { kind: 'mayLastingBuff', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, power: -3, hp: 0, optional: true }) : s
} }] })

registerCard('ASH_253', { abilities: [{ trigger: 'onAttack', description: 'If this unit is upgraded, deal 2 damage to a base.', effect: (s, ctx) => { // Yellow Aces Bomber
  const u = allUnits(s).find(x => x.instanceId === ctx.sourceInstanceId)
  if (!u || !isUpgraded(u)) return s
  return pushChoice(s, { kind: 'selectDamageTarget', id: ctx.sourceInstanceId!, controller: ctx.owner, amount: 2, unitTargets: [], baseTargets: ['player', 'opponent'] })
} }] })

// ── On Attack — paying a cost of your own ────────────────────────────
registerCard('ASH_059', { abilities: [{ trigger: 'onAttack', description: 'You may deal 1 damage to this unit. If you do, heal 2 damage from your base.', effect: (s, ctx) => // Leia Organa
  pushChoice(s, { kind: 'maySelfDamageHealBase', id: ctx.sourceInstanceId!, controller: ctx.owner, unitId: ctx.sourceInstanceId!, selfDamage: 1, healBase: 2 }) }] })

registerCard('ASH_172', { abilities: [{ trigger: 'onAttack', description: 'You may discard a card from your hand. If you do, this unit gets +2/+0 for this attack.', effect: (s, ctx) => // Razor Crest
  s.players[ctx.owner].hand.length > 0 ? pushChoice(s, { kind: 'selectDiscard', id: ctx.sourceInstanceId!, controller: ctx.owner, count: 1, optional: true, then: { buffUnit: ctx.sourceInstanceId!, power: 2, hp: 0 } }) : s }] })

registerCard('ASH_203', { abilities: [{ trigger: 'onAttack', description: 'You may exhaust a friendly leader. If you do, this unit gets +2/+0 for this attack.', effect: (s, ctx) => // Mando's N-1 Starfighter
  // `leaderCanExhaust`, not the base-zone flag: this is a UNIT ability, so unlike the four
  // leader-front costs it can fire while its controller's leader is deployed (#577).
  leaderCanExhaust(s, ctx.owner) ? pushChoice(s, { kind: 'mayExhaustLeaderBuffSelf', id: ctx.sourceInstanceId!, controller: ctx.owner, unitId: ctx.sourceInstanceId!, power: 2, hp: 0 }) : s }] })

// ── When Attack Ends ─────────────────────────────────────────────────
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

// ── Multi-trigger On Attack, and activated action abilities ──────────
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

// ── Combat-role and static stat modifiers ────────────────────────────
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

// ── Reactions to unit defeat, base attacks, and upgrades attaching ───
// The Twins (127): a Sentinel grant on play/attack, plus a base heal whenever another friendly dies.
const twinsGrantSentinel = (s: GameState, ctx: { owner: PlayerId; sourceInstanceId?: string }): GameState => {
  const targets = s.players[ctx.owner].units.filter(u => u.instanceId !== ctx.sourceInstanceId).map(u => u.instanceId)
  return targets.length ? pushChoice(s, { kind: 'mayLastingBuff', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, keywords: [{ name: 'Sentinel' }], optional: true }) : s
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
  return targets.length ? pushChoice(s, { kind: 'mayExhaustUnit', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, optional: true }) : s
} }] })

// ── Once-per-phase cost reductions ───────────────────────────────────
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

// ── Targeting rules — what may attack, and what may be attacked ──────
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

// ── HP-reduction defeats (state-based and combat-only) ───────────────
registerCard('ASH_050', whenDefeated('You may give a unit -2/-2 for this phase.', (s, ctx) => { // Morgan Elsbeth
  const targets = allUnits(s).map(u => u.instanceId)
  return targets.length ? pushChoice(s, { kind: 'mayLastingBuff', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, power: -2, hp: -2, optional: true }) : s
}))

// Scion Shuttle (046): while it attacks, the DEFENDING unit gets -1/-1 — a combat-conditional aura.
registerCard('ASH_046', {
  aura: (_s, source, target, _sameController, combat) =>
    combat && combat.attackerInstanceId === source.instanceId && combat.defenderInstanceId === target.instanceId
      ? { power: -1, hp: -1 }
      : undefined,
})

// ── Damage prevention and token-creation replacement ─────────────────
// At Attin Safety Droid (070): "if your base would be dealt more than 4 damage, prevent all but 4".
registerCard('ASH_070', { preventBaseDamage: (_s, _source, amount) => Math.min(amount, 4) })

// Moff Jerjerrod (094): "if you would create a number of tokens, you may defeat this unit to create
// twice that number instead" — offered by `createTokenUnits` as a top-up (see its note).
registerCard('ASH_094', { doublesTokenCreation: () => true })

// ── Reactions to units entering play, and to friendly attacks ────────
registerCard('ASH_144', { abilities: [{ trigger: 'whenFriendlyAttackEnds', description: "If the attack dealt combat damage to a base, give an Advantage token to this unit.", effect: (s, ctx) => // Vane's Snub Fighter
  (ctx.combatDamageToBase ?? 0) > 0 ? giveToken(s, ctx.sourceInstanceId!, TOKEN_ADVANTAGE) : s }] })

registerCard('ASH_041', { // Outcast — "when a friendly unit enters play (including this one)"
  abilities: [
    // Played and created units both enter play. Those trigger points fire on the controller's OTHER
    // units, so the "including this one" half is covered by its own whenPlayed.
    { trigger: 'whenPlayed', description: 'This unit gets +1/+0 for this phase.', effect: (s, ctx) => addLastingEffect(s, { targetInstanceId: ctx.sourceInstanceId!, power: 1 }) },
    ...onPlayOrCreate({ description: 'A friendly unit entering play gets +1/+0 for this phase.', effect: (s, ctx) => ctx.targetInstanceId ? addLastingEffect(s, { targetInstanceId: ctx.targetInstanceId, power: 1 }) : s }),
  ],
})

registerCard('ASH_102', { abilities: [{ trigger: 'whenPlayUnit', description: 'You may have the entering unit deal damage equal to its power to a unit in the same arena.', effect: (s, ctx) => { // Ravager
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

// ── Units needing a chained follow-up choice or a real "[Exhaust]" action cost ──────────

registerCard('ASH_171', whenPlayed('You may defeat a friendly upgrade. If you do, ready this unit.', (s, ctx) => { // Pegasus Tri-Wing
  const candidates = friendlyUpgradeCandidates(s, ctx.owner)
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
    trigger: 'whenPlayUnit',
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
    // "You **may** attack": the only user of this choice that can be declined.
    effect: (s, ctx) => (canAnyUnitAttack(s, ctx.owner)
      ? pushChoice(s, { kind: 'mayAttackAnyUnit', id: `${ctx.sourceInstanceId}-attack`, controller: ctx.owner, restore: 0, optional: true })
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
      const revealed = s.players[ctx.owner].deck.slice(0, searchCount(s, ctx.owner, 8))
      const eligibleIndices = revealed.flatMap((cardId, i) => {
        const c = s.cards[cardId]
        return c?.type === 'unit' && c.cost <= budget ? [i] : []
      })
      // Pull the searched window OUT of the deck, as Ackbar's search does: `searchPlayFree` both
      // bottoms its leftovers and returns them on a pass, so leaving them in place duplicated them.
      // Reveal even when nothing is playable (#413), so the player sees what they looked at.
      const pulled = updatePlayer(s, ctx.owner, { deck: s.players[ctx.owner].deck.slice(revealed.length) })
      return pushChoice(pulled, {
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

// ── Reactions to draws, base damage, and upgrade defeats ──────────────────────────────────

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
        next = pushChoice(next, { kind: 'mayExhaustUnit', id: `${ctx.sourceInstanceId}-exh`, controller: ctx.owner, targets, optional: true })
      }
      return next
    },
  })),
})

registerCard('ASH_202', { dealsDamageFirst: () => true }) // Carson Teva — deals combat damage before the defender

registerCard('ASH_207', { // Heroic Purrgil — +2/+0 while attacking using Ambush
  statModifier: (_s, _u, ctx) => (ctx.attacking && ctx.viaAmbush ? { power: 2 } : {}),
})

// ── Multi-step choice chains ──────────────────────────────────────────────────────────────

registerCard('ASH_052', { // Chimaera
  abilities: [
    { trigger: 'whenPlayed', description: 'You may choose a friendly unit and an enemy non-leader unit. If you do, defeat those units.', effect: (s, ctx) => {
      const friendlyTargets = s.players[ctx.owner].units.map(u => u.instanceId)
      const enemyTargets = s.players[opponentOf(ctx.owner)].units.filter(u => !u.isLeader).map(u => u.instanceId)
      return friendlyTargets.length && enemyTargets.length
        ? pushChoice(s, { kind: 'selectPair', id: ctx.sourceInstanceId!, controller: ctx.owner, friendlyTargets, enemyTargets, mode: 'defeat', optional: true })
        : s
    } },
    { trigger: 'whenEnemyUnitDefeated', description: 'Heal 2 damage from your base.', effect: (s, ctx) => healBase(s, ctx.owner, 2) },
  ],
})

registerCard('ASH_042', { // Jabba the Hutt
  abilities: [{ trigger: 'whenPlayed', description: "You may return an upgrade to its owner's hand. If it's returned to your hand, you may play it for free.", effect: (s, ctx) => {
    // "An upgrade": either side, tokens included. A token has no card to put in a hand, so
    // returning one defeats it instead (see `returnUpgradeToHand`), which is a legal and useful
    // play against an enemy Shield.
    const candidates = upgradeCandidates(s)
    return candidates.length ? pushChoice(s, { kind: 'selectUpgradeToReturn', id: ctx.sourceInstanceId!, controller: ctx.owner, candidates, optional: true, replayFree: true }) : s
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

// ── Action-ability costs, regroup-phase choices, token suppression ────────────────────────

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

// ── Aura-granted abilities, capture, and searching an opponent's deck ───────────────────

/**
 * Not a real card — a carrier for the ability Bo-Katan's Gauntlet lends to other units. Deliberately
 * NOT `ASH_`-prefixed: the manifest drift test treats every registered ASH id as an implemented card.
 */
const GRANT_MANDO_ON_DEFEAT = 'GRANT_MANDO_ON_DEFEAT'
registerCard(GRANT_MANDO_ON_DEFEAT, {
  sourceCardId: 'ASH_063', // Bo-Katan's Gauntlet
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
        upTo: true,
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

registerCard('ASH_062', { // The Mandalorian
  // "If damage would be dealt to another friendly unit, you may defeat a Shield token on this unit.
  // If you do, prevent that damage." Offered per instance of damage, for as long as it holds Shields.
  canPreventDamage: (_s, self, target) => target.instanceId !== self.instanceId && hasToken(self.upgrades, TOKEN_SHIELD),
  payPreventionCost: (s, self) => defeatUpgrade(s, self.instanceId, TOKEN_SHIELD),
})

// ── Events ────────────────────────────────────────────────────────────────────────────────────
// An event's effect is its `whenPlayed`: the resolver pays the cost, puts the card in the discard,
// then fires this. `ctx.sourceInstanceId` is a synthetic id (no unit is in play), unique per play,
// so it is safe to use as a pending-choice id but will never resolve to a unit.

registerCard('ASH_140', whenPlayed('Create 2 Mandalorian tokens.', (s, ctx) => // Stronger Together
  createTokenUnits(s, ctx.owner, TOKEN_MANDALORIAN, 2)))

registerCard('ASH_185', whenPlayed('If you control a unit with 4 or more power, draw 2 cards.', (s, ctx) => // Intimidation
  s.players[ctx.owner].units.some(u => effectivePower(s, u) >= 4) ? drawCards(s, ctx.owner, 2) : s))

registerCard('ASH_258', whenPlayed('Deal 3 damage to a unit. Heal 3 damage from your base.', (s, ctx) => { // Grassroots Resistance
  // Both sentences resolve, in the order printed: the heal rides on the damage choice so the target
  // is picked first, and happens on its own when there is no unit to damage.
  const targets = allUnits(s).map(u => u.instanceId)
  return targets.length
    ? pushChoice(s, { kind: 'selectDamageTarget', id: ctx.sourceInstanceId!, controller: ctx.owner, amount: 3, unitTargets: targets, baseTargets: [], thenHealBase: 3 })
    : healBase(s, ctx.owner, 3)
}))

registerCard('ASH_136', whenPlayed('Give a unit +3/+3 for this phase.', (s, ctx) => { // Display of Strength
  const targets = allUnits(s).map(u => u.instanceId)
  return targets.length
    ? pushChoice(s, { kind: 'mayLastingBuff', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, power: 3, hp: 3 })
    : s
}))

registerCard('ASH_151', whenPlayed('Deal 5 damage to your base. Then, deal 5 damage to each unit.', (s, ctx) => { // Operation Cinder
  const next = dealDamageToBase(s, ctx.owner, 5)
  return allUnits(next).map(u => u.instanceId).reduce((acc, id) => dealDamageToUnit(acc, id, 5), next)
}))

registerCard('ASH_187', whenPlayed('Deal damage to a unit equal to the total damage on all units you control.', (s, ctx) => { // Reckoning
  const amount = s.players[ctx.owner].units.reduce((n, u) => n + u.damage, 0)
  const targets = allUnits(s).map(u => u.instanceId)
  return amount > 0 && targets.length
    ? pushChoice(s, { kind: 'selectDamageTarget', id: ctx.sourceInstanceId!, controller: ctx.owner, amount, unitTargets: targets, baseTargets: [] })
    : s
}))

registerCard('ASH_138', whenPlayed('Choose a unit. Deal 1 damage to it for each friendly unit.', (s, ctx) => { // Turning the Tide
  const amount = s.players[ctx.owner].units.length
  const targets = allUnits(s).map(u => u.instanceId)
  return amount > 0 && targets.length
    ? pushChoice(s, { kind: 'selectDamageTarget', id: ctx.sourceInstanceId!, controller: ctx.owner, amount, unitTargets: targets, baseTargets: [] })
    : s
}))

registerCard('ASH_264', whenPlayed('Give an Advantage token to each of up to 2 units.', (s, ctx) => { // A New Order
  const targets = allUnits(s).map(u => u.instanceId)
  return targets.length
    ? pushChoice(s, { kind: 'multiPick', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, spec: { mode: 'giveAdvantage', remaining: 2 } })
    : s
}))

registerCard('ASH_067', whenPlayed('Defeat an upgraded non-leader unit.', (s, ctx) => { // Get Lost
  const targets = allUnits(s).filter(u => !u.isLeader && u.upgrades.length > 0).map(u => u.instanceId)
  return targets.length ? pushChoice(s, { kind: 'selectUnitToDefeat', id: ctx.sourceInstanceId!, controller: ctx.owner, targets }) : s
}))

registerCard('ASH_092', whenPlayed('You may defeat a unit with 2 or less remaining HP. Create a Mandalorian token.', (s, ctx) => { // Foundling Rescue
  // Eligible units are read BEFORE the token is created: the defeat happens first on the card, so
  // the new token (1 HP) must not be a legal target for it. Creating the token up front regardless
  // is otherwise equivalent, and means it lands whether or not the optional defeat is taken.
  const targets = allUnits(s).filter(u => effectiveHp(s, u) - u.damage <= 2).map(u => u.instanceId)
  const next = createTokenUnit(s, ctx.owner, TOKEN_MANDALORIAN)
  return targets.length ? pushChoice(next, { kind: 'selectUnitToDefeat', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, optional: true }) : next
}))

registerCard('ASH_091', whenPlayed('Create a Mandalorian token and give it Sentinel for this phase.', (s, ctx) => { // Buy Time
  // createTokenUnit assigns the next instance id, so the token it makes is knowable up front.
  const tokenId = `u${s.instanceCounter}`
  return addLastingEffect(createTokenUnit(s, ctx.owner, TOKEN_MANDALORIAN), { targetInstanceId: tokenId, keywords: [{ name: 'Sentinel' }] })
}))

registerCard('ASH_103', whenPlayed('Defeat a friendly Imperial unit. If you do, resource the top card of your deck.', (s, ctx) => { // Long Live the Empire
  const targets = s.players[ctx.owner].units.filter(u => unitHasTrait(s, u, 'Imperial')).map(u => u.instanceId)
  return targets.length
    ? pushChoice(s, { kind: 'selectUnitToDefeat', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, thenResource: true })
    : s
}))

registerCard('ASH_246', whenPlayed('Defeat a friendly upgrade. If you do, draw 2 cards.', (s, ctx) => { // Exploit Advantage
  const candidates = friendlyUpgradeCandidates(s, ctx.owner)
  return candidates.length
    ? pushChoice(s, { kind: 'selectUpgradeToDefeat', id: ctx.sourceInstanceId!, controller: ctx.owner, candidates, optional: true, thenDraw: 2 })
    : s
}))

registerCard('ASH_089', whenPlayed('Heal 3 damage from a unit and give a Shield token to it.', (s, ctx) => { // Perserverance
  const unitTargets = allUnits(s).map(u => u.instanceId)
  return unitTargets.length
    ? pushChoice(s, { kind: 'selectHealTarget', id: ctx.sourceInstanceId!, controller: ctx.owner, amount: 3, unitTargets, baseTargets: [], thenShield: true })
    : s
}))

registerCard('ASH_233', whenPlayed('Exhaust up to 2 units that each cost 3 or less.', (s, ctx) => { // Keep Them Talking
  const targets = allUnits(s).filter(u => (s.cards[u.cardId]?.cost ?? 0) <= 3).map(u => u.instanceId)
  return targets.length
    ? pushChoice(s, { kind: 'multiPick', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, spec: { mode: 'exhaust', remaining: 2 } })
    : s
}))

registerCard('ASH_236', whenPlayed("Return a friendly non-leader unit to its owner's hand. If you do, return an enemy non-leader unit to its owner's hand.", (s, ctx) => { // Far Far Away
  const targets = s.players[ctx.owner].units.filter(u => !u.isLeader).map(u => u.instanceId)
  return targets.length
    ? pushChoice(s, { kind: 'returnFriendlyUnit', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, then: 'returnEnemyUnit' })
    : s
}))

registerCard('ASH_232', whenPlayed("Return an upgrade that costs 2 or less to its owner's hand. Give a Shield token to a unit.", (s, ctx) => { // Full of Surprises
  // "An upgrade that costs 2 or less": either side, and tokens qualify at cost 0. A token cannot go
  // to a hand, so returning one defeats it instead (see `returnUpgradeToHand`).
  const candidates = upgradeCandidates(s, { maxCost: 2 })
  return candidates.length
    ? pushChoice(s, { kind: 'selectUpgradeToReturn', id: ctx.sourceInstanceId!, controller: ctx.owner, candidates, thenShield: true })
    : s
}))

registerCard('ASH_115', whenPlayed('Give a friendly unit +1/+0 for this phase for each other friendly unit with less power than it.', (s, ctx) => { // The Student Guides the Master
  const targets = s.players[ctx.owner].units.map(u => u.instanceId)
  return targets.length
    ? pushChoice(s, { kind: 'mayLastingBuff', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, powerPerWeakerFriendly: true })
    : s
}))

registerCard('ASH_139', whenPlayed('Choose a friendly unit. That unit deals damage equal to its power divided as you choose among any number of units in its arena.', (s, ctx) => { // Hold Them Off
  const targets = s.players[ctx.owner].units.filter(u => effectivePower(s, u) > 0).map(u => u.instanceId)
  return targets.length
    ? pushChoice(s, { kind: 'selectDistributeSource', id: ctx.sourceInstanceId!, controller: ctx.owner, targets })
    : s
}))

registerCard('ASH_163', whenPlayed('Discard a unit from your hand. Deal 5 damage to a unit that costs more than the discarded card.', (s, ctx) => { // Reckless Sacrifice
  const hasUnit = s.players[ctx.owner].hand.some(id => s.cards[id]?.type === 'unit')
  return hasUnit
    ? pushChoice(s, { kind: 'selectDiscard', id: ctx.sourceInstanceId!, controller: ctx.owner, count: 1, optional: false, then: { dealDamage: 5, costlierThanDiscard: true } })
    : s
}))

registerCard('ASH_188', whenPlayed('Ready a unit that was damaged this phase.', (s, ctx) => { // Galvanized Leap
  const damaged = new Set(damagedThisPhase(s))
  const targets = allUnits(s).filter(u => damaged.has(u.instanceId)).map(u => u.instanceId)
  return targets.length ? pushChoice(s, { kind: 'selectUnitToReady', id: ctx.sourceInstanceId!, controller: ctx.owner, targets }) : s
}))

registerCard('ASH_211', whenPlayed('If a friendly unit left play this phase, distribute 3 Advantage tokens among friendly units. If a friendly leader unit left play this phase, distribute 5 instead.', (s, ctx) => { // Fateful Goodbye
  if (leftPlayThisPhase(s, ctx.owner).length === 0) return s
  const total = leaderLeftPlayThisPhase(s, ctx.owner) ? 5 : 3
  const targets = s.players[ctx.owner].units.map(u => u.instanceId)
  return targets.length
    ? pushChoice(s, { kind: 'distributeTokens', id: ctx.sourceInstanceId!, controller: ctx.owner, token: TOKEN_ADVANTAGE, remaining: total, total, targets })
    : s
}))

registerCard('ASH_231', whenPlayed('Exhaust a friendly unit and an enemy unit. If you do, give 2 Advantage tokens to a friendly unit.', (s, ctx) => { // Diplomatic Pageantry
  const friendlyTargets = s.players[ctx.owner].units.map(u => u.instanceId)
  const enemyTargets = s.players[opponentOf(ctx.owner)].units.map(u => u.instanceId)
  return friendlyTargets.length && enemyTargets.length
    ? pushChoice(s, { kind: 'selectPair', id: ctx.sourceInstanceId!, controller: ctx.owner, friendlyTargets, enemyTargets, mode: 'exhaust', thenAdvantage: 2 })
    : s
}))

registerCard('ASH_247', whenPlayed('Defeat a friendly non-leader unit. Then, you may play that unit from your discard pile for free.', (s, ctx) => { // One Must Destroy to Create
  const targets = s.players[ctx.owner].units.filter(u => !u.isLeader && !isTokenCard(u.cardId)).map(u => u.instanceId)
  return targets.length
    ? pushChoice(s, { kind: 'selectUnitToDefeat', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, thenReplayFromDiscard: true })
    : s
}))

registerCard('ASH_104', { // Dathomiri Magicks
  costModifier: (s, playerId) => (s.players[playerId].units.some(u => unitHasTrait(s, u, 'Force')) ? -1 : 0),
  abilities: [{
    trigger: 'whenPlayed',
    description: 'Play up to 3 non-Vehicle units that each cost 2 or less from your discard pile for free.',
    effect: (s, ctx) => {
      const candidates = discardUnitsMatching(s, ctx.owner, 2, 'Vehicle')
      return candidates.length
        ? pushChoice(s, { kind: 'mayPlayUnitFromDiscard', id: ctx.sourceInstanceId!, controller: ctx.owner, candidates, remaining: 3, maxCost: 2, excludeTrait: 'Vehicle' })
        : s
    },
  }],
})

registerCard('ASH_257', whenPlayed('Choose one: if you control a Force unit, heal 5 damage from your base; if you control a Mandalorian unit, create a Mandalorian token and give an Advantage token to it.', (s, ctx) => { // Choose Your Path
  // Only modes whose condition currently holds are offered — picking an option that would do
  // nothing isn't a meaningful choice.
  const modes: string[] = []
  if (s.players[ctx.owner].units.some(u => unitHasTrait(s, u, 'Force'))) modes.push('healBase')
  if (s.players[ctx.owner].units.some(u => unitHasTrait(s, u, 'Mandalorian'))) modes.push('mandoToken')
  return modes.length ? pushChoice(s, { kind: 'chooseMode', id: ctx.sourceInstanceId!, controller: ctx.owner, modes }) : s
}))

registerCard('ASH_200', whenPlayed('Choose a non-leader unit. Give that unit -3/-0 for this phase, then take control of it. At the start of the regroup phase, its owner takes control of it.', (s, ctx) => { // Rehabilitation
  const targets = s.players[opponentOf(ctx.owner)].units.filter(u => !u.isLeader).map(u => u.instanceId)
  return targets.length
    ? pushChoice(s, { kind: 'selectUnitToSteal', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, power: -3 })
    : s
}))

// ── Attack-granting events ────────────────────────────────────────────────────────────────────
// Each lets you attack with a unit and lends it a rider for that attack. The rider lives on a
// carrier card whose abilities are granted to the attacker via `mayAttackAnyUnit.grantCardId` —
// the same mechanism Support and Improvised Identity use. Carrier ids are deliberately not
// `ASH_`-prefixed: the manifest drift test treats every registered ASH id as an implemented card.

const GRANT_RASH_ACTION = 'GRANT_RASH_ACTION'
registerCard(GRANT_RASH_ACTION, {
  sourceCardId: 'ASH_162', // Rash Action
  statModifier: (_s, _u, ctx) => (ctx.attacking ? { power: 1 } : {}),
  abilities: [{
    trigger: 'onAttackEnd',
    description: "If this unit dealt combat damage to an opponent's base, that opponent discards a card.",
    effect: (s, ctx) => {
      const enemy = opponentOf(ctx.owner)
      if (!ctx.combatDamageToBase || s.players[enemy].hand.length === 0) return s
      return pushChoice(s, { kind: 'selectDiscard', id: `${ctx.sourceInstanceId}-rash`, controller: enemy, count: 1, optional: false })
    },
  }],
})

const GRANT_FOLLOW_ME = 'GRANT_FOLLOW_ME'
registerCard(GRANT_FOLLOW_ME, {
  sourceCardId: 'ASH_184', // Follow Me!
  abilities: [{
    trigger: 'onAttackEnd',
    description: 'After completing the attack, give 3 Advantage tokens to a unit.',
    effect: (s, ctx) => {
      const targets = allUnits(s).map(u => u.instanceId)
      return targets.length
        ? pushChoice(s, { kind: 'mayGiveTokens', id: `${ctx.sourceInstanceId}-follow`, controller: ctx.owner, token: TOKEN_ADVANTAGE, count: 3, targets, optional: false })
        : s
    },
  }],
})

const GRANT_MASTERSTROKE = 'GRANT_MASTERSTROKE'
registerCard(GRANT_MASTERSTROKE, {
  sourceCardId: 'ASH_234', // Masterstroke
  // +1/+0 per unit the defending player has in this unit's arena.
  statModifier: (s, u, ctx) => {
    if (!ctx.attacking) return {}
    const owner = findUnit(s, u.instanceId)?.owner
    if (owner === undefined) return {}
    return { power: s.players[opponentOf(owner)].units.filter(e => e.arena === u.arena).length }
  },
})

const GRANT_WIPE_THEM_OUT = 'GRANT_WIPE_THEM_OUT'
registerCard(GRANT_WIPE_THEM_OUT, { sourceCardId: 'ASH_137', spillsExcessToUnit: () => true }) // Wipe Them Out

/**
 * "Attack with a unit", lending it `grantCardId`'s rider for that attack. Mandatory, so it is gated
 * on an attack being legal rather than merely on a ready unit existing. `offer` narrows the attacker
 * ("attack with a Vehicle unit") or lets it be exhausted.
 */
const attackWithRider = (description: string, grantCardId?: string, offer: AttackOffer = {}) =>
  whenPlayed(description, (s, ctx) => offerAttack(s, ctx.owner, ctx.sourceInstanceId!, { ...offer, grantCardId }))

registerCard('ASH_162', attackWithRider('Attack with a unit. For this attack, it gets +1/+0 and gains: "When Attack Ends: If this unit dealt combat damage to an opponent\'s base, that opponent discards a card."', GRANT_RASH_ACTION))
registerCard('ASH_184', attackWithRider('Attack with a unit. After completing the attack, give 3 Advantage tokens to a unit.', GRANT_FOLLOW_ME))
registerCard('ASH_234', attackWithRider('Attack with a unit. It gets +1/+0 for this attack for each unit the defending player controls in its arena.', GRANT_MASTERSTROKE))
registerCard('ASH_137', attackWithRider('Attack with a unit. For this attack, you may deal its excess damage to another unit in the same arena.', GRANT_WIPE_THEM_OUT))

// ── Keywords that are really When Played abilities ────────────────────────────────────────────

/**
 * Ambush and Support read as keywords but each is a **When Played ability** ("When you play this
 * unit, you may attack …"), so they are registered here and collected into the play batch like any
 * other ability. That is what puts them into the ordering question alongside the card's own When
 * Played and everyone else's reactions.
 *
 * Raising their choice directly from `playUnitCard` instead is what made a Snub Fighter Squadron unable
 * to deal its 1 damage until after it had taken its Ambush attack: a choice on the board stops the
 * rest of the batch (CR 7.6.12), and this one was there before the batch began.
 *
 * The unit's ready state is NOT decided here. Ambush enters its unit ready so it can attack, which is
 * part of entering play rather than part of the ability, and stays in `playUnitCard`.
 */
export const KEYWORD_AMBUSH = 'KEYWORD_AMBUSH'
registerCard(KEYWORD_AMBUSH, {
  abilities: [{
    trigger: 'whenPlayed',
    description: 'You may attack with this unit.',
    effect: (s, ctx) => {
      const u = findUnit(s, ctx.sourceInstanceId!)
      // Re-checked as the ability resolves: an earlier ability in the same batch may have cleared the
      // arena, and an Ambush with nothing to hit offers nothing.
      if (!u || enemyAttackTargets(s, u.unit).targets.length === 0) return s
      return pushChoice(s, {
        kind: 'ambush',
        id: ctx.sourceInstanceId!,
        controller: ctx.owner,
        unitId: ctx.sourceInstanceId!,
        source: { cardId: u.unit.cardId, controller: ctx.owner },
      })
    },
  }],
})

export const KEYWORD_SUPPORT = 'KEYWORD_SUPPORT'
registerCard(KEYWORD_SUPPORT, {
  abilities: [{
    trigger: 'whenPlayed',
    description: "You may attack with another unit. It gains this unit's other abilities for this attack.",
    effect: (s, ctx) => openSupportChoice(s, ctx.owner, ctx.sourceInstanceId!),
  }],
})

// ── The last three events ─────────────────────────────────────────────────────────────────────

/** The ability Treacherous Minefield hands to every unit in the chosen arena for the phase. */
const GRANT_MINEFIELD = 'GRANT_MINEFIELD'
registerCard(GRANT_MINEFIELD, {
  sourceCardId: 'ASH_186', // Treacherous Minefield
  abilities: [{ trigger: 'onAttack', description: 'Deal 2 damage to this unit.', effect: (s, ctx) => dealDamageToUnit(s, ctx.sourceInstanceId!, 2) }],
})

registerCard('ASH_186', whenPlayed('Choose an arena. For this phase, each unit in that arena gains: "On Attack: Deal 2 damage to this unit."', (s, ctx) => // Treacherous Minefield
  pushChoice(s, { kind: 'selectArenaToGrant', id: ctx.sourceInstanceId!, controller: ctx.owner, grantCardId: GRANT_MINEFIELD })))

registerCard('ASH_090', whenPlayed('Defeat an upgrade on a friendly unit. If you do, search the top 8 cards of your deck for an upgrade that can attach to that unit, reveal it, and play it on that unit. It costs 4 less.', (s, ctx) => { // Reforge
  // "On a friendly unit" is keyed on the HOST's controller, not the upgrade's owner, so this one is
  // deliberately different from the "a friendly upgrade" cards. The SIDE is all that differs:
  // "defeat an upgrade" takes tokens here just as it does for Vane and Clan Vizsla Soldier.
  const candidates = upgradeCandidates(s, { hostController: ctx.owner })
  return candidates.length
    ? pushChoice(s, { kind: 'selectUpgradeToDefeat', id: ctx.sourceInstanceId!, controller: ctx.owner, candidates, optional: true, thenSearchUpgrade: { depth: 8, discount: 4 } })
    : s
}))

registerCard('ASH_235', whenPlayed('Choose a number, then search the top 5 cards of your deck for a card, reveal it, and draw it. If its cost is the chosen number, you may give 3 Advantage tokens to a Force unit.', (s, ctx) => // Sense Through the Force
  pushChoice(s, { kind: 'chooseNumber', id: ctx.sourceInstanceId!, controller: ctx.owner, max: 10, then: 'senseThroughTheForce' })))

// ── Events from the other sealed sets that existing choices already express ──────────────────
// Each is one pending choice, or one primitive applied across a set of units, with the card
// supplying only which units qualify and how much. A card's cross-set reprints reach it through
// `data/reprints.ts`.

type EventCtx = { owner: PlayerId; sourceInstanceId?: string }
type UnitTest = (s: GameState, u: UnitState, owner: PlayerId) => boolean
type Buff = { power?: number; hp?: number; keywords?: KeywordInstance[] }

const printedCost = (s: GameState, u: UnitState): number => s.cards[u.cardId]?.cost ?? 0
// A leader unit includes one made so by an upgrade (The Darksaber), hence `isLeaderUnit` over `isLeader`.
const nonLeader = (s: GameState, u: UnitState): boolean => !isLeaderUnit(s, u)
const isEnemy = (s: GameState, u: UnitState, owner: PlayerId): boolean => s.players[opponentOf(owner)].units.includes(u)
const controlsTrait = (s: GameState, owner: PlayerId, trait: string): boolean => s.players[owner].units.some(u => unitHasTrait(s, u, trait))
const unitsIn = (s: GameState, owner: PlayerId, arena: 'ground' | 'space'): UnitState[] => s.players[owner].units.filter(u => u.arena === arena)
const eligibleIds = (s: GameState, owner: PlayerId, test: UnitTest): string[] => allUnits(s).filter(u => test(s, u, owner)).map(u => u.instanceId)
const lastingOnEach = (s: GameState, units: UnitState[], effect: Omit<LastingEffect, 'targetInstanceId'>): GameState =>
  units.reduce((acc, u) => addLastingEffect(acc, { targetInstanceId: u.instanceId, ...effect }), s)

// Each choice below is mandatory unless `optional`, which a card passes only when it prints "may".
const mayFlag = (optional: boolean) => (optional ? { optional: true } : {})

/** "Deal N damage to a unit" (or a base, where `baseTargets` names them). */
const damageChoice = (s: GameState, ctx: EventCtx, amount: number, units: UnitState[], baseTargets: PlayerId[] = [], optional = false): GameState =>
  units.length || baseTargets.length
    ? pushChoice(s, { kind: 'selectDamageTarget', id: ctx.sourceInstanceId!, controller: ctx.owner, amount, unitTargets: units.map(u => u.instanceId), baseTargets, ...mayFlag(optional) })
    : s

/** "Heal N damage from a unit" (or a base, where `baseTargets` names them). */
const healChoice = (s: GameState, ctx: EventCtx, amount: number, unitTargets: string[], baseTargets: PlayerId[], optional = false): GameState =>
  unitTargets.length || baseTargets.length
    ? pushChoice(s, { kind: 'selectHealTarget', id: ctx.sourceInstanceId!, controller: ctx.owner, amount, unitTargets, baseTargets, ...mayFlag(optional) })
    : s

/** "Give a Shield token to a unit". `mayGiveTokens` reads a missing flag as optional, so it is always set. */
const shieldChoice = (s: GameState, ctx: EventCtx, targets: string[], optional: boolean): GameState =>
  targets.length ? pushChoice(s, { kind: 'mayGiveTokens', id: ctx.sourceInstanceId!, controller: ctx.owner, token: TOKEN_SHIELD, count: 1, targets, optional }) : s

type TargetKind = 'selectUnitToDefeat' | 'selectUnitToReady' | 'selectUnitToReturn' | 'mayExhaustUnit'
/** Defeat, ready, return or exhaust one of `targets`, or nothing when there are none. */
const targetChoice = (s: GameState, ctx: EventCtx, kind: TargetKind, targets: string[], optional = false): GameState =>
  targets.length ? pushChoice(s, { kind, id: ctx.sourceInstanceId!, controller: ctx.owner, targets, ...mayFlag(optional) }) : s

const defeatEvent = (description: string, test: UnitTest) =>
  whenPlayed(description, (s, ctx) => targetChoice(s, ctx, 'selectUnitToDefeat', eligibleIds(s, ctx.owner, test)))
const readyEvent = (description: string, test: UnitTest) =>
  whenPlayed(description, (s, ctx) => targetChoice(s, ctx, 'selectUnitToReady', eligibleIds(s, ctx.owner, test)))
const returnEvent = (description: string, test: UnitTest) =>
  whenPlayed(description, (s, ctx) => targetChoice(s, ctx, 'selectUnitToReturn', eligibleIds(s, ctx.owner, test)))

/** "Give a unit +X/+Y (and keywords) for this phase", the amounts read as the ability resolves. */
const lastingBuffChoice = (s: GameState, ctx: EventCtx, targets: string[], buff: Buff, optional = false): GameState =>
  targets.length ? pushChoice(s, { kind: 'mayLastingBuff', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, ...buff, ...mayFlag(optional) }) : s
const buffChoice = (s: GameState, ctx: EventCtx, test: UnitTest, buff: Buff): GameState =>
  lastingBuffChoice(s, ctx, eligibleIds(s, ctx.owner, test), buff)
const buffEvent = (description: string, test: UnitTest, buff: (s: GameState, owner: PlayerId) => Buff) =>
  whenPlayed(description, (s, ctx) => buffChoice(s, ctx, test, buff(s, ctx.owner)))
const anyUnit: UnitTest = () => true

// Damage
registerCard('SOR_172', whenPlayed('Deal 4 damage to a unit.', (s, ctx) => damageChoice(s, ctx, 4, allUnits(s)))) // Open Fire
registerCard('SHD_178', whenPlayed('Deal 2 damage to a unit or base.', (s, ctx) => damageChoice(s, ctx, 2, allUnits(s), BOTH_BASES))) // Daring Raid
registerCard('JTL_125', whenPlayed('If you control more space units than an opponent, deal 4 damage to a ground unit that opponent controls.', (s, ctx) => { // Air Superiority
  const enemy = opponentOf(ctx.owner)
  return unitsIn(s, ctx.owner, 'space').length > unitsIn(s, enemy, 'space').length ? damageChoice(s, ctx, 4, unitsIn(s, enemy, 'ground')) : s
}))

// Defeat
registerCard('SOR_078', defeatEvent('Defeat a non-leader unit.', nonLeader)) // Vanquish
registerCard('LOF_264', defeatEvent('Defeat a non-leader unit.', nonLeader)) // It's Worse
registerCard('SHD_079', defeatEvent('Defeat a unit.', anyUnit)) // Rival's Fall
registerCard('LOF_077', defeatEvent('Defeat a non-leader unit that costs 2 or less.', (s, u) => nonLeader(s, u) && printedCost(s, u) <= 2)) // Crushing Blow
registerCard('SHD_078', defeatEvent('Defeat a non-leader unit with 5 or more power.', (s, u) => nonLeader(s, u) && effectivePower(s, u) >= 5)) // Fell the Dragon
registerCard('SOR_077', defeatEvent('Defeat a unit with 5 or less remaining HP.', (s, u) => remainingHp(s, u) <= 5)) // Takedown
registerCard('JTL_078', defeatEvent('Defeat a non-leader Vehicle unit.', (s, u) => nonLeader(s, u) && unitHasTrait(s, u, 'Vehicle'))) // Direct Hit
registerCard('SEC_247', defeatEvent('Defeat a unit with cost equal to or less than the number of Villainy aspect icons among friendly units.', (s, u, owner) => { // Evil is Everywhere
  const icons = s.players[owner].units.reduce((n, f) => n + (s.cards[f.cardId]?.aspects ?? []).filter(a => a === 'Villainy').length, 0)
  return printedCost(s, u) <= icons
}))
registerCard('SOR_251', whenPlayed('Defeat an upgrade.', (s, ctx) => { // Confiscate
  // Any upgrade on either side, tokens included, as "defeat an upgrade" reads for Vane and Reforge.
  const candidates = upgradeCandidates(s)
  return candidates.length
    ? pushChoice(s, { kind: 'selectUpgradeToDefeat', id: ctx.sourceInstanceId!, controller: ctx.owner, candidates, optional: false })
    : s
}))

// Heal, shield, exhaust
registerCard('SOR_074', whenPlayed('Heal 3 damage from a unit or base.', (s, ctx) => // Repair
  healChoice(s, ctx, 3, allUnits(s).map(u => u.instanceId), BOTH_BASES)))
registerCard('SOR_073', whenPlayed('Give a Shield token to a unit.', (s, ctx) => // Moment of Peace
  shieldChoice(s, ctx, allUnits(s).map(u => u.instanceId), false)))
registerCard('JTL_262', whenPlayed('Exhaust a unit.', (s, ctx) => // Evasive Maneuver
  targetChoice(s, ctx, 'mayExhaustUnit', allUnits(s).map(u => u.instanceId))))

// Ready
registerCard('SOR_169', readyEvent('Ready a unit with 3 or less power.', (s, u) => effectivePower(s, u) <= 3)) // Keep Fighting
registerCard('LOF_174', readyEvent('Ready a Force unit with 4 or less power.', (s, u) => unitHasTrait(s, u, 'Force') && effectivePower(s, u) <= 4)) // Ataru Onslaught
registerCard('JTL_179', readyEvent('Ready a Fighter or Transport unit with 6 or less power.', (s, u) => // Koiogran Turn
  (unitHasTrait(s, u, 'Fighter') || unitHasTrait(s, u, 'Transport')) && effectivePower(s, u) <= 6))
registerCard('JTL_209', whenPlayed('If an opponent controls more space units than you, ready each space unit you control.', (s, ctx) => { // It's a Trap
  const mine = unitsIn(s, ctx.owner, 'space')
  return unitsIn(s, opponentOf(ctx.owner), 'space').length > mine.length ? mine.reduce((acc, u) => readyUnit(acc, u.instanceId), s) : s
}))

// Return to hand
registerCard('SOR_222', returnEvent("Return a non-leader unit to its owner's hand.", nonLeader)) // Waylay
registerCard('LAW_246', returnEvent("Return a non-leader unit that costs 3 or less to its owner's hand.", (s, u) => nonLeader(s, u) && printedCost(s, u) <= 3)) // The Axe Forgets
registerCard('SHD_233', whenPlayed("Return each non-leader unit to its owner's hand.", s => // Evacuate
  allUnits(s).filter(u => nonLeader(s, u)).reduce((acc, u) => returnUnitToHand(acc, u.instanceId), s)))

// One unit, for this phase
registerCard('SOR_124', buffEvent('Give a unit +2/+2 for this phase.', anyUnit, () => ({ power: 2, hp: 2 }))) // Tactical Advantage
registerCard('SHD_130', buffEvent('Give a unit +4/+4 for this phase.', anyUnit, () => ({ power: 4, hp: 4 }))) // Moment of Glory
registerCard('LAW_131', buffEvent('Give a unit -2/-2 for this phase.', anyUnit, () => ({ power: -2, hp: -2 }))) // Incapacitate
registerCard('JTL_079', buffEvent('Give a unit -5/-5 for this phase.', anyUnit, () => ({ power: -5, hp: -5 }))) // Out the Airlock
registerCard('SOR_216', buffEvent('Give an enemy unit -4/-0 for this phase.', isEnemy, () => ({ power: -4 }))) // Disarm
registerCard('LOF_126', buffEvent('Give a unit +3/+3 and Overwhelm for this phase.', anyUnit, () => ({ power: 3, hp: 3, keywords: [{ name: 'Overwhelm' }] }))) // Overpower
registerCard('JTL_229', buffEvent('Give a unit Sentinel for this phase.', anyUnit, () => ({ keywords: [{ name: 'Sentinel' }] }))) // Diversion
registerCard('LOF_217', buffEvent('Give an exhausted unit -8/-0 for this phase.', (_s, u) => u.exhausted, () => ({ power: -8 }))) // Force Slow
registerCard('TWI_052', buffEvent('Choose a unit that entered play this phase. It gets -4/-4 for this phase.', (s, u) => // Hello There
  [...enteredPlayThisPhase(s, 'player'), ...enteredPlayThisPhase(s, 'opponent')].includes(u.instanceId), () => ({ power: -4, hp: -4 })))
registerCard('SHD_051', buffEvent('Give an enemy unit -2/-0 for this phase. If you control a Force unit, give the enemy unit -2/-2 for this phase instead.', isEnemy, (s, owner) => // Mystic Reflection
  (controlsTrait(s, owner, 'Force') ? { power: -2, hp: -2 } : { power: -2 })))
registerCard('LOF_078', buffEvent('Give a unit -2/-2 for this phase. If you control a Force unit, give it -3/-3 instead.', anyUnit, (s, owner) => // Whirlwind of Power
  (controlsTrait(s, owner, 'Force') ? { power: -3, hp: -3 } : { power: -2, hp: -2 })))
registerCard('LAW_167', buffEvent('Give a unit +1/+1 for this phase for each different aspect among units you control.', anyUnit, (s, owner) => { // Common Cause
  const n = new Set(s.players[owner].units.flatMap(u => s.cards[u.cardId]?.aspects ?? [])).size
  return { power: n, hp: n }
}))
registerCard('TWI_074', buffEvent('Give a unit Sentinel for this phase. If you have the initiative, also give that unit +2/+2 for this phase.', anyUnit, (s, owner) => // Guarding the Way
  (s.initiative === owner ? { power: 2, hp: 2, keywords: [{ name: 'Sentinel' }] } : { keywords: [{ name: 'Sentinel' }] })))
registerCard('SOR_076', whenPlayed('Give a unit -2/-2 for this phase. Heal 2 damage from your base.', (s, ctx) => // Make an Opening
  healBase(buffChoice(s, ctx, anyUnit, { power: -2, hp: -2 }), ctx.owner, 2)))
registerCard('SEC_075', whenPlayed('Give a unit -2/-2 for this phase. Draw a card.', (s, ctx) => // Knowledge and Defense
  // The draw goes first, so a "when you draw" reaction settles before the debuff choice is on the board.
  buffChoice(drawCards(s, ctx.owner, 1), ctx, anyUnit, { power: -2, hp: -2 })))

// Draw and bases
registerCard('TWI_175', whenPlayed('Draw 3 cards.', (s, ctx) => drawCards(s, ctx.owner, 3))) // Strategic Analysis
registerCard('SEC_125', whenPlayed('If you control a ground unit and a space unit, draw 2 cards.', (s, ctx) => // Reconnaissance
  (unitsIn(s, ctx.owner, 'ground').length && unitsIn(s, ctx.owner, 'space').length ? drawCards(s, ctx.owner, 2) : s)))
registerCard('TWI_100', whenPlayed('If you control 3 or more Official units, draw 3 cards.', (s, ctx) => // Petition the Senate
  (s.players[ctx.owner].units.filter(u => unitHasTrait(s, u, 'Official')).length >= 3 ? drawCards(s, ctx.owner, 3) : s)))
registerCard('SHD_159', whenPlayed("Deal damage to each player's base equal to the number of cards in that player's hand.", (s, ctx) => // The Chaos of War
  [ctx.owner, opponentOf(ctx.owner)].reduce((acc, p) => dealDamageToBase(acc, p, acc.players[p].hand.length), s)))

// Every unit that qualifies
registerCard('TWI_173', whenPlayed('Deal 2 damage to each ground unit.', s => // Blood Sport
  allUnits(s).filter(u => u.arena === 'ground').reduce((acc, u) => dealDamageToUnit(acc, u.instanceId, 2), s)))
registerCard('LOF_141', whenPlayed('Deal 2 damage to each non-Vehicle enemy unit. If you control a Force unit, draw a card.', (s, ctx) => { // Death Field
  const hit = s.players[opponentOf(ctx.owner)].units.filter(u => !unitHasTrait(s, u, 'Vehicle')).reduce((acc, u) => dealDamageToUnit(acc, u.instanceId, 2), s)
  return controlsTrait(hit, ctx.owner, 'Force') ? drawCards(hit, ctx.owner, 1) : hit
}))
registerCard('TWI_126', whenPlayed('Give each friendly unit +1/+1 for this phase.', (s, ctx) => // Encouraging Leadership
  lastingOnEach(s, s.players[ctx.owner].units, { power: 1, hp: 1 })))
registerCard('TWI_075', whenPlayed('Give each enemy unit -1/-1 for this phase.', (s, ctx) => // Disruptive Burst
  lastingOnEach(s, s.players[opponentOf(ctx.owner)].units, { power: -1, hp: -1 })))
registerCard('LOF_127', whenPlayed('Each friendly Creature unit gets +2/+2 for this phase.', (s, ctx) => // Rampage
  lastingOnEach(s, s.players[ctx.owner].units.filter(u => unitHasTrait(s, u, 'Creature')), { power: 2, hp: 2 })))
registerCard('SOR_154', whenPlayed('Each friendly unit gains Raid 2 this phase.', (s, ctx) => // Rallying Cry
  lastingOnEach(s, s.players[ctx.owner].units, { keywords: [{ name: 'Raid', value: 2 }] })))
registerCard('LOF_152', whenPlayed('Each friendly Force unit gains Raid 1 and Saboteur for this phase.', (s, ctx) => // Focus Determines Reality
  lastingOnEach(s, s.players[ctx.owner].units.filter(u => unitHasTrait(s, u, 'Force')), { keywords: [{ name: 'Raid', value: 1 }, { name: 'Saboteur' }] })))
registerCard('TWI_250', whenPlayed('Give each friendly Trooper unit Raid 1 for this phase. Give each friendly Jedi unit Sentinel for this phase.', (s, ctx) => { // Sword and Shield Maneuver
  const units = s.players[ctx.owner].units
  const raided = lastingOnEach(s, units.filter(u => unitHasTrait(s, u, 'Trooper')), { keywords: [{ name: 'Raid', value: 1 }] })
  return lastingOnEach(raided, units.filter(u => unitHasTrait(s, u, 'Jedi')), { keywords: [{ name: 'Sentinel' }] })
}))

// Attack with a unit, with a rider for that attack (see "Attack-granting events" above)
const GRANT_SURPRISE_STRIKE = 'GRANT_SURPRISE_STRIKE'
registerCard(GRANT_SURPRISE_STRIKE, { sourceCardId: 'SOR_220', statModifier: (_s, _u, ctx) => (ctx.attacking ? { power: 3 } : {}) })
registerCard('SOR_220', attackWithRider('Attack with a unit. It gets +3/+0 for this attack.', GRANT_SURPRISE_STRIKE)) // Surprise Strike

const GRANT_BREAKING_IN = 'GRANT_BREAKING_IN'
registerCard(GRANT_BREAKING_IN, {
  sourceCardId: 'TWI_224',
  statModifier: (_s, _u, ctx) => (ctx.attacking ? { power: 2 } : {}),
  conditionalKeywords: () => [{ name: 'Saboteur' }],
})
registerCard('TWI_224', attackWithRider('Attack with a unit. It gets +2/+0 and gains Saboteur for this attack.', GRANT_BREAKING_IN)) // Breaking In

const GRANT_PRECISION_FIRE = 'GRANT_PRECISION_FIRE'
registerCard(GRANT_PRECISION_FIRE, {
  sourceCardId: 'SOR_168',
  statModifier: (s, u, ctx) => (ctx.attacking && unitHasTrait(s, u, 'Trooper') ? { power: 2 } : {}),
  conditionalKeywords: () => [{ name: 'Saboteur' }],
})
registerCard('SOR_168', attackWithRider("Attack with a unit. It gains Saboteur for this attack. If it's a Trooper, it also gets +2/+0 for this attack.", GRANT_PRECISION_FIRE)) // Precision Fire

const GRANT_SHOOT_FIRST = 'GRANT_SHOOT_FIRST'
registerCard(GRANT_SHOOT_FIRST, {
  sourceCardId: 'SOR_217',
  statModifier: (_s, _u, ctx) => (ctx.attacking ? { power: 1 } : {}),
  dealsDamageFirst: () => true,
})
registerCard('SOR_217', attackWithRider('Attack with a unit. It gets +1/+0 for this attack and deals its combat damage before the defender.', GRANT_SHOOT_FIRST)) // Shoot First

// ── Attack events beyond a plain rider ────────────────────────────────────────────────────────
// Still one carrier per card, lent for the attack. What the plain rider lacked is carried by the
// offer (who may attack, and whether exhausted) and by hooks the carrier already has: an `aura` for
// the defender's -X/-0, `preventUnitDamage` for the attacker's protection, and an "attack ends"
// ability for anything after. An attack that follows another ("attack with 2 units, one at a time")
// is raised by the first attack's carrier as that attack ends, so it cannot start while the first is
// still resolving.

/** "It gets +N/+0 for this attack." */
const attackBonus = (power: number): CardDefinition => ({ statModifier: (_s, _u, ctx) => (ctx.attacking ? { power } : {}) })

/**
 * The next attack of a sequence, never with the unit that just attacked. Raised as the attack ends,
 * so a sequence stops if its attacker is defeated before combat damage: that attack never reaches its
 * end, where the card would go on to the next one.
 */
const thenAttack = (description: string, offer: AttackOffer = {}): AbilityDef => ({
  trigger: 'onAttackEnd',
  description,
  effect: (s, ctx) => offerAttack(s, ctx.owner, `${ctx.sourceInstanceId}-next`, {
    ...offer,
    attacker: { ...offer.attacker, exclude: [...(offer.attacker?.exclude ?? []), ctx.sourceInstanceId!] },
  }),
})

/** "The defender gets -N/-0 for this attack", as an aura the attacker holds only while it attacks that defender. */
const defenderPowerAura = (power: number, when: (target: UnitState) => boolean = () => true): CardDefinition['aura'] =>
  (_s, source, target, _friendly, combat) =>
    (combat?.attackerInstanceId === source.instanceId && combat.defenderInstanceId === target.instanceId && when(target) ? { power } : undefined)

const GRANT_POUNCE = 'GRANT_POUNCE'
registerCard(GRANT_POUNCE, { sourceCardId: 'LOF_224', ...attackBonus(4) })
registerCard('LOF_224', attackWithRider('Attack with a Creature unit. It gets +4/+0 for this attack.', GRANT_POUNCE, { attacker: { trait: 'Creature' } })) // Pounce

const GRANT_PUNCH_IT = 'GRANT_PUNCH_IT'
registerCard(GRANT_PUNCH_IT, { sourceCardId: 'JTL_231', ...attackBonus(2) })
registerCard('JTL_231', attackWithRider('Attack with a Vehicle unit. It gets +2/+0 for this attack.', GRANT_PUNCH_IT, { attacker: { trait: 'Vehicle' } })) // Punch It

const GRANT_DESPERATE_ATTACK = 'GRANT_DESPERATE_ATTACK'
registerCard(GRANT_DESPERATE_ATTACK, { sourceCardId: 'SHD_179', ...attackBonus(2) })
registerCard('SHD_179', attackWithRider('Attack with a damaged unit. It gets +2/+0 for this attack.', GRANT_DESPERATE_ATTACK, { attacker: { damaged: true } })) // Desperate Attack

const GRANT_GRIM_RESOLVE = 'GRANT_GRIM_RESOLVE'
registerCard(GRANT_GRIM_RESOLVE, { sourceCardId: 'TWI_172', conditionalKeywords: () => [{ name: 'Grit' }] })
registerCard('TWI_172', attackWithRider('Attack with a non-leader unit. It gains Grit for this attack.', GRANT_GRIM_RESOLVE, { attacker: { nonLeader: true } })) // Grim Resolve

const GRANT_REBEL_ASSAULT = 'GRANT_REBEL_ASSAULT'
const GRANT_REBEL_ASSAULT_SECOND = 'GRANT_REBEL_ASSAULT_SECOND'
registerCard(GRANT_REBEL_ASSAULT_SECOND, { sourceCardId: 'SOR_103', ...attackBonus(1) })
registerCard(GRANT_REBEL_ASSAULT, {
  sourceCardId: 'SOR_103',
  ...attackBonus(1),
  abilities: [thenAttack('Then, attack with another Rebel unit. It gets +1/+0 for this attack.', { attacker: { trait: 'Rebel' }, grantCardId: GRANT_REBEL_ASSAULT_SECOND })],
})
registerCard('SOR_103', attackWithRider('Attack with a Rebel unit. It gets +1/+0 for this attack. Then, attack with another Rebel unit. It gets +1/+0 for this attack.', GRANT_REBEL_ASSAULT, { attacker: { trait: 'Rebel' } })) // Rebel Assault

const GRANT_NIMAN_STRIKE = 'GRANT_NIMAN_STRIKE'
registerCard(GRANT_NIMAN_STRIKE, { sourceCardId: 'LOF_124', ...attackBonus(1), cannotAttackBases: () => true })
registerCard('LOF_124', attackWithRider("Attack with a Force unit, even if it's exhausted. It gets +1/+0 and can't attack bases for this attack.", GRANT_NIMAN_STRIKE, { attacker: { trait: 'Force' }, exhausted: true })) // Niman Strike

const GRANT_DOGFIGHT = 'GRANT_DOGFIGHT'
registerCard(GRANT_DOGFIGHT, { sourceCardId: 'JTL_123', cannotAttackBases: () => true })
registerCard('JTL_123', attackWithRider("Attack with a unit, even if it's exhausted. That unit can't attack bases for this attack.", GRANT_DOGFIGHT, { exhausted: true })) // Dogfight

const GRANT_CATCH_UNAWARES = 'GRANT_CATCH_UNAWARES'
registerCard(GRANT_CATCH_UNAWARES, { sourceCardId: 'SEC_229', aura: defenderPowerAura(-4) })
registerCard('SEC_229', attackWithRider('Attack with a unit. The defender gets -4/-0 for this attack.', GRANT_CATCH_UNAWARES)) // Catch Unawares

const GRANT_SWOOP_DOWN = 'GRANT_SWOOP_DOWN'
registerCard(GRANT_SWOOP_DOWN, {
  sourceCardId: 'SHD_230',
  conditionalKeywords: () => [{ name: 'Saboteur' }],
  attacksEitherArena: () => true,
  statModifier: (_s, _u, ctx) => (ctx.attacking && ctx.defenderArena === 'ground' ? { power: 2 } : {}),
  aura: defenderPowerAura(-2, target => target.arena === 'ground'),
})
registerCard('SHD_230', attackWithRider('Attack with a space unit. It gains Saboteur and can attack ground units for this attack. If it attacks a ground unit, it gets +2/+0 and the defender gets -2/-0 for this attack.', GRANT_SWOOP_DOWN, { attacker: { arena: 'space' } })) // Swoop Down

const GRANT_OUTFLANK = 'GRANT_OUTFLANK'
registerCard(GRANT_OUTFLANK, { abilities: [thenAttack('Then, attack with a second unit.')] })
registerCard('TWI_123', attackWithRider('Attack with 2 units (one at a time).', GRANT_OUTFLANK)) // Outflank
registerCard('SHD_128', attackWithRider('Attack with 2 units (one at a time).', GRANT_OUTFLANK)) // Outflank

const GRANT_ATTACK_RUN = 'GRANT_ATTACK_RUN'
registerCard(GRANT_ATTACK_RUN, { sourceCardId: 'JTL_261', abilities: [thenAttack('Then, attack with a second space unit.', { attacker: { arena: 'space' } })] })
registerCard('JTL_261', attackWithRider('Attack with 2 space units (one at a time).', GRANT_ATTACK_RUN, { attacker: { arena: 'space' } })) // Attack Run

/** Headhunting's rider for one of its up to three attacks, offering the next while any remain. */
const headhunting = (next?: string): CardDefinition => ({
  sourceCardId: 'SHD_145',
  cannotAttackBases: () => true,
  statModifier: (s, u, ctx) => (ctx.attacking && unitHasTrait(s, u, 'Bounty Hunter') ? { power: 2 } : {}),
  ...(next ? { abilities: [thenAttack('You may attack with another unit.', { grantCardId: next, optional: true })] } : {}),
})
const GRANT_HEADHUNTING_THIRD = 'GRANT_HEADHUNTING_THIRD'
const GRANT_HEADHUNTING_SECOND = 'GRANT_HEADHUNTING_SECOND'
const GRANT_HEADHUNTING = 'GRANT_HEADHUNTING'
registerCard(GRANT_HEADHUNTING_THIRD, headhunting())
registerCard(GRANT_HEADHUNTING_SECOND, headhunting(GRANT_HEADHUNTING_THIRD))
registerCard(GRANT_HEADHUNTING, headhunting(GRANT_HEADHUNTING_SECOND))
registerCard('SHD_145', attackWithRider("Attack with up to 3 units (one at a time). They can't attack bases for these attacks. Each Bounty Hunter that attacks this way gets +2/+0 for its attack.", GRANT_HEADHUNTING, { optional: true })) // Headhunting

const GRANT_TANDEM_ASSAULT = 'GRANT_TANDEM_ASSAULT'
const GRANT_TANDEM_ASSAULT_GROUND = 'GRANT_TANDEM_ASSAULT_GROUND'
registerCard(GRANT_TANDEM_ASSAULT_GROUND, { sourceCardId: 'JTL_124', ...attackBonus(2) })
registerCard(GRANT_TANDEM_ASSAULT, {
  sourceCardId: 'JTL_124',
  abilities: [thenAttack('If you do, attack with a ground unit, and that ground unit gets +2/+0 for this attack.', { attacker: { arena: 'ground' }, grantCardId: GRANT_TANDEM_ASSAULT_GROUND })],
})
registerCard('JTL_124', attackWithRider('Attack with a space unit. If you do, attack with a ground unit, and that ground unit gets +2/+0 for this attack.', GRANT_TANDEM_ASSAULT, { attacker: { arena: 'space' } })) // Tandem Assault

/** Brothers' rider: no combat damage to the attacker, and the second attack offered after the first. */
const brothers = (next?: string): CardDefinition => ({
  sourceCardId: 'TS26_59',
  preventUnitDamage: (_s, self, target, amount, ctx) => (ctx.byCombat && target.instanceId === self.instanceId ? amount : 0),
  ...(next ? { abilities: [thenAttack('You may attack with another unique unit.', { attacker: { unique: true }, grantCardId: next, optional: true })] } : {}),
})
const GRANT_BROTHERS_SECOND = 'GRANT_BROTHERS_SECOND'
const GRANT_BROTHERS = 'GRANT_BROTHERS'
registerCard(GRANT_BROTHERS_SECOND, brothers())
registerCard(GRANT_BROTHERS, brothers(GRANT_BROTHERS_SECOND))
registerCard('TS26_59', attackWithRider('Attack with up to 2 unique units (one at a time). Prevent all combat damage that would be dealt to each of them for these attacks.', GRANT_BROTHERS, { attacker: { unique: true }, optional: true })) // Brothers

const GRANT_ACCELERATE_OUR_PLANS = 'GRANT_ACCELERATE_OUR_PLANS'
registerCard(GRANT_ACCELERATE_OUR_PLANS, { sourceCardId: 'SEC_228', ...attackBonus(3) })
registerCard('SEC_228', whenPlayed('Exhaust a friendly unit. If you do, attack with another unit. It gets +3/+0 for this attack.', (s, ctx) => { // Accelerate Our Plans
  // A unit already exhausted cannot be exhausted, so "if you do" never holds for one.
  const targets = s.players[ctx.owner].units.filter(u => !u.exhausted).map(u => u.instanceId)
  return targets.length
    ? pushChoice(s, { kind: 'mayExhaustUnit', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, thenAttackWithAnother: { grantCardId: GRANT_ACCELERATE_OUR_PLANS } })
    : s
}))

const GRANT_COMMENCE_THE_FESTIVITIES = 'GRANT_COMMENCE_THE_FESTIVITIES'
registerCard(GRANT_COMMENCE_THE_FESTIVITIES, {
  sourceCardId: 'LAW_202',
  conditionalKeywords: () => [{ name: 'Saboteur' }],
  statModifier: (s, u, ctx) => {
    const owner = unitOwner(s, u)
    return ctx.attacking && owner !== undefined && s.players[owner].resources.length < s.players[opponentOf(owner)].resources.length ? { power: 2 } : {}
  },
})
registerCard('LAW_202', attackWithRider('Attack with a unit. It gains Saboteur for this attack. If you control fewer resources than an opponent, it gets +2/+0 for this attack.', GRANT_COMMENCE_THE_FESTIVITIES)) // Commence the Festivities

const GRANT_FLASH_THE_VENTS = 'GRANT_FLASH_THE_VENTS'
registerCard(GRANT_FLASH_THE_VENTS, {
  sourceCardId: 'LAW_205',
  ...attackBonus(2),
  conditionalKeywords: () => [{ name: 'Overwhelm' }],
  abilities: [{
    trigger: 'onAttackEnd',
    description: 'After completing this attack, if that unit damaged a base, defeat that unit.',
    effect: (s, ctx) => ((ctx.combatDamageToBase ?? 0) > 0 && findUnit(s, ctx.sourceInstanceId!) ? defeatUnit(s, ctx.sourceInstanceId!) : s),
  }],
})
registerCard('LAW_205', attackWithRider('Attack with a unit. It gets +2/+0 and gains Overwhelm for this attack. After completing this attack, if that unit damaged a base, defeat that unit.', GRANT_FLASH_THE_VENTS)) // Flash the Vents

const GRANT_AGGRESSIVE_NEGOTIATIONS = 'GRANT_AGGRESSIVE_NEGOTIATIONS'
registerCard(GRANT_AGGRESSIVE_NEGOTIATIONS, {
  sourceCardId: 'SEC_179',
  statModifier: (s, u, ctx) => {
    const owner = unitOwner(s, u)
    return ctx.attacking && owner !== undefined ? { power: s.players[owner].hand.length } : {}
  },
})
registerCard('SEC_179', attackWithRider('Attack with a unit. For this attack, it gets +1/+0 for each card in your hand.', GRANT_AGGRESSIVE_NEGOTIATIONS)) // Aggressive Negotiations

const GRANT_CORNER_THE_PREY = 'GRANT_CORNER_THE_PREY'
registerCard(GRANT_CORNER_THE_PREY, {
  sourceCardId: 'TWI_139',
  // Read as combat damage is calculated. An On Attack or On Defense ability that damages the defender
  // first is counted too, where the card counts only what was there as the attack began.
  statModifier: (s, _u, ctx) => {
    const defenderId = ctx.attacking ? ctx.combat?.defenderInstanceId : undefined
    return defenderId ? { power: findUnit(s, defenderId)?.unit.damage ?? 0 } : {}
  },
})
registerCard('TWI_139', attackWithRider('Attack with a unit. It gets +1/+0 for this attack for each damage on the defender at the start of this attack.', GRANT_CORNER_THE_PREY)) // Corner the Prey

const GRANT_BARREL_ROLL = 'GRANT_BARREL_ROLL'
registerCard(GRANT_BARREL_ROLL, {
  sourceCardId: 'JTL_228',
  abilities: [{
    trigger: 'onAttackEnd',
    description: 'After completing this attack, you may exhaust a space unit.',
    effect: (s, ctx) => {
      const targets = allUnits(s).filter(u => u.arena === 'space' && !u.exhausted).map(u => u.instanceId)
      return targets.length ? pushChoice(s, { kind: 'mayExhaustUnit', id: `${ctx.sourceInstanceId}-barrel`, controller: ctx.owner, targets, optional: true }) : s
    },
  }],
})
registerCard('JTL_228', attackWithRider('Attack with a space unit. After completing this attack, you may exhaust a space unit.', GRANT_BARREL_ROLL, { attacker: { arena: 'space' } })) // Barrel Roll

const GRANT_I_HAVE_YOU_NOW = 'GRANT_I_HAVE_YOU_NOW'
registerCard(GRANT_I_HAVE_YOU_NOW, {
  sourceCardId: 'JTL_193',
  preventUnitDamage: (_s, self, target, amount) => (target.instanceId === self.instanceId ? amount : 0),
})
registerCard('JTL_193', attackWithRider('Attack with a Vehicle unit. Prevent all damage that would be dealt to it during this attack.', GRANT_I_HAVE_YOU_NOW, { attacker: { trait: 'Vehicle' } })) // I Have You Now

// The granted "When this unit deals damage to a base" and "When this unit deals combat damage" are
// read as the attack ends, from what the attack dealt. Nothing else can happen between the damage
// and the end of the attack that either ability would see differently, apart from the order among
// other attack-end abilities.
const GRANT_STAY_ON_TARGET = 'GRANT_STAY_ON_TARGET'
registerCard(GRANT_STAY_ON_TARGET, {
  sourceCardId: 'JTL_177',
  ...attackBonus(2),
  abilities: [{
    trigger: 'onAttackEnd',
    description: 'When this unit deals damage to a base: Draw a card.',
    effect: (s, ctx) => ((ctx.combatDamageToBase ?? 0) > 0 ? drawCards(s, ctx.owner, 1) : s),
  }],
})
registerCard('JTL_177', attackWithRider('Attack with a Vehicle unit. For this attack, it gets +2/+0 and gains: "When this unit deals damage to a base: Draw a card."', GRANT_STAY_ON_TARGET, { attacker: { trait: 'Vehicle' } })) // Stay on Target

const GRANT_HEROIC_SACRIFICE = 'GRANT_HEROIC_SACRIFICE'
registerCard(GRANT_HEROIC_SACRIFICE, {
  sourceCardId: 'SOR_150',
  ...attackBonus(2),
  abilities: [{
    trigger: 'onAttackEnd',
    description: 'When this unit deals combat damage: Defeat it.',
    effect: (s, ctx) => {
      const dealt = (ctx.combatDamageToBase ?? 0) + (ctx.combatDamageToDefender ?? 0)
      return dealt > 0 && findUnit(s, ctx.sourceInstanceId!) ? defeatUnit(s, ctx.sourceInstanceId!) : s
    },
  }],
})
registerCard('SOR_150', whenPlayed('Draw a card, then attack with a unit. For this attack, it gets +2/+0 and gains: "When this unit deals combat damage: Defeat it."', (s, ctx) => // Heroic Sacrifice
  offerAttack(drawCards(s, ctx.owner, 1), ctx.owner, ctx.sourceInstanceId!, { grantCardId: GRANT_HEROIC_SACRIFICE })))

const GRANT_TRENCH_RUN = 'GRANT_TRENCH_RUN'
registerCard(GRANT_TRENCH_RUN, {
  sourceCardId: 'JTL_156',
  ...attackBonus(4),
  makesDamageUnpreventable: (_s, _self, source) => source.cardId === GRANT_TRENCH_RUN,
  abilities: [{
    trigger: 'onAttack',
    description: "Discard 2 cards from the defending player's deck. Deal unpreventable damage equal to the difference in the discarded cards' costs to this unit.",
    effect: (s, ctx) => {
      const defending = opponentOf(ctx.owner)
      const p = s.players[defending]
      const milled = p.deck.slice(0, 2)
      const next = updatePlayer(s, defending, { deck: p.deck.slice(milled.length), discard: [...p.discard, ...milled] })
      // With fewer than two cards discarded there is no pair to take a difference of.
      if (milled.length < 2) return next
      const [a, b] = milled.map(id => s.cards[id]?.cost ?? 0)
      return dealDamageToUnit(next, ctx.sourceInstanceId!, Math.abs(a - b), { cardId: GRANT_TRENCH_RUN, controller: ctx.owner })
    },
  }],
})
registerCard('JTL_156', attackWithRider('Attack with a Fighter unit. For this attack, it gets +4/+0 and gains: "On Attack: Discard 2 cards from the defending player\'s deck. Deal unpreventable damage equal to the difference in the discarded cards\' costs to this unit."', GRANT_TRENCH_RUN, { attacker: { trait: 'Fighter' } })) // Trench Run

registerCard('JTL_174', whenPlayed('Choose a friendly unit. For each of its "On Attack" abilities, deal 2 damage to a different enemy unit. Then, attack with the chosen unit.', (s, ctx) => { // Hotshot Maneuver
  const targets = s.players[ctx.owner].units.map(u => u.instanceId)
  return targets.length ? pushChoice(s, { kind: 'selectFriendlyUnit', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, then: 'hotshotManeuver' }) : s
}))

registerCard('SOR_215', whenPlayed('You may attack with attached unit.', (s, ctx) => { // Snapshot Reflexes
  // An upgrade can be played on an enemy unit, and you can never attack with one of those.
  const host = findUnit(s, ctx.sourceInstanceId!)
  return host && host.owner === ctx.owner && eligibleAttacker(s, host.unit) && canAttackSomething(s, host.unit)
    ? pushChoice(s, { kind: 'mayAttack', id: `${ctx.sourceInstanceId}-snapshot`, controller: ctx.owner, unitId: host.unit.instanceId })
    : s
}))

registerCard('TS26_31', whenPlayed("Ready an enemy unit. If you do, it can't attack your base or units you control for this phase. Give a Shield token to a friendly unit.", (s, ctx) => { // Chaotic Diversion
  // Only an exhausted unit can be readied, so only one of those makes "if you do" true.
  const toReady = s.players[opponentOf(ctx.owner)].units.filter(u => u.exhausted).map(u => u.instanceId)
  const friendly = s.players[ctx.owner].units.map(u => u.instanceId)
  let next = toReady.length ? pushChoice(s, { kind: 'selectUnitToReady', id: ctx.sourceInstanceId!, controller: ctx.owner, targets: toReady, thenCannotAttack: true }) : s
  if (friendly.length) next = pushChoice(next, { kind: 'mayGiveTokens', id: `${ctx.sourceInstanceId}-shield`, controller: ctx.owner, token: TOKEN_SHIELD, count: 1, targets: friendly, optional: false })
  return next
}))

// ── When Played units and upgrades from the other sealed sets that existing choices already express ──
// Built on the event helpers above. `ctx.sourceInstanceId` is the unit itself, or for an upgrade the unit
// it is attached to. "Another" unit leaves the source out; "a unit" and "a friendly unit" count it.

type Pick = (s: GameState, u: UnitState, ctx: EventCtx) => boolean
type When = (s: GameState, ctx: EventCtx) => boolean
const picked = (s: GameState, ctx: EventCtx, test: Pick): UnitState[] => allUnits(s).filter(u => test(s, u, ctx))
const pickedIds = (s: GameState, ctx: EventCtx, test: Pick): string[] => picked(s, ctx, test).map(u => u.instanceId)
const pickAny: Pick = () => true
const pickFriendly: Pick = (s, u, ctx) => s.players[ctx.owner].units.includes(u)
const pickEnemy: Pick = (s, u, ctx) => s.players[opponentOf(ctx.owner)].units.includes(u)
const pickOther: Pick = (_s, u, ctx) => u.instanceId !== ctx.sourceInstanceId
const pickArena = (arena: 'ground' | 'space'): Pick => (_s, u) => u.arena === arena
const pickTrait = (trait: string): Pick => (s, u) => unitHasTrait(s, u, trait)
const pickAspect = (...aspects: string[]): Pick => (s, u) => (s.cards[u.cardId]?.aspects ?? []).some(a => aspects.includes(a))
const pickAll = (...tests: Pick[]): Pick => (s, u, ctx) => tests.every(t => t(s, u, ctx))
const pickGround = pickArena('ground')
/** "If you control a unit that ...", `pickOther` included for "another". */
const youControl = (s: GameState, ctx: EventCtx, ...tests: Pick[]): boolean => picked(s, ctx, pickAll(pickFriendly, ...tests)).length > 0
const friendlyWasDefeated: When = (s, ctx) => defeatedThisPhase(s, ctx.owner).length > 0
const always: When = () => true

/** "(If ...,) (you may) deal N damage to a unit that ...". Nothing is raised for 0 damage. */
const damageWp = (description: string, test: Pick, amount: number | ((s: GameState, ctx: EventCtx) => number), optional: boolean, when: When = always) =>
  whenPlayed(description, (s, ctx) => {
    const n = typeof amount === 'number' ? amount : amount(s, ctx)
    return when(s, ctx) && n > 0 ? damageChoice(s, ctx, n, picked(s, ctx, test), [], optional) : s
  })
/** "(If ...,) (you may) defeat, ready, return or exhaust a unit that ...". */
const targetWp = (description: string, kind: TargetKind, test: Pick, optional: boolean, when: When = always) =>
  whenPlayed(description, (s, ctx) => (when(s, ctx) ? targetChoice(s, ctx, kind, pickedIds(s, ctx, test), optional) : s))
/** "(If ...,) (you may) give a unit +X/+Y (or a keyword) for this phase". */
const buffWp = (description: string, test: Pick, buff: (s: GameState, ctx: EventCtx) => Buff, optional: boolean, when: When = always) =>
  whenPlayed(description, (s, ctx) => (when(s, ctx) ? lastingBuffChoice(s, ctx, pickedIds(s, ctx, test), buff(s, ctx), optional) : s))
/** "You may defeat an upgrade", tokens included as for Confiscate. */
const mayDefeatUpgradeWp = (description: string, test: (s: GameState, up: UpgradeRef) => boolean = () => true) => whenPlayed(description, (s, ctx) => {
  const candidates = upgradeCandidates(s).filter(up => test(s, up))
  return candidates.length ? pushChoice(s, { kind: 'selectUpgradeToDefeat', id: ctx.sourceInstanceId!, controller: ctx.owner, candidates, optional: true }) : s
})
/** "(If ...,) deal N damage to this unit", or to the attached unit for an upgrade. */
const damageSourceWp = (description: string, amount: number, when: When = always) =>
  whenPlayed(description, (s, ctx) => (when(s, ctx) ? dealDamageToUnit(s, ctx.sourceInstanceId!, amount) : s))
const readySelfWp = (description: string, when: When) =>
  whenPlayed(description, (s, ctx) => (when(s, ctx) ? readyUnit(s, ctx.sourceInstanceId!) : s))
/** The unit an upgrade is attached to, when it passes `test`. */
const hostPasses = (s: GameState, ctx: EventCtx, test: (s: GameState, host: UnitState) => boolean): UnitState | undefined => {
  const host = findUnit(s, ctx.sourceInstanceId!)?.unit
  return host && test(s, host) ? host : undefined
}
const namedAs = (name: string) => (s: GameState, u: UnitState): boolean => cardOf(s, u)?.name === name

// Damage to a chosen unit
registerCard('LAW_213', damageWp('You may deal 2 damage to an exhausted ground unit.', pickAll(pickGround, (_s, u) => u.exhausted), 2, true)) // Cutthroat Podracer
registerCard('LAW_045', damageWp('You may deal 3 damage to a ground unit. If you control a Command or Cunning unit, you may deal 5 damage to a ground unit instead.', pickGround, // Zeb Orellios
  (s, ctx) => (youControl(s, ctx, pickAspect('Command', 'Cunning')) ? 5 : 3), true))
registerCard('LAW_137', damageWp('If you control another Villainy unit, you may deal 2 damage to a ground unit.', pickGround, 2, true, (s, ctx) => youControl(s, ctx, pickOther, pickAspect('Villainy')))) // Ruthless Duo
registerCard('SEC_241', damageWp('If you control another Official unit, you may deal 2 damage to a ground unit.', pickGround, 2, true, (s, ctx) => youControl(s, ctx, pickOther, pickTrait('Official')))) // Political Bully
registerCard('SEC_254', damageWp('If you control a damaged unit, you may deal 2 damage to an enemy unit.', pickEnemy, 2, true, (s, ctx) => youControl(s, ctx, (_s, u) => u.damage > 0))) // Heroic ARC-170
registerCard('LOF_133', damageWp('You may deal 2 damage to a Force unit.', pickTrait('Force'), 2, true)) // Purge Trooper
registerCard('LOF_158', damageWp('If you control another Aggression unit, you may deal 2 damage to a ground unit.', pickGround, 2, true, (s, ctx) => youControl(s, ctx, pickOther, pickAspect('Aggression')))) // Hyena Bomber
registerCard('LOF_145', damageWp('If you have the initiative, deal 2 damage to an enemy ground unit.', pickAll(pickEnemy, pickGround), 2, false, (s, ctx) => s.initiative === ctx.owner)) // Jedi Knight
registerCard('LOF_259', damageWp('Deal 1 damage to a ground unit.', pickGround, 1, false)) // Ravening Gundark
registerCard('LOF_198', damageWp('You may deal 2 damage to an exhausted unit.', (_s, u) => u.exhausted, 2, true)) // Stinger Mantis
registerCard('JTL_239', damageWp('You may deal 2 damage to a damaged unit.', (_s, u) => u.damage > 0, 2, true)) // TIE Dagger Vanguard
registerCard('JTL_153', damageWp('You may deal damage to a unit equal to the number of cards in your hand.', pickAny, (s, ctx) => s.players[ctx.owner].hand.length, true)) // Rebellious Hammerhead
registerCard('JTL_102', damageWp('You may deal damage to a unit equal to the number of friendly space units.', pickAny, (s, ctx) => unitsIn(s, ctx.owner, 'space').length, true)) // Resistance Blue Squadron
registerCard('SHD_254', damageWp('If you control another Bounty Hunter unit, you may deal 2 damage to a ground unit.', pickGround, 2, true, (s, ctx) => youControl(s, ctx, pickOther, pickTrait('Bounty Hunter')))) // Bounty Guild Initiate
registerCard('SHD_235', damageWp('Deal 2 damage to a friendly unit.', pickFriendly, 2, false)) // Ruthless Assassin
registerCard('SOR_132', damageWp('You may deal 3 damage to a space unit.', pickArena('space'), 3, true)) // Imperial Interceptor
registerCard('SOR_090', damageWp('You may deal damage to a unit equal to the number of resources you control.', pickAny, (s, ctx) => s.players[ctx.owner].resources.length, true)) // Devastator
registerCard('TWI_149', damageWp('Choose an enemy unit. Deal 1 damage to it for each friendly Republic unit.', pickEnemy, // Low Altitude Gunship
  (s, ctx) => picked(s, ctx, pickAll(pickFriendly, pickTrait('Republic'))).length, false))
registerCard('SHD_158', whenPlayed('Deal 2 damage to each other ground unit.', (s, ctx) => // Wild Rancor
  pickedIds(s, ctx, pickAll(pickOther, pickGround)).reduce((acc, id) => dealDamageToUnit(acc, id, 2), s)))

// Defeat
registerCard('LAW_124', targetWp('You may defeat a non-leader unit with 4 or less remaining HP.', 'selectUnitToDefeat', (s, u) => nonLeader(s, u) && remainingHp(s, u) <= 4, true)) // Industrious Team
registerCard('LOF_071', targetWp('You may defeat a space unit with 6 or less remaining HP.', 'selectUnitToDefeat', (s, u) => u.arena === 'space' && remainingHp(s, u) <= 6, true)) // Grappling Guardian
registerCard('TWI_036', targetWp('Defeat an enemy unit with 2 or less remaining HP.', 'selectUnitToDefeat', (s, u, ctx) => pickEnemy(s, u, ctx) && remainingHp(s, u) <= 2, false)) // Devastating Gunship
registerCard('SOR_038', targetWp('You may defeat a unit with 4 or less remaining HP.', 'selectUnitToDefeat', (s, u) => remainingHp(s, u) <= 4, true)) // Count Dooku
registerCard('SOR_162', mayDefeatUpgradeWp('You may defeat an upgrade.')) // Disabling Fang Fighter
registerCard('SEC_163', mayDefeatUpgradeWp('You may defeat an upgrade.')) // Outer Rim Constable
registerCard('LOF_155', mayDefeatUpgradeWp('You may defeat a non-unique upgrade.', (s, up) => !s.cards[up.cardId]?.unique)) // DRK-1 Probe Droid

// Ready
registerCard('LAW_061', targetWp('You may ready another Bounty Hunter unit.', 'selectUnitToReady', pickAll(pickOther, pickTrait('Bounty Hunter')), true)) // Asajj Ventress
registerCard('SHD_189', targetWp('You may ready another unit with power equal to or less than the number of upgrades on enemy units.', 'selectUnitToReady', (s, u, ctx) => // Slaver's Freighter
  pickOther(s, u, ctx) && effectivePower(s, u) <= s.players[opponentOf(ctx.owner)].units.reduce((n, e) => n + e.upgrades.length, 0), true))
registerCard('JTL_135', readySelfWp('If an opponent controls more space units than you, ready this unit.', (s, ctx) => // Special Forces TIE Fighter
  unitsIn(s, opponentOf(ctx.owner), 'space').length > unitsIn(s, ctx.owner, 'space').length))
registerCard('TWI_137', readySelfWp('If you control fewer units than an opponent, ready this unit.', (s, ctx) => // Savage Opress
  s.players[ctx.owner].units.length < s.players[opponentOf(ctx.owner)].units.length))
registerCard('SOR_148', readySelfWp('If a base has 15 or more damage on it, ready this unit.', s => BOTH_BASES.some(p => s.players[p].base.damage >= 15))) // Guerilla Attack Pod
registerCard('LOF_234', targetWp('If you control a Sith leader unit, you may ready this unit.', 'selectUnitToReady', (_s, u, ctx) => u.instanceId === ctx.sourceInstanceId, true, // Darth Malak
  (s, ctx) => youControl(s, ctx, (s2, u) => isLeaderUnit(s2, u) && unitHasTrait(s2, u, 'Sith'))))

// Return to hand
registerCard('SOR_202', targetWp("You may return a non-leader unit to its owner's hand.", 'selectUnitToReturn', nonLeader, true)) // Cantina Bouncer
registerCard('LAW_241', targetWp("You may return a non-leader unit to its owner's hand.", 'selectUnitToReturn', nonLeader, true)) // The Blade Wing
registerCard('LAW_089', targetWp("You may return a non-leader unit that costs 2 or less to its owner's hand. If you control a Command or Aggression unit, you may return a non-leader unit that costs 4 or less instead.", 'selectUnitToReturn', // Kanan Jarrus
  (s, u, ctx) => nonLeader(s, u) && printedCost(s, u) <= (youControl(s, ctx, pickAspect('Command', 'Aggression')) ? 4 : 2), true))
registerCard('LAW_240', targetWp("You may return another friendly non-leader unit to its owner's hand.", 'selectUnitToReturn', (s, u, ctx) => pickFriendly(s, u, ctx) && pickOther(s, u, ctx) && nonLeader(s, u), true)) // Milodon Rider
registerCard('TWI_191', targetWp("You may return a friendly non-leader, non-Vehicle unit to its owner's hand.", 'selectUnitToReturn', (s, u, ctx) => pickFriendly(s, u, ctx) && nonLeader(s, u) && nonVehicle(s, u), true)) // Wolf Pack Escort
registerCard('SOR_209', targetWp("Return a friendly non-leader unit to its owner's hand.", 'selectUnitToReturn', (s, u, ctx) => pickFriendly(s, u, ctx) && nonLeader(s, u), false)) // Pirated Starfighter

// Shield tokens, exhausting, healing
registerCard('LOF_242', whenPlayed('You may give a Shield token to a unit with Sentinel.', (s, ctx) => // Refugee of The Path
  shieldChoice(s, ctx, pickedIds(s, ctx, (s2, u) => unitHasKeyword(s2, u, 'Sentinel')), true)))
registerCard('JTL_044', whenPlayed('You may give a Shield token to a damaged Vehicle unit.', (s, ctx) => // Echo Base Engineer
  shieldChoice(s, ctx, pickedIds(s, ctx, (s2, u) => u.damage > 0 && unitHasTrait(s2, u, 'Vehicle')), true)))
registerCard('JTL_199', whenPlayed('If another player controls 3 or more exhausted units, give a Shield token to a unit.', (s, ctx) => // Blade Squadron B-Wing
  (s.players[opponentOf(ctx.owner)].units.filter(u => u.exhausted).length >= 3 ? shieldChoice(s, ctx, pickedIds(s, ctx, pickAny), false) : s)))
registerCard('JTL_217', targetWp('If you control another space unit, you may exhaust a unit.', 'mayExhaustUnit', pickAny, true, (s, ctx) => youControl(s, ctx, pickOther, pickArena('space')))) // Death Space Skirmisher
registerCard('SOR_178', targetWp('If you control another Cunning unit, exhaust an enemy unit that costs 4 or less.', 'mayExhaustUnit', (s, u, ctx) => pickEnemy(s, u, ctx) && printedCost(s, u) <= 4, false, // Cartel Spacer
  (s, ctx) => youControl(s, ctx, pickOther, pickAspect('Cunning'))))
registerCard('SOR_039', whenPlayed('Exhaust all ground units.', s => groundUnits(s).reduce((acc, u) => exhaustUnit(acc, u.instanceId), s))) // AT-AT Suppressor
registerCard('TWI_109', whenPlayed('If you control another Republic unit, you may heal 3 damage from a base.', (s, ctx) => // 501st Liberator
  (youControl(s, ctx, pickOther, pickTrait('Republic')) ? healChoice(s, ctx, 3, [], BOTH_BASES, true) : s)))
registerCard('LAW_035', whenPlayed('You may heal 2 damage from a unit. If you control an Aggression or Cunning unit, you may heal 4 damage from a unit instead.', (s, ctx) => // Ezra Bridger
  healChoice(s, ctx, youControl(s, ctx, pickAspect('Aggression', 'Cunning')) ? 4 : 2, pickedIds(s, ctx, pickAny), [], true)))

// For this phase, on one unit
registerCard('SEC_206', buffWp('You may give a unit -3/-0 for this phase.', pickAny, () => ({ power: -3 }), true)) // Emissaries from Ryloth
registerCard('LAW_151', buffWp('Another friendly unit gets +1/+1 for this phase.', pickAll(pickFriendly, pickOther), () => ({ power: 1, hp: 1 }), false)) // Profiteering Hunter
registerCard('LOF_114', buffWp('You may give another friendly unit Overwhelm for this phase.', pickAll(pickFriendly, pickOther), () => ({ keywords: [{ name: 'Overwhelm' }] }), true)) // Kaadu
registerCard('SOR_086', buffWp('Give a unit Sentinel for this phase.', pickAny, () => ({ keywords: [{ name: 'Sentinel' }] }), false)) // Gladiator Star Destroyer
registerCard('TWI_031', buffWp('If a friendly unit was defeated this phase, you may give a unit -1/-1 for this phase.', pickAny, () => ({ power: -1, hp: -1 }), true, friendlyWasDefeated)) // Rune Haako
registerCard('SOR_051', buffWp('Give an enemy unit -3/-3 for this phase. If a friendly unit was defeated this phase, give that enemy unit -6/-6 for this phase instead.', pickEnemy, // Luke Skywalker
  (s, ctx) => (friendlyWasDefeated(s, ctx) ? { power: -6, hp: -6 } : { power: -3, hp: -3 }), false))

// Draw and bases
registerCard('SOR_111', whenPlayed('Draw a card.', (s, ctx) => drawCards(s, ctx.owner, 1))) // Patrolling V-Wing
registerCard('SHD_249', whenPlayed('If you control another Wookiee unit, draw a card.', (s, ctx) => // Wookiee Warrior
  (youControl(s, ctx, pickOther, pickTrait('Wookiee')) ? drawCards(s, ctx.owner, 1) : s)))
registerCard('LOF_121', whenPlayed('Draw a card for each friendly unit with 7 or more remaining HP.', (s, ctx) => { // The Purrgil King
  const n = picked(s, ctx, pickAll(pickFriendly, (s2, u) => remainingHp(s2, u) >= 7)).length
  return n > 0 ? drawCards(s, ctx.owner, n) : s
}))
registerCard('SOR_068', whenPlayed('If you control another Vigilance unit, heal 4 damage from your base.', (s, ctx) => // Cargo Juggernaut
  (youControl(s, ctx, pickOther, pickAspect('Vigilance')) ? healBase(s, ctx.owner, 4) : s)))
registerCard('LAW_109', whenPlayed('If a friendly unit was defeated this phase, heal 4 damage from your base.', (s, ctx) => // Tantive IV
  (friendlyWasDefeated(s, ctx) ? healBase(s, ctx.owner, 4) : s)))
registerCard('SEC_102', whenPlayed('Heal 2 damage from your base for each friendly Official unit.', (s, ctx) => { // Renowned Dignitaries
  const n = picked(s, ctx, pickAll(pickFriendly, pickTrait('Official'))).length
  return n > 0 ? healBase(s, ctx.owner, 2 * n) : s
}))
registerCard('TWI_160', whenPlayed('If you control another Separatist unit, deal 2 damage to an enemy base.', (s, ctx) => // Vanguard Droid Bomber
  (youControl(s, ctx, pickOther, pickTrait('Separatist')) ? dealDamageToBase(s, opponentOf(ctx.owner), 2) : s)))

// This unit
registerCard('SEC_240', damageSourceWp('Deal 2 damage to this unit.', 2)) // Hutt Cartel Starfighter
registerCard('JTL_248', damageSourceWp('Deal 3 damage to this unit.', 3)) // Dilapidated Ski Speeder
registerCard('TWI_059', damageSourceWp('Deal 2 damage to this unit.', 2)) // Royal Guard Attaché
registerCard('JTL_158', damageSourceWp('If you control no other Fighter units, deal 1 damage to this unit.', 1, (s, ctx) => !youControl(s, ctx, pickOther, pickTrait('Fighter')))) // Crackshot V-Wing
registerCard('JTL_067', whenPlayed('Give 2 Shield tokens to this unit.', (s, ctx) => giveTokens(s, ctx.sourceInstanceId!, TOKEN_SHIELD, 2))) // Cloaked StarViper

// Upgrades acting on the attached unit
registerCard('TWI_155', damageSourceWp('Deal 2 damage to attached unit.', 2)) // Twice the Pride
registerCard('LAW_127', whenPlayed('Exhaust attached unit.', (s, ctx) => exhaustUnit(s, ctx.sourceInstanceId!))) // Kill Switch
registerCard('TWI_070', whenPlayed('Exhaust attached unit.', (s, ctx) => exhaustUnit(s, ctx.sourceInstanceId!))) // Perilous Position
registerCard('SOR_053', { // Luke's Lightsaber
  attachRestriction: nonVehicle,
  ...whenPlayed('If attached unit is Luke Skywalker, heal all damage from him and give a Shield token to him.', (s, ctx) => {
    const luke = hostPasses(s, ctx, namedAs('Luke Skywalker'))
    return luke ? giveToken(healUnit(s, luke.instanceId, luke.damage), luke.instanceId, TOKEN_SHIELD) : s
  }),
})
registerCard('SHD_073', { // Mandalorian Armor
  attachRestriction: nonVehicle,
  ...whenPlayed('If attached unit is a Mandalorian, give a Shield token to it.', (s, ctx) =>
    (hostPasses(s, ctx, (s2, u) => unitHasTrait(s2, u, 'Mandalorian')) ? giveToken(s, ctx.sourceInstanceId!, TOKEN_SHIELD) : s)),
})
registerCard('TWI_152', { // Mace Windu's Lightsaber
  attachRestriction: nonVehicle,
  ...whenPlayed('If attached unit is Mace Windu, draw 2 cards.', (s, ctx) => (hostPasses(s, ctx, namedAs('Mace Windu')) ? drawCards(s, ctx.owner, 2) : s)),
})
registerCard('TWI_168', whenPlayed('If an opponent controls more units than you, draw a card.', (s, ctx) => // Old Access Codes
  (s.players[opponentOf(ctx.owner)].units.length > s.players[ctx.owner].units.length ? drawCards(s, ctx.owner, 1) : s)))

// ── Constant abilities on units and upgrades from the other sealed sets ──
// `u` is the unit the ability is on: the unit itself, or for an upgrade the unit it is attached to. A keyword the
// source data lists as the card's own, when the card only gains it conditionally or gives it to other units, is
// stripped in `cardDataCorrections.ts` and granted here.

type Holds = (s: GameState, u: UnitState) => boolean
const friendliesOf = (s: GameState, u: UnitState): UnitState[] => { const o = unitOwner(s, u); return o ? s.players[o].units : [] }
const enemiesOf = (s: GameState, u: UnitState): UnitState[] => { const o = unitOwner(s, u); return o ? s.players[opponentOf(o)].units : [] }
const resourcesOf = (s: GameState, u: UnitState): number => { const o = unitOwner(s, u); return o ? s.players[o].resources.length : 0 }
const isAspect = (aspect: string): Holds => (s, x) => (s.cards[x.cardId]?.aspects ?? []).includes(aspect)
const isTrait = (trait: string): Holds => (s, x) => unitHasTrait(s, x, trait)
const isNamed = (name: string): Holds => (s, x) => cardOf(s, x)?.name === name
const another = (test: Holds): Holds => (s, u) => controlsAnother(s, u, test)
const controlsA = (test: Holds): Holds => (s, u) => friendliesOf(s, u).some(x => test(s, x))
const enemyHas = (test: Holds): Holds => (s, u) => enemiesOf(s, u).some(x => test(s, x))
const holdsInitiative: Holds = (s, u) => unitOwner(s, u) === s.initiative
const undamaged: Holds = (_s, u) => u.damage === 0
const upgraded: Holds = (_s, u) => isUpgraded(u)
const anyHost: Holds = () => true
const enemyDefeatedThisPhase: Holds = (s, u) => { const o = unitOwner(s, u); return o !== undefined && defeatedThisPhase(s, opponentOf(o)).length > 0 }
/** "(as a leader or unit)": the player's leader, deployed or not, or any unit of theirs with that name. */
const playerControlsNamed = (s: GameState, owner: PlayerId, name: string): boolean =>
  s.cards[s.players[owner].leader.cardId]?.name === name || s.players[owner].units.some(x => cardOf(s, x)?.name === name)
const controlsNamed = (name: string): Holds => (s, u) => { const o = unitOwner(s, u); return o !== undefined && playerControlsNamed(s, o, name) }
/** "You control a <trait> upgrade": one the unit's controller owns, on any unit. */
const controlsUpgradeWithTrait = (s: GameState, u: UnitState, trait: string): boolean => {
  const o = unitOwner(s, u)
  return o !== undefined && allUnits(s).some(x => x.upgrades.some(up => up.owner === o && (s.cards[up.cardId]?.traits ?? []).some(t => t.toLowerCase() === trait.toLowerCase())))
}
const perEach = (n: number, power: number, hp = 0) => (n > 0 ? { power: n * power, hp: n * hp } : {})
const KW = {
  sentinel: { name: 'Sentinel' }, ambush: { name: 'Ambush' }, overwhelm: { name: 'Overwhelm' }, saboteur: { name: 'Saboteur' }, grit: { name: 'Grit' },
  raid: (value: number): KeywordInstance => ({ name: 'Raid', value }),
  restore: (value: number): KeywordInstance => ({ name: 'Restore', value }),
}
/** "While <condition>, this unit (or attached unit) gains <keywords>". */
const gains = (when: Holds, ...keywords: KeywordInstance[]) => ({ conditionalKeywords: (s: GameState, u: UnitState) => (when(s, u) ? keywords : []) })
/** "Each (other) friendly <test> unit gets/gains ...". `others` leaves the source out. */
const friendlyAura = (test: Holds, contribution: { power?: number; hp?: number; keywords?: KeywordInstance[] }, others: boolean) => ({
  aura: (s: GameState, source: UnitState, target: UnitState, friendly: boolean) =>
    (friendly && (!others || target.instanceId !== source.instanceId) && test(s, target) ? contribution : undefined),
})

// Conditional keywords on the unit itself
registerCard('LAW_105', gains(upgraded, KW.sentinel)) // Cinta Kaz
registerCard('SEC_201', gains(controlsNamed('Padmé Amidala'), KW.raid(2))) // Anakin Skywalker
registerCard('SEC_079', gains((s, u) => friendliesOf(s, u).length > enemiesOf(s, u).length, KW.sentinel)) // Corrupt Politician
registerCard('SEC_249', gains(another(isTrait('Official')), KW.raid(2))) // High Command Councilor
registerCard('SEC_134', gains(enemyHas((_s, x) => x.damage > 0), KW.raid(2))) // Hunting Assassin Droid
registerCard('SEC_116', gains(controlsA(isTrait('Official')), KW.restore(2))) // Nubian Star Skiff
registerCard('SEC_063', gains(undamaged, KW.sentinel)) // Rotunda Senate Guards
registerCard('SEC_029', gains(upgraded, KW.grit)) // Zam Wesell
registerCard('LOF_162', gains(another(isAspect('Aggression')), KW.raid(2))) // Hunting Nexu
registerCard('LOF_212', gains(enemyHas((_s, x) => x.exhausted), KW.raid(2))) // Life Wind Sage
registerCard('LOF_118', gains(enemyHas(isTrait('Force')), KW.ambush)) // Terentatek
registerCard('JTL_107', gains(controlsA(isTrait('Vehicle')), KW.sentinel)) // Bunker Defender
registerCard('JTL_081', gains(controlsA((_s, x) => isTokenCard(x.cardId)), KW.raid(1))) // First Order TIE Fighter
registerCard('JTL_257', gains(another(isTrait('Fighter')), KW.raid(2))) // Flanking Fang Fighter
registerCard('JTL_113', gains((s, u) => resourcesOf(s, u) >= 6, KW.sentinel)) // Homestead Militia
registerCard('TWI_062', gains(undamaged, KW.restore(2))) // Daughter of Dathomir
registerCard('TWI_081', gains(another(isTrait('Separatist')), KW.ambush)) // Droid Commando
registerCard('TWI_054', gains((s, u) => enemiesOf(s, u).length >= 3, KW.sentinel)) // Duchess's Champion
registerCard('TWI_180', gains(another(isTrait('Separatist')), KW.raid(2))) // Separatist Commando
registerCard('SHD_169', gains(upgraded, KW.overwhelm)) // Clan Challengers
registerCard('SHD_112', gains(another(isAspect('Command')), KW.sentinel)) // Gamorrean Retainer
registerCard('SHD_247', gains(upgraded, KW.sentinel)) // Protector of the Throne
registerCard('SHD_034', gains(upgraded, KW.sentinel)) // Supercommando Squad
registerCard('SOR_065', gains(holdsInitiative, KW.sentinel)) // Baze Malbus
registerCard('SOR_114', gains(another(isAspect('Command')), KW.ambush)) // Escort Skiff
registerCard('SOR_249', gains(another(isTrait('Vehicle')), KW.ambush)) // Frontier AT-RT
registerCard('SOR_211', gains(another(isAspect('Cunning')), KW.sentinel)) // Gamorrean Guards
registerCard('SOR_159', gains(another(isAspect('Aggression')), KW.raid(2))) // Partisan Insurgent
registerCard('SOR_048', gains(undamaged, KW.sentinel)) // Vigilant Honor Guards
registerCard('TS26_20', gains(undamaged, KW.sentinel)) // 501st Veteran
registerCard('SOR_082', { // Emperor's Royal Guard
  ...gains(controlsA(isTrait('Official')), KW.sentinel),
  statModifier: (s, u) => (controlsNamed('Emperor Palpatine')(s, u) ? { hp: 1 } : {}),
})
registerCard('TWI_130', { // Bo-Katan Kryze
  ...gains(another(isTrait('Mandalorian')), KW.overwhelm, KW.saboteur),
  statModifier: (s, u) => (another(isTrait('Trooper'))(s, u) ? { power: 1 } : {}),
})
registerCard('TWI_143', { ...gains(enemyDefeatedThisPhase, KW.saboteur), statModifier: (s, u) => (enemyDefeatedThisPhase(s, u) ? { power: 1 } : {}) }) // Jyn Erso
registerCard('TS26_50', { ...gains(undamaged, KW.sentinel), statModifier: (s, u) => perEach(resourcesOf(s, u), 1, 1) }) // General Grievous

// Stat modifiers on the unit itself
const whileDefending = { statModifier: (_s: GameState, _u: UnitState, ctx: { defending?: boolean }) => (ctx.defending ? { power: 2 } : {}) }
registerCard('SEC_151', { statModifier: (s, u) => { const o = unitOwner(s, u); return o && s.players[o].resources.length < s.players[opponentOf(o)].resources.length ? { power: 2 } : {} } }) // Kazuda Xiono
registerCard('SEC_114', { statModifier: (s, u) => perEach(friendliesOf(s, u).filter(x => x.instanceId !== u.instanceId && x.exhausted).length, 1) }) // Kino Loy
registerCard('SEC_108', { statModifier: (s, u) => (holdsInitiative(s, u) ? { power: 2 } : {}) }) // Senator's Aide
registerCard('LOF_062', { statModifier: (_s, u) => perEach(u.upgrades.length, 1, 1) }) // Axe Woves
registerCard('LOF_083', { statModifier: (s, u) => { // Captain Enoch: Trooper units in your discard pile
  const o = unitOwner(s, u)
  return o ? perEach(s.players[o].discard.filter(id => s.cards[id]?.type === 'unit' && (s.cards[id]?.traits ?? []).some(t => t.toLowerCase() === 'trooper')).length, 1) : {}
} })
registerCard('LOF_049', whileDefending) // Jedi Guardian
registerCard('SHD_042', whileDefending) // Concord Dawn Interceptors
registerCard('LOF_244', { statModifier: (s, u) => ({ power: (another(isTrait('Jedi'))(s, u) ? 1 : 0) + (controlsUpgradeWithTrait(s, u, 'Lightsaber') ? 1 : 0) }) }) // Jedi Vector
registerCard('LOF_060', { statModifier: (s, u) => (controlsA(isTrait('Force'))(s, u) || controlsUpgradeWithTrait(s, u, 'Force') ? { power: 1, hp: 1 } : {}) }) // Padawan Starfighter
registerCard('LOF_153', { statModifier: (_s, u) => perEach(u.damage, 2) }) // Paz Vizsla
registerCard('LOF_233', { statModifier: (_s, u) => (u.damage > 0 ? { power: 3 } : {}) }) // Scimitar
registerCard('LOF_081', { statModifier: (s, u) => (another(isAspect('Villainy'))(s, u) ? { power: 2 } : {}) }) // Sith Legionnaire
registerCard('JTL_115', { statModifier: (s, u) => perEach(friendliesOf(s, u).filter(x => x.instanceId !== u.instanceId && x.arena === 'space').length, 1, 1) }) // Clone Combat Squadron
registerCard('JTL_052', { statModifier: (_s, u) => perEach(u.damage, -1) }) // D'Qar Cargo Frigate
registerCard('JTL_256', { statModifier: (s, u) => perEach(friendliesOf(s, u).filter(x => x.instanceId !== u.instanceId && isNamed('Swarming Vulture Droid')(s, x)).length, 1) }) // Swarming Vulture Droid
registerCard('TWI_142', { statModifier: (s, u) => { const o = unitOwner(s, u); return o && s.players[o].base.damage >= 15 ? { power: 2 } : {} } }) // Anakin's Interceptor
registerCard('TWI_163', { statModifier: (s, u) => (another(isTrait('Trooper'))(s, u) ? { power: 2 } : {}) }) // Relentless Rocket Droid
registerCard('SHD_056', { statModifier: (_s, u) => (isUpgraded(u) ? { power: 1, hp: 1 } : {}) }) // Follower of The Way
registerCard('SHD_083', { statModifier: (s, u) => (resourcesOf(s, u) >= 6 ? { power: 2 } : {}) }) // Seasoned Shoretrooper
registerCard('SOR_118', { statModifier: (s, u) => perEach(resourcesOf(s, u), 1, 1) }) // 97th Legion
registerCard('SOR_161', { statModifier: (s, u) => (holdsInitiative(s, u) ? { power: 2 } : {}) }) // Ardent Sympathizer

// Auras on other units
registerCard('LAW_139', friendlyAura((s, x) => isLeaderUnit(s, x), { power: 2, hp: 2 }, false)) // Admiral Motti
registerCard('SEC_047', friendlyAura(anyHost, { keywords: [KW.restore(1)] }, true)) // Coronet
registerCard('LOF_169', friendlyAura(isTrait('Droid'), { keywords: [KW.raid(2)] }, false)) // Invasion Control Ship
registerCard('LOF_089', friendlyAura(isTrait('Vehicle'), { power: 6, hp: 6 }, true)) // Supremacy
registerCard('JTL_161', friendlyAura(isTrait('Vehicle'), { power: 1, keywords: [KW.overwhelm] }, false)) // Captain Tarkin
registerCard('JTL_085', friendlyAura((_s, x) => x.arena === 'space', { power: 1, hp: 1 }, true)) // Victor Leader
registerCard('TWI_092', friendlyAura(isAspect('Heroism'), { hp: 1 }, true)) // Admiral Yularen
registerCard('SHD_188', friendlyAura(isNamed('Zuckuss'), { power: 1, hp: 1, keywords: [KW.ambush] }, false)) // 4-LOM
registerCard('SHD_190', friendlyAura(isNamed('4-LOM'), { power: 1, hp: 1, keywords: [KW.saboteur] }, false)) // Zuckuss
registerCard('SOR_079', friendlyAura((s, x) => nonLeader(s, x) && printedCost(s, x) >= 6, { keywords: [KW.ambush] }, false)) // Admiral Piett
registerCard('SOR_242', friendlyAura(isTrait('Rebel'), { power: 1, hp: 1 }, true)) // General Dodonna
registerCard('SOR_230', friendlyAura(isTrait('Imperial'), { power: 1, hp: 1 }, true)) // General Veers
registerCard('SOR_144', friendlyAura(isAspect('Heroism'), { keywords: [KW.raid(1)] }, true)) // Red Three
registerCard('SOR_100', friendlyAura(isTrait('Vehicle'), { power: 1, hp: 1, keywords: [KW.ambush] }, false)) // Wedge Antilles
registerCard('TS26_40', friendlyAura(isTrait('Republic'), { keywords: [KW.restore(1)] }, true)) // Obi-Wan Kenobi
registerCard('SHD_037', { aura: (s, _src, tgt, friendly) => (!friendly && nonLeader(s, tgt) ? { power: -2, hp: -2 } : undefined) }) // Supreme Leader Snoke
registerCard('SEC_224', { // Vel Sartha: each exhausted enemy unit gets -2/-0 while defending
  aura: (_s, _src, tgt, friendly, combat) => (!friendly && tgt.exhausted && combat?.defenderInstanceId === tgt.instanceId ? { power: -2 } : undefined),
})
registerCard('SOR_212', { // Strafing Gunship: attacks ground units; a ground defender gets -2/-0 while it attacks
  attacksEitherArena: () => true,
  aura: (_s, src, tgt, _friendly, combat) =>
    (combat?.attackerInstanceId === src.instanceId && combat.defenderInstanceId === tgt.instanceId && tgt.arena === 'ground' ? { power: -2 } : undefined),
})

// Costs, entering ready and combat rules
registerCard('LAW_110', { costModifier: (s, p) => -s.players[p].units.filter(x => x.damage > 0).length }) // Phoenix Squadron Fighters
registerCard('JTL_163', { costModifier: s => -groundUnits(s).filter(x => x.damage > 0).length }) // AT-DP Occupier
registerCard('JTL_204', { costModifier: (s, p) => (unitsIn(s, opponentOf(p), 'space').length >= 3 ? -3 : 0) }) // Home One
registerCard('TWI_197', { costModifier: (s, p) => (s.players[p].units.length >= 3 ? -1 : 0) }) // Republic Attack Pod
registerCard('TWI_098', { costModifier: (s, p) => -s.players[opponentOf(p)].units.length }) // Republic Defense Carrier
registerCard('SOR_248', { costModifier: (s, p) => (s.players[p].units.some(x => unitHasTrait(s, x, 'Trooper')) ? -1 : 0) }) // Volunteer Soldier
registerCard('LAW_223', { entersReady: (s, p) => s.players[p].units.some(x => !cardOf(s, x)?.unique) }) // Rose Tico
registerCard('LAW_210', { entersReady: (s, p) => playerControlsNamed(s, p, 'Jabba the Hutt') }) // Salacious Crumb
registerCard('SEC_170', { entersReady: (s, p) => unitsIn(s, opponentOf(p), 'ground').length === 0 }) // Corellian Hounds
registerCard('SEC_135', { cannotBeAttacked: (_s, u) => !u.exhausted }) // Muckraker Crab Droid
registerCard('SOR_198', { dealsDamageFirst: () => true }) // Han Solo: while attacking, deals combat damage first
registerCard('SHD_234', { dealsDamageFirst: () => true }) // Incinerator Trooper: while attacking, deals combat damage first

// Upgrades
registerCard('SEC_071', gains((_s, u) => u.exhausted, KW.sentinel)) // Disciples' Devotion
registerCard('LOF_215', { attachRestriction: nonVehicle, ...gains(anyHost, KW.saboteur) }) // Ascension Cable
registerCard('LOF_261', { // Constructed Lightsaber
  attachRestriction: isTrait('Force'),
  conditionalKeywords: (s, u) => {
    const heroism = isAspect('Heroism')(s, u)
    const villainy = isAspect('Villainy')(s, u)
    return [...(heroism ? [KW.restore(2)] : []), ...(villainy ? [KW.raid(2)] : []), ...(heroism || villainy ? [] : [KW.sentinel])]
  },
})
registerCard('LOF_238', { attachRestriction: nonVehicle, ...gains(isTrait('Sith'), KW.grit) }) // Darth Revan's Lightsabers
registerCard('LOF_053', { attachRestriction: nonVehicle, ...gains(isTrait('Force'), KW.restore(1)) }) // Heirloom Lightsaber
registerCard('LAW_128', { attachRestriction: nonLeader, ...gains(anyHost, KW.grit) }) // Veiled Strength
registerCard('TWI_071', gains(anyHost, KW.sentinel)) // Unshakeable Will
registerCard('TWI_236', { // Grievous's Wheel Bike
  attachRestriction: nonVehicle,
  costModifier: (s, _p, target) => (target && cardOf(s, target)?.name === 'General Grievous' ? -2 : 0),
  ...gains(anyHost, KW.overwhelm),
})
registerCard('SOR_070', gains(anyHost, KW.restore(2))) // Devotion
registerCard('SOR_166', gains(anyHost, KW.saboteur)) // Infiltrator's Skill
registerCard('SOR_057', gains(anyHost, KW.sentinel)) // Protector
registerCard('LOF_074', { attachRestriction: isTrait('Force') }) // Bolstered Endurance
registerCard('LOF_151', { attachRestriction: (s, t) => unitHasTrait(s, t, 'Jedi') && nonVehicle(s, t) }) // Knight's Saber
registerCard('TS26_79', { attachRestriction: (s, t) => printedCost(s, t) <= 4 }) // Underestimated
registerCard('LAW_129', { costModifier: (s, _p, target) => (target && s.cards[target.cardId]?.unique ? -1 : 0) }) // Mastery: 1 less on a unique unit
registerCard('SHD_069', { grantedTraits: () => ['Mandalorian'] }) // Foundling
registerCard('LAW_150', { attachRestriction: nonVehicle, grantedTraits: () => ['Rebel'], ...friendlyAura(isTrait('Rebel'), { power: 2, hp: 2 }, true) }) // Fulcrum
registerCard('SOR_072', { cannotAttackBases: () => true }) // Entrenched

// ── The remainder of the other sets' events: wipes, and the two unsweepable sets ──────────────
// Two groups taken whole. The wipes have to defeat **simultaneously** (`defeatUnits`), because a
// looped single defeat gives each unit's whenDefeated its own batch. TS26 and IBH are both under the
// 200-card sealed minimum, so `--sweep` refuses them and `eventsRemainder.test.ts` is the whole of
// their evidence: every one of those cards asserts its eligible targets as well as its effect.

const enemyUnitsOf = (s: GameState, owner: PlayerId): UnitState[] => s.players[opponentOf(owner)].units
const nonLeaderUnits = (s: GameState): UnitState[] => allUnits(s).filter(u => !isLeaderUnit(s, u))

/** "Defeat all <matching> units", as one event. */
const wipeEvent = (description: string, test: (s: GameState, u: UnitState) => boolean) =>
  whenPlayed(description, s => defeatUnits(s, allUnits(s).filter(u => test(s, u)).map(u => u.instanceId)))

registerCard('SOR_043', wipeEvent('Defeat all units.', () => true)) // Superlaser Blast
registerCard('SEC_078', wipeEvent('Defeat all space units.', (_s, u) => u.arena === 'space')) // Hyperspace Disaster
// A Shield token is an upgrade, so a shielded unit counts as upgraded and survives.
registerCard('JTL_080', wipeEvent("Defeat each unit that isn't upgraded.", (_s, u) => u.upgrades.length === 0)) // Nebula Ignition

registerCard('LAW_044', whenPlayed("Defeat all units. For each enemy unit defeated this way, deal 1 damage to its controller's base.", (s, ctx) => { // Single Reactor Ignition
  const enemy = opponentOf(ctx.owner)
  const losses = s.players[enemy].units.length
  const wiped = defeatUnits(s, allUnits(s).map(u => u.instanceId))
  return losses > 0 ? dealDamageToBase(wiped, enemy, losses) : wiped
}))

registerCard('LAW_096', whenPlayed("Each player may return a non-leader unit to its owner's hand. Then, defeat all non-leader units.", (s, ctx) => { // Rhydonium Detonation
  // "a non-leader unit", not "one you control", and it goes to its OWNER's hand — so either player's
  // unit is a legal save. Both offers are raised together; the wipe follows the last one answered.
  const targets = nonLeaderUnits(s).map(u => u.instanceId)
  if (targets.length === 0) return s
  const mine = pushChoice(s, { kind: 'selectUnitToReturn', id: `${ctx.sourceInstanceId}-mine`, controller: ctx.owner, targets, optional: true, thenWipeNonLeaders: true })
  return pushChoice(mine, { kind: 'selectUnitToReturn', id: `${ctx.sourceInstanceId}-theirs`, controller: opponentOf(ctx.owner), targets, optional: true, thenWipeNonLeaders: true })
}))

// TS26 / IBH: no target
registerCard('TS26_68', whenPlayed('You and an opponent each draw 2 cards.', (s, ctx) => // Arms Deal
  drawCards(drawCards(s, ctx.owner, 2), opponentOf(ctx.owner), 2)))
registerCard('TS26_56', whenPlayed('Each player resources the top card of their deck.', (s, ctx) => // Galactic Escalation
  resourceTopOfDeck(resourceTopOfDeck(s, ctx.owner), opponentOf(ctx.owner))))
registerCard('TS26_64', whenPlayed('Deal 2 damage to your base. Draw 2 cards.', (s, ctx) => // Urgent Mission
  drawCards(dealDamageToBase(s, ctx.owner, 2), ctx.owner, 2)))
registerCard('TS26_48', whenPlayed('Give each enemy ground unit -2/-2 for this phase.', (s, ctx) => // Vanquish the Legion
  lastingOnEach(s, unitsIn(s, opponentOf(ctx.owner), 'ground'), { power: -2, hp: -2 })))

// TS26 / IBH: one target
registerCard('IBH_18', whenPlayed('Exhaust an enemy ground unit.', (s, ctx) => { // Go for the Legs
  const targets = unitsIn(s, opponentOf(ctx.owner), 'ground').map(u => u.instanceId)
  return targets.length ? pushChoice(s, { kind: 'mayExhaustUnit', id: ctx.sourceInstanceId!, controller: ctx.owner, targets }) : s
}))

/** "Heal N damage from a unit" — no base among the targets, unlike Repair. */
const healUnitEvent = (description: string, amount: number, thenShield = false) =>
  whenPlayed(description, (s, ctx) => {
    const unitTargets = allUnits(s).map(u => u.instanceId)
    return unitTargets.length
      ? pushChoice(s, { kind: 'selectHealTarget', id: ctx.sourceInstanceId!, controller: ctx.owner, amount, unitTargets, baseTargets: [], ...(thenShield ? { thenShield: true } : {}) })
      : s
  })
registerCard('IBH_13', healUnitEvent('Heal 5 damage from a unit.', 5)) // Recovery
registerCard('IBH_66', healUnitEvent('Heal 2 damage from a unit.', 2)) // Too Strong for Blasters

registerCard('IBH_59', whenPlayed('Deal 2 damage to a base.', (s, ctx) => // Target the Main Generator
  pushChoice(s, { kind: 'selectDamageTarget', id: ctx.sourceInstanceId!, controller: ctx.owner, amount: 2, unitTargets: [], baseTargets: BOTH_BASES })))
registerCard('IBH_61', whenPlayed('Deal 3 damage to a unit.', (s, ctx) => damageChoice(s, ctx, 3, allUnits(s)))) // We're In Trouble

registerCard('IBH_74', whenPlayed('Draw 2 cards, then discard a card from your hand.', (s, ctx) => { // I Want Proof, Not Leads
  const drew = drawCards(s, ctx.owner, 2)
  return drew.players[ctx.owner].hand.length
    ? pushChoice(drew, { kind: 'selectDiscard', id: ctx.sourceInstanceId!, controller: ctx.owner, count: 1 })
    : drew
}))

// TS26 / IBH: a second effect that depends on the first
registerCard('TS26_72', whenPlayed('Ready a unit. Deal 3 damage to a unit.', (s, ctx) => { // Fervor
  const targets = allUnits(s).map(u => u.instanceId)
  return targets.length ? pushChoice(s, { kind: 'selectUnitToReady', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, thenDamage: { amount: 3 } }) : s
}))
registerCard('TS26_81', whenPlayed('Give a Shield token to a unit. Give a unit -3/-0 for this phase.', (s, ctx) => { // Mislead
  const targets = allUnits(s).map(u => u.instanceId)
  return targets.length
    ? pushChoice(s, { kind: 'mayGiveTokens', id: ctx.sourceInstanceId!, controller: ctx.owner, token: TOKEN_SHIELD, count: 1, targets, optional: false, thenBuff: { power: -3 } })
    : s
}))
registerCard('TS26_69', whenPlayed("Deal 2 damage to a unit. If it's a Clone, ready it.", (s, ctx) => { // Remove the Chip
  const unitTargets = allUnits(s).map(u => u.instanceId)
  return unitTargets.length
    ? pushChoice(s, { kind: 'selectDamageTarget', id: ctx.sourceInstanceId!, controller: ctx.owner, amount: 2, unitTargets, baseTargets: [], thenReadyIfTrait: 'Clone' })
    : s
}))
registerCard('IBH_5', whenPlayed('Deal 1 damage to an enemy unit and 1 damage to another enemy unit.', (s, ctx) => { // I'll Cover For You
  const unitTargets = enemyUnitsOf(s, ctx.owner).map(u => u.instanceId)
  return unitTargets.length
    ? pushChoice(s, { kind: 'selectDamageTarget', id: ctx.sourceInstanceId!, controller: ctx.owner, amount: 1, unitTargets, baseTargets: [], thenDamage: { amount: 1, scope: 'anotherEnemy' } })
    : s
}))
registerCard('TS26_70', whenPlayed('Deal 1 damage to an enemy unit. You may deal damage to a unit equal to the number of damaged enemy units.', (s, ctx) => { // Backed by Black Sun
  const unitTargets = enemyUnitsOf(s, ctx.owner).map(u => u.instanceId)
  return unitTargets.length
    ? pushChoice(s, { kind: 'selectDamageTarget', id: ctx.sourceInstanceId!, controller: ctx.owner, amount: 1, unitTargets, baseTargets: [], thenDamage: { perDamagedEnemy: true, scope: 'anyUnit', optional: true } })
    : s
}))
registerCard('IBH_95', whenPlayed('Defeat a friendly unit. If you do, ready a friendly unit with 5 or less power.', (s, ctx) => { // You Have Failed Me
  const targets = s.players[ctx.owner].units.map(u => u.instanceId)
  return targets.length ? pushChoice(s, { kind: 'selectUnitToDefeat', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, thenReadyFriendlyMaxPower: 5 }) : s
}))
registerCard('IBH_52', whenPlayed("Return a non-leader unit that costs 6 or less to its owner's hand. Exhaust each other enemy unit in the same arena.", (s, ctx) => { // Watch This
  const targets = nonLeaderUnits(s).filter(u => printedCost(s, u) <= 6).map(u => u.instanceId)
  return targets.length ? pushChoice(s, { kind: 'selectUnitToReturn', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, thenExhaustOtherEnemiesInArena: true }) : s
}))
registerCard('TS26_33', whenPlayed('An opponent (of your choice) may discard a card from their hand. If they do, give a non-Vehicle unit -8/-8 for this phase.', (s, ctx) => { // Kouhun Assassination
  // Two players, so "an opponent of your choice" is the opponent. They choose whether to discard;
  // the debuff that follows is the caster's pick, which is why the follow-up changes hands.
  const enemy = opponentOf(ctx.owner)
  return s.players[enemy].hand.length
    ? pushChoice(s, { kind: 'selectDiscard', id: ctx.sourceInstanceId!, controller: enemy, count: 1, optional: true, then: { buffFor: ctx.owner, power: -8, hp: -8, nonVehicleOnly: true } })
    : s
}))
registerCard('TS26_32', whenPlayed('Play a unit from your hand. It costs 4 less. Deal 4 damage to it.', (s, ctx) => { // Reckless Landing
  const candidates = affordableHandUnits(s, ctx.owner, 0, -4)
  return candidates.length
    ? pushChoice(s, { kind: 'playUnitFromHand', id: ctx.sourceInstanceId!, controller: ctx.owner, candidates, costDelta: -4, entersReady: false, thenDamageIt: 4 })
    : s
}))
registerCard('TS26_80', whenPlayed('Each player reveals their hand. In player order, each player discards a card from the hand of the player to their right. Then, each player draws a card.', (s, ctx) => { // Reveal Intentions
  // Two players, so "the player to their right" is the opponent each way, and the two discards are
  // independent: both offers are raised at once, and each player draws to replace what was taken.
  const enemy = opponentOf(ctx.owner)
  const mine = pushChoice(s, { kind: 'lookAtHand', id: `${ctx.sourceInstanceId}-mine`, controller: ctx.owner, target: enemy, mayDiscard: true, thenDraw: true, mustDiscard: true })
  return pushChoice(mine, { kind: 'lookAtHand', id: `${ctx.sourceInstanceId}-theirs`, controller: enemy, target: ctx.owner, mayDiscard: true, thenDraw: true, mustDiscard: true })
}))

// TS26 / IBH: several targets at once
registerCard('TS26_82', whenPlayed('Exhaust any number of non-unique units.', (s, ctx) => { // Evade Arrest
  const targets = allUnits(s).filter(u => !cardOf(s, u)?.unique).map(u => u.instanceId)
  return targets.length ? pushChoice(s, { kind: 'multiPick', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, spec: { mode: 'exhaust', remaining: targets.length } }) : s
}))
registerCard('IBH_104', whenPlayed('Defeat up to 2 enemy units that each cost 3 or less.', (s, ctx) => { // The Desolation of Hoth
  const targets = enemyUnitsOf(s, ctx.owner).filter(u => printedCost(s, u) <= 3).map(u => u.instanceId)
  return targets.length ? pushChoice(s, { kind: 'multiPick', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, spec: { mode: 'defeat', remaining: 2 } }) : s
}))
registerCard('IBH_9', whenPlayed('Reveal the top 3 cards of your deck. Draw a unit revealed this way, then discard the other revealed cards.', (s, ctx) => { // I've Found Them
  const revealed = s.players[ctx.owner].deck.slice(0, searchCount(s, ctx.owner, 3))
  if (revealed.length === 0) return s
  const eligibleIndices = revealed.flatMap((id, i) => (s.cards[id]?.type === 'unit' ? [i] : []))
  return pushChoice(s, { kind: 'searchDraw', id: ctx.sourceInstanceId!, controller: ctx.owner, revealed, eligibleIndices, discardRest: true })
}))

// TS26: "This event costs 1 less to play for each friendly leader unit."
const perLeaderUnitDiscount = { costModifier: (s: GameState, p: PlayerId) => -s.players[p].units.filter(u => u.isLeader).length }

registerCard('TS26_71', { // Take Action
  ...perLeaderUnitDiscount,
  ...whenPlayed('This event costs 1 less to play for each friendly leader unit. Deal 3 damage to a unit.', (s, ctx) => damageChoice(s, ctx, 3, allUnits(s))),
})
registerCard('TS26_47', { // Take Cover
  ...perLeaderUnitDiscount,
  ...healUnitEvent('This event costs 1 less to play for each friendly leader unit. Heal up to 3 damage from a unit and give a Shield token to it.', 3, true),
})

// TS26 / IBH: attack events, each lending the attacker a rider for that attack
const GRANT_TAKE_AIM = 'GRANT_TAKE_AIM'
registerCard(GRANT_TAKE_AIM, {
  sourceCardId: 'TS26_83',
  statModifier: (_s, _u, ctx) => (ctx.attacking ? { power: 2 } : {}),
  conditionalKeywords: () => [{ name: 'Saboteur' }],
})
registerCard('TS26_83', { // Take Aim
  ...perLeaderUnitDiscount,
  ...attackWithRider('This event costs 1 less to play for each friendly leader unit. Attack with a unit. It gets +2/+0 and gains Saboteur for this attack.', GRANT_TAKE_AIM),
})

const GRANT_FEARLESS_ATTACK = 'GRANT_FEARLESS_ATTACK'
registerCard(GRANT_FEARLESS_ATTACK, {
  sourceCardId: 'TS26_84',
  // Every unit the defending player controls, in either arena — where Masterstroke counts its own.
  statModifier: (s, u, ctx) => {
    if (!ctx.attacking) return {}
    const owner = findUnit(s, u.instanceId)?.owner
    return owner === undefined ? {} : { power: s.players[opponentOf(owner)].units.length }
  },
})
registerCard('TS26_84', attackWithRider('Attack with a unit. It gets +1/+0 for this attack for each unit controlled by the defending player.', GRANT_FEARLESS_ATTACK))

const GRANT_IMPROVISED_DETONATION = 'GRANT_IMPROVISED_DETONATION'
registerCard(GRANT_IMPROVISED_DETONATION, { sourceCardId: 'IBH_21', statModifier: (_s, _u, ctx) => (ctx.attacking ? { power: 2 } : {}) })
registerCard('IBH_21', attackWithRider('Attack with a unit. It gets +2/+0 for this attack.', GRANT_IMPROVISED_DETONATION))

// ── The remainder of the other sets' When Played units and upgrades: searches, hands, resources ──
// Three groups taken whole. The searches reuse `searchDraw` (reveal and draw) and `searchPlayFree`
// (reveal and play), the latter now carrying the searching card's own filter rather than Ackbar's
// space units. Four of the search cards also print a constant ability, registered here alongside the
// search so the card ships whole rather than half-built.

/** A card anywhere (deck, hand, discard) matching a trait or an aspect. Card data is upper case. */
const printedTrait = (c: EngineCard | undefined, trait: string): boolean =>
  (c?.traits ?? []).some(t => t.toLowerCase() === trait.toLowerCase())
const printedAspect = (c: EngineCard | undefined, aspect: string): boolean =>
  (c?.aspects ?? []).some(a => a.toLowerCase() === aspect.toLowerCase())
const printedUnit = (c: EngineCard | undefined): boolean => c?.type === 'unit'

type CardTest = (c: EngineCard | undefined, s: GameState, ctx: EventCtx) => boolean

/**
 * "Search the top N cards of your deck for X, reveal it, and draw it."
 *
 * The window is `searchCount`, so Arcana Star Map doubles it. The reveal is raised even when nothing
 * matches (#413): those cards are about to go to the bottom and the player is entitled to see which.
 * `count` above 1 is "up to N" (Grand Moff Tarkin), which draws again from what is left of the same
 * window and may stop at any point (CR 8.30.1).
 */
const searchDrawChoice = (s: GameState, ctx: EventCtx, depth: number, test: CardTest, count = 1, then?: IfYouDo): GameState => {
  const revealed = s.players[ctx.owner].deck.slice(0, searchCount(s, ctx.owner, depth))
  if (revealed.length === 0) return s
  const eligibleIndices = revealed.flatMap((id, i) => (test(s.cards[id], s, ctx) ? [i] : []))
  return pushChoice(s, {
    kind: 'searchDraw', id: ctx.sourceInstanceId!, controller: ctx.owner, revealed, eligibleIndices,
    ...(count > 1 && { remaining: count, upTo: true }),
    ...(then && { then }),
  })
}
const searchDrawWp = (description: string, depth: number, test: CardTest, count = 1) =>
  whenPlayed(description, (s: GameState, ctx: EventCtx) => searchDrawChoice(s, ctx, depth, test, count))

registerCard('LAW_136', searchDrawWp('Search the top 3 cards of your deck for an Underworld unit, reveal it, and draw it.', 3,
  c => printedUnit(c) && printedTrait(c, 'Underworld'))) // Syndicate Spice Runner
registerCard('LAW_138', searchDrawWp('Search the top 5 cards of your deck for a Bounty Hunter unit, reveal it, and draw it.', 5,
  c => printedUnit(c) && printedTrait(c, 'Bounty Hunter'))) // Undercity Hunting Team
registerCard('LAW_145', searchDrawWp('Search the top 5 cards of your deck for a unit that shares an aspect with a friendly unit, reveal it, and draw it.', 5,
  (c, s, ctx) => { // R2-D2
    const mine = new Set(s.players[ctx.owner].units.flatMap(u => (s.cards[u.cardId]?.aspects ?? []).map(a => a.toLowerCase())))
    return printedUnit(c) && (c?.aspects ?? []).some(a => mine.has(a.toLowerCase()))
  }))
registerCard('SOR_096', searchDrawWp('Search the top 5 cards of your deck for a Rebel card, reveal it, and draw it.', 5,
  c => printedTrait(c, 'Rebel'))) // Mon Mothma
registerCard('SHD_245', searchDrawWp('Search the top 5 cards of your deck for an upgrade, reveal it, and draw it.', 5,
  c => c?.type === 'upgrade')) // Greef Karga
registerCard('SOR_084', searchDrawWp('Search the top 5 cards of your deck for up to 2 Imperial units, reveal them, and draw them.', 5,
  c => printedUnit(c) && printedTrait(c, 'Imperial'), 2)) // Grand Moff Tarkin
registerCard('LOF_122', { // Pillio Star Compass
  attachRestriction: nonVehicle,
  ...searchDrawWp('Search the top 3 cards of your deck for a unit, reveal it, and draw it.', 3, printedUnit),
})

// The four search cards that also carry a constant ability. "Each round" and "each phase" coincide
// for cards played, because cards are only ever played during the action phase.
registerCard('LAW_229', { // The Master Codebreaker
  costDiscount: (s, _source, ctx) =>
    (printedTrait(ctx.card, 'Gambit') && !cardsPlayedThisPhase(s, ctx.owner).some(id => printedTrait(s.cards[id], 'Gambit')) ? -1 : 0),
  ...searchDrawWp('The first Gambit card you play each round costs 1 less. Search the top 8 cards of your deck for a Gambit card, reveal it, and draw it.', 8,
    c => printedTrait(c, 'Gambit')),
})
registerCard('SOR_181', { // Jabba the Hutt
  costDiscount: (_s, _source, ctx) => (ctx.card.type === 'event' && printedTrait(ctx.card, 'Trick') ? -1 : 0),
  ...searchDrawWp('Each Trick event you play costs 1 less. Search the top 8 cards of your deck for a Trick event, reveal it, and draw it.', 8,
    c => c?.type === 'event' && printedTrait(c, 'Trick')),
})
registerCard('SEC_112', { // Orn Free Taa
  statModifier: (s, u) => {
    const o = unitOwner(s, u)
    return o ? perEach(s.players[o].discard.filter(id => printedTrait(s.cards[id], 'Law')).length, 1) : {}
  },
  ...searchDrawWp('This unit gets +1/+0 for each Law card in your discard pile. Search the top 10 cards of your deck for a Law card, reveal it, and draw it.', 10,
    c => printedTrait(c, 'Law')),
})
registerCard('SHD_198', { // Omega
  waivesAspectPenalty: (s, _source, ctx) =>
    ctx.card.type === 'unit' && printedTrait(ctx.card, 'Clone')
      && !cardsPlayedThisPhase(s, ctx.owner).some(id => s.cards[id]?.type === 'unit' && printedTrait(s.cards[id], 'Clone')),
  ...searchDrawWp('Ignore the aspect penalty on the first Clone unit you play each round. Search the top 5 cards of your deck for a Clone card, reveal it, and draw it.', 5,
    c => printedTrait(c, 'Clone')),
})

/**
 * "Search the top N for any number of <X> units with combined cost C or less and play each free."
 *
 * The window is held OUT of the deck while the choice stands, as Admiral Ackbar's is: leaving it in
 * place duplicated the cards, since the choice bottoms its own leftovers when it ends.
 */
const searchPlayFreeWp = (description: string, depth: number, budget: number, filter: { trait?: string; aspect?: string }) =>
  whenPlayed(description, (s: GameState, ctx: EventCtx) => {
    const p = s.players[ctx.owner]
    const revealed = p.deck.slice(0, searchCount(s, ctx.owner, depth))
    if (revealed.length === 0) return s
    const eligibleIndices = revealed.flatMap((id, i) => {
      const c = s.cards[id]
      if (!printedUnit(c) || (c?.cost ?? 0) > budget) return []
      if (filter.trait && !printedTrait(c, filter.trait)) return []
      if (filter.aspect && !printedAspect(c, filter.aspect)) return []
      return [i]
    })
    const pulled = updatePlayer(s, ctx.owner, { deck: p.deck.slice(revealed.length) })
    return pushChoice(pulled, { kind: 'searchPlayFree', id: ctx.sourceInstanceId!, controller: ctx.owner, revealed, eligibleIndices, budget, filter })
  })

registerCard('LAW_063', searchPlayFreeWp('Search the top 10 cards of your deck for any number of Droid units with combined cost 5 or less and play each of them for free.', 10, 5, { trait: 'Droid' })) // L3-37
registerCard('SOR_087', searchPlayFreeWp('Search the top 10 cards of your deck for any number of Villainy units with combined cost 3 or less and play each of them for free.', 10, 3, { aspect: 'Villainy' })) // Darth Vader

registerCard('LOF_100', whenPlayed('Search the top 7 cards of your deck for a unit, reveal it, and play it. It costs 3 less.', (s, ctx) => { // Kelleran Beq
  // A discounted purchase, not a free play: only units the player can still pay for are offered,
  // and the resources are spent when one is taken.
  const p = s.players[ctx.owner]
  const revealed = p.deck.slice(0, searchCount(s, ctx.owner, 7))
  if (revealed.length === 0) return s
  const ready = p.resources.filter(r => !r.exhausted).length
  const eligibleIndices = revealed.flatMap((id, i) => {
    const c = s.cards[id]
    return printedUnit(c) && c && Math.max(0, effectiveCost(s, ctx.owner, c) - 3) <= ready ? [i] : []
  })
  const pulled = updatePlayer(s, ctx.owner, { deck: p.deck.slice(revealed.length) })
  return pushChoice(pulled, { kind: 'searchPlayFree', id: ctx.sourceInstanceId!, controller: ctx.owner, revealed, eligibleIndices, budget: 0, playOne: true, costDelta: -3 })
}))

// Hands and named cards
registerCard('SEC_239', whenPlayed("Look at an opponent's hand.", (s, ctx) => // Viper Probe Droid
  pushChoice(s, { kind: 'lookAtHand', id: ctx.sourceInstanceId!, controller: ctx.owner, target: opponentOf(ctx.owner) })))

registerCard('SOR_201', whenPlayed("Look at an opponent's hand and discard a non-unit card from it.", (s, ctx) => // Bodhi Rook
  pushChoice(s, { kind: 'lookAtHand', id: ctx.sourceInstanceId!, controller: ctx.owner, target: opponentOf(ctx.owner), mayDiscard: true, mustDiscard: true, discardFilter: 'nonUnit' })))

registerCard('SOR_062', whenPlayed("Name a card. While this unit is in play, opponents can't play the named card.", (s, ctx) => // Regional Governor
  pushChoice(s, { kind: 'nameCard', id: ctx.sourceInstanceId!, controller: ctx.owner, unitId: ctx.sourceInstanceId! })))

registerCard('SHD_202', whenPlayed("Look at an opponent's hand, then name a card. While this unit is in play, each card with that name costs 3 more for your opponents to play.", (s, ctx) => // Qi'ra
  // The look settles first and the naming follows it, so the name is chosen knowing the hand.
  pushChoice(s, {
    kind: 'lookAtHand', id: ctx.sourceInstanceId!, controller: ctx.owner, target: opponentOf(ctx.owner),
    thenNameCard: { unitId: ctx.sourceInstanceId!, surcharge: 3 },
  })))

registerCard('SOR_190', whenPlayed('If you played another card this phase, each opponent draws a card then discards a random card from their hand.', (s, ctx) => { // Lothal Insurgent
  // This unit's own play is already recorded by the time its When Played fires, so "another card"
  // means a second entry in the phase's record.
  if (cardsPlayedThisPhase(s, ctx.owner).length < 2) return s
  const enemy = opponentOf(ctx.owner)
  const drawn = drawCards(s, enemy, 1)
  const hand = drawn.players[enemy].hand
  if (hand.length === 0) return drawn
  // Random, not chosen: the seed on the state keeps it deterministic under replay.
  const pick = Math.floor(seededUnit(drawn.rngSeed) * hand.length)
  return { ...discardFromHand(drawn, enemy, pick), rngSeed: nextSeed(drawn.rngSeed) }
}))

// Resources
registerCard('LAW_083', whenPlayed('If you have fewer cards in hand than an opponent, draw a card. If you control fewer resources than an opponent, resource the top card of your deck.', (s, ctx) => { // Broken Horn
  // Both sentences are checked in order, so the draw can change what the second one sees.
  const enemy = opponentOf(ctx.owner)
  const drawn = s.players[ctx.owner].hand.length < s.players[enemy].hand.length ? drawCards(s, ctx.owner, 1) : s
  return drawn.players[ctx.owner].resources.length < drawn.players[enemy].resources.length ? resourceTopOfDeck(drawn, ctx.owner) : drawn
}))

/** "(If ...,) you may put the top card of your deck into play as a resource." */
const mayResourceTopWp = (description: string, when: When = always) =>
  whenPlayed(description, (s: GameState, ctx: EventCtx) =>
    (when(s, ctx) && s.players[ctx.owner].deck.length > 0
      ? pushChoice(s, { kind: 'mayResourceTop', id: ctx.sourceInstanceId!, controller: ctx.owner })
      : s))

registerCard('JTL_119', mayResourceTopWp('You may put the top card of your deck into play as a resource.')) // Resupply Carrier
registerCard('JTL_164', mayResourceTopWp('If an opponent controls more resources than you, you may put the top card of your deck into play as a resource.',
  (s, ctx) => s.players[opponentOf(ctx.owner)].resources.length > s.players[ctx.owner].resources.length)) // Cham Syndulla

registerCard('SOR_189', whenPlayed('Either ready a resource or exhaust a unit.', (s, ctx) => { // Leia Organa
  // Only modes that can actually do something are offered, as Choose Your Path does: picking an
  // option that would do nothing is not a meaningful choice.
  const modes: string[] = []
  if (s.players[ctx.owner].resources.some(r => r.exhausted)) modes.push('readyResource')
  if (allUnits(s).length > 0) modes.push('exhaustUnit')
  return modes.length ? pushChoice(s, { kind: 'chooseMode', id: ctx.sourceInstanceId!, controller: ctx.owner, modes }) : s
}))

// ── Constant abilities the static hooks could not express ────────────────────────────────────────
// Each block is one group of cards sharing one engine change, named in the comment above it.

// "While this unit is defending, the attacker gets -N/-0": an aura aimed at the ATTACKER, which is
// why `completeAttack` threads the combat roles into the attacker's stat context as well.
const debuffsAttackerWhileDefending = (power: number) => ({
  aura: (_s: GameState, source: UnitState, target: UnitState, _friendly: boolean, combat?: CombatContext) =>
    (combat?.defenderInstanceId === source.instanceId && combat.attackerInstanceId === target.instanceId ? { power } : undefined),
})
registerCard('LAW_108', debuffsAttackerWhileDefending(-1)) // Lando Calrissian
registerCard('JTL_054', debuffsAttackerWhileDefending(-1)) // Gold Leader
registerCard('SOR_071', { attachRestriction: nonVehicle, ...debuffsAttackerWhileDefending(-1) }) // Electrostaff
registerCard('SEC_042', { // Cassian Andor
  ...debuffsAttackerWhileDefending(-2),
  // "If an enemy card ability would deal damage to this unit, prevent 2 of that damage": an ability,
  // so combat damage is not covered.
  preventUnitDamage: (s, self, target, amount, ctx) =>
    (target.instanceId === self.instanceId && !ctx.byCombat && ctx.source !== undefined && ctx.source.controller !== unitOwner(s, self)
      ? Math.min(2, amount) : 0),
})

// Keywords and attack variants that depend on the combat: the keyword readers and `dealsDamageFirst`
// take the attacker's context, and a unit that has attacked this phase is recorded.
registerCard('SOR_130', { // First Legion Snowtrooper
  statModifier: (_s, _u, ctx) => (ctx.defenderDamaged ? { power: 2 } : {}),
  conditionalKeywords: (_s, _u, ctx) => (ctx?.defenderDamaged ? [KW.overwhelm] : []),
})
registerCard('JTL_185', { // Hound's Tooth
  dealsDamageFirst: (s, _u, ctx) => {
    const defender = ctx?.defender
    if (!defender?.exhausted) return false
    const owner = unitOwner(s, defender)
    return owner !== undefined && !enteredPlayThisPhase(s, owner).includes(defender.instanceId)
  },
})
registerCard('LAW_219', { dealsDamageFirst: (s, u) => attackedThisPhase(s).every(id => id === u.instanceId) }) // Anakin's Podracer
registerCard('SHD_219', { // Enfys Nest
  // "While a friendly unit (including this one) is attacking using Ambush, the defender gets -3/-0."
  aura: (s, source, target, _friendly, combat) => {
    if (!combat?.viaAmbush || combat.defenderInstanceId !== target.instanceId) return undefined
    const attacker = allUnits(s).find(x => x.instanceId === combat.attackerInstanceId)
    return attacker && unitOwner(s, attacker) === unitOwner(s, source) ? { power: -3 } : undefined
  },
})
registerCard('JTL_259', { // Retrofitted Airspeeder
  attacksEitherArena: () => true,
  statModifier: (_s, _u, ctx) => (ctx.defenderArena === 'space' ? { power: -1 } : {}),
})

// Keywords that act as a unit ENTERS play, gained rather than printed: `playUnitCard` reads them live.
registerCard('SHD_212', gains(another(isAspect('Cunning')), { name: 'Shielded' })) // Privateer Scyk
registerCard('LOF_132', friendlyAura(isTrait('Inquisitor'), { keywords: [{ name: 'Hidden' }] }, true)) // Grand Inquisitor

// Conditions on a unit's COMPUTED power or keywords, which the keyword and power passes guard
// against recursing through.
registerCard('LOF_085', gains((s, u) => friendliesOf(s, u).some(x => effectivePower(s, x) >= 4), KW.sentinel)) // Praetorian Guard
registerCard('JTL_137', { // Vonreg's TIE Interceptor
  conditionalKeywords: (s, u) => {
    const power = effectivePower(s, u)
    const out: KeywordInstance[] = []
    if (power >= 4) out.push(KW.overwhelm)
    if (power >= 6) out.push(KW.raid(1))
    return out
  },
})
registerCard('SEC_032', { // Kylo Ren's Command Shuttle
  aura: (s, _src, tgt, friendly) => (friendly && tgt.arena === 'ground' && nonAuraKeywordNames(s, tgt).has('Sentinel') ? { hp: 2 } : undefined),
})
registerCard('LOF_186', { // Marchion Ro — "each friendly unit's Raid is doubled", himself included
  aura: (s, _src, tgt, friendly) => {
    const raid = friendly ? nonAuraKeywordValue(s, tgt, 'Raid') : 0
    return raid > 0 ? { keywords: [KW.raid(raid)] } : undefined
  },
})

// "This unit can't attack."
registerCard('LOF_044', { cannotAttack: () => true }) // Loth-Wolf
registerCard('JTL_059', { cannotAttack: () => true }) // Corporate Defense Shuttle

// Damage a card stops by itself, with nothing for the controller to decide.
registerCard('SEC_067', { // Umbaran Mobile Cannon
  preventUnitDamage: (s, self, target, amount) =>
    (target.instanceId === self.instanceId && !damagePreventedThisPhase(s, self.instanceId) ? amount : 0),
})
registerCard('SHD_224', { // Boba Fett's Armor
  attachRestriction: nonVehicle,
  preventUnitDamage: (s, self, target, amount) =>
    (target.instanceId === self.instanceId && cardOf(s, self)?.name === 'Boba Fett' ? Math.min(2, amount) : 0),
})
registerCard('LOF_108', { // Malakili
  costDiscount: (s, _source, ctx) => {
    const isCreatureUnit = (c: EngineCard | undefined) => c?.type === 'unit' && printedTrait(c, 'Creature')
    return isCreatureUnit(ctx.card) && !cardsPlayedThisPhase(s, ctx.owner).some(id => isCreatureUnit(s.cards[id])) ? -1 : 0
  },
  preventUnitDamage: (s, self, target, amount, ctx) => {
    const owner = unitOwner(s, self)
    const source = ctx.source
    return source !== undefined && source.controller === owner && unitOwner(s, target) === owner && printedTrait(s.cards[source.cardId], 'Creature')
      ? amount : 0
  },
})

// Cost rules that remember what has been played, or reach across the table.
registerCard('SEC_064', { // Congress of Malastare
  costDiscount: (s, _source, ctx) =>
    (ctx.card.type === 'upgrade' && !cardsPlayedThisPhase(s, ctx.owner).some(id => s.cards[id]?.type === 'upgrade') ? -1 : 0),
})
registerCard('LOF_058', { // Guardian of the Whills
  costDiscount: (_s, source, ctx) =>
    (ctx.card.type === 'upgrade' && ctx.target?.instanceId === source.instanceId && (source.upgradesPlayedThisRound ?? 0) === 0 ? -1 : 0),
})
registerCard('SOR_034', { enemyCostDelta: (_s, _source, ctx) => (ctx.card.type === 'event' ? 1 : 0) }) // Del Meeko
registerCard('JTL_105', { halvesCosts: () => true }) // The Starhawk

// "Printed power/HP is considered to be N."
registerCard('LAW_036', { // Obi-Wan Kenobi
  printedStats: (s, source, _target, friendly) => {
    const owner = unitOwner(s, source)
    return friendly && owner !== undefined && s.players[owner].units.length >= 7 ? { power: 7, hp: 7 } : undefined
  },
})
registerCard('LOF_056', { // Size Matters Not
  costModifier: (s, p) => (s.players[p].units.some(u => unitHasTrait(s, u, 'Force')) ? -1 : 0),
  printedStats: (_s, source, target) => (target.instanceId === source.instanceId ? { power: 5, hp: 5 } : undefined),
})

// Rules a card changes for as long as it is in play.
registerCard('TWI_132', { suppressesBaseHealing: () => true }) // Confederate Tri-Fighter
registerCard('JTL_182', { readiesInRegroup: (s, u) => effectivePower(s, u) >= 4 }) // Rampart
registerCard('TWI_042', { // Barriss Offee — "each friendly unit healed this phase", herself included
  aura: (s, _src, tgt, friendly) => (friendly && healedThisPhase(s).includes(tgt.instanceId) ? { power: 1 } : undefined),
})

// ── The last of the other sets' When Played units and upgrades ────────────────────────────────────
// Built on the When Played helpers above. Each block is one group of the ticket that listed them.

/** "(You may) attack with (another) unit", lending `grantCardId`'s rider for that attack. */
const attackWp = (description: string, offer: AttackOffer & { another?: boolean }, when: When = always) =>
  whenPlayed(description, (s, ctx) => {
    if (!when(s, ctx)) return s
    const { another, ...rest } = offer
    const attacker = another ? { ...rest.attacker, exclude: [...(rest.attacker?.exclude ?? []), ctx.sourceInstanceId!] } : rest.attacker
    return offerAttack(s, ctx.owner, `${ctx.sourceInstanceId}-attack`, { ...rest, ...(attacker ? { attacker } : {}) })
  })
/** "+2/+0 for this attack", only for an attacker passing `test`. */
const attackBonusIf = (power: number, test: (s: GameState, u: UnitState) => boolean): CardDefinition => ({
  statModifier: (s, u, ctx) => (ctx.attacking && test(s, u) ? { power } : {}),
})
const baseDamage = (s: GameState, p: PlayerId): number => s.players[p].base.damage

// TS26 and IBH
registerCard('TS26_37', { // Abandoned the Order
  removedTraits: () => ['Jedi'],
  conditionalKeywords: () => [KW.restore(1)],
  ...targetWp("Attached unit loses the Jedi trait and gains Restore 1. You may return a non-leader unit to its owner's hand.", 'selectUnitToReturn', nonLeader, true),
})
registerCard('TS26_15', { // C-3P0
  ...whenPlayed('An opponent takes control of this unit.', (s, ctx) =>
    takeControlOfUnit(s, ctx.owner, opponentOf(ctx.owner), ctx.sourceInstanceId!, 'permanent')),
  actionAbilities: [{
    description: "Deal damage equal to this unit's power to another ground unit. Only opponents may use this ability.",
    exhaustCost: true,
    // "Only opponents may use this ability": its controller may use it only while they are not its owner.
    usable: (_s, u) => u.owner !== undefined,
    effect: (s, ctx) => {
      const self = findUnit(s, ctx.sourceInstanceId!)
      if (!self) return s
      const amount = effectivePower(s, self.unit)
      const targets = groundUnits(s).filter(u => u.instanceId !== self.unit.instanceId)
      return amount > 0 ? damageChoice(s, ctx, amount, targets) : s
    },
  }],
})
registerCard('TS26_19', whenPlayed('Deal 1 damage to each enemy base. Heal 1 damage from your base for each damage dealt this way.', (s, ctx) => { // Coleman Trebor
  const enemy = opponentOf(ctx.owner)
  const hit = dealDamageToBase(s, enemy, 1)
  const dealt = baseDamage(hit, enemy) - baseDamage(s, enemy)
  return dealt > 0 ? healBase(hit, ctx.owner, dealt) : hit
}))
registerCard('TS26_53', whenPlayed('Heal 2 damage from each of any number of bases.', (s, ctx) => { // Coruscanti Spy
  const remaining = BOTH_BASES.filter(p => baseDamage(s, p) > 0)
  return remaining.length ? pushChoice(s, { kind: 'damageAnyBases', id: ctx.sourceInstanceId!, controller: ctx.owner, remaining, amount: 2, heal: true }) : s
}))
registerCard('TS26_25', whenPlayed('You may deal 1 damage to another friendly unit and attack with it.', (s, ctx) => { // Fiery Alliance
  const unitTargets = pickedIds(s, ctx, pickAll(pickFriendly, pickOther))
  return unitTargets.length
    ? pushChoice(s, { kind: 'selectDamageTarget', id: ctx.sourceInstanceId!, controller: ctx.owner, amount: 1, unitTargets, baseTargets: [], optional: true, thenAttackWithIt: true })
    : s
}))
registerCard('TS26_18', whenPlayed('Search the top 8 cards of your deck for a card and resource it.', (s, ctx) => { // Jendirian Valley
  const revealed = s.players[ctx.owner].deck.slice(0, searchCount(s, ctx.owner, 8))
  return revealed.length
    ? pushChoice(s, { kind: 'searchDraw', id: ctx.sourceInstanceId!, controller: ctx.owner, revealed, eligibleIndices: revealed.map((_, i) => i), resourceIt: true })
    : s
}))
registerCard('TS26_16', whenPlayed('All units (including enemy units) gain Restore 1 for this phase.', s => // King Katuunko
  lastingOnEach(s, allUnits(s), { keywords: [KW.restore(1)] })))
registerCard('TS26_30', attackWp('You may attack with another unit.', { another: true, optional: true })) // Maul
registerCard('TS26_28', whenPlayed('Give a friendly unit +2/+2 for this phase. Exhaust each enemy unit in its arena with less power than it.', (s, ctx) => { // Prime Minister Almec
  const targets = pickedIds(s, ctx, pickFriendly)
  return targets.length
    ? pushChoice(s, { kind: 'mayLastingBuff', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, power: 2, hp: 2, thenExhaustWeakerEnemiesInArena: true })
    : s
}))
registerCard('TS26_62', whenPlayed("You may deal 2 damage to a base. If you do, that base's controller draws a card.", (s, ctx) => // R2-D2
  pushChoice(s, { kind: 'selectDamageTarget', id: ctx.sourceInstanceId!, controller: ctx.owner, amount: 2, unitTargets: [], baseTargets: BOTH_BASES, optional: true, thenBaseOwnerDraws: true })))
// With two players, choosing one base and healing "each other base" heals exactly the one not chosen,
// so the choice is offered as the base to heal.
registerCard('TS26_42', whenPlayed('Choose a base. Heal 3 damage from each other base.', (s, ctx) => healChoice(s, ctx, 3, [], BOTH_BASES))) // Relief Frigate
registerCard('TS26_67', whenPlayed('If your base has 15 or more damage on it, deal 2 damage to a base.', (s, ctx) => // Ruping Rider
  (baseDamage(s, ctx.owner) >= 15 ? damageChoice(s, ctx, 2, [], BOTH_BASES) : s)))
registerCard('TS26_36', { // Tribunal
  // Its own play is recorded only after its cost is worked out, so every card on the record is "other".
  costModifier: (s, p) => -2 * cardsPlayedThisPhase(s, p).length,
  ...whenPlayed('This unit costs 2 less to play for each other card you played this phase. Give each other unit -2/-2 for this phase.', (s, ctx) =>
    lastingOnEach(s, picked(s, ctx, pickOther), { power: -2, hp: -2 })),
})
registerCard('TS26_41', whenPlayed('If there are 5 or more cards in your discard pile, heal 3 damage from your base.', (s, ctx) => // Twilight
  (s.players[ctx.owner].discard.length >= 5 ? healBase(s, ctx.owner, 3) : s)))
registerCard('IBH_72', whenPlayed('Deal 1 damage to each other unit (including friendly units).', (s, ctx) => // Avenger
  pickedIds(s, ctx, pickOther).reduce((acc, id) => dealDamageToUnit(acc, id, 1), s)))
registerCard('IBH_99', targetWp('You may defeat a non-leader ground unit with 3 or less remaining HP.', 'selectUnitToDefeat', // Blizzard One
  (s, u) => nonLeader(s, u) && u.arena === 'ground' && remainingHp(s, u) <= 3, true))
registerCard('IBH_19', whenPlayed('If you control a Cunning unit, draw a card.', (s, ctx) => // C-3P0
  (youControl(s, ctx, pickAspect('Cunning')) ? drawCards(s, ctx.owner, 1) : s)))
registerCard('IBH_68', whenPlayed('If you control a Vigilance unit, deal 2 damage to an enemy base and heal 2 damage from your base.', (s, ctx) => // General Veers
  (youControl(s, ctx, pickAspect('Vigilance')) ? healBase(dealDamageToBase(s, opponentOf(ctx.owner), 2), ctx.owner, 2) : s)))
const GRANT_HOTH_LIEUTENANT = 'GRANT_HOTH_LIEUTENANT'
registerCard(GRANT_HOTH_LIEUTENANT, { sourceCardId: 'IBH_64', ...attackBonus(2) })
registerCard('IBH_64', attackWp('You may attack with another unit. It gets +2/+0 for this attack.', { another: true, optional: true, grantCardId: GRANT_HOTH_LIEUTENANT })) // Hoth Lieutenant
registerCard('IBH_20', damageWp('You may deal 3 damage to a ground unit.', pickGround, 3, true)) // Luke Skywalker
registerCard('IBH_31', readySelfWp('If your base has more damage on it than an enemy base, ready this unit.', (s, ctx) => // Millennium Falcon
  baseDamage(s, ctx.owner) > baseDamage(s, opponentOf(ctx.owner))))

// Attacks raised by a unit or upgrade entering play
/** "If attached unit is <name>": for an upgrade's When Played, the source is the unit it is attached to. */
const hostNamed = (name: string): When => (s, ctx) => {
  const host = findUnit(s, ctx.sourceInstanceId!)?.unit
  return host !== undefined && cardOf(s, host)?.name === name
}
/** A rider that only adds power for this attack when `test` holds. */
const riderIf = (id: string, sourceCardId: string, test: (s: GameState, u: UnitState) => boolean): string => {
  registerCard(id, { sourceCardId, ...attackBonusIf(2, test) })
  return id
}
const traitRider = (id: string, sourceCardId: string, trait: string) => riderIf(id, sourceCardId, (s, u) => unitHasTrait(s, u, trait))

registerCard('LOF_111', attackWp('You may attack with a Force unit. It gets +2/+0 for this attack.', // Maz Kanata
  { optional: true, attacker: { trait: 'Force' }, grantCardId: riderIf('GRANT_MAZ_KANATA', 'LOF_111', () => true) }))
registerCard('TWI_091', attackWp('You may attack with a Republic unit. It gets +2/+0 for this attack.', // Republic Tactical Officer
  { optional: true, attacker: { trait: 'Republic' }, grantCardId: riderIf('GRANT_REPUBLIC_TACTICAL_OFFICER', 'TWI_091', () => true) }))
registerCard('LAW_157', attackWp("You may attack with a unit. If it's a Bounty Hunter, it gets +2/+0 for this attack.", // Target Tagger
  { optional: true, grantCardId: traitRider('GRANT_TARGET_TAGGER', 'LAW_157', 'Bounty Hunter') }))
registerCard('SHD_236', attackWp("You may attack with a unit. If it's an Imperial unit, it gets +2/+0 for this attack.", // Snowtrooper Lieutenant
  { optional: true, grantCardId: traitRider('GRANT_SNOWTROOPER_LIEUTENANT', 'SHD_236', 'Imperial') }))
registerCard('SOR_240', attackWp("You may attack with a unit. If it's a Rebel unit, it gets +2/+0 for this attack.", // Fleet Lieutenant
  { optional: true, grantCardId: traitRider('GRANT_FLEET_LIEUTENANT', 'SOR_240', 'Rebel') }))
registerCard('SHD_101', attackWp('You may attack with a unit. If you have the initiative, it gets +2/+0 for this attack.', { // Adelphi Patrol Wing
  optional: true,
  grantCardId: riderIf('GRANT_ADELPHI_PATROL_WING', 'SHD_101', (s, u) => findUnit(s, u.instanceId)?.owner === s.initiative),
}))

const GRANT_FOUR_LOM = 'GRANT_FOUR_LOM'
registerCard(GRANT_FOUR_LOM, { sourceCardId: 'LAW_065', cannotAttackBases: () => true })
registerCard('LAW_065', attackWp("You may attack with a friendly Bounty Hunter unit, even if it's exhausted. It can't attack bases for this attack.", // 4-LOM
  { optional: true, exhausted: true, attacker: { trait: 'Bounty Hunter' }, grantCardId: GRANT_FOUR_LOM }))

/**
 * Mon Mothma's "any number of other units (one at a time)": each attack's rider offers the next, and
 * marks its attacker for the phase so no unit attacks twice in the sequence. The mark carries no
 * ability; it is only read here. A second Mon Mothma in the same phase would see the first one's
 * marks, which needs her to leave play and be played again.
 */
const GRANT_MON_MOTHMA = 'GRANT_MON_MOTHMA'
const MON_MOTHMA_ATTACKED = 'GRANT_MON_MOTHMA_ATTACKED'
registerCard(MON_MOTHMA_ATTACKED, { sourceCardId: 'SEC_103' })
const monMothmaOffer = (s: GameState, owner: PlayerId, id: string): GameState => {
  const used = (s.lastingEffects ?? []).filter(e => e.abilityCardIds?.includes(MON_MOTHMA_ATTACKED)).map(e => e.targetInstanceId)
  const herself = s.players[owner].units.filter(u => u.cardId === 'SEC_103').map(u => u.instanceId)
  return offerAttack(s, owner, id, { optional: true, exhausted: true, grantCardId: GRANT_MON_MOTHMA, attacker: { exclude: [...herself, ...used] } })
}
registerCard(GRANT_MON_MOTHMA, {
  sourceCardId: 'SEC_103',
  cannotAttackBases: () => true,
  abilities: [{
    trigger: 'onAttackEnd',
    description: 'You may attack with another unit.',
    effect: (s, ctx) => monMothmaOffer(addLastingEffect(s, { targetInstanceId: ctx.sourceInstanceId!, abilityCardIds: [MON_MOTHMA_ATTACKED] }), ctx.owner, `${ctx.sourceInstanceId}-next`),
  }],
})
registerCard('SEC_103', whenPlayed("You may attack with any number of other units (one at a time), even if those units are exhausted. They can't attack bases for these attacks.", (s, ctx) => // Mon Mothma
  monMothmaOffer(s, ctx.owner, `${ctx.sourceInstanceId}-attack`)))

registerCard('TWI_248', { // Ahsoka's Padawan Lightsaber
  attachRestriction: nonVehicle,
  ...attackWp('If attached unit is Ahsoka Tano, you may attack with a unit.', { optional: true }, hostNamed('Ahsoka Tano')),
})
const GRANT_DARTH_MAULS_LIGHTSABER = 'GRANT_DARTH_MAULS_LIGHTSABER'
registerCard(GRANT_DARTH_MAULS_LIGHTSABER, { sourceCardId: 'LOF_140', conditionalKeywords: () => [KW.overwhelm], cannotAttackBases: () => true })
registerCard('LOF_140', { // Darth Maul's Lightsaber
  attachRestriction: (s, t, player) => nonVehicle(s, t) && findUnit(s, t.instanceId)?.owner === player,
  ...whenPlayed("If attached unit is Darth Maul, you may attack with him. For this attack, he gains Overwhelm and can't attack bases.", (s, ctx) =>
    (hostNamed('Darth Maul')(s, ctx)
      ? offerAttack(s, ctx.owner, `${ctx.sourceInstanceId}-attack`, { optional: true, attacker: { only: [ctx.sourceInstanceId!] }, grantCardId: GRANT_DARTH_MAULS_LIGHTSABER })
      : s)),
})

// "You may pay N. If you do" and two linked steps: the first step is a choice, and the card's
// `ifYouDo` hook is the rest of the ability, told what that choice settled.
type Resumable = EventCtx & { cardId: string }
const resume = (ctx: Resumable, step?: string, unit?: string): IfYouDo =>
  ({ cardId: ctx.cardId, owner: ctx.owner, sourceInstanceId: ctx.sourceInstanceId, ...(step ? { step } : {}), ...(unit ? { unit } : {}) })
/** "You may pay `cost`. If you do, <then>". Not offered at all when the cost cannot be paid. */
const mayPayWp = (description: string, cost: number, text: string, then: NonNullable<CardDefinition['ifYouDo']>): CardDefinition => ({
  ...whenPlayed(description, (s, ctx) =>
    (canAfford(s.players[ctx.owner], cost) ? pushChoice(s, { kind: 'mayPayThen', id: ctx.sourceInstanceId!, controller: ctx.owner, cost, text, then: resume(ctx) }) : s)),
  ifYouDo: then,
})
/** Choose one of `targets` for the card's `ifYouDo` hook, or nothing when there are none. */
const unitThen = (s: GameState, ctx: Resumable, targets: string[], text: string, optional: boolean, step?: string, unit?: string): GameState =>
  targets.length ? pushChoice(s, { kind: 'selectUnitThen', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, text, then: resume(ctx, step, unit), ...mayFlag(optional) }) : s
/** "(You may) <do things> to a unit that ...": the pick, then `then` with the unit as `targetInstanceId`. */
const unitThenWp = (description: string, test: Pick, text: string, optional: boolean, then: NonNullable<CardDefinition['ifYouDo']>): CardDefinition => ({
  ...whenPlayed(description, (s, ctx) => unitThen(s, ctx, pickedIds(s, ctx, test), text, optional)),
  ifYouDo: then,
})
const opponentDiscards = (s: GameState, owner: PlayerId, id: string, then?: IfYouDo): GameState => {
  const opp = opponentOf(owner)
  return s.players[opp].hand.length
    ? pushChoice(s, { kind: 'selectDiscard', id, controller: opp, count: 1, ...(then ? { then: { ifYouDo: then } } : {}) })
    : s
}

registerCard('LAW_198', mayPayWp('You may pay 1. If you do, deal 2 damage to a ground unit.', 1, 'deal 2 damage to a ground unit', (s, ctx) => // Dogged Pursuers
  damageChoice(s, ctx, 2, picked(s, ctx, pickGround))))
registerCard('LAW_193', mayPayWp('You may pay 1. If you do, an opponent discards a card from their hand.', 1, 'make an opponent discard a card', (s, ctx) => // Mid Rim Sharpshooter
  opponentDiscards(s, ctx.owner, ctx.sourceInstanceId!)))
registerCard('LAW_227', mayPayWp('You may pay 1. If you do, give a Shield token to this unit.', 1, 'give this unit a Shield token', (s, ctx) => // Rookie Rocket-jumper
  giveToken(s, ctx.sourceInstanceId!, TOKEN_SHIELD)))
registerCard('LAW_113', mayPayWp('You may pay 1. If you do, give a Shield token to a unit.', 1, 'give a unit a Shield token', (s, ctx) => // Shield Drive Outfitter
  shieldChoice(s, ctx, pickedIds(s, ctx, pickAny), false)))
registerCard('LAW_148', mayPayWp('You may pay 1. If you do, this unit gets +1/+1 for this phase.', 1, 'give this unit +1/+1 for this phase', (s, ctx) => // Smuggler's YT-2400
  addLastingEffect(s, { targetInstanceId: ctx.sourceInstanceId!, power: 1, hp: 1 })))
registerCard('TWI_212', mayPayWp('You may pay 2. If you do, deal 2 damage to a unit.', 2, 'deal 2 damage to a unit', (s, ctx) => // Freelance Assassin
  damageChoice(s, ctx, 2, picked(s, ctx, pickAny))))

// Two linked steps
registerCard('SEC_184', { // ISB Agent
  ...whenPlayed('You may reveal an event from your hand. If you do, deal 1 damage to a unit.', (s, ctx) =>
    (s.players[ctx.owner].hand.some(id => s.cards[id]?.type === 'event')
      ? pushChoice(s, { kind: 'mayPayThen', id: ctx.sourceInstanceId!, controller: ctx.owner, cost: 0, revealEvent: true, text: 'deal 1 damage to a unit', then: resume(ctx) })
      : s)),
  ifYouDo: (s, ctx) => damageChoice(s, ctx, 1, picked(s, ctx, pickAny)),
})
registerCard('JTL_051', { // Red Squadron X-Wing
  ...whenPlayed('You may deal 2 damage to this unit. If you do, draw a card.', (s, ctx) =>
    pushChoice(s, { kind: 'mayPayThen', id: ctx.sourceInstanceId!, controller: ctx.owner, cost: 0, damageSelf: 2, text: 'draw a card', then: resume(ctx) })),
  ifYouDo: (s, ctx) => drawCards(s, ctx.owner, 1),
})
registerCard('TWI_193', { // R2-D2
  ...whenPlayed('You may discard a card from your hand. If you do, search the top 3 cards of your deck for a card and draw it.', (s, ctx) =>
    (s.players[ctx.owner].hand.length
      ? pushChoice(s, { kind: 'selectDiscard', id: ctx.sourceInstanceId!, controller: ctx.owner, count: 1, optional: true, then: { ifYouDo: resume(ctx) } })
      : s)),
  ifYouDo: (s, ctx) => {
    const revealed = s.players[ctx.owner].deck.slice(0, searchCount(s, ctx.owner, 3))
    return revealed.length
      ? pushChoice(s, { kind: 'searchDraw', id: ctx.sourceInstanceId!, controller: ctx.owner, revealed, eligibleIndices: revealed.map((_, i) => i) })
      : s
  },
})
registerCard('SOR_099', unitThenWp("You may return a friendly non-leader ground unit to its owner's hand. If you do, draw a card.", // Bright Hope
  pickAll(pickFriendly, pickGround, nonLeader), 'return a friendly ground unit to hand and draw a card', true,
  (s, ctx) => drawCards(returnUnitToHand(s, ctx.targetInstanceId!), ctx.owner, 1)))
registerCard('SEC_165', { // Academy Disciplinarian
  ...whenPlayed('You may deal 1 damage to a friendly unit with 2 or less power and ready it.', (s, ctx) => {
    const unitTargets = pickedIds(s, ctx, pickAll(pickFriendly, (st, u) => effectivePower(st, u) <= 2))
    return unitTargets.length
      ? pushChoice(s, { kind: 'selectDamageTarget', id: ctx.sourceInstanceId!, controller: ctx.owner, amount: 1, unitTargets, baseTargets: [], optional: true, thenReadyIt: true })
      : s
  }),
})
registerCard('LAW_075', unitThenWp('Exhaust an enemy unit. If you do, and that unit costs 3 or less, its controller discards a card from their hand.', // Interrogation Droid
  pickEnemy, 'exhaust an enemy unit', false, (s, ctx) => {
    const target = findUnit(s, ctx.targetInstanceId!)
    // Only a ready unit can be exhausted, so only then has "if you do" happened.
    if (!target || target.unit.exhausted) return s
    const exhausted = exhaustUnit(s, target.unit.instanceId)
    return (cardOf(s, target.unit)?.cost ?? 0) <= 3 ? opponentDiscards(exhausted, ctx.owner, ctx.sourceInstanceId!) : exhausted
  }))
registerCard('JTL_201', { // Ahsoka Tano
  ...whenPlayed("An opponent discards a card from their hand. If it's a unit, you may exhaust a unit.", (s, ctx) =>
    opponentDiscards(s, ctx.owner, ctx.sourceInstanceId!, resume(ctx))),
  ifYouDo: (s, ctx) =>
    (ctx.cardChosen && s.cards[ctx.cardChosen]?.type === 'unit' ? targetChoice(s, ctx, 'mayExhaustUnit', pickedIds(s, ctx, pickAny), true) : s),
})
registerCard('SHD_049', unitThenWp('You may heal all damage from a unit that costs 2 or less and give 2 Shield tokens to it.', // The Mandalorian
  (s, u) => (cardOf(s, u)?.cost ?? 0) <= 2, 'heal a unit that costs 2 or less and give it 2 Shields', true,
  (s, ctx) => {
    const target = findUnit(s, ctx.targetInstanceId!)?.unit
    return target ? giveTokens(healUnit(s, target.instanceId, target.damage), target.instanceId, TOKEN_SHIELD, 2) : s
  }))
registerCard('LAW_093', unitThenWp("You may return a non-leader unit that costs 3 or less to its owner's hand. Then, its owner may play it for free. It gains Shielded for this phase.", // Rio Durant
  pickAll(nonLeader, (s, u) => (cardOf(s, u)?.cost ?? 0) <= 3), 'return a unit that costs 3 or less to hand', true,
  (s, ctx) => returnThenOwnerMayPlayFree(s, ctx, true)))
/** Return the chosen unit to its owner's hand; its owner may then play it for free (Rio Durant, A New Adventure). */
function returnThenOwnerMayPlayFree(s: GameState, ctx: IfYouDoContext, thenShield: boolean): GameState {
  const target = findUnit(s, ctx.targetInstanceId!)
  if (!target) return s
  const cardOwner = target.unit.owner ?? target.owner
  const returned = returnUnitToHand(s, target.unit.instanceId)
  const hand = returned.players[cardOwner].hand
  // A token leaves no card behind, so there is nothing to play.
  if (hand.length === s.players[cardOwner].hand.length) return returned
  const handIndex = hand.length - 1
  return pushChoice(returned, {
    kind: 'playUnitFromHand', id: ctx.sourceInstanceId!, controller: cardOwner, candidates: [{ handIndex, cardId: hand[handIndex] }],
    costDelta: -(returned.cards[hand[handIndex]]?.cost ?? 0) - 99, entersReady: false, optional: true,
    ...(thenShield ? { thenTokens: [TOKEN_SHIELD] } : {}),
  })
}
registerCard('LOF_171', { // Heavy Blaster Cannon
  attachRestriction: nonVehicle,
  ...unitThenWp('You may deal 1 damage to a ground unit. Then, deal 1 damage to the same unit. Then, deal 1 damage to the same unit.',
    pickGround, 'deal 1 damage to a ground unit three times', true,
    (s, ctx) => [1, 2, 3].reduce(acc => (findUnit(acc, ctx.targetInstanceId!) ? dealDamageToUnit(acc, ctx.targetInstanceId!, 1) : acc), s)),
})
registerCard('SEC_030', { // Death Trooper
  ...whenPlayed('Deal 2 damage to a friendly ground unit and 2 damage to an enemy ground unit.', (s, ctx) =>
    unitThen(s, ctx, pickedIds(s, ctx, pickAll(pickFriendly, pickGround)), 'deal 2 damage to a friendly ground unit', false, 'friendly')),
  ifYouDo: (s, ctx) => {
    const hit = dealDamageToUnit(s, ctx.targetInstanceId!, 2)
    return ctx.step === 'friendly' ? unitThen(hit, ctx, pickedIds(hit, ctx, pickAll(pickEnemy, pickGround)), 'deal 2 damage to an enemy ground unit', false, 'enemy') : hit
  },
})
registerCard('SOR_097', unitThenWp('You may deal damage to a unit equal to the number of units you control in its arena.', // Admiral Ackbar
  pickAny, 'deal damage to a unit equal to the units you control in its arena', true,
  (s, ctx) => {
    const target = findUnit(s, ctx.targetInstanceId!)?.unit
    const amount = target ? unitsIn(s, ctx.owner, target.arena).length : 0
    return target && amount > 0 ? dealDamageToUnit(s, target.instanceId, amount) : s
  }))
registerCard('LOF_037', { // Darth Vader
  abilities: [
    ...whenPlayed('Give a Shield token to a friendly unit and to an enemy unit.', (s, ctx) =>
      unitThen(s, ctx, pickedIds(s, ctx, pickFriendly), 'give a friendly unit a Shield token', false, 'friendly')).abilities,
    {
      trigger: 'onAttack',
      description: 'Defeat an enemy unit with a Shield token on it.',
      effect: (s, ctx) => targetChoice(s, ctx, 'selectUnitToDefeat', pickedIds(s, ctx, pickAll(pickEnemy, (_s, u) => hasToken(u.upgrades, TOKEN_SHIELD)))),
    },
  ],
  ifYouDo: (s, ctx) => {
    const shielded = giveToken(s, ctx.targetInstanceId!, TOKEN_SHIELD)
    return ctx.step === 'friendly' ? unitThen(shielded, ctx, pickedIds(shielded, ctx, pickEnemy), 'give an enemy unit a Shield token', false, 'enemy') : shielded
  },
})

// Upgrades returned, moved or played
const mayReturnUpgradeWp = (description: string, candidates: (s: GameState) => UpgradeRef[]) => whenPlayed(description, (s, ctx) => {
  const found = candidates(s)
  return found.length ? pushChoice(s, { kind: 'selectUpgradeToReturn', id: ctx.sourceInstanceId!, controller: ctx.owner, candidates: found, optional: true }) : s
})
const nonUniqueUpgrade = (s: GameState, up: UpgradeRef): boolean => !s.cards[up.cardId]?.unique
registerCard('SEC_200', mayReturnUpgradeWp("You may return an upgrade that costs 3 or less to its owner's hand.", s => upgradeCandidates(s, { maxCost: 3 }))) // Junior Senator
registerCard('SHD_209', mayReturnUpgradeWp("You may return a non-unique upgrade to its owner's hand.", s => upgradeCandidates(s).filter(up => nonUniqueUpgrade(s, up)))) // Criminal Muscle
registerCard('LAW_078', whenPlayed('You may defeat a non-unique upgrade. If you control a Vigilance or Command unit, you may defeat an upgrade instead.', (s, ctx) => { // Sabine Wren
  const any = youControl(s, ctx, pickAspect('Vigilance', 'Command'))
  const candidates = upgradeCandidates(s).filter(up => any || nonUniqueUpgrade(s, up))
  return candidates.length ? pushChoice(s, { kind: 'selectUpgradeToDefeat', id: ctx.sourceInstanceId!, controller: ctx.owner, candidates, optional: true }) : s
}))

/** The units other than its host that `up` could be attached to by `owner`. */
const moveTargets = (s: GameState, up: UpgradeRef, owner: PlayerId): string[] => {
  const restriction = getCardDefinition(up.cardId)?.attachRestriction
  return allUnits(s).filter(u => u.instanceId !== up.unitId && (!restriction || restriction(s, u, owner))).map(u => u.instanceId)
}
registerCard('LOF_248', { // Jocasta Nu
  ...whenPlayed('You may attach a friendly upgrade on a friendly unit to a different eligible unit.', (s, ctx) => {
    const candidates = upgradeCandidates(s, { owner: ctx.owner, hostController: ctx.owner }).filter(up => moveTargets(s, up, ctx.owner).length > 0)
    return candidates.length
      ? pushChoice(s, { kind: 'selectUpgradeThen', id: ctx.sourceInstanceId!, controller: ctx.owner, candidates, optional: true, text: 'move a friendly upgrade to another unit', then: resume(ctx) })
      : s
  }),
  ifYouDo: (s, ctx) => {
    const up = ctx.upgradeChosen
    if (!up) return s
    // First the upgrade, then where it goes.
    if (!ctx.targetInstanceId) {
      return pushChoice(s, { kind: 'selectUnitThen', id: ctx.sourceInstanceId!, controller: ctx.owner, targets: moveTargets(s, up, ctx.owner), text: `attach ${s.cards[up.cardId]?.name ?? 'the upgrade'} to a different unit`, then: { ...resume(ctx), upgrade: up } })
    }
    return moveUpgrade(s, up, ctx.targetInstanceId)
  },
})
/**
 * Detach an upgrade and attach it to `targetId`, handing it to `newOwner` when the move also takes control
 * of it (Evidence of the Crime). A move is an attach, not a play (CR 3.6.14): the new host's "when an
 * upgrade attaches" reacts, and nothing counts it as played. Detaching is not being defeated, so the old
 * host's side fires nothing.
 */
function moveUpgrade(s: GameState, up: UpgradeRef, targetId: string, newOwner?: PlayerId): GameState {
  const from = findUnit(s, up.unitId)
  const moving = from?.unit.upgrades[up.upgradeIndex]
  if (!from || !moving || moving.cardId !== up.cardId) return s
  const detached = updatePlayer(s, from.owner, {
    units: s.players[from.owner].units.map(u => (u.instanceId === up.unitId ? { ...u, upgrades: u.upgrades.filter((_, i) => i !== up.upgradeIndex) } : u)),
  })
  if (!findUnit(detached, targetId)) return s
  return fireUpgradeAttached(attachUpgrades(detached, targetId, [newOwner ? { ...moving, owner: newOwner } : moving]), targetId)
}
registerCard('LOF_150', { // Cin Drallig
  ...whenPlayed('You may play a Lightsaber upgrade from your hand for free on this unit. If you do, ready him.', (s, ctx) => {
    const self = findUnit(s, ctx.sourceInstanceId!)?.unit
    if (!self) return s
    const handIndices = s.players[ctx.owner].hand.flatMap((id, i) => {
      const c = s.cards[id]
      const restriction = getCardDefinition(id)?.attachRestriction
      return c?.type === 'upgrade' && c.traits.some(t => t.toLowerCase() === 'lightsaber') && (!restriction || restriction(s, self, ctx.owner)) ? [i] : []
    })
    return handIndices.length
      ? pushChoice(s, { kind: 'selectHandCardThen', id: ctx.sourceInstanceId!, controller: ctx.owner, handIndices, optional: true, text: 'play a Lightsaber upgrade on this unit for free', then: resume(ctx) })
      : s
  }),
  ifYouDo: (s, ctx) =>
    (ctx.handIndex === undefined ? s : readyUnit(playUpgradeOnto(s, ctx.owner, ctx.handIndex, ctx.sourceInstanceId!), ctx.sourceInstanceId!)),
})

// Upgrade attach rules and upgrade-specific text
/** "Attach to a friendly unit", read against the player playing the upgrade. */
const friendlyHost = (s: GameState, t: UnitState, player: PlayerId): boolean => s.players[player].units.includes(t)
/** When Played on an upgrade: its host, when that host is named `name`. */
const hostIs = (name: string): When => (s, ctx) => hostPasses(s, ctx, namedAs(name)) !== undefined

registerCard('SEC_069', { // Nimble Prowess
  attachRestriction: friendlyHost,
  ...whenPlayed("You may exhaust a unit in attached unit's arena.", (s, ctx) => {
    const host = findUnit(s, ctx.sourceInstanceId!)?.unit
    return host ? targetChoice(s, ctx, 'mayExhaustUnit', pickedIds(s, ctx, pickArena(host.arena)), true) : s
  }),
})
registerCard('LOF_091', { // Craving Power
  attachRestriction: friendlyHost,
  ...whenPlayed("Deal damage to an enemy unit equal to attached unit's power.", (s, ctx) => {
    const host = findUnit(s, ctx.sourceInstanceId!)?.unit
    const amount = host ? effectivePower(s, host) : 0
    return amount > 0 ? damageChoice(s, ctx, amount, picked(s, ctx, pickEnemy)) : s
  }),
})
/** Qui-Gon Jinn's Lightsaber: ready units that still fit what is left of the combined cost of 6. */
const quiGonTargets = (s: GameState, ctx: EventCtx, budget: number): string[] =>
  pickedIds(s, ctx, (st, u) => !u.exhausted && (st.cards[u.cardId]?.cost ?? 0) <= budget)
registerCard('LOF_201', { // Qui-Gon Jinn's Lightsaber
  attachRestriction: (s, t, player) => friendlyHost(s, t, player) && nonVehicle(s, t),
  ...whenPlayed('If attached unit is Qui-Gon Jinn, you may exhaust any number of units with combined cost 6 or less.', (s, ctx) =>
    (hostIs('Qui-Gon Jinn')(s, ctx) ? unitThen(s, ctx, quiGonTargets(s, ctx, 6), 'exhaust a unit (combined cost 6 or less)', true, '6') : s)),
  // One unit at a time, the step carrying the cost still unspent; stopping is always allowed.
  ifYouDo: (s, ctx) => {
    const target = findUnit(s, ctx.targetInstanceId!)?.unit
    if (!target) return s
    const left = Number(ctx.step) - (s.cards[target.cardId]?.cost ?? 0)
    const exhausted = exhaustUnit(s, target.instanceId)
    return unitThen(exhausted, ctx, quiGonTargets(exhausted, ctx, left), `exhaust another unit (cost ${left} or less)`, true, String(left))
  },
})
registerCard('SHD_193', { // Frozen in Carbonite
  attachRestriction: nonLeader,
  cannotReady: () => true,
  ...whenPlayed('Exhaust attached unit.', (s, ctx) => exhaustUnit(s, ctx.sourceInstanceId!)),
})
registerCard('LAW_111', { // Leia's Disguise
  attachRestriction: nonVehicle,
  grantedTraits: () => ['Underworld'],
  ...whenPlayed('If attached unit is Leia Organa, give a Shield token to a friendly unit.', (s, ctx) =>
    (hostIs('Leia Organa')(s, ctx) ? shieldChoice(s, ctx, pickedIds(s, ctx, pickFriendly), false) : s)),
})
registerCard('TWI_256', { // Hold-Out Blaster
  attachRestriction: nonVehicle,
  ...whenPlayed('You may have attached unit deal 1 damage to a ground unit.', (s, ctx) => {
    const host = findUnit(s, ctx.sourceInstanceId!)?.unit
    const unitTargets = pickedIds(s, ctx, pickGround)
    // The damage is the attached unit's, so it is its card that deals it.
    return host && unitTargets.length
      ? pushChoice(s, { kind: 'selectDamageTarget', id: ctx.sourceInstanceId!, controller: ctx.owner, amount: 1, unitTargets, baseTargets: [], optional: true, source: { cardId: host.cardId, controller: ctx.owner } })
      : s
  }),
})
registerCard('SOR_136', { // Vader's Lightsaber
  attachRestriction: nonVehicle,
  ...damageWp('If attached unit is Darth Vader, you may deal 4 damage to a ground unit.', pickGround, 4, true, hostIs('Darth Vader')),
})
registerCard('TWI_219', whenPlayed('Attached unit can\'t be attacked this phase (unless it has Sentinel).', (s, ctx) => // On Top of Things
  addLastingEffect(s, { targetInstanceId: ctx.sourceInstanceId!, cannotBeAttacked: true, unlessSentinel: true })))

// Lasting effects the buff choice cannot carry
/** "Choose another friendly unit. While this unit is in play, the chosen unit gets ...". */
const whileInPlayBuff = (description: string, contribution: { power?: number; hp?: number; keywords?: KeywordInstance[] }): CardDefinition => ({
  ...whenPlayed(description, (s, ctx) =>
    unitThen(s, ctx, pickedIds(s, ctx, pickAll(pickFriendly, pickOther)), 'choose another friendly unit to buff while this unit is in play', false)),
  ifYouDo: (s, ctx) => {
    const self = findUnit(s, ctx.sourceInstanceId!)
    if (!self) return s
    return updatePlayer(s, self.owner, { units: s.players[self.owner].units.map(u => (u.instanceId === self.unit.instanceId ? { ...u, chosenUnitId: ctx.targetInstanceId } : u)) })
  },
  aura: (_s, source, target) => (source.chosenUnitId === target.instanceId ? contribution : undefined),
})
registerCard('LOF_191', whileInPlayBuff('Choose another friendly unit. While this unit is in play, the chosen unit gets +1/+0 and gains Saboteur.', { power: 1, keywords: [KW.saboteur] })) // BD-1
registerCard('TWI_110', whileInPlayBuff('Choose another friendly unit. While this unit is in play, the chosen unit gets +2/+2.', { power: 2, hp: 2 })) // Huyang
registerCard('LOF_211', whenPlayed("Each friendly unit with Hidden can't be attacked for this phase.", (s, ctx) => // Dooku
  lastingOnEach(s, picked(s, ctx, pickAll(pickFriendly, (st, u) => unitHasKeyword(st, u, 'Hidden'))), { cannotBeAttacked: true })))
registerCard('LOF_209', whenPlayed('Each enemy unit loses Hidden for this phase.', (s, ctx) => { // Tusken Tracker
  const enemy = opponentOf(ctx.owner)
  // Hidden protects through the unit's `hidden` mark as well as the keyword, so both go.
  const unmasked = updatePlayer(s, enemy, { units: s.players[enemy].units.map(u => (u.hidden ? { ...u, hidden: false } : u)) })
  return lastingOnEach(unmasked, unmasked.players[enemy].units, { removeKeywords: ['Hidden'] })
}))
registerCard('SOR_140', { // SpecForce Soldier
  ...whenPlayed('A unit loses Sentinel for this phase.', (s, ctx) => unitThen(s, ctx, pickedIds(s, ctx, pickAny), 'choose a unit to lose Sentinel for this phase', false)),
  ifYouDo: (s, ctx) => addLastingEffect(s, { targetInstanceId: ctx.targetInstanceId!, removeKeywords: ['Sentinel'] }),
})
registerCard('TWI_067', { // The Zillo Beast
  abilities: [
    ...whenPlayed('Give each enemy ground unit -5/-0 for this phase.', (s, ctx) => lastingOnEach(s, picked(s, ctx, pickAll(pickEnemy, pickGround)), { power: -5 })).abilities,
    { trigger: 'whenRegroupStarts', description: 'Heal 5 damage from this unit.', effect: (s, ctx) => healUnit(s, ctx.sourceInstanceId!, 5) },
  ],
})
const discardHasAspect = (aspect: string): When => (s, ctx) => s.players[ctx.owner].discard.some(id => s.cards[id]?.aspects.includes(aspect))
registerCard('LOF_070', { // Anakin Skywalker
  abilities: [
    ...buffWp('If there is a Heroism card in your discard pile, you may give a unit -3/-3 for this phase.', pickAny, () => ({ power: -3, hp: -3 }), true, discardHasAspect('Heroism')).abilities,
    ...buffWp('If there is a Villainy card in your discard pile, you may give a unit -3/-3 for this phase.', pickAny, () => ({ power: -3, hp: -3 }), true, discardHasAspect('Villainy')).abilities,
  ],
})

// Control and other zones
registerCard('LAW_233', { // Galen Erso
  ...whenPlayed('You may have an opponent take control of this unit.', (s, ctx) =>
    pushChoice(s, { kind: 'mayPayThen', id: ctx.sourceInstanceId!, controller: ctx.owner, cost: 0, text: 'let an opponent take control of this unit', then: resume(ctx) })),
  ifYouDo: (s, ctx) => takeControlOfUnit(s, ctx.owner, opponentOf(ctx.owner), ctx.sourceInstanceId!, 'permanent'),
  aura: (_s, _source, _target, friendly) => (friendly ? undefined : { keywords: [KW.raid(1), KW.saboteur] }),
})
registerCard('SEC_192', { // Grand Moff Tarkin
  ...whenPlayed("Take control of an enemy non-leader Vehicle unit. When this unit leaves play, that unit's owner takes control of that unit.", (s, ctx) =>
    unitThen(s, ctx, pickedIds(s, ctx, pickAll(pickEnemy, nonLeader, pickTrait('Vehicle'))), 'take control of an enemy Vehicle unit', false)),
  ifYouDo: (s, ctx) => takeControlOfUnit(s, opponentOf(ctx.owner), ctx.owner, ctx.targetInstanceId!, ctx.sourceInstanceId),
})
registerCard('TWI_211', { // Sly Moore
  ...whenPlayed("Take control of an enemy token unit and ready it. At the start of the regroup phase, that token unit's owner takes control of it.", (s, ctx) =>
    unitThen(s, ctx, pickedIds(s, ctx, pickAll(pickEnemy, (_st, u) => isTokenCard(u.cardId))), 'take control of an enemy token unit', false)),
  ifYouDo: (s, ctx) => readyUnit(takeControlOfUnit(s, opponentOf(ctx.owner), ctx.owner, ctx.targetInstanceId!), ctx.targetInstanceId!),
})
/**
 * Governor's Shuttle: the player picks, then the opponent, and only then are both defeated, as one
 * event. The first pick rides in the step so the second can finish the ability.
 */
const shuttlePick = (s: GameState, ctx: Resumable, chooser: PlayerId, step: string): GameState => {
  const targets = s.players[chooser].units.map(u => u.instanceId)
  return pushChoice(s, { kind: 'selectUnitThen', id: `${ctx.sourceInstanceId}-${chooser}`, controller: chooser, targets, text: 'choose a unit you control to defeat', then: resume(ctx, step) })
}
registerCard('LAW_099', { // Governor's Shuttle
  ...whenPlayed('Each player chooses a unit they control. Defeat those units.', (s, ctx) => {
    if (s.players[ctx.owner].units.length) return shuttlePick(s, ctx, ctx.owner, 'mine')
    return s.players[opponentOf(ctx.owner)].units.length ? shuttlePick(s, ctx, opponentOf(ctx.owner), 'theirs:') : s
  }),
  ifYouDo: (s, ctx) => {
    if (ctx.step === 'mine') {
      return s.players[opponentOf(ctx.owner)].units.length
        ? shuttlePick(s, ctx, opponentOf(ctx.owner), `theirs:${ctx.targetInstanceId}`)
        : defeatUnits(s, [ctx.targetInstanceId!])
    }
    const mine = ctx.step?.slice('theirs:'.length)
    return defeatUnits(s, [...(mine ? [mine] : []), ctx.targetInstanceId!])
  },
})
registerCard('TWI_252', whenPlayed('Choose an opponent. They shuffle their discard pile and put it on the bottom of their deck.', (s, ctx) => { // Aggrieved Parliamentarian
  // With two players the opponent is the only choice.
  const opp = opponentOf(ctx.owner)
  const p = s.players[opp]
  if (!p.discard.length) return s
  return { ...updatePlayer(s, opp, { discard: [], deck: [...p.deck, ...seededShuffle(p.discard, s.rngSeed)] }), rngSeed: nextSeed(s.rngSeed) }
}))
registerCard('SOR_183', whenPlayed("You may return an event from a discard pile to its owner's hand.", (s, ctx) => { // Bounty Hunter Crew
  const piles = [ctx.owner, opponentOf(ctx.owner)].flatMap(p => s.players[p].discard.filter(id => s.cards[id]?.type === 'event').map(id => ({ id, p })))
  return piles.length
    ? pushChoice(s, { kind: 'selectFromDiscard', id: ctx.sourceInstanceId!, controller: ctx.owner, candidates: piles.map(x => x.id), owners: piles.map(x => x.p), optional: true })
    : s
}))

// A second ability outside When Played
registerCard('LAW_058', { // Honor-Bound Partisan
  abilities: [
    ...whenPlayed('Deal 1 damage to a base.', (s, ctx) => damageChoice(s, ctx, 1, [], BOTH_BASES)).abilities,
    ...whenDefeated('The next unit you play this phase costs 1 less.', (s, ctx) => grantNextUnit(s, ctx.owner, { costDelta: -1 })).abilities,
  ],
})
registerCard('LAW_091', { // Val
  abilities: [
    ...whenPlayed('Give a Shield token to another friendly unit.', (s, ctx) => shieldChoice(s, ctx, pickedIds(s, ctx, pickAll(pickFriendly, pickOther)), false)).abilities,
    ...whenDefeated('Give a Shield token to an enemy unit.', (s, ctx) => shieldChoice(s, ctx, pickedIds(s, ctx, pickEnemy), false)).abilities,
  ],
})
const drawThenDiscardOnDefeat: CardDefinition = {
  abilities: [
    ...whenPlayed('Draw a card.', (s, ctx) => drawCards(s, ctx.owner, 1)).abilities,
    ...whenDefeated('Discard a card from your hand.', (s, ctx) =>
      (s.players[ctx.owner].hand.length ? pushChoice(s, { kind: 'selectDiscard', id: ctx.sourceInstanceId!, controller: ctx.owner, count: 1 }) : s)).abilities,
  ],
}
registerCard('LOF_194', drawThenDiscardOnDefeat) // J-Type Nubian Starship
registerCard('TWI_208', drawThenDiscardOnDefeat) // Favorable Delegate
registerCard('TWI_185', { // Ziro the Hutt
  abilities: [
    ...whenPlayed('For each opponent, you may exhaust a unit that player controls.', (s, ctx) => targetChoice(s, ctx, 'mayExhaustUnit', pickedIds(s, ctx, pickEnemy), true)).abilities,
    {
      trigger: 'onAttack',
      description: 'For each opponent, you may exhaust a resource that player controls.',
      effect: (s, ctx) => (s.players[opponentOf(ctx.owner)].resources.some(r => !r.exhausted)
        ? pushChoice(s, { kind: 'mayPayThen', id: `${ctx.sourceInstanceId}-resource`, controller: ctx.owner, cost: 0, text: "exhaust an opponent's resource", then: resume(ctx) })
        : s),
    },
  ],
  ifYouDo: (s, ctx) => exhaustReadyResource(s, opponentOf(ctx.owner)),
})
registerCard('SHD_080', { // Salacious Crumb
  ...whenPlayed('Heal 1 damage from your base.', (s, ctx) => healBase(s, ctx.owner, 1)),
  actionAbilities: [{
    description: "[Exhaust, return this unit to his owner's hand]: Deal 1 damage to a ground unit.",
    exhaustCost: true,
    effect: (s, ctx) => {
      const returned = returnUnitToHand(s, ctx.sourceInstanceId!)
      return damageChoice(returned, ctx, 1, picked(returned, ctx, pickGround))
    },
  }],
})
const controlsFett = (s: GameState, owner: PlayerId): boolean =>
  [s.cards[s.players[owner].leader.cardId], ...s.players[owner].units.map(u => s.cards[u.cardId])].some(c => c?.name === 'Boba Fett' || c?.name === 'Jango Fett')
registerCard('SOR_184', { // Fett's Firespray
  ...readySelfWp('If you control Boba Fett or Jango Fett (as a leader or unit), ready this unit.', (s, ctx) => controlsFett(s, ctx.owner)),
  actionAbilities: [{
    description: '[C=2]: Exhaust a non-unique unit.',
    cost: 2,
    effect: (s, ctx) => targetChoice(s, ctx, 'mayExhaustUnit', pickedIds(s, ctx, (st, u) => !st.cards[u.cardId]?.unique)),
  }],
})
registerCard('SEC_139', { // Miraj Scintel
  ...damageWp('You may deal 3 damage to an undamaged unit.', (_s, u) => u.damage === 0, 3, true),
  aura: (s, _source, target, friendly, combat) => {
    if (!friendly || combat?.attackerInstanceId !== target.instanceId || !combat.defenderInstanceId) return undefined
    return (findUnit(s, combat.defenderInstanceId)?.unit.damage ?? 0) > 0 ? { keywords: [KW.overwhelm] } : undefined
  },
})

// Several targets: "each of up to N", "any number", divided amounts
/** Where an "each of up to N units" ability has got to: picks left, the units picked, and a flag for its finish. */
type UpToStep = { left: number; chosen: string[]; flag?: boolean }
interface UpToSpec {
  text: string
  test: Pick
  apply: (s: GameState, ctx: IfYouDoContext, id: string) => GameState
  /** Whether a pick counts toward the finish's flag, judged from the states either side of it. */
  mark?: (before: GameState, after: GameState, ctx: IfYouDoContext, id: string) => boolean
  /** What happens once the picks stop, however they stopped. */
  finish?: (s: GameState, ctx: IfYouDoContext, step: UpToStep) => GameState
}
const upToOffer = (s: GameState, ctx: Resumable, spec: UpToSpec, step: UpToStep): GameState => {
  const targets = step.left > 0 ? pickedIds(s, ctx, spec.test).filter(id => !step.chosen.includes(id)) : []
  if (!targets.length) return spec.finish ? spec.finish(s, { ...ctx }, step) : s
  return pushChoice(s, {
    kind: 'selectUnitThen', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, optional: true, text: spec.text,
    then: resume(ctx, JSON.stringify(step)), ...(spec.finish ? { hookOnDecline: true } : {}),
  })
}
/**
 * "<Effect> each of up to `n` (different) units that ...": one pick at a time, each unit at most once,
 * and Done at any point. Each pick applies at once, which is how the rest of the engine resolves a
 * divided or repeated effect.
 */
const eachOfUpTo = (description: string, n: number, spec: UpToSpec, when: When = always): CardDefinition => ({
  ...whenPlayed(description, (s, ctx) => (when(s, ctx) ? upToOffer(s, ctx, spec, { left: n, chosen: [] }) : s)),
  ifYouDo: (s, ctx) => {
    const step = JSON.parse(ctx.step ?? '{}') as UpToStep
    if (!ctx.targetInstanceId) return spec.finish ? spec.finish(s, ctx, step) : s
    const id = ctx.targetInstanceId
    const after = spec.apply(s, ctx, id)
    const flag = step.flag || (spec.mark?.(s, after, ctx, id) ?? false)
    return upToOffer(after, ctx, spec, { left: step.left - 1, chosen: [...step.chosen, id], ...(flag ? { flag } : {}) })
  },
})
const damageEach = (amount: number) => (s: GameState, _ctx: IfYouDoContext, id: string) => dealDamageToUnit(s, id, amount)
const shieldEach = (s: GameState, _ctx: IfYouDoContext, id: string) => giveToken(s, id, TOKEN_SHIELD)
const haveInitiative: When = (s, ctx) => s.initiative === ctx.owner

registerCard('LAW_187', { // "Staccato Lightning" Repeater
  attachRestriction: nonVehicle,
  ...eachOfUpTo('Deal 1 damage to each of up to 3 different ground units.', 3, { text: 'deal 1 damage to a ground unit (up to 3)', test: pickGround, apply: damageEach(1) }),
})
registerCard('LAW_183', eachOfUpTo('Deal 1 damage to each of up to 2 space units.', 2, { text: 'deal 1 damage to a space unit (up to 2)', test: pickArena('space'), apply: damageEach(1) })) // B-Wing Skirmisher
registerCard('SEC_169', eachOfUpTo('Deal 1 damage to each of up to 4 other ground units. If no friendly units were damaged by this ability, deal 2 damage to your base.', 4, { // AAT Incinerator
  text: 'deal 1 damage to another ground unit (up to 4)',
  test: pickAll(pickGround, pickOther),
  apply: damageEach(1),
  // Damaged means damage landed: a Shield that soaks the hit leaves the unit undamaged.
  mark: (before, after, ctx, id) => before.players[ctx.owner].units.some(u => u.instanceId === id)
    && (findUnit(after, id)?.unit.damage ?? Infinity) > (findUnit(before, id)?.unit.damage ?? 0),
  finish: (s, ctx, step) => (step.flag ? s : dealDamageToBase(s, ctx.owner, 2)),
}))
registerCard('SEC_155', { // Alexsandr Kallus
  ...eachOfUpTo('Deal 2 damage to each of up to 3 ground units.', 3, { text: 'deal 2 damage to a ground unit (up to 3)', test: pickGround, apply: damageEach(2) }),
  aura: (s, source, target, friendly) =>
    (friendly && target.instanceId !== source.instanceId && s.cards[target.cardId]?.unique && findUnit(s, source.instanceId)?.owner === s.initiative
      ? { keywords: [KW.raid(2)] }
      : undefined),
})
registerCard('LOF_167', eachOfUpTo('If you have the initiative, deal 1 damage to each of up to 3 units.', 3, { text: 'deal 1 damage to a unit (up to 3)', test: pickAny, apply: damageEach(1) }, haveInitiative)) // Saesee Tiin
registerCard('JTL_140', eachOfUpTo('Deal 1 damage to each of up to 3 units.', 3, { text: 'deal 1 damage to a unit (up to 3)', test: pickAny, apply: damageEach(1) })) // IG-2000
registerCard('JTL_170', { // War Juggernaut
  ...eachOfUpTo('Deal 1 damage to each of any number of units.', Number.MAX_SAFE_INTEGER, { text: 'deal 1 damage to a unit (any number)', test: pickAny, apply: damageEach(1) }),
  statModifier: s => ({ power: allUnits(s).filter(u => u.damage > 0).length }),
})
registerCard('JTL_072', eachOfUpTo('Give a Shield token to each of up to 2 Fringe units.', 2, { text: 'give a Fringe unit a Shield token (up to 2)', test: pickTrait('Fringe'), apply: shieldEach })) // Wing Guard Security Team
registerCard('SHD_047', eachOfUpTo('Give a Shield token to each of up to 3 Mandalorian units.', 3, { text: 'give a Mandalorian unit a Shield token (up to 3)', test: pickTrait('Mandalorian'), apply: shieldEach })) // The Armorer

registerCard('LOF_147', { // Kit Fisto's Aethersprite
  ...whenPlayed('You may defeat any number of upgrades on a unit.', (s, ctx) =>
    unitThen(s, ctx, pickedIds(s, ctx, (_st, u) => u.upgrades.length > 0), 'choose a unit to defeat upgrades on', true, 'unit')),
  // The unit first, then its upgrades one at a time until Done or none are left.
  ifYouDo: (s, ctx) => {
    const up = ctx.upgradeChosen
    const onUnit = up ? up.unitId : ctx.targetInstanceId
    if (!onUnit) return s
    const next = up ? defeatUpgradeAt(s, up.unitId, up.upgradeIndex) : s
    const candidates = upgradeCandidates(next).filter(c => c.unitId === onUnit)
    return candidates.length
      ? pushChoice(next, { kind: 'selectUpgradeThen', id: ctx.sourceInstanceId!, controller: ctx.owner, candidates, optional: true, text: 'defeat an upgrade on that unit', then: resume(ctx, 'upgrade') })
      : next
  },
})
registerCard('SOR_135', whenPlayed('Deal 6 damage divided as you choose among enemy units.', (s, ctx) => { // Emperor Palpatine
  const targets = s.players[opponentOf(ctx.owner)].units.map(u => u.instanceId)
  return targets.length ? pushChoice(s, { kind: 'distributeDamage', id: ctx.sourceInstanceId!, controller: ctx.owner, remaining: 6, total: 6, targets, enemiesOf: ctx.owner }) : s
}))
registerCard('SOR_052', whenPlayed('Heal up to 8 total damage from any number of units and/or bases. Deal that much damage to this unit.', (s, ctx) => { // Redemption
  const unitTargets = allUnits(s).filter(u => u.damage > 0).map(u => u.instanceId)
  const baseTargets = BOTH_BASES.filter(b => s.players[b].base.damage > 0)
  return unitTargets.length + baseTargets.length
    ? pushChoice(s, { kind: 'distributeHealing', id: ctx.sourceInstanceId!, controller: ctx.owner, remaining: 8, healed: 0, unitTargets, baseTargets, damageUnit: ctx.sourceInstanceId! })
    : s
}))
registerCard('TWI_044', whenPlayed('Heal up to 2 damage from another unit and deal that much damage to this unit.', (s, ctx) => { // Kashyyyk Defender
  const unitTargets = picked(s, ctx, pickOther).filter(u => u.damage > 0).map(u => u.instanceId)
  return unitTargets.length
    ? pushChoice(s, { kind: 'distributeHealing', id: ctx.sourceInstanceId!, controller: ctx.owner, remaining: 2, healed: 0, unitTargets, baseTargets: [], damageUnit: ctx.sourceInstanceId!, oneUnit: true })
    : s
}))

// ── The rest of the one-off events: searches that draw, and hands ─────────────────────────────────

// Searches that draw: `searchDrawWp` as the When Played searches use it.
registerCard('LAW_166', searchDrawWp('Search the top 8 cards of your deck for a Vigilance, Aggression, or Cunning unit, reveal it, and draw it.', 8, // Putting a Team Together
  c => printedUnit(c) && ['Vigilance', 'Aggression', 'Cunning'].some(a => printedAspect(c, a))))
registerCard('SEC_072', searchDrawWp('Search the top 8 cards of your deck for an upgrade, reveal it, and draw it.', 8, // Scour the Archives
  c => c?.type === 'upgrade'))
registerCard('SOR_123', searchDrawWp('Search the top 5 cards of your deck for a unit, reveal it, and draw it.', 5, printedUnit)) // Recruit
const prepareForTakeoff = searchDrawWp('Search the top 8 cards of your deck for up to 2 Vehicle units, reveal them, and draw them.', 8,
  c => printedUnit(c) && printedTrait(c, 'Vehicle'), 2)
registerCard('JTL_128', prepareForTakeoff) // Prepare for Takeoff
registerCard('SOR_125', prepareForTakeoff) // Prepare For Takeoff (the same card, printed with a capital F)
registerCard('SHD_093', searchDrawWp('Search the top 5 cards of your deck for up to 3 units, reveal them, and draw them.', 5, printedUnit, 3)) // Remnant Reserves
registerCard('SHD_253', searchDrawWp('Search the top 8 cards of your deck for up to 2 Mandalorian and/or upgrade cards, reveal them, and draw them.', 8, // This Is The Way
  c => c?.type === 'upgrade' || printedTrait(c, 'Mandalorian'), 2))

// Hands. A discard a card prints as compulsory ("discard a card from it") removes the Done.
const opponentHandDiscard = (s: GameState, ctx: EventCtx, over: Partial<Extract<PendingChoice, { kind: 'lookAtHand' }>> = {}): GameState =>
  pushChoice(s, { kind: 'lookAtHand', id: ctx.sourceInstanceId!, controller: ctx.owner, target: opponentOf(ctx.owner), mayDiscard: true, mustDiscard: true, ...over })
/** `who` discards `count` cards of their choice, or as many as they hold. */
const discards = (s: GameState, who: PlayerId, count: number, id: string, then?: IfYouDo): GameState => {
  const n = Math.min(count, s.players[who].hand.length)
  return n > 0 ? pushChoice(s, { kind: 'selectDiscard', id, controller: who, count: n, ...(then ? { then: { ifYouDo: then } } : {}) }) : s
}
const choosePlayer = (s: GameState, ctx: Resumable, text: string, step?: string): GameState =>
  pushChoice(s, { kind: 'choosePlayerThen', id: ctx.sourceInstanceId!, controller: ctx.owner, text, then: resume(ctx, step) })

registerCard('SOR_200', whenPlayed("Look at an opponent's hand and discard a card from it.", (s, ctx) => opponentHandDiscard(s, ctx))) // Spark of Rebellion
registerCard('LOF_226', whenPlayed("Look at an opponent's hand and discard a non-unit card from it.", (s, ctx) => // Tip the Scale
  opponentHandDiscard(s, ctx, { discardFilter: 'nonUnit' })))
registerCard('JTL_207', whenPlayed("Look at an opponent's hand and discard an event from it.", (s, ctx) => // Jam Communications
  opponentHandDiscard(s, ctx, { discardFilter: 'event' })))
registerCard('TWI_223', { // Unmasking the Conspiracy
  ...whenPlayed("Discard a card from your hand. If you do, look at an opponent's hand and discard a card from it.", (s, ctx) =>
    discards(s, ctx.owner, 1, ctx.sourceInstanceId!, resume(ctx))),
  ifYouDo: (s, ctx) => opponentHandDiscard(s, ctx),
})
registerCard('LAW_217', unitThenWp("Exhaust an enemy unit. If you do, look at its controller's hand and discard a card from it that shares an aspect with that unit.", // Hold For Questioning
  pickEnemy, 'exhaust an enemy unit', false, (s, ctx) => {
    const target = findUnit(s, ctx.targetInstanceId!)
    // Only a ready unit can be exhausted, so only then has "if you do" happened.
    if (!target || target.unit.exhausted) return s
    const discardAspects = (cardOf(s, target.unit)?.aspects ?? []).map(a => a.toLowerCase())
    return pushChoice(exhaustUnit(s, target.unit.instanceId), {
      kind: 'lookAtHand', id: ctx.sourceInstanceId!, controller: ctx.owner, target: target.owner, mayDiscard: true, mustDiscard: true, discardAspects,
    })
  }))
registerCard('SEC_233', whenPlayed("Look at an opponent's hand. Then, choose a non-leader unit that opponent controls that costs 6 or less and return it to its owner's hand.", (s, ctx) => { // Beguile
  // The look is answered before the return is offered; looking changes nothing on the board.
  const looked = pushChoice(s, { kind: 'lookAtHand', id: `${ctx.sourceInstanceId}-look`, controller: ctx.owner, target: opponentOf(ctx.owner) })
  return targetChoice(looked, ctx, 'selectUnitToReturn', pickedIds(s, ctx, pickAll(pickEnemy, nonLeader, (st, u) => (cardOf(st, u)?.cost ?? 0) <= 6)))
}))
registerCard('LAW_204', whenPlayed('Each player discards a card from their hand.', (s, ctx) => // Every Day, More Lies
  discards(discards(s, ctx.owner, 1, `${ctx.sourceInstanceId}-mine`), opponentOf(ctx.owner), 1, `${ctx.sourceInstanceId}-theirs`)))
registerCard('SHD_244', whenPlayed('Each opponent discards a card from their hand. Draw a card.', (s, ctx) => // No Bargain
  drawCards(discards(s, opponentOf(ctx.owner), 1, ctx.sourceInstanceId!), ctx.owner, 1)))
registerCard('SHD_156', whenPlayed('Draw a card. Each opponent who controls more resources than you discards a card from their hand.', (s, ctx) => { // Cripple Authority
  const drawn = drawCards(s, ctx.owner, 1)
  const opp = opponentOf(ctx.owner)
  return drawn.players[opp].resources.length > drawn.players[ctx.owner].resources.length ? discards(drawn, opp, 1, ctx.sourceInstanceId!) : drawn
}))
registerCard('SOR_175', whenPlayed("Draw 2 cards. Each opponent whose base you've damaged this phase discards 2 cards from their hand.", (s, ctx) => { // Forced Surrender
  // The phase record says the base took damage, not who dealt it; an opponent damaging their own
  // base is rare enough that it is read as yours.
  const drawn = drawCards(s, ctx.owner, 2)
  const opp = opponentOf(ctx.owner)
  return baseDamagedThisPhase(drawn, opp) ? discards(drawn, opp, 2, ctx.sourceInstanceId!) : drawn
}))
registerCard('SOR_174', whenPlayed('Each player discards all but 2 cards (of their choice) from their hand.', (s, ctx) => { // Smoke and Cinders
  const allBut2 = (st: GameState, who: PlayerId, id: string) => discards(st, who, st.players[who].hand.length - 2, id)
  return allBut2(allBut2(s, ctx.owner, `${ctx.sourceInstanceId}-mine`), opponentOf(ctx.owner), `${ctx.sourceInstanceId}-theirs`)
}))

// "Choose a player": the pick, then the card's hook with `playerChosen`.
registerCard('SOR_171', { // Mission Briefing
  ...whenPlayed('Choose a player. They draw 2 cards.', (s, ctx) => choosePlayer(s, ctx, 'draw 2 cards')),
  ifYouDo: (s, ctx) => drawCards(s, ctx.playerChosen!, 2),
})
registerCard('SHD_181', { // Pillage
  ...whenPlayed('Choose a player. They discard 2 cards from their hand.', (s, ctx) => choosePlayer(s, ctx, 'discard 2 cards')),
  ifYouDo: (s, ctx) => discards(s, ctx.playerChosen!, 2, ctx.sourceInstanceId!),
})
registerCard('SOR_167', { // Force Throw
  ...whenPlayed('Choose a player. That player discards a card from their hand. Then, if you control a FORCE unit, you may deal damage to a unit equal to the cost of the discarded card.', (s, ctx) =>
    choosePlayer(s, ctx, 'discard a card')),
  ifYouDo: (s, ctx) => {
    if (ctx.step !== 'thrown') return discards(s, ctx.playerChosen!, 1, ctx.sourceInstanceId!, resume(ctx, 'thrown'))
    const amount = (ctx.cardChosen ? s.cards[ctx.cardChosen]?.cost : 0) ?? 0
    return amount > 0 && controlsTrait(s, ctx.owner, 'Force') ? damageChoice(s, ctx, amount, picked(s, ctx, pickAny), [], true) : s
  },
})

// Damage read from a unit. A two-unit card picks the first unit (step `dealer`), carries it as
// `IfYouDo.unit` to the second pick, and reads the amount only when the second pick lands, so a change
// between the two (a prevention, a defeat) is honoured.
const sameArenaAs = (s: GameState, id: string | undefined): Pick => (_st, u) => u.instanceId !== id && u.arena === findUnit(s, id ?? '')?.unit.arena
/** "A <dealer> unit deals <amount> damage to a <target> unit." */
const unitDealsWp = (description: string, dealer: Pick, target: Pick, amount: (s: GameState, dealer: UnitState) => number): CardDefinition => ({
  ...whenPlayed(description, (s, ctx) => unitThen(s, ctx, pickedIds(s, ctx, dealer), 'choose the unit that deals the damage', false, 'dealer')),
  ifYouDo: (s, ctx) => {
    if (ctx.step === 'dealer') return unitThen(s, ctx, pickedIds(s, ctx, target), 'choose the unit to damage', false, 'target', ctx.targetInstanceId)
    const from = findUnit(s, ctx.unitChosen ?? '')?.unit
    return from ? dealDamageToUnit(s, ctx.targetInstanceId!, amount(s, from)) : s
  },
})

registerCard('SOR_127', unitDealsWp('A friendly unit deals damage equal to its power to an enemy unit.', pickFriendly, pickEnemy, // Strike True
  (s, u) => effectivePower(s, u)))
registerCard('SOR_151', unitDealsWp('A friendly unit deals damage to an enemy unit equal to the amount of damage on the friendly unit plus 1.', pickFriendly, pickEnemy, // Karabast
  (_s, u) => u.damage + 1))
registerCard('LOF_128', unitDealsWp('A friendly non-Vehicle unit deals damage equal to its remaining HP to an enemy unit.', // Protect the Pod
  pickAll(pickFriendly, (s, u) => !unitHasTrait(s, u, 'Vehicle')), pickEnemy, remainingHp))
registerCard('SOR_234', { // Maximum Firepower
  ...whenPlayed('A friendly IMPERIAL unit deals damage equal to its power to a unit. Then, another friendly IMPERIAL unit deals damage equal to its power to the same unit.', (s, ctx) =>
    unitThen(s, ctx, pickedIds(s, ctx, pickAll(pickFriendly, (st, u) => unitHasTrait(st, u, 'Imperial'))), 'choose the Imperial unit that deals the damage', false, 'dealer')),
  ifYouDo: (s, ctx) => {
    const imperials = (exclude?: string) => pickedIds(s, ctx, pickAll(pickFriendly, (st, u) => u.instanceId !== exclude && unitHasTrait(st, u, 'Imperial')))
    const power = (id: string | undefined) => { const u = findUnit(s, id ?? '')?.unit; return u ? effectivePower(s, u) : 0 }
    switch (ctx.step) {
      case 'dealer':
        return unitThen(s, ctx, pickedIds(s, ctx, pickAny), 'choose the unit to damage', false, `target:${ctx.targetInstanceId}`, ctx.targetInstanceId)
      case 'second': {
        const hit = findUnit(s, ctx.unitChosen ?? '')
        return hit ? dealDamageToUnit(s, hit.unit.instanceId, power(ctx.targetInstanceId)) : s
      }
      default: {
        // `target:<first dealer>`: the first hit, then "another" Imperial unit, which excludes the first.
        const first = ctx.step?.slice('target:'.length)
        const hit = dealDamageToUnit(s, ctx.targetInstanceId!, power(first))
        return findUnit(hit, ctx.targetInstanceId!)
          ? unitThen(hit, ctx, imperials(first).filter(id => findUnit(hit, id)), 'choose another Imperial unit to deal damage', false, 'second', ctx.targetInstanceId)
          : hit
      }
    }
  },
})
registerCard('JTL_129', unitThenWp('Choose a unit. Each friendly Vehicle unit in the same arena deals damage equal to its power to that unit.', pickAny, 'choose the unit to fire on', false, // Focus Fire
  (s, ctx) => {
    const target = findUnit(s, ctx.targetInstanceId!)?.unit
    if (!target) return s
    const vehicles = s.players[ctx.owner].units.filter(u => u.instanceId !== target.instanceId && u.arena === target.arena && unitHasTrait(s, u, 'Vehicle'))
    return vehicles.reduce((acc, v) => (findUnit(acc, target.instanceId) ? dealDamageToUnit(acc, target.instanceId, effectivePower(acc, v)) : acc), s)
  }))
registerCard('TWI_176', { // Caught in the Crossfire
  ...whenPlayed('Choose 2 enemy units in the same arena. Each of those units deals damage equal to its power to the other.', (s, ctx) =>
    unitThen(s, ctx, pickedIds(s, ctx, (st, u, c) => pickEnemy(st, u, c) && picked(st, c, pickEnemy).some(o => o !== u && o.arena === u.arena)), 'choose the first enemy unit', false, 'dealer')),
  ifYouDo: (s, ctx) => {
    if (ctx.step === 'dealer') return unitThen(s, ctx, pickedIds(s, ctx, pickAll(pickEnemy, sameArenaAs(s, ctx.targetInstanceId))), 'choose the second enemy unit', false, 'target', ctx.targetInstanceId)
    const a = findUnit(s, ctx.unitChosen ?? '')?.unit
    const b = findUnit(s, ctx.targetInstanceId!)?.unit
    if (!a || !b) return s
    // Both amounts are read before either lands: the damage is dealt at the same time.
    const [toB, toA] = [effectivePower(s, a), effectivePower(s, b)]
    return dealDamageToUnit(dealDamageToUnit(s, b.instanceId, toB), a.instanceId, toA)
  },
})
registerCard('JTL_173', { // Fight Fire With Fire
  ...whenPlayed('Choose a friendly unit and an enemy unit in the same arena. If you do, deal 3 damage to each of them.', (s, ctx) =>
    unitThen(s, ctx, pickedIds(s, ctx, (st, u, c) => pickFriendly(st, u, c) && picked(st, c, pickEnemy).some(e => e.arena === u.arena)), 'choose a friendly unit', false, 'dealer')),
  ifYouDo: (s, ctx) => {
    if (ctx.step === 'dealer') return unitThen(s, ctx, pickedIds(s, ctx, pickAll(pickEnemy, sameArenaAs(s, ctx.targetInstanceId))), 'choose an enemy unit in the same arena', false, 'target', ctx.targetInstanceId)
    return dealDamageToUnit(dealDamageToUnit(s, ctx.targetInstanceId!, 3), ctx.unitChosen!, 3)
  },
})
const unitsYouControlIn = (s: GameState, owner: PlayerId, u: UnitState): number => s.players[owner].units.filter(x => x.arena === u.arena).length
registerCard('SEC_130', unitThenWp('Deal damage to a unit equal to twice the number of units you control in its arena.', pickAny, 'choose a unit to damage', false, // Ferrix Uprising
  (s, ctx) => { const u = findUnit(s, ctx.targetInstanceId!)?.unit; return u ? dealDamageToUnit(s, u.instanceId, 2 * unitsYouControlIn(s, ctx.owner, u)) : s }))
registerCard('TWI_099', unitThenWp('Deal damage to an enemy unit equal to the number of units you control in its arena.', pickEnemy, 'choose an enemy unit to damage', false, // Synchronized Strike
  (s, ctx) => { const u = findUnit(s, ctx.targetInstanceId!)?.unit; return u ? dealDamageToUnit(s, u.instanceId, unitsYouControlIn(s, ctx.owner, u)) : s }))
registerCard('JTL_144', unitThenWp('Deal damage to a non-leader unit equal to 1 less than its remaining HP.', nonLeader, 'choose a non-leader unit to damage', false, // No Disintegrations
  (s, ctx) => { const u = findUnit(s, ctx.targetInstanceId!)?.unit; return u ? dealDamageToUnit(s, u.instanceId, Math.max(0, remainingHp(s, u) - 1)) : s }))
registerCard('SOR_092', unitThenWp('Give a friendly unit +2/+2 for this phase. Then, it deals damage equal to its power divided as you choose among any number of other units.', pickFriendly, 'choose a friendly unit', false, // Overwhelming Barrage
  (s, ctx) => {
    const id = ctx.targetInstanceId!
    const buffed = addLastingEffect(s, { targetInstanceId: id, power: 2, hp: 2 })
    const u = findUnit(buffed, id)?.unit
    const total = u ? effectivePower(buffed, u) : 0
    const targets = allUnits(buffed).filter(x => x.instanceId !== id).map(x => x.instanceId)
    return total > 0 && targets.length ? pushChoice(buffed, { kind: 'distributeDamage', id: ctx.sourceInstanceId!, controller: ctx.owner, remaining: total, total, targets }) : buffed
  }))

// "Choose an arena": the pick, then the card's hook with `arenaChosen`.
const chooseArena = (s: GameState, ctx: Resumable, text: string): GameState =>
  pushChoice(s, { kind: 'chooseArenaThen', id: ctx.sourceInstanceId!, controller: ctx.owner, text, then: resume(ctx) })
registerCard('SOR_173', { // Bombing Run
  ...whenPlayed('Choose an arena (ground or space). Deal 3 damage to each unit in that arena.', (s, ctx) => chooseArena(s, ctx, 'deal 3 damage to each unit in')),
  ifYouDo: (s, ctx) => allUnits(s).filter(u => u.arena === ctx.arenaChosen).reduce((acc, u) => dealDamageToUnit(acc, u.instanceId, 3), s),
})
registerCard('SOR_221', { // Outmaneuver
  ...whenPlayed('Choose an arena (ground or space). Exhaust each unit in that arena.', (s, ctx) => chooseArena(s, ctx, 'exhaust each unit in')),
  ifYouDo: (s, ctx) => allUnits(s).filter(u => u.arena === ctx.arenaChosen).reduce((acc, u) => exhaustUnit(acc, u.instanceId), s),
})
registerCard('JTL_131', { // Turbolaser Salvo
  ...whenPlayed('Choose an arena. A friendly space unit deals damage equal to its power to each enemy unit in that arena.', (s, ctx) => chooseArena(s, ctx, 'fire on')),
  ifYouDo: (s, ctx) => {
    // `salvo:<arena>` carries the arena to the second pick.
    if (ctx.arenaChosen) return unitThen(s, ctx, pickedIds(s, ctx, pickAll(pickFriendly, pickArena('space'))), 'choose a friendly space unit to fire', false, `salvo:${ctx.arenaChosen}`)
    const arena = ctx.step?.slice('salvo:'.length)
    const gun = findUnit(s, ctx.targetInstanceId!)?.unit
    if (!gun) return s
    const amount = effectivePower(s, gun)
    return s.players[opponentOf(ctx.owner)].units.filter(u => u.arena === arena).reduce((acc, u) => dealDamageToUnit(acc, u.instanceId, amount), s)
  },
})

// Exhausting and readying. "Exhaust X. If you do" has happened only when X was ready.
const readyNow = (s: GameState, id: string | undefined): UnitState | undefined => {
  const u = findUnit(s, id ?? '')?.unit
  return u && !u.exhausted ? u : undefined
}
/** "Exhaust an enemy unit" `left` more times, one pick at a time (`left:<n>` carries the count). */
const exhaustEnemiesStep = (s: GameState, ctx: Resumable, left: number, test: Pick = pickEnemy, unit?: string): GameState =>
  (left > 0 ? unitThen(s, ctx, pickedIds(s, ctx, test), 'exhaust an enemy unit', false, `left:${left}`, unit) : s)
const stepCount = (step: string | undefined): number => Number(step?.slice('left:'.length) ?? 0)

registerCard('SOR_218', whenPlayed('Exhaust an enemy unit. Give a Shield token to a friendly unit that costs 3 or less.', (s, ctx) => // Asteroid Sanctuary
  shieldChoice(targetChoice(s, ctx, 'mayExhaustUnit', pickedIds(s, ctx, pickEnemy)), { ...ctx, sourceInstanceId: `${ctx.sourceInstanceId}-shield` },
    pickedIds(s, ctx, pickAll(pickFriendly, (st, u) => printedCost(st, u) <= 3)), false)))
registerCard('TWI_221', unitThenWp('Exhaust a friendly unit. If you do, exhaust an enemy unit.', pickFriendly, 'exhaust a friendly unit', false, // In Pursuit
  (s, ctx) => (readyNow(s, ctx.targetInstanceId)
    ? targetChoice(exhaustUnit(s, ctx.targetInstanceId!), ctx, 'mayExhaustUnit', pickedIds(s, ctx, pickEnemy))
    : s)))
registerCard('JTL_195', unitThenWp('Exhaust an enemy unit. If you do, ready a friendly unit in the same arena with power equal to or less than that enemy unit.', pickEnemy, 'exhaust an enemy unit', false, // Cat and Mouse
  (s, ctx) => {
    const enemy = readyNow(s, ctx.targetInstanceId)
    if (!enemy) return s
    const next = exhaustUnit(s, enemy.instanceId)
    const power = effectivePower(next, enemy)
    return targetChoice(next, ctx, 'selectUnitToReady', pickedIds(next, ctx, pickAll(pickFriendly, (st, u) => u.arena === enemy.arena && effectivePower(st, u) <= power)))
  }))
registerCard('SEC_196', { // No One Ever Knew
  ...whenPlayed('For each friendly Official unit, exhaust an enemy unit.', (s, ctx) =>
    exhaustEnemiesStep(s, ctx, picked(s, ctx, pickAll(pickFriendly, pickTrait('Official'))).length)),
  ifYouDo: (s, ctx) => exhaustEnemiesStep(exhaustUnit(s, ctx.targetInstanceId!), ctx, stepCount(ctx.step) - 1),
})
registerCard('LAW_226', { // Secret Battle of Pretend
  ...whenPlayed('Exhaust a friendly unit. If you do, for each different aspect it has, exhaust an enemy unit in the same arena.', (s, ctx) =>
    unitThen(s, ctx, pickedIds(s, ctx, pickFriendly), 'exhaust a friendly unit', false, 'friendly')),
  ifYouDo: (s, ctx) => {
    if (ctx.step === 'friendly') {
      const friendly = readyNow(s, ctx.targetInstanceId)
      if (!friendly) return s
      const aspects = new Set((cardOf(s, friendly)?.aspects ?? []).map(a => a.toLowerCase())).size
      const next = exhaustUnit(s, friendly.instanceId)
      return exhaustEnemiesStep(next, ctx, aspects, pickAll(pickEnemy, sameArenaAs(next, friendly.instanceId)), friendly.instanceId)
    }
    const next = exhaustUnit(s, ctx.targetInstanceId!)
    return exhaustEnemiesStep(next, ctx, stepCount(ctx.step) - 1, pickAll(pickEnemy, sameArenaAs(next, ctx.unitChosen)), ctx.unitChosen)
  },
})
registerCard('JTL_230', unitThenWp('Deal 2 damage to a Droid or Vehicle unit and exhaust it.', (s, u) => unitHasTrait(s, u, 'Droid') || unitHasTrait(s, u, 'Vehicle'), // Electromagnetic Pulse
  'deal 2 damage to a Droid or Vehicle unit and exhaust it', false,
  (s, ctx) => {
    const hit = dealDamageToUnit(s, ctx.targetInstanceId!, 2)
    return findUnit(hit, ctx.targetInstanceId!) ? exhaustUnit(hit, ctx.targetInstanceId!) : hit
  }))
registerCard('SHD_227', unitThenWp('Exhaust a unit unless its controller pays 2.', pickAny, 'choose a unit to exhaust unless its controller pays 2', false, // Look the Other Way
  (s, ctx) => {
    const found = findUnit(s, ctx.targetInstanceId!)
    return found ? pushChoice(s, { kind: 'payOrExhaust', id: `${ctx.sourceInstanceId}-pay`, controller: found.owner, unitId: found.unit.instanceId, cost: 2 }) : s
  }))
registerCard('JTL_194', unitThenWp('Exhaust a unit and give it -2/-0 for this phase. Then, if it has 0 power and isn\'t a leader, you may return it to its owner\'s hand.', pickAny, 'exhaust a unit and give it -2/-0', false, // Heartless Tactics
  (s, ctx) => {
    const id = ctx.targetInstanceId!
    const next = addLastingEffect(exhaustUnit(s, id), { targetInstanceId: id, power: -2 })
    const u = findUnit(next, id)?.unit
    return u && effectivePower(next, u) === 0 && !isLeaderUnit(next, u) ? targetChoice(next, ctx, 'selectUnitToReturn', [id], true) : next
  }))
registerCard('LOF_223', whenPlayed('Exhaust an enemy unit. A friendly unit gains Sentinel for this phase.', (s, ctx) => // Force Illusion
  lastingBuffChoice(targetChoice(s, ctx, 'mayExhaustUnit', pickedIds(s, ctx, pickEnemy)), { ...ctx, sourceInstanceId: `${ctx.sourceInstanceId}-sentinel` },
    pickedIds(s, ctx, pickFriendly), { keywords: [KW.sentinel] })))
registerCard('JTL_178', { // Face Off
  ...whenPlayed('If no player has taken the initiative this phase, you may ready an enemy unit. If you do, ready a friendly unit in the same arena.', (s, ctx) =>
    (s.initiativeTakenBy === null ? unitThen(s, ctx, pickedIds(s, ctx, pickEnemy), 'ready an enemy unit', true) : s)),
  ifYouDo: (s, ctx) => {
    const enemy = findUnit(s, ctx.targetInstanceId!)?.unit
    if (!enemy || !enemy.exhausted) return s
    const next = readyUnit(s, enemy.instanceId)
    return targetChoice(next, ctx, 'selectUnitToReady', pickedIds(next, ctx, pickAll(pickFriendly, pickArena(enemy.arena))))
  },
})
registerCard('JTL_206', unitThenWp("Ready a Vehicle unit. It can't attack bases for this phase.", pickTrait('Vehicle'), 'ready a Vehicle unit', false, // Fly Casual
  (s, ctx) => addLastingEffect(readyUnit(s, ctx.targetInstanceId!), { targetInstanceId: ctx.targetInstanceId!, cannotAttackBases: true })))
registerCard('LAW_043', unitThenWp('Ready a unit and give a Shield token to it.', pickAny, 'ready a unit and give it a Shield token', false, // Shadow Cloaking
  (s, ctx) => giveToken(readyUnit(s, ctx.targetInstanceId!), ctx.targetInstanceId!, TOKEN_SHIELD)))
registerCard('SHD_182', { // Bravado
  // The phase record says an enemy unit was defeated, not by whom; it is read as defeated by you.
  costModifier: (s, playerId) => (defeatedThisPhase(s, opponentOf(playerId)).length > 0 ? -2 : 0),
  ...readyEvent("If you've defeated an enemy unit this phase, this event costs 2 less to play. Ready a unit.", () => true),
})

// Phase-long changes to units. A card that picks several units in turn carries the picks so far in its
// step (`picks:<id>,<id>`), so "another" and "share a Trait" can be checked against them.
const picksOf = (step: string | undefined): string[] => (step?.startsWith('picks:') ? step.slice('picks:'.length).split(',').filter(Boolean) : [])
const picksStep = (ids: string[]): string => `picks:${ids.join(',')}`

registerCard('SEC_091', unitThenWp('Give a friendly unit +3/+3 for this phase. Give each other friendly unit +1/+1 for this phase.', pickFriendly, 'give a friendly unit +3/+3', false, // Corporate Warmongering
  (s, ctx) => s.players[ctx.owner].units.reduce((acc, u) =>
    addLastingEffect(acc, u.instanceId === ctx.targetInstanceId ? { targetInstanceId: u.instanceId, power: 3, hp: 3 } : { targetInstanceId: u.instanceId, power: 1, hp: 1 }), s)))
const DELTA = [3, 2, 1]
registerCard('SOR_106', { // Attack Pattern Delta
  ...whenPlayed('Give a friendly unit +3/+3 for this phase. Give another friendly unit +2/+2 for this phase. Give a third friendly unit +1/+1 for this phase.', (s, ctx) =>
    unitThen(s, ctx, pickedIds(s, ctx, pickFriendly), 'give a friendly unit +3/+3', false, picksStep([]))),
  ifYouDo: (s, ctx) => {
    const before = picksOf(ctx.step)
    const amount = DELTA[before.length]
    const next = addLastingEffect(s, { targetInstanceId: ctx.targetInstanceId!, power: amount, hp: amount })
    const picks = [...before, ctx.targetInstanceId!]
    const more = DELTA[picks.length]
    return more ? unitThen(next, ctx, pickedIds(next, ctx, pickFriendly).filter(id => !picks.includes(id)), `give another friendly unit +${more}/+${more}`, false, picksStep(picks)) : next
  },
})
registerCard('JTL_253', whenPlayed('You may give a ground unit +2/+2 for this phase. You may give a space unit +2/+2 for this phase.', (s, ctx) => // Coordinated Front
  lastingBuffChoice(lastingBuffChoice(s, { ...ctx, sourceInstanceId: `${ctx.sourceInstanceId}-ground` }, pickedIds(s, ctx, pickGround), { power: 2, hp: 2 }, true),
    { ...ctx, sourceInstanceId: `${ctx.sourceInstanceId}-space` }, pickedIds(s, ctx, pickArena('space')), { power: 2, hp: 2 }, true)))
registerCard('JTL_042', unitThenWp('Give a unit +1/+0 for this phase for each damage on it.', pickAny, 'give a unit +1/+0 for each damage on it', false, // Power from Pain
  (s, ctx) => { const u = findUnit(s, ctx.targetInstanceId!)?.unit; return u ? addLastingEffect(s, { targetInstanceId: u.instanceId, power: u.damage }) : s }))
registerCard('TWI_153', { // Bold Resistance
  ...whenPlayed('Choose up to 3 units that share the same Trait. Each of those units gets +2/+0 for this phase.', (s, ctx) =>
    unitThen(s, ctx, pickedIds(s, ctx, (st, u) => unitTraits(st, u).length > 0), 'give a unit +2/+0', true, picksStep([]))),
  ifYouDo: (s, ctx) => {
    const picks = [...picksOf(ctx.step), ctx.targetInstanceId!]
    const next = addLastingEffect(s, { targetInstanceId: ctx.targetInstanceId!, power: 2 })
    if (picks.length >= 3) return next
    // A Trait every unit picked so far has, so every further pick must have one of them too.
    const lower = (u: UnitState | undefined) => (u ? unitTraits(next, u).map(t => t.toLowerCase()) : [])
    const shared = picks.map(id => lower(findUnit(next, id)?.unit)).reduce((acc, ts) => acc.filter(t => ts.includes(t)))
    const targets = pickedIds(next, ctx, (_st, u) => !picks.includes(u.instanceId) && lower(u).some(t => shared.includes(t)))
    return unitThen(next, ctx, targets, 'give another unit sharing that Trait +2/+0', true, picksStep(picks))
  },
})
registerCard('TWI_249', whenPlayed('Choose up to 1 Republic unit and up to 1 Separatist unit. Give each chosen unit +2/+2 and Saboteur for this phase.', (s, ctx) => { // Heroes on Both Sides
  const buff = { power: 2, hp: 2, keywords: [KW.saboteur] }
  return lastingBuffChoice(lastingBuffChoice(s, { ...ctx, sourceInstanceId: `${ctx.sourceInstanceId}-republic` }, pickedIds(s, ctx, pickTrait('Republic')), buff, true),
    { ...ctx, sourceInstanceId: `${ctx.sourceInstanceId}-separatist` }, pickedIds(s, ctx, pickTrait('Separatist')), buff, true)
}))
registerCard('JTL_106', whenPlayed('For each friendly unit with a different name, give each unit you control +1/+1 for this phase.', (s, ctx) => { // Unity of Purpose
  const units = s.players[ctx.owner].units
  const n = new Set(units.map(u => cardOf(s, u)?.name ?? u.cardId)).size
  return n > 0 ? units.reduce((acc, u) => addLastingEffect(acc, { targetInstanceId: u.instanceId, power: n, hp: n }), s) : s
}))
registerCard('TWI_055', { // Equalize
  ...whenPlayed('Give a unit -2/-2 for this phase. Then, if you control fewer units than that unit\'s controller, give another unit -2/-2 for this phase.', (s, ctx) =>
    unitThen(s, ctx, pickedIds(s, ctx, pickAny), 'give a unit -2/-2', false, 'first')),
  ifYouDo: (s, ctx) => {
    const found = findUnit(s, ctx.targetInstanceId!)
    if (!found) return s
    const next = addLastingEffect(s, { targetInstanceId: found.unit.instanceId, power: -2, hp: -2 })
    if (ctx.step !== 'first' || s.players[ctx.owner].units.length >= s.players[found.owner].units.length) return next
    return unitThen(next, ctx, pickedIds(next, ctx, pickAny).filter(id => id !== found.unit.instanceId), 'give another unit -2/-2', false, 'second')
  },
})
registerCard('LAW_041', unitThenWp('Choose a friendly unit and give it +2/+2 for this phase. Then, you may defeat a non-leader unit with power equal to or less than the chosen unit.', pickFriendly, 'give a friendly unit +2/+2', false, // Nothing Left to Fear
  (s, ctx) => {
    const next = addLastingEffect(s, { targetInstanceId: ctx.targetInstanceId!, power: 2, hp: 2 })
    const chosen = findUnit(next, ctx.targetInstanceId!)?.unit
    if (!chosen) return next
    const bar = effectivePower(next, chosen)
    return targetChoice(next, ctx, 'selectUnitToDefeat', pickedIds(next, ctx, pickAll(nonLeader, (st, u) => effectivePower(st, u) <= bar)), true)
  }))
registerCard('LOF_262', unitThenWp("Choose a unit. It can't be attacked this phase (unless it has Sentinel).", pickAny, "choose a unit that can't be attacked this phase", false, // Go Into Hiding
  (s, ctx) => addLastingEffect(s, { targetInstanceId: ctx.targetInstanceId!, cannotBeAttacked: true, unlessSentinel: true })))
registerCard('JTL_077', whenPlayed('Each unit gains Sentinel and loses Saboteur for this phase.', s => // In the Heat of Battle
  allUnits(s).reduce((acc, u) => addLastingEffect(acc, { targetInstanceId: u.instanceId, keywords: [KW.sentinel], removeKeywords: ['Saboteur'] }), s)))

// Defeats
registerCard('LAW_133', unitThenWp('Defeat a non-leader unit. If you do, heal 3 damage from your base.', nonLeader, 'defeat a non-leader unit', false, // Lost and Forgotten
  (s, ctx) => healBase(defeatUnit(s, ctx.targetInstanceId!), ctx.owner, 3)))
registerCard('TWI_140', unitThenWp('Defeat a friendly unit. If you do, deal 4 damage to a unit.', pickFriendly, 'defeat a friendly unit', false, // Self-Destruct
  (s, ctx) => { const next = defeatUnit(s, ctx.targetInstanceId!); return damageChoice(next, ctx, 4, allUnits(next)) }))
registerCard('SHD_108', unitThenWp('Defeat a friendly unit. If you do, draw 2 cards.', pickFriendly, 'defeat a friendly unit', false, // Enforced Loyalty
  (s, ctx) => drawCards(defeatUnit(s, ctx.targetInstanceId!), ctx.owner, 2)))
registerCard('TWI_041', unitThenWp('Defeat a non-leader unit. Deal damage to your base equal to that unit\'s power.', nonLeader, 'defeat a non-leader unit', false, // Lethal Crackdown
  (s, ctx) => {
    const u = findUnit(s, ctx.targetInstanceId!)?.unit
    // The power is read while the unit is still in play, with everything that modifies it.
    const power = u ? effectivePower(s, u) : 0
    return dealDamageToBase(defeatUnit(s, ctx.targetInstanceId!), ctx.owner, power)
  }))
registerCard('SOR_041', whenPlayed('An opponent chooses a unit they control. Defeat that unit.', (s, ctx) => { // Power of the Dark Side
  const opp = opponentOf(ctx.owner)
  return targetChoice(s, { ...ctx, owner: opp }, 'selectUnitToDefeat', s.players[opp].units.map(u => u.instanceId))
}))
registerCard('TWI_238', { // Merciless Contest
  ...whenPlayed('Each player chooses a non-leader unit they control. Defeat those units.', (s, ctx) => {
    const mine = pickedIds(s, ctx, pickAll(pickFriendly, nonLeader))
    return mine.length ? unitThen(s, ctx, mine, 'choose a non-leader unit you control to defeat', false, 'mine') : mercilessTheirs(s, ctx, undefined)
  }),
  // The caster's pick waits for the opponent's, and both units are defeated together.
  ifYouDo: (s, ctx) => (ctx.step === 'mine'
    ? mercilessTheirs(s, ctx, ctx.targetInstanceId)
    : defeatUnits(s, [ctx.unitChosen, ctx.targetInstanceId].filter((id): id is string => id !== undefined))),
})
function mercilessTheirs(s: GameState, ctx: Resumable, mine: string | undefined): GameState {
  const opp = opponentOf(ctx.owner)
  const theirs = pickedIds(s, ctx, pickAll(pickEnemy, nonLeader))
  if (theirs.length === 0) return mine ? defeatUnit(s, mine) : s
  return pushChoice(s, { kind: 'selectUnitThen', id: `${ctx.sourceInstanceId}-theirs`, controller: opp, targets: theirs, text: 'choose a non-leader unit you control to defeat', then: resume(ctx, 'theirs', mine) })
}
registerCard('LAW_103', unitThenWp("Defeat an enemy non-leader unit. Its controller resources it from its owner's discard pile.", pickAll(pickEnemy, nonLeader), 'defeat an enemy non-leader unit', false, // Display Piece
  (s, ctx) => {
    const found = findUnit(s, ctx.targetInstanceId!)
    if (!found) return s
    const cardOwner = found.unit.owner ?? found.owner
    const next = defeatUnit(s, found.unit.instanceId)
    const discard = next.players[cardOwner].discard
    const at = discard.lastIndexOf(found.unit.cardId)
    if (at === -1) return next // a token leaves no card behind
    // Resourced exhausted, as every resource an ability puts into play is.
    const moved = updatePlayer(next, cardOwner, { discard: discard.filter((_, i) => i !== at) })
    return updatePlayer(moved, found.owner, { resources: [...moved.players[found.owner].resources, { cardId: found.unit.cardId, exhausted: true }] })
  }))
registerCard('JTL_043', unitThenWp('Take control of a non-leader unit, then defeat it.', nonLeader, 'take control of a non-leader unit, then defeat it', false, // No Glory, Only Results
  (s, ctx) => {
    const found = findUnit(s, ctx.targetInstanceId!)
    return found ? defeatUnit(takeControlOfUnit(s, found.owner, ctx.owner, found.unit.instanceId, 'permanent'), found.unit.instanceId) : s
  }))
registerCard('JTL_175', { // System Shock
  ...whenPlayed('Defeat a non-leader upgrade attached to a unit. If you do, deal 1 damage to that unit.', (s, ctx) => {
    const candidates = upgradeCandidates(s, { on: 'unit' }).filter(c => s.cards[c.cardId]?.type !== 'leader')
    return candidates.length ? pushChoice(s, { kind: 'selectUpgradeThen', id: ctx.sourceInstanceId!, controller: ctx.owner, candidates, text: 'defeat a non-leader upgrade', then: resume(ctx) }) : s
  }),
  ifYouDo: (s, ctx) => {
    const up = ctx.upgradeChosen
    return up ? dealDamageToUnit(defeatUpgradeAt(s, up.unitId, up.upgradeIndex), up.unitId, 1) : s
  },
})
registerCard('SOR_170', { // Power Failure
  ...whenPlayed('Defeat any number of upgrades on a unit.', (s, ctx) =>
    unitThen(s, ctx, pickedIds(s, ctx, (_st, u) => u.upgrades.length > 0), 'choose a unit to defeat upgrades on', false, 'unit')),
  // The same unit-then-upgrades loop as Kit Fisto's Aethersprite, only the unit is not optional.
  ifYouDo: (s, ctx) => getCardDefinition('LOF_147')!.ifYouDo!(s, ctx),
})
registerCard('JTL_180', unitThenWp('Defeat all Shield tokens on a unit. Deal 3 damage to that unit.', pickAny, 'defeat the Shields on a unit and deal 3 damage to it', false, // Piercing Shot
  (s, ctx) => {
    const id = ctx.targetInstanceId!
    const shields = (findUnit(s, id)?.unit.upgrades ?? []).flatMap((up, i) => (up.cardId === TOKEN_SHIELD ? [i] : [])).reverse()
    return dealDamageToUnit(shields.reduce((acc, i) => defeatUpgradeAt(acc, id, i), s), id, 3)
  }))

// Damage with a tail. "Another unit in the same arena" reads the arena before the first damage lands.
const otherInArena = (s: GameState, id: string): UnitState[] => {
  const arena = findUnit(s, id)?.unit.arena
  return allUnits(s).filter(u => u.instanceId !== id && u.arena === arena)
}
registerCard('SOR_139', { // Force Choke
  costModifier: (s, playerId) => (s.players[playerId].units.some(u => unitHasTrait(s, u, 'Force')) ? -1 : 0),
  ...unitThenWp("If you control a FORCE unit, this event costs 1 less to play. Deal 5 damage to a non-VEHICLE unit. That unit's controller draws a card.", (s, u) => !unitHasTrait(s, u, 'Vehicle'),
    'deal 5 damage to a non-Vehicle unit', false,
    (s, ctx) => { const found = findUnit(s, ctx.targetInstanceId!); return found ? drawCards(dealDamageToUnit(s, found.unit.instanceId, 5), found.owner, 1) : s }),
})
registerCard('JTL_176', unitThenWp('Deal 3 damage to a space unit. If that unit is defeated this way, you may deal 2 damage to a base.', pickArena('space'), 'deal 3 damage to a space unit', false, // Shoot Down
  (s, ctx) => {
    const next = dealDamageToUnit(s, ctx.targetInstanceId!, 3)
    // A prevention offer still pending means the damage has not landed yet, so nothing was defeated.
    const pending = (next.pendingChoices?.length ?? 0) > (s.pendingChoices?.length ?? 0)
    return !pending && !findUnit(next, ctx.targetInstanceId!) ? damageChoice(next, ctx, 2, [], BOTH_BASES, true) : next
  }))
registerCard('LAW_208', unitThenWp('Deal 2 damage to a unit. Then, deal 2 damage to a base or another unit in the same arena.', pickAny, 'deal 2 damage to a unit', false, // Collateral Damage
  (s, ctx) => { const others = otherInArena(s, ctx.targetInstanceId!); const next = dealDamageToUnit(s, ctx.targetInstanceId!, 2); return damageChoice(next, ctx, 2, others.filter(u => findUnit(next, u.instanceId)), BOTH_BASES) }))
registerCard('SEC_180', unitThenWp("Deal 3 damage to a unit. Then, if you have the initiative, you may deal 2 damage to another unit in the same arena.", pickAny, 'deal 3 damage to a unit', false, // Let's Call It War
  (s, ctx) => {
    const others = otherInArena(s, ctx.targetInstanceId!)
    const next = dealDamageToUnit(s, ctx.targetInstanceId!, 3)
    return next.initiative === ctx.owner ? damageChoice(next, ctx, 2, others.filter(u => findUnit(next, u.instanceId)), [], true) : next
  }))
registerCard('TWI_171', unitThenWp('Deal 2 damage to a unit. You may deal 1 damage to another unit in the same arena.', pickAny, 'deal 2 damage to a unit', false, // Grenade Strike
  (s, ctx) => { const others = otherInArena(s, ctx.targetInstanceId!); const next = dealDamageToUnit(s, ctx.targetInstanceId!, 2); return damageChoice(next, ctx, 1, others.filter(u => findUnit(next, u.instanceId)), [], true) }))

// Change of control, through `takeControlOfUnit` and its duration.
const stealTo = (s: GameState, to: PlayerId, id: string | undefined, until?: UnitState['controlUntil']): GameState => {
  const found = findUnit(s, id ?? '')
  return found ? takeControlOfUnit(s, found.owner, to, found.unit.instanceId, until) : s
}
registerCard('SOR_224', unitThenWp('Take control of a non-leader unit. At the start of the regroup phase, its owner takes control of it.', nonLeader, 'take control of a non-leader unit', false, // Change of Heart
  (s, ctx) => stealTo(s, ctx.owner, ctx.targetInstanceId)))
/** A friendly and then an enemy unit (`test` narrows both), then `swap` with the pair. */
const swapPairWp = (description: string, test: Pick, until: UnitState['controlUntil']): CardDefinition => ({
  ...whenPlayed(description, (s, ctx) =>
    (pickedIds(s, ctx, pickAll(pickEnemy, test)).length
      ? unitThen(s, ctx, pickedIds(s, ctx, pickAll(pickFriendly, test)), 'choose a friendly unit to exchange', false, 'friendly')
      : s)),
  ifYouDo: (s, ctx) => (ctx.step === 'friendly'
    ? unitThen(s, ctx, pickedIds(s, ctx, pickAll(pickEnemy, test)), 'choose an enemy unit to exchange', false, 'enemy', ctx.targetInstanceId)
    : stealTo(stealTo(s, opponentOf(ctx.owner), ctx.unitChosen, until), ctx.owner, ctx.targetInstanceId, until)),
})
registerCard('SHD_132', swapPairWp('Choose a friendly non-leader unit and an enemy non-leader unit. Exchange control of those units.', nonLeader, 'permanent')) // Choose Sides
// "Takes control of each unit they own" at the regroup phase is the default duration.
registerCard('TWI_204', swapPairWp('Choose a ready non-leader unit controlled by each player. If you do, each player takes control of the chosen unit controlled by the player to their right. At the start of the regroup phase, each player takes control of each unit they own that was chosen for this ability.', // Impropriety Among Thieves
  pickAll(nonLeader, (_s, u) => !u.exhausted), undefined))
// Returns to hand
registerCard('TWI_199', unitThenWp("Choose a non-leader unit that costs 3 or less. Return it and each enemy non-leader unit with the same name as it to their owners' hands.", // Clear the Field
  pickAll(nonLeader, (s, u) => printedCost(s, u) <= 3), 'choose a non-leader unit that costs 3 or less', false,
  (s, ctx) => {
    const chosen = findUnit(s, ctx.targetInstanceId!)?.unit
    if (!chosen) return s
    const name = cardOf(s, chosen)?.name
    const same = picked(s, ctx, pickAll(pickEnemy, nonLeader, (st, u) => u.instanceId !== chosen.instanceId && cardOf(st, u)?.name === name))
    return [chosen, ...same].reduce((acc, u) => returnUnitToHand(acc, u.instanceId), s)
  }))
registerCard('JTL_233', { // Sweep the Area
  ...whenPlayed("Return up to 2 non-leader units in the same arena with a combined cost 3 or less to their owners' hands.", (s, ctx) =>
    unitThen(s, ctx, pickedIds(s, ctx, pickAll(nonLeader, (st, u) => printedCost(st, u) <= 3)), "return a non-leader unit that costs 3 or less to its owner's hand", true, 'first')),
  // The first unit waits for the second pick, or for its decline, so both go back together.
  ifYouDo: (s, ctx) => {
    if (ctx.step === 'second') return [ctx.unitChosen, ctx.targetInstanceId].reduce((acc, id) => (id && findUnit(acc, id) ? returnUnitToHand(acc, id) : acc), s)
    const first = findUnit(s, ctx.targetInstanceId!)?.unit
    if (!first) return s
    const left = 3 - printedCost(s, first)
    const targets = pickedIds(s, ctx, pickAll(nonLeader, pickArena(first.arena), (st, u) => u.instanceId !== first.instanceId && printedCost(st, u) <= left))
    return targets.length
      ? pushChoice(s, { kind: 'selectUnitThen', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, optional: true, hookOnDecline: true, text: "return another unit in that arena to its owner's hand", then: resume(ctx, 'second', first.instanceId) })
      : returnUnitToHand(s, first.instanceId)
  },
})
registerCard('SHD_207', unitThenWp("Return a non-leader unit that costs 6 or less to its owner's hand. Then, its owner may play it for free.", // A New Adventure
  pickAll(nonLeader, (s, u) => printedCost(s, u) <= 6), "return a non-leader unit that costs 6 or less to its owner's hand", false,
  (s, ctx) => returnThenOwnerMayPlayFree(s, ctx, false)))
registerCard('SHD_229', unitThenWp("Return a friendly non-leader Underworld unit to its owner's hand. If you do, deal 3 damage to a unit.", pickAll(pickFriendly, nonLeader, pickTrait('Underworld')), // Ma Klounkee
  'return a friendly Underworld unit to hand', false,
  (s, ctx) => { const next = returnUnitToHand(s, ctx.targetInstanceId!); return damageChoice(next, ctx, 3, allUnits(next)) }))

// This phase's record
registerCard('SEC_144', whenPlayed("If you've dealt damage to an enemy base this phase, deal 2 damage to each enemy space unit.", (s, ctx) => { // Tempest Assault
  // The phase record says the base took damage, not who dealt it; it is read as dealt by you.
  const opp = opponentOf(ctx.owner)
  return baseDamagedThisPhase(s, opp) ? s.players[opp].units.filter(u => u.arena === 'space').reduce((acc, u) => dealDamageToUnit(acc, u.instanceId, 2), s) : s
}))
registerCard('SOR_091', whenPlayed('Return each unit in your discard pile that was defeated this phase to your hand.', (s, ctx) => // The Emperor's Legion
  defeatedThisPhase(s, ctx.owner).reduce((acc, cardId) => {
    const p = acc.players[ctx.owner]
    const at = p.discard.lastIndexOf(cardId)
    return at === -1 || acc.cards[cardId]?.type !== 'unit' ? acc : updatePlayer(acc, ctx.owner, { discard: p.discard.filter((_, i) => i !== at), hand: [...p.hand, cardId] })
  }, s)))
registerCard('TWI_188', whenPlayed('Look at cards from the top of your deck equal to the number of units that were defeated this phase. Draw 1 and put the others on the bottom of your deck in a random order.', (s, ctx) => { // Wartime Profiteering
  const n = defeatedThisPhase(s, ctx.owner).length + defeatedThisPhase(s, opponentOf(ctx.owner)).length
  const revealed = s.players[ctx.owner].deck.slice(0, n)
  return revealed.length ? pushChoice(s, { kind: 'searchDraw', id: ctx.sourceInstanceId!, controller: ctx.owner, revealed, eligibleIndices: revealed.map((_, i) => i) }) : s
}))

// Playing a unit from hand. "Play a unit" is not a "may": it is offered whenever one is affordable.
type PlayFromHandOptions = {
  costDelta?: number
  test?: (c: EngineCard | undefined) => boolean
  /** Tokens the unit just played receives, attached together as one grant. */
  thenTokens?: string[]
  thenDamageOwnBase?: boolean
  thenDamageIt?: number
  /** "It gains <keywords> for this phase": granted to the next unit played, so an Ambush or Hidden takes effect as it enters. */
  gains?: KeywordInstance[]
}
const FREE = -99
const playableFromHand = (s: GameState, owner: PlayerId, o: PlayFromHandOptions, extraResourceCost = 0) =>
  affordableHandUnits(s, owner, extraResourceCost, o.costDelta ?? 0).filter(ref => !o.test || o.test(s.cards[ref.cardId]))
const playFromHand = (s: GameState, ctx: EventCtx, o: PlayFromHandOptions): GameState => {
  const costDelta = o.costDelta ?? 0
  const candidates = playableFromHand(s, ctx.owner, o)
  if (!candidates.length) return s
  const granted = o.gains ? grantNextUnit(s, ctx.owner, { keywords: o.gains }) : s
  return pushChoice(granted, {
    kind: 'playUnitFromHand', id: ctx.sourceInstanceId!, controller: ctx.owner, candidates, costDelta, entersReady: false,
    ...(o.thenTokens ? { thenTokens: o.thenTokens } : {}), ...(o.thenDamageOwnBase ? { thenDamageOwnBase: true } : {}),
    ...(o.thenDamageIt ? { thenDamageIt: o.thenDamageIt } : {}),
  })
}
registerCard('LOF_076', whenPlayed('Play a Force unit from your hand (paying its cost) and give a Shield token to it.', (s, ctx) => // Soresu Stance
  playFromHand(s, ctx, { test: c => printedTrait(c, 'Force'), thenTokens: [TOKEN_SHIELD] })))
registerCard('SEC_257', whenPlayed('Play a unit from your hand. It costs 1 less for each Heroism aspect icon among friendly units.', (s, ctx) => { // Restore Freedom
  const icons = s.players[ctx.owner].units.flatMap(u => cardOf(s, u)?.aspects ?? []).filter(a => a.toLowerCase() === 'heroism').length
  return playFromHand(s, ctx, { costDelta: -icons })
}))
registerCard('SOR_235', whenPlayed('Play a non-Heroism unit from your hand for free. Deal damage to your base equal to its cost.', (s, ctx) => // Galactic Ambition
  playFromHand(s, ctx, { costDelta: FREE, test: c => !printedAspect(c, 'Heroism'), thenDamageOwnBase: true })))
registerCard('TWI_225', whenPlayed('If you control exactly one unit, play a non-Vehicle unit from your hand that shares a Trait with the unit you control. It costs 5 less.', (s, ctx) => { // Now There Are Two of Them
  const units = s.players[ctx.owner].units
  if (units.length !== 1) return s
  const traits = unitTraits(s, units[0]).map(t => t.toLowerCase())
  return playFromHand(s, ctx, { costDelta: -5, test: c => !printedTrait(c, 'Vehicle') && (c?.traits ?? []).some(t => traits.includes(t.toLowerCase())) })
}))

// Resourcing. The event is already in its owner's discard pile as its When Played resolves.
const resourceThisEvent = (s: GameState, ctx: { owner: PlayerId; cardId: string }): GameState => {
  const p = s.players[ctx.owner]
  const at = p.discard.lastIndexOf(ctx.cardId)
  if (at === -1) return s
  // Exhausted, as every resource an ability puts into play is.
  return updatePlayer(s, ctx.owner, { discard: p.discard.filter((_, i) => i !== at), resources: [...p.resources, { cardId: ctx.cardId, exhausted: true }] })
}
const resupply = whenPlayed('Put this event into play as a resource.', (s, ctx) => resourceThisEvent(s, ctx))
registerCard('TWI_127', resupply) // Resupply
registerCard('SOR_126', resupply) // Resupply
registerCard('LAW_171', whenPlayed('Resource this event and the top card of your deck.', (s, ctx) => // Stockpile
  resourceTopOfDeck(resourceThisEvent(s, ctx), ctx.owner)))

// Decks, draws and discard piles
/** Choose a card from your own hand for the card's hook (`step`), or nothing with an empty hand. */
const handCardThen = (s: GameState, ctx: Resumable, text: string, step: string, test?: (c: EngineCard | undefined) => boolean): GameState => {
  const hand = s.players[ctx.owner].hand
  const handIndices = hand.flatMap((id, i) => (!test || test(s.cards[id]) ? [i] : []))
  return handIndices.length ? pushChoice(s, { kind: 'selectHandCardThen', id: ctx.sourceInstanceId!, controller: ctx.owner, handIndices, text, then: resume(ctx, step) }) : s
}
/** Move the hand card at `handIndex` to the top or the bottom of its owner's deck. */
const handToDeck = (s: GameState, owner: PlayerId, handIndex: number | undefined, where: 'top' | 'bottom'): GameState => {
  const p = s.players[owner]
  const cardId = handIndex === undefined ? undefined : p.hand[handIndex]
  if (cardId === undefined) return s
  const hand = p.hand.filter((_, i) => i !== handIndex)
  return updatePlayer(s, owner, { hand, deck: where === 'top' ? [cardId, ...p.deck] : [...p.deck, cardId] })
}
registerCard('SEC_232', { // Kreia's Whispers
  ...whenPlayed('Draw 3 cards, then put a card from your hand on the top of your deck and another card from your hand on the bottom of your deck.', (s, ctx) =>
    handCardThen(drawCards(s, ctx.owner, 3), ctx, 'put a card from your hand on top of your deck', 'top')),
  ifYouDo: (s, ctx) => (ctx.step === 'top'
    ? handCardThen(handToDeck(s, ctx.owner, ctx.handIndex, 'top'), ctx, 'put another card from your hand on the bottom of your deck', 'bottom')
    : handToDeck(s, ctx.owner, ctx.handIndex, 'bottom')),
})
registerCard('TWI_257', { // Private Manufacturing
  ...whenPlayed('Draw 2 cards. If you control no token units, put 2 cards from your hand on the bottom of your deck in any order.', (s, ctx) => {
    const drawn = drawCards(s, ctx.owner, 2)
    // Picked one at a time, so the order they are picked is the order they go under the deck.
    return drawn.players[ctx.owner].units.some(u => isTokenCard(u.cardId)) ? drawn : handCardThen(drawn, ctx, 'put a card from your hand on the bottom of your deck', 'first')
  }),
  ifYouDo: (s, ctx) => {
    const next = handToDeck(s, ctx.owner, ctx.handIndex, 'bottom')
    return ctx.step === 'first' ? handCardThen(next, ctx, 'put another card from your hand on the bottom of your deck', 'second') : next
  },
})
/** Discard the top `n` cards of `who`'s deck; returns the state and the cards discarded. */
const millTop = (s: GameState, who: PlayerId, n: number): [GameState, string[]] => {
  const p = s.players[who]
  const milled = p.deck.slice(0, n)
  return [updatePlayer(s, who, { deck: p.deck.slice(milled.length), discard: [...p.discard, ...milled] }), milled]
}
registerCard('LAW_203', whenPlayed('Discard 2 cards from your deck. You may return an Aggression card discarded this way to your hand.', (s, ctx) => { // Daring Delve
  const [next, milled] = millTop(s, ctx.owner, 2)
  const candidates = milled.filter(id => printedAspect(next.cards[id], 'Aggression'))
  return candidates.length ? pushChoice(next, { kind: 'selectFromDiscard', id: ctx.sourceInstanceId!, controller: ctx.owner, candidates, optional: true }) : next
}))
registerCard('JTL_208', whenPlayed("Discard 3 cards from an opponent's deck and 3 cards from your deck. Deal damage to a unit equal to the number of cards with an odd cost discarded this way.", (s, ctx) => { // Never Tell Me the Odds
  const [theirs, fromThem] = millTop(s, opponentOf(ctx.owner), 3)
  const [next, fromMe] = millTop(theirs, ctx.owner, 3)
  const odd = [...fromThem, ...fromMe].filter(id => (next.cards[id]?.cost ?? 0) % 2 === 1).length
  return odd > 0 ? damageChoice(next, ctx, odd, allUnits(next)) : next
}))
registerCard('LOF_240', whenPlayed('You may return a Force unit and a Lightsaber upgrade from your discard pile to your hand.', (s, ctx) => { // Flight of the Inquisitor
  const discard = s.players[ctx.owner].discard
  const offer = (st: GameState, id: string, test: (c: EngineCard | undefined) => boolean): GameState => {
    const candidates = [...new Set(discard.filter(cardId => test(st.cards[cardId])))]
    return candidates.length ? pushChoice(st, { kind: 'selectFromDiscard', id, controller: ctx.owner, candidates, optional: true }) : st
  }
  return offer(offer(s, `${ctx.sourceInstanceId}-unit`, c => printedUnit(c) && printedTrait(c, 'Force')), `${ctx.sourceInstanceId}-saber`,
    c => c?.type === 'upgrade' && printedTrait(c, 'Lightsaber'))
}))
registerCard('SOR_042', whenPlayed('Search your deck for a card and draw it. (Then, shuffle your deck.)', (s, ctx) => { // Search Your Feelings
  const revealed = s.players[ctx.owner].deck
  return revealed.length ? pushChoice(s, { kind: 'searchDraw', id: ctx.sourceInstanceId!, controller: ctx.owner, revealed, eligibleIndices: revealed.map((_, i) => i), shuffle: true }) : s
}))

// Yes-or-no answers, each player's pick, and several picks at once
registerCard('LAW_207', { // Attack From All Sides
  ...whenPlayed('Deal 3 damage to a unit. If there are 4 or more different aspects among friendly units, you may deal 5 damage to that unit instead.', (s, ctx) =>
    unitThen(s, ctx, pickedIds(s, ctx, pickAny), 'choose a unit to damage', false, 'target')),
  ifYouDo: (s, ctx) => {
    if (ctx.step === 'five' || ctx.step === 'three') return dealDamageToUnit(s, ctx.unitChosen!, ctx.step === 'five' ? 5 : 3)
    const aspects = new Set(s.players[ctx.owner].units.flatMap(u => (cardOf(s, u)?.aspects ?? []).map(a => a.toLowerCase()))).size
    if (aspects < 4) return dealDamageToUnit(s, ctx.targetInstanceId!, 3)
    return pushChoice(s, { kind: 'mayPayThen', id: ctx.sourceInstanceId!, controller: ctx.owner, cost: 0, text: 'deal 5 damage instead of 3', then: resume(ctx, 'five', ctx.targetInstanceId), declineStep: 'three' })
  },
})
registerCard('SOR_233', { // I Am Your Father
  ...whenPlayed('Deal 7 Damage to an enemy unit unless its controller says "no." If they do, draw 3 cards.', (s, ctx) =>
    unitThen(s, ctx, pickedIds(s, ctx, pickEnemy), 'choose an enemy unit', false, 'target')),
  // The controller answers: accepting is saying "no" (the caster draws 3), declining takes the 7 damage.
  ifYouDo: (s, ctx) => {
    if (ctx.step === 'no') return drawCards(s, ctx.owner, 3)
    if (ctx.step === 'yes') return dealDamageToUnit(s, ctx.unitChosen!, 7)
    const found = findUnit(s, ctx.targetInstanceId!)
    return found
      ? pushChoice(s, { kind: 'mayPayThen', id: `${ctx.sourceInstanceId}-answer`, controller: found.owner, cost: 0, text: 'say "no" and let your opponent draw 3 cards instead of taking 7 damage', then: resume(ctx, 'no', found.unit.instanceId), declineStep: 'yes' })
      : s
  },
})
registerCard('LOF_177', { // Time of Crisis
  ...whenPlayed('Each player chooses a unit they control. Deal 3 damage to each unit not chosen this way.', (s, ctx) => {
    const mine = pickedIds(s, ctx, pickFriendly)
    return mine.length ? unitThen(s, ctx, mine, 'choose a unit you control to spare', false, 'mine') : timeOfCrisisTheirs(s, ctx, undefined)
  }),
  ifYouDo: (s, ctx) => (ctx.step === 'mine'
    ? timeOfCrisisTheirs(s, ctx, ctx.targetInstanceId)
    : timeOfCrisisDamage(s, [ctx.unitChosen, ctx.targetInstanceId])),
})
function timeOfCrisisTheirs(s: GameState, ctx: Resumable, mine: string | undefined): GameState {
  const theirs = pickedIds(s, ctx, pickEnemy)
  if (theirs.length === 0) return timeOfCrisisDamage(s, [mine])
  return pushChoice(s, { kind: 'selectUnitThen', id: `${ctx.sourceInstanceId}-theirs`, controller: opponentOf(ctx.owner), targets: theirs, text: 'choose a unit you control to spare', then: resume(ctx, 'theirs', mine) })
}
function timeOfCrisisDamage(s: GameState, spared: (string | undefined)[]): GameState {
  return allUnits(s).filter(u => !spared.includes(u.instanceId)).reduce((acc, u) => dealDamageToUnit(acc, u.instanceId, 3), s)
}
const UNLIMITED = [4, 3, 2, 1]
registerCard('TWI_156', { // Unlimited Power
  ...whenPlayed('Deal 4 damage to a unit, 3 damage to a second unit, 2 damage to a third unit, and 1 damage to a fourth unit. (All damage is dealt simultaneously.)', (s, ctx) =>
    unitThen(s, ctx, pickedIds(s, ctx, pickAny), 'choose a unit to deal 4 damage to', false, picksStep([]))),
  // Every pick is made before any damage is dealt, so a unit defeated by it cannot change a later pick.
  ifYouDo: (s, ctx) => {
    const picks = [...picksOf(ctx.step), ctx.targetInstanceId!]
    const left = pickedIds(s, ctx, pickAny).filter(id => !picks.includes(id))
    if (picks.length < UNLIMITED.length && left.length) return unitThen(s, ctx, left, `choose a unit to deal ${UNLIMITED[picks.length]} damage to`, false, picksStep(picks))
    return picks.reduce((acc, id, i) => (findUnit(acc, id) ? dealDamageToUnit(acc, id, UNLIMITED[i]) : acc), s)
  },
})
registerCard('SHD_054', whenPlayed('Heal up to 8 total damage from any number of units.', (s, ctx) => { // Midnight Repairs
  const unitTargets = allUnits(s).filter(u => u.damage > 0).map(u => u.instanceId)
  return unitTargets.length ? pushChoice(s, { kind: 'distributeHealing', id: ctx.sourceInstanceId!, controller: ctx.owner, remaining: 8, healed: 0, unitTargets, baseTargets: [] }) : s
}))
registerCard('LOF_176', { // Lightsaber Throw
  ...whenPlayed('Discard a Lightsaber card from your hand. If you do, deal 4 damage to a ground unit and draw a card.', (s, ctx) => {
    const handIndices = s.players[ctx.owner].hand.flatMap((id, i) => (printedTrait(s.cards[id], 'Lightsaber') ? [i] : []))
    return handIndices.length ? pushChoice(s, { kind: 'selectHandCardThen', id: ctx.sourceInstanceId!, controller: ctx.owner, handIndices, text: 'discard a Lightsaber card', then: resume(ctx) }) : s
  }),
  ifYouDo: (s, ctx) => {
    const next = drawCards(discardFromHand(s, ctx.owner, ctx.handIndex!), ctx.owner, 1)
    return damageChoice(next, ctx, 4, picked(next, ctx, pickGround))
  },
})

// Lasting prohibitions and delayed effects
registerCard('LAW_130', unitThenWp("Choose an enemy unit. For this phase, that unit can't deal combat damage.", pickEnemy, "choose an enemy unit that can't deal combat damage this phase", false, // Betrayed Trust
  (s, ctx) => addLastingEffect(s, { targetInstanceId: ctx.targetInstanceId!, noCombatDamage: true })))
registerCard('SOR_186', unitThenWp("Exhaust a unit. That unit can't ready this round (including during the regroup phase).", pickAny, "exhaust a unit that can't ready this round", false, // No Good to Me Dead
  (s, ctx) => addLastingEffect(exhaustUnit(s, ctx.targetInstanceId!), { targetInstanceId: ctx.targetInstanceId!, cannotReady: true, untilRoundEnd: true })))
registerCard('JTL_074', { // Close the Shield Gate
  ...whenPlayed('Choose a base. The next time damage would be dealt to it this phase, prevent that damage.', (s, ctx) => choosePlayer(s, ctx, 'shield the base of')),
  ifYouDo: (s, ctx) => (s.shieldedBases?.includes(ctx.playerChosen!) ? s : { ...s, shieldedBases: [...(s.shieldedBases ?? []), ctx.playerChosen!] }),
})
registerCard('TWI_072', unitThenWp('Choose a friendly unit. Each enemy unit gets -4/-0 while attacking that unit this phase.', pickFriendly, 'choose a friendly unit', false, // I Have the High Ground
  (s, ctx) => addLastingEffect(s, { targetInstanceId: ctx.targetInstanceId!, attackersPower: -4 })))
registerCard('LAW_243', whenPlayed("Name a card. Cards with that name can't be played this phase.", (s, ctx) => // Transmission Jamming
  pushChoice(s, { kind: 'nameCard', id: ctx.sourceInstanceId!, controller: ctx.owner, unitId: ctx.sourceInstanceId!, phaseBan: true })))
registerCard('SOR_219', { // Sneak Attack
  ...whenPlayed('Play a unit from your hand. It costs 3 less and enters play ready. At the start of the regroup phase, defeat it.', (s, ctx) => {
    const candidates = affordableHandUnits(s, ctx.owner, 0, -3)
    return candidates.length
      ? pushChoice(s, { kind: 'playUnitFromHand', id: ctx.sourceInstanceId!, controller: ctx.owner, candidates, costDelta: -3, entersReady: true, thenDelay: { cardId: 'SOR_219', when: 'regroupStart' } })
      : s
  }),
  delayed: (s, e) => (e.unitId && findUnit(s, e.unitId) ? defeatUnit(s, e.unitId) : s),
})
registerCard('LOF_203', { // Premonition of Doom
  ...whenPlayed('The next time you take the initiative this phase, exhaust all units.', (s, ctx) =>
    addDelayedEffect(s, { cardId: 'LOF_203', owner: ctx.owner, when: 'takeInitiative' })),
  delayed: s => allUnits(s).reduce((acc, u) => exhaustUnit(acc, u.instanceId), s),
})
registerCard('SEC_073', { // The Eye of Aldhani
  ...whenPlayed('At the start of the next action phase, for each enemy unit, its controller must pay 1 or exhaust that unit.', (s, ctx) =>
    addDelayedEffect(s, { cardId: 'SEC_073', owner: ctx.owner, when: 'actionPhaseStart' })),
  delayed: (s, e) => {
    const opp = opponentOf(e.owner)
    return s.players[opp].units.reduce((acc, u) =>
      pushChoice(acc, { kind: 'payOrExhaust', id: `eye-${u.instanceId}`, controller: opp, unitId: u.instanceId, cost: 1, resumeAtInitiative: true }), s)
  },
})
registerCard('SHD_208', { // Final Showdown
  ...whenPlayed('Ready each unit you control. At the start of the regroup phase, you lose the game.', (s, ctx) =>
    addDelayedEffect(s.players[ctx.owner].units.reduce((acc, u) => readyUnit(acc, u.instanceId), s), { cardId: 'SHD_208', owner: ctx.owner, when: 'regroupStart' })),
  delayed: (s, e) => (s.winner === null ? { ...s, winner: opponentOf(e.owner) } : s),
})

// Picking cards out of a discard pile or off the top of a deck, with `selectCardThen`. A card that picks
// several carries the picks so far in its step, and finishes when the picks stop.
const cardThen = (s: GameState, ctx: Resumable, candidates: string[], text: string, optional: boolean, step: string): GameState =>
  pushChoice(s, { kind: 'selectCardThen', id: ctx.sourceInstanceId!, controller: ctx.owner, candidates, text, then: resume(ctx, step), ...(optional ? { optional: true, hookOnDecline: true } : {}) })
/** `list` less one occurrence of each id in `remove`. */
const withoutEach = (list: string[], remove: string[]): string[] => {
  const out = [...list]
  for (const id of remove) { const at = out.indexOf(id); if (at !== -1) out.splice(at, 1) }
  return out
}
/** `owner`'s discard pile without the event now resolving, which is already in it. */
const discardBesides = (s: GameState, owner: PlayerId, ctx: { owner: PlayerId; cardId: string }): string[] => {
  const pile = s.players[owner].discard
  const at = owner === ctx.owner ? pile.lastIndexOf(ctx.cardId) : -1
  return at === -1 ? pile : pile.filter((_, i) => i !== at)
}
/** Move one occurrence of each of `ids` from `owner`'s discard pile to the bottom of their deck, in a random order. */
const discardToDeckBottom = (s: GameState, owner: PlayerId, ids: string[]): GameState => {
  if (ids.length === 0) return s
  const p = s.players[owner]
  return { ...updatePlayer(s, owner, { discard: withoutEach(p.discard, ids), deck: [...p.deck, ...seededShuffle(ids, s.rngSeed)] }), rngSeed: nextSeed(s.rngSeed) }
}
const splitStep = (step: string | undefined, prefix: string): string[] => (step ?? '').slice(prefix.length).split(',').filter(Boolean)

registerCard('LOF_219', { // Psychometry
  ...whenPlayed('Choose another card in your discard pile. Search the top 5 cards of your deck for a card that shares a Trait with the chosen card, reveal it, and draw it.', (s, ctx) => {
    const pile = discardBesides(s, ctx.owner, ctx)
    return pile.length ? cardThen(s, ctx, pile, 'choose another card in your discard pile', false, 'chosen') : s
  }),
  ifYouDo: (s, ctx) => {
    const traits = (s.cards[ctx.cardChosen ?? '']?.traits ?? []).map(t => t.toLowerCase())
    const revealed = s.players[ctx.owner].deck.slice(0, searchCount(s, ctx.owner, 5))
    if (revealed.length === 0) return s
    const eligibleIndices = revealed.flatMap((id, i) => ((s.cards[id]?.traits ?? []).some(t => traits.includes(t.toLowerCase())) ? [i] : []))
    return pushChoice(s, { kind: 'searchDraw', id: ctx.sourceInstanceId!, controller: ctx.owner, revealed, eligibleIndices })
  },
})
registerCard('SOR_252', { // Restock
  ...whenPlayed("Choose up to 4 cards in a discard pile. Put them on the bottom of their owner's deck in a random order.", (s, ctx) => choosePlayer(s, ctx, 'restock the discard pile of')),
  ifYouDo: (s, ctx) => {
    // `restock:<player>:<picks>`
    const [, pileOwner, list] = ctx.step?.startsWith('restock:') ? ctx.step.split(':') : ['', ctx.playerChosen!, '']
    const owner = pileOwner as PlayerId
    const picks = [...(list ?? '').split(',').filter(Boolean), ...(ctx.step?.startsWith('restock:') && ctx.cardChosen ? [ctx.cardChosen] : [])]
    const left = withoutEach(discardBesides(s, owner, ctx), picks)
    const stopped = ctx.step?.startsWith('restock:') && !ctx.cardChosen
    if (stopped || picks.length >= 4 || left.length === 0) return discardToDeckBottom(s, owner, picks)
    return cardThen(s, ctx, left, "put a card on the bottom of its owner's deck (up to 4)", true, `restock:${owner}:${picks.join(',')}`)
  },
})
registerCard('LOF_104', { // Luminous Beings
  ...whenPlayed('Put up to 3 Force units from your discard pile on the bottom of your deck in a random order. Give that many units +4/+4 for this phase.', (s, ctx) =>
    luminousPick(s, ctx, [])),
  ifYouDo: (s, ctx) => {
    if (ctx.step?.startsWith('beings:')) {
      const picks = splitStep(ctx.step, 'beings:')
      if (ctx.cardChosen) return luminousPick(s, ctx, [...picks, ctx.cardChosen])
      return luminousBuff(discardToDeckBottom(s, ctx.owner, picks), ctx, picks.length, [])
    }
    // `buff:<n>:<units>`
    const [, n, list] = ctx.step!.split(':')
    return luminousBuff(addLastingEffect(s, { targetInstanceId: ctx.targetInstanceId!, power: 4, hp: 4 }), ctx, Number(n), [...list.split(',').filter(Boolean), ctx.targetInstanceId!])
  },
})
function luminousPick(s: GameState, ctx: Resumable, picks: string[]): GameState {
  const left = withoutEach(s.players[ctx.owner].discard.filter(id => printedUnit(s.cards[id]) && printedTrait(s.cards[id], 'Force')), picks)
  if (picks.length >= 3 || left.length === 0) return luminousBuff(discardToDeckBottom(s, ctx.owner, picks), ctx, picks.length, [])
  return cardThen(s, ctx, left, 'put a Force unit from your discard pile on the bottom of your deck (up to 3)', true, `beings:${picks.join(',')}`)
}
function luminousBuff(s: GameState, ctx: Resumable, n: number, buffed: string[]): GameState {
  if (buffed.length >= n) return s
  return unitThen(s, ctx, pickedIds(s, ctx, pickAny).filter(id => !buffed.includes(id)), `give a unit +4/+4 (${buffed.length + 1} of ${n})`, false, `buff:${n}:${buffed.join(',')}`)
}
registerCard('LOF_103', { // Following the Path
  ...whenPlayed('Search the top 8 cards of your deck for up to 2 Force units, reveal them, and put them on top of your deck in any order.', (s, ctx) =>
    followPath(s, ctx, [])),
  ifYouDo: (s, ctx) => {
    const picks = splitStep(ctx.step, 'path:').map(Number)
    const window = s.players[ctx.owner].deck.slice(0, searchCount(s, ctx.owner, 8))
    const offered = followPathOffers(s, window, picks)
    return ctx.optionIndex === undefined ? followPathFinish(s, ctx, picks) : followPath(s, ctx, [...picks, offered[ctx.optionIndex]])
  },
})
function followPathOffers(s: GameState, window: string[], picks: number[]): number[] {
  return window.flatMap((id, i) => (!picks.includes(i) && printedUnit(s.cards[id]) && printedTrait(s.cards[id], 'Force') ? [i] : []))
}
function followPath(s: GameState, ctx: Resumable, picks: number[]): GameState {
  const window = s.players[ctx.owner].deck.slice(0, searchCount(s, ctx.owner, 8))
  const offered = followPathOffers(s, window, picks)
  if (picks.length >= 2 || offered.length === 0) return followPathFinish(s, ctx, picks)
  return cardThen(s, ctx, offered.map(i => window[i]), 'put a Force unit on top of your deck (up to 2); the first you pick goes on top', true, `path:${picks.join(',')}`)
}
/** The picks go on top in the order picked; the rest of the window goes to the bottom. */
function followPathFinish(s: GameState, ctx: Resumable, picks: number[]): GameState {
  const deck = s.players[ctx.owner].deck
  const size = Math.min(deck.length, searchCount(s, ctx.owner, 8))
  const window = deck.slice(0, size)
  return updatePlayer(s, ctx.owner, { deck: [...picks.map(i => window[i]), ...deck.slice(size), ...window.filter((_, i) => !picks.includes(i))] })
}
registerCard('SOR_223', { // Don't Get Cocky
  ...whenPlayed('Choose a unit. One at a time, reveal cards from your deck until you choose to stop or have revealed 7 cards. If the combined cost of the revealed cards is 7 or less, deal that much damage to the chosen unit. Put the revealed cards on the bottom of your deck in a random order.', (s, ctx) =>
    unitThen(s, ctx, pickedIds(s, ctx, pickAny), 'choose a unit', false, 'target')),
  // The revealed cards stay on top of the deck while the reveal goes on: `more:<n>` and `stop:<n>` count them.
  ifYouDo: (s, ctx) => {
    if (ctx.step === 'target') return cockyReveal(s, ctx, ctx.targetInstanceId!, 1)
    const n = Number(ctx.step!.split(':')[1])
    return ctx.step!.startsWith('more:') ? cockyReveal(s, ctx, ctx.unitChosen!, n + 1) : cockyFinish(s, ctx, ctx.unitChosen!, n)
  },
})
function cockyReveal(s: GameState, ctx: Resumable, unitId: string, n: number): GameState {
  const deck = s.players[ctx.owner].deck
  const shown = deck.slice(0, n)
  if (n >= 7 || n >= deck.length) return cockyFinish(s, ctx, unitId, shown.length)
  const total = shown.reduce((sum, id) => sum + (s.cards[id]?.cost ?? 0), 0)
  const names = shown.map(id => s.cards[id]?.name ?? id).join(', ')
  return pushChoice(s, {
    kind: 'mayPayThen', id: ctx.sourceInstanceId!, controller: ctx.owner, cost: 0,
    text: `reveal another card (revealed: ${names}; combined cost ${total})`, then: resume(ctx, `more:${n}`, unitId), declineStep: `stop:${n}`,
  })
}
function cockyFinish(s: GameState, ctx: Resumable, unitId: string, n: number): GameState {
  const deck = s.players[ctx.owner].deck
  const shown = deck.slice(0, n)
  const total = shown.reduce((sum, id) => sum + (s.cards[id]?.cost ?? 0), 0)
  const bottomed = { ...updatePlayer(s, ctx.owner, { deck: [...deck.slice(n), ...seededShuffle(shown, s.rngSeed)] }), rngSeed: nextSeed(s.rngSeed) }
  return total <= 7 && total > 0 && findUnit(bottomed, unitId) ? dealDamageToUnit(bottomed, unitId, total) : bottomed
}
registerCard('SOR_152', { // For a Cause I Believe In
  ...whenPlayed('Reveal the top 4 cards of your deck. For each Heroism card revealed this way, deal 1 damage to an enemy base. You may discard any of the revealed cards and put the rest back on top of your deck in any order.', (s, ctx) => {
    const revealed = s.players[ctx.owner].deck.slice(0, 4)
    if (revealed.length === 0) return s
    const heroism = revealed.filter(id => printedAspect(s.cards[id], 'Heroism')).length
    return causePick(heroism > 0 ? dealDamageToBase(s, opponentOf(ctx.owner), heroism) : s, ctx, revealed.length, [])
  }),
  ifYouDo: (s, ctx) => {
    const picks = splitStep(ctx.step, 'cause:').map(Number)
    const size = Math.min(4, s.players[ctx.owner].deck.length)
    if (ctx.optionIndex === undefined) return causeFinish(s, ctx, picks)
    const left = [...Array(size).keys()].filter(i => !picks.includes(i))
    return causePick(s, ctx, size, [...picks, left[ctx.optionIndex]])
  },
})
function causePick(s: GameState, ctx: Resumable, size: number, picks: number[]): GameState {
  const deck = s.players[ctx.owner].deck
  const left = [...Array(size).keys()].filter(i => !picks.includes(i))
  if (left.length === 0) return causeFinish(s, ctx, picks)
  return cardThen(s, ctx, left.map(i => deck[i]), 'discard a revealed card', true, `cause:${picks.join(',')}`)
}
/**
 * The picked cards are discarded and the rest stay on top in the order they were revealed. The rules let
 * the player reorder them; keeping the order is an approximation.
 */
function causeFinish(s: GameState, ctx: Resumable, picks: number[]): GameState {
  const p = s.players[ctx.owner]
  const size = Math.min(4, p.deck.length)
  const top = p.deck.slice(0, size)
  return updatePlayer(s, ctx.owner, { deck: [...top.filter((_, i) => !picks.includes(i)), ...p.deck.slice(size)], discard: [...p.discard, ...picks.map(i => top[i])] })
}
registerCard('SHD_194', { // Triple Dark Raid
  ...whenPlayed('Search the top 7 cards of your deck for a Vehicle and play it. It costs 5 less and enters play ready. Return it to its owner\'s hand at the end of the phase.', (s, ctx) => {
    const p = s.players[ctx.owner]
    const revealed = p.deck.slice(0, searchCount(s, ctx.owner, 7))
    if (revealed.length === 0) return s
    const ready = p.resources.filter(r => !r.exhausted).length
    const eligibleIndices = revealed.flatMap((id, i) => {
      const c = s.cards[id]
      return printedUnit(c) && printedTrait(c, 'Vehicle') && c && Math.max(0, effectiveCost(s, ctx.owner, c) - 5) <= ready ? [i] : []
    })
    const pulled = updatePlayer(s, ctx.owner, { deck: p.deck.slice(revealed.length) })
    return pushChoice(pulled, { kind: 'searchPlayFree', id: ctx.sourceInstanceId!, controller: ctx.owner, revealed, eligibleIndices, budget: 0, playOne: true, costDelta: -5, entersReady: true, thenDelay: { cardId: 'SHD_194', when: 'regroupStart' } })
  }),
  // "At the end of the phase" is read as the start of the regroup phase that follows it.
  delayed: (s, e) => (e.unitId && findUnit(s, e.unitId) ? returnUnitToHand(s, e.unitId) : s),
})

// Moving units and upgrades, and the last one-offs
/** Put a unit on the top or bottom of its owner's deck: it leaves play as a return to hand does, and the card goes on the deck. */
const unitToDeck = (s: GameState, id: string, where: 'top' | 'bottom'): GameState => {
  const found = findUnit(s, id)
  if (!found) return s
  const cardOwner = found.unit.owner ?? found.owner
  const before = s.players[cardOwner].hand.length
  const returned = returnUnitToHand(s, id)
  const hand = returned.players[cardOwner].hand
  if (hand.length === before) return returned // a token leaves no card
  const card = hand[hand.length - 1]
  const deck = returned.players[cardOwner].deck
  return updatePlayer(returned, cardOwner, { hand: hand.slice(0, -1), deck: where === 'top' ? [card, ...deck] : [...deck, card] })
}
const unitToDeckBottom = (s: GameState, id: string): GameState => unitToDeck(s, id, 'bottom')
const selectUnitWithDecline = (s: GameState, ctx: Resumable, targets: string[], text: string, step: string, unit?: string): GameState =>
  (targets.length ? pushChoice(s, { kind: 'selectUnitThen', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, optional: true, hookOnDecline: true, text, then: resume(ctx, step, unit) }) : resumeNow(s, ctx, step, unit))
/** Run a card's own hook directly, as a declined pick would, when there was nothing to pick. */
const resumeNow = (s: GameState, ctx: Resumable, step: string, unit?: string): GameState =>
  getCardDefinition(ctx.cardId)!.ifYouDo!(s, { owner: ctx.owner, cardId: ctx.cardId, sourceInstanceId: ctx.sourceInstanceId, step, unitChosen: unit })

registerCard('SOR_187', { // I Had No Choice
  ...whenPlayed("Choose up to 2 non-leader units. An opponent chooses 1 of those units. Return that unit to its owner's hand and put the other on the bottom of its owner's deck.", (s, ctx) => {
    const targets = pickedIds(s, ctx, nonLeader)
    return targets.length ? pushChoice(s, { kind: 'selectUnitThen', id: ctx.sourceInstanceId!, controller: ctx.owner, targets, optional: true, text: 'choose a non-leader unit (up to 2)', then: resume(ctx, 'first') }) : s
  }),
  ifYouDo: (s, ctx) => {
    if (ctx.step === 'first') return selectUnitWithDecline(s, ctx, pickedIds(s, ctx, nonLeader).filter(id => id !== ctx.targetInstanceId), 'choose a second non-leader unit', 'second', ctx.targetInstanceId)
    if (ctx.step === 'second') {
      const chosen = [ctx.unitChosen, ctx.targetInstanceId].filter((id): id is string => id !== undefined)
      if (chosen.length < 2) return chosen.length ? returnUnitToHand(s, chosen[0]) : s
      return pushChoice(s, { kind: 'selectUnitThen', id: `${ctx.sourceInstanceId}-fate`, controller: opponentOf(ctx.owner), targets: chosen, text: "choose the unit that returns to its owner's hand; the other goes under its owner's deck", then: resume(ctx, `fate:${chosen.join(',')}`) })
    }
    const other = splitStep(ctx.step, 'fate:').find(id => id !== ctx.targetInstanceId)
    return returnUnitToHand(other ? unitToDeckBottom(s, other) : s, ctx.targetInstanceId!)
  },
})
registerCard('SHD_077', { // Evidence of the Crime
  ...whenPlayed('Take control of an upgrade that costs 3 or less and attach it to an eligible unit of your choice.', (s, ctx) => {
    // Attached to a unit: a Fortify upgrade attaches only to a base, so one there is never offered.
    const candidates = upgradeCandidates(s, { maxCost: 3, on: 'unit' }).filter(up => s.cards[up.cardId]?.type !== 'leader' && evidenceTargets(s, up, ctx.owner).length > 0)
    return candidates.length ? pushChoice(s, { kind: 'selectUpgradeThen', id: ctx.sourceInstanceId!, controller: ctx.owner, candidates, text: 'take control of an upgrade that costs 3 or less', then: resume(ctx) }) : s
  }),
  ifYouDo: (s, ctx) => {
    const up = ctx.upgradeChosen
    if (!up) return s
    if (!ctx.targetInstanceId) {
      return pushChoice(s, { kind: 'selectUnitThen', id: ctx.sourceInstanceId!, controller: ctx.owner, targets: evidenceTargets(s, up, ctx.owner), text: `attach ${s.cards[up.cardId]?.name ?? 'the upgrade'} to an eligible unit`, then: { ...resume(ctx), upgrade: up } })
    }
    // Taken, then attached: the caster controls it now.
    return moveUpgrade(s, up, ctx.targetInstanceId, ctx.owner)
  },
})
/** Every unit the taken upgrade may attach to, its current host included. */
function evidenceTargets(s: GameState, up: UpgradeRef, owner: PlayerId): string[] {
  const restriction = getCardDefinition(up.cardId)?.attachRestriction
  return allUnits(s).filter(u => !restriction || restriction(s, u, owner)).map(u => u.instanceId)
}
registerCard('JTL_232', { // Jump to Lightspeed
  ...whenPlayed("Return a friendly space unit and any number of non-leader upgrades on it to their owners' hands. The next time you play a copy of that unit this phase, you may play it for free.", (s, ctx) =>
    unitThen(s, ctx, pickedIds(s, ctx, pickAll(pickFriendly, pickArena('space'))), 'return a friendly space unit to hand', false, 'unit')),
  // The unit first, then its upgrades one at a time until Done; the unit goes last, taking the rest with it.
  ifYouDo: (s, ctx) => {
    const unitId = ctx.upgradeChosen?.unitId ?? ctx.unitChosen ?? ctx.targetInstanceId
    if (!unitId) return s
    const next = ctx.upgradeChosen ? returnUpgradeToHand(s, ctx.upgradeChosen.unitId, ctx.upgradeChosen.upgradeIndex) : s
    const candidates = upgradeCandidates(next).filter(c => c.unitId === unitId && !['leader', 'token'].includes(next.cards[c.cardId]?.type ?? ''))
    // A decline arrives at step `done` with no upgrade; a pick or the unit itself offers the next upgrade.
    if (candidates.length && (ctx.upgradeChosen || ctx.step === 'unit')) {
      return pushChoice(next, { kind: 'selectUpgradeThen', id: ctx.sourceInstanceId!, controller: ctx.owner, candidates, optional: true, text: "return an upgrade on it to its owner's hand", then: resume(ctx, 'done', unitId), hookOnDecline: true })
    }
    const cardId = findUnit(next, unitId)?.unit.cardId
    const returned = returnUnitToHand(next, unitId)
    return cardId ? grantNextUnit(returned, ctx.owner, { cardId, costDelta: FREE }) : returned
  },
})
registerCard('TWI_089', { // Consolidation of Power
  ...whenPlayed('Choose any number of friendly units. You may play a unit from your hand if its cost is less than or equal to the combined power of the chosen units for free. Then, defeat the chosen units.', (s, ctx) =>
    consolidatePick(s, ctx, [])),
  ifYouDo: (s, ctx) => {
    const picks = splitStep(ctx.step, 'consolidate:')
    return ctx.targetInstanceId ? consolidatePick(s, ctx, [...picks, ctx.targetInstanceId]) : consolidatePlay(s, ctx, picks)
  },
})
function consolidatePick(s: GameState, ctx: Resumable, picks: string[]): GameState {
  const left = pickedIds(s, ctx, pickFriendly).filter(id => !picks.includes(id))
  if (left.length === 0) return consolidatePlay(s, ctx, picks)
  return pushChoice(s, { kind: 'selectUnitThen', id: ctx.sourceInstanceId!, controller: ctx.owner, targets: left, optional: true, hookOnDecline: true, text: 'choose a friendly unit to consolidate (any number)', then: resume(ctx, `consolidate:${picks.join(',')}`) })
}
function consolidatePlay(s: GameState, ctx: Resumable, picks: string[]): GameState {
  const power = picks.reduce((sum, id) => { const u = findUnit(s, id)?.unit; return sum + (u ? effectivePower(s, u) : 0) }, 0)
  const candidates = s.players[ctx.owner].hand.flatMap((cardId, handIndex) =>
    (printedUnit(s.cards[cardId]) && (s.cards[cardId]?.cost ?? 0) <= power ? [{ handIndex, cardId }] : []))
  if (candidates.length === 0) return picks.length ? defeatUnits(s, picks) : s
  return pushChoice(s, { kind: 'playUnitFromHand', id: ctx.sourceInstanceId!, controller: ctx.owner, candidates, costDelta: FREE, entersReady: false, optional: true, ...(picks.length ? { thenDefeat: picks } : {}) })
}
registerCard('LOF_220', whenPlayed('Play a Force unit from your hand (paying its cost). It gains Ambush for this phase. The next time it would be dealt damage this phase, prevent 2 of that damage.', (s, ctx) => { // Shien Flurry
  const candidates = affordableHandUnits(s, ctx.owner, 0, 0).filter(ref => printedTrait(s.cards[ref.cardId], 'Force'))
  if (candidates.length === 0) return s
  // The Ambush is granted before the play, so the unit enters with it and may attack at once.
  return pushChoice(grantNextUnit(s, ctx.owner, { keywords: [KW.ambush], trait: 'Force' }), {
    kind: 'playUnitFromHand', id: ctx.sourceInstanceId!, controller: ctx.owner, candidates, costDelta: 0, entersReady: false, thenLasting: { preventNext: 2 },
  })
}))
registerCard('LOF_043', { // The Tragedy of Plagueis
  ...unitThenWp('Choose a friendly unit. For this phase, it can\'t be defeated by having no remaining HP. An opponent chooses a unit they control. Defeat that unit.', pickFriendly, 'choose a friendly unit that can\'t be defeated by damage this phase', false,
    (s, ctx) => {
      const opp = opponentOf(ctx.owner)
      return targetChoice(addLastingEffect(s, { targetInstanceId: ctx.targetInstanceId!, survivesNoHp: true }), { ...ctx, owner: opp }, 'selectUnitToDefeat', s.players[opp].units.map(u => u.instanceId))
    }),
})
registerCard('SOR_075', unitThenWp('Heal up to 3 damage from a unit. If you control a FORCE unit, you may deal that much damage to another unit.', pickAny, 'heal up to 3 damage from a unit', false, // It Binds All Things
  (s, ctx) => {
    // Healing less than it can never helps, so "up to 3" heals as much as the unit has, to 3.
    const u = findUnit(s, ctx.targetInstanceId!)?.unit
    const healed = u ? Math.min(3, u.damage) : 0
    const next = healed > 0 ? healUnit(s, u!.instanceId, healed) : s
    return healed > 0 && controlsTrait(next, ctx.owner, 'Force') ? damageChoice(next, ctx, healed, picked(next, ctx, pickAny).filter(x => x.instanceId !== u!.instanceId), [], true) : next
  }))
registerCard('SOR_104', whenPlayed('Search the top 10 cards of your deck for up to 3 units with combined cost 7 or less and play each of them for free.', (s, ctx) => { // U-Wing Reinforcement
  // Admiral Ackbar's budgeted search, capped at three plays.
  const p = s.players[ctx.owner]
  const revealed = p.deck.slice(0, searchCount(s, ctx.owner, 10))
  if (revealed.length === 0) return s
  const eligibleIndices = revealed.flatMap((id, i) => (printedUnit(s.cards[id]) && (s.cards[id]?.cost ?? 0) <= 7 ? [i] : []))
  return pushChoice(updatePlayer(s, ctx.owner, { deck: p.deck.slice(revealed.length) }), { kind: 'searchPlayFree', id: ctx.sourceInstanceId!, controller: ctx.owner, revealed, eligibleIndices, budget: 7, maxPlays: 3 })
}))
registerCard('LAW_102', { // Choke on Aspirations
  ...whenPlayed('Deal up to 5 damage to a friendly non-Vehicle unit. If it survives, heal damage from your base equal to the damage dealt this way.', (s, ctx) =>
    unitThen(s, ctx, pickedIds(s, ctx, pickAll(pickFriendly, (st, u) => !unitHasTrait(st, u, 'Vehicle'))), 'choose a friendly non-Vehicle unit', false, 'target')),
  ifYouDo: (s, ctx) => {
    if (ctx.step === 'target') {
      return pushChoice(s, { kind: 'chooseNumber', id: ctx.sourceInstanceId!, controller: ctx.owner, max: 5, text: 'choose how much damage to deal (up to 5)', then: resume(ctx, 'amount', ctx.targetInstanceId) })
    }
    const id = ctx.unitChosen!
    const before = findUnit(s, id)?.unit.damage ?? 0
    const next = dealDamageToUnit(s, id, ctx.optionIndex ?? 0)
    const after = findUnit(next, id)?.unit
    // A pending prevention offer means nothing has been dealt yet, so nothing is healed.
    return after && after.damage > before ? healBase(next, ctx.owner, after.damage - before) : next
  },
})

registerCard('LAW_085', unitThenWp('Choose a friendly non-leader unit. An opponent takes control of it. If they do, deal 4 damage to another unit in the same arena.', pickAll(pickFriendly, nonLeader), 'give a friendly non-leader unit to an opponent', false, // You Hold This
  (s, ctx) => {
    const others = otherInArena(s, ctx.targetInstanceId!)
    return damageChoice(stealTo(s, opponentOf(ctx.owner), ctx.targetInstanceId, 'permanent'), ctx, 4, others)
  }))

// ── Units with an activated "Action:" ability ─────────────────────────────────────────────────────
// Built on the event helpers above: an action's effect is handed the same context as a When Played.
// Each is gated with `usable` where using it could do nothing at all, as Lang is.

/** The player whose unit `u` is, read from the board. */
const controllerOf = (s: GameState, u: UnitState): PlayerId => unitOwner(s, u) ?? 'player'
/** The unit as an event context, for the pickers that read "friendly" and "another". */
const asCtx = (s: GameState, u: UnitState): EventCtx => ({ owner: controllerOf(s, u), sourceInstanceId: u.instanceId })
const anyPicked = (test: Pick) => (s: GameState, u: UnitState): boolean => picked(s, asCtx(s, u), test).length > 0
const playedThisPhase = (trait: string) => (s: GameState, u: UnitState): boolean =>
  cardsPlayedThisPhase(s, controllerOf(s, u)).some(id => printedTrait(s.cards[id], trait))

// Targeted effects
registerCard('LOF_134', { actionAbilities: [{ // Heavy Missile Gunship
  description: 'Deal 2 damage to a ground unit.',
  exhaustCost: true,
  usable: anyPicked(pickGround),
  effect: (s, ctx) => damageChoice(s, ctx, 2, picked(s, ctx, pickGround)),
}] })
registerCard('IBH_16', { actionAbilities: [{ // Ion Cannon
  description: 'Deal 3 damage to a space unit.',
  exhaustCost: true,
  usable: anyPicked(pickArena('space')),
  effect: (s, ctx) => damageChoice(s, ctx, 3, picked(s, ctx, pickArena('space'))),
}] })
registerCard('SHD_196', { actionAbilities: [{ // Grogu
  description: 'Exhaust an enemy unit.',
  exhaustCost: true,
  usable: anyPicked(pickEnemy),
  effect: (s, ctx) => targetChoice(s, ctx, 'mayExhaustUnit', pickedIds(s, ctx, pickEnemy)),
}] })
const powerAtMost4: Pick = (s, x) => effectivePower(s, x) <= 4
registerCard('TWI_206', { actionAbilities: [{ // Independent Senator
  description: 'Exhaust a unit with 4 or less power.',
  cost: 2,
  exhaustCost: true,
  usable: anyPicked(powerAtMost4),
  effect: (s, ctx) => targetChoice(s, ctx, 'mayExhaustUnit', pickedIds(s, ctx, powerAtMost4)),
}] })
registerCard('TWI_056', { actionAbilities: [{ // Compassionate Senator
  description: 'Heal 2 damage from a unit or base.',
  cost: 2,
  exhaustCost: true,
  effect: (s, ctx) => healChoice(s, ctx, 2, pickedIds(s, ctx, pickAny), BOTH_BASES),
}] })
registerCard('TWI_157', { actionAbilities: [{ // Disaffected Senator
  description: 'Deal 2 damage to a base.',
  cost: 2,
  exhaustCost: true,
  effect: (s, ctx) => damageChoice(s, ctx, 2, [], BOTH_BASES),
}] })
registerCard('IBH_62', { actionAbilities: [{ // Imperial Deck Officer
  description: 'Heal 2 damage from a Villainy unit.',
  exhaustCost: true,
  usable: anyPicked(pickAspect('Villainy')),
  effect: (s, ctx) => healChoice(s, ctx, 2, pickedIds(s, ctx, pickAspect('Villainy')), []),
}] })
const enemyGround = pickAll(pickEnemy, pickGround)
registerCard('SHD_087', { actionAbilities: [ // Crosshair
  {
    description: 'This unit gets +1/+0 for this phase.',
    cost: 2,
    effect: (s, ctx) => addLastingEffect(s, { targetInstanceId: ctx.sourceInstanceId!, power: 1 }),
  },
  {
    description: 'This unit deals damage equal to his power to an enemy ground unit.',
    exhaustCost: true,
    usable: anyPicked(enemyGround),
    effect: (s, ctx) => {
      const self = findUnit(s, ctx.sourceInstanceId!)?.unit
      const power = self ? effectivePower(s, self) : 0
      return power > 0 ? damageChoice(s, ctx, power, picked(s, ctx, enemyGround)) : s
    },
  },
] })
registerCard('SEC_216', { // Regulations Bureaucrat
  actionAbilities: [{
    description: 'Exhaust a resource.',
    exhaustCost: true,
    usable: s => BOTH_BASES.some(p => s.players[p].resources.some(r => !r.exhausted)),
    effect: (s, ctx) => choosePlayer(s, ctx, 'choose the player whose resource to exhaust'),
  }],
  ifYouDo: (s, ctx) => exhaustReadyResource(s, ctx.playerChosen!),
})

// Attacks
const GRANT_MASSASSI_TACTICAL_OFFICER = 'GRANT_MASSASSI_TACTICAL_OFFICER'
registerCard(GRANT_MASSASSI_TACTICAL_OFFICER, { sourceCardId: 'JTL_146', ...attackBonus(2) })
const GRANT_STEADFAST_SENATOR = 'GRANT_STEADFAST_SENATOR'
registerCard(GRANT_STEADFAST_SENATOR, { sourceCardId: 'TWI_105', ...attackBonus(2) })
const GRANT_GENERAL_RIEEKAN = 'GRANT_GENERAL_RIEEKAN'
registerCard(GRANT_GENERAL_RIEEKAN, { sourceCardId: 'IBH_23', ...attackBonus(2) })
const GRANT_FRONTLINE_SHUTTLE = 'GRANT_FRONTLINE_SHUTTLE'
registerCard(GRANT_FRONTLINE_SHUTTLE, { sourceCardId: 'SOR_110', cannotAttackBases: () => true })
const GRANT_MAGNAGUARD = 'GRANT_MAGNAGUARD'
registerCard(GRANT_MAGNAGUARD, {
  sourceCardId: 'TWI_082',
  abilities: [thenAttack('Then, attack with another Droid unit.', { attacker: { trait: 'Droid' } })],
})

/** An action's "attack with a unit": offered only while some friendly unit could make that attack. */
const actionAttack = (owner: PlayerId, s: GameState, offer: AttackOffer): boolean =>
  s.players[owner].units.some(x => eligibleAttacker(s, x, offer.attacker, offer.exhausted) && canAttackSomething(s, x, offer.grantCardId))
const attackAction = (description: string, offer: (s: GameState, self: UnitState) => AttackOffer, costs: { cost?: number; exhaustCost?: boolean; oncePerRound?: boolean }) => ({
  actionAbilities: [{
    description,
    ...costs,
    usable: (s: GameState, self: UnitState) => {
      // The exhaust cost is paid before the attack is chosen, so the unit itself cannot be the attacker.
      const o = offer(s, self)
      const attacker = costs.exhaustCost ? { ...o.attacker, exclude: [...(o.attacker?.exclude ?? []), self.instanceId] } : o.attacker
      return actionAttack(controllerOf(s, self), s, { ...o, attacker })
    },
    effect: (s: GameState, ctx: EffectContext) => {
      const self = findUnit(s, ctx.sourceInstanceId!)?.unit
      return self ? offerAttack(s, ctx.owner, `${ctx.sourceInstanceId}-attack`, offer(s, self)) : s
    },
  }],
})
registerCard('JTL_146', attackAction('Attack with a Fighter unit. It gets +2/+0 for this attack.', // Massassi Tactical Officer
  () => ({ attacker: { trait: 'Fighter' }, grantCardId: GRANT_MASSASSI_TACTICAL_OFFICER }), { exhaustCost: true }))
registerCard('TWI_105', attackAction('Attack with a unit. It gets +2/+0 for this attack.', // Steadfast Senator
  () => ({ grantCardId: GRANT_STEADFAST_SENATOR }), { cost: 2, exhaustCost: true }))
registerCard('IBH_23', attackAction('Attack with another Heroism unit. It gets +2/+0 for this attack.', (s, self) => ({ // General Rieekan
  // Heroism is an aspect, not a trait, so the candidates are named rather than filtered.
  attacker: { only: picked(s, asCtx(s, self), pickAll(pickFriendly, pickOther, pickAspect('Heroism'))).map(x => x.instanceId) },
  grantCardId: GRANT_GENERAL_RIEEKAN,
}), { exhaustCost: true }))
registerCard('TWI_082', attackAction('Attack with a Droid unit. Then, attack with another Droid unit. Use this ability only once each round.', // MagnaGuard Wing Leader
  () => ({ attacker: { trait: 'Droid' }, grantCardId: GRANT_MAGNAGUARD }), { oncePerRound: true }))
registerCard('SOR_110', { actionAbilities: [{ // Frontline Shuttle
  description: "[Defeat this unit]: Attack with a unit, even if it's exhausted. It can't attack bases for this attack.",
  usable: (s, self) => actionAttack(controllerOf(s, self), s, { attacker: { exclude: [self.instanceId] }, exhausted: true, grantCardId: GRANT_FRONTLINE_SHUTTLE }),
  effect: (s, ctx) => offerAttack(defeatUnits(s, [ctx.sourceInstanceId!]), ctx.owner, `${ctx.sourceInstanceId}-attack`, { exhausted: true, grantCardId: GRANT_FRONTLINE_SHUTTLE }),
}] })

// Gated on a card played this phase
const drawIfPlayed = (description: string, trait: string) => ({
  description,
  exhaustCost: true,
  usable: playedThisPhase(trait),
  effect: (s: GameState, ctx: EffectContext) => drawCards(s, ctx.owner, 1),
})
registerCard('LOF_243', { actionAbilities: [drawIfPlayed('If you played a Force card this phase, draw a card.', 'Force')] }) // Caretaker Matron
registerCard('JTL_134', { // General Hux
  ...friendlyAura(isTrait('First Order'), { keywords: [KW.raid(1)] }, true),
  actionAbilities: [drawIfPlayed('If you played a First Order card this phase, draw a card.', 'First Order')],
})

// Costs that move or damage a unit
registerCard('SEC_093', { actionAbilities: [{ // C-3P0
  description: "[Exhaust, return this unit to its owner's hand]: Give a unit +2/+2 for this phase.",
  exhaustCost: true,
  effect: (s, ctx) => {
    const returned = returnUnitToHand(s, ctx.sourceInstanceId!)
    return lastingBuffChoice(returned, ctx, pickedIds(returned, ctx, pickAny), { power: 2, hp: 2 })
  },
}] })
registerCard('LAW_084', { // Krrsantan
  actionAbilities: [{
    description: '[Discard 2 cards from your hand]: Return this unit to your hand.',
    // The discard is a cost, so it cannot be used with fewer than 2 cards in hand.
    usable: (s, self) => s.players[controllerOf(s, self)].hand.length >= 2,
    effect: (s, ctx) => discards(s, ctx.owner, 2, ctx.sourceInstanceId!, resume(ctx)),
  }],
  ifYouDo: (s, ctx) => returnUnitToHand(s, ctx.sourceInstanceId!),
})
registerCard('SHD_028', { // Doctor Pershing
  actionAbilities: [{
    description: '[Exhaust, deal 1 damage to a friendly unit]: Draw a card.',
    exhaustCost: true,
    effect: (s, ctx) => unitThen(s, ctx, pickedIds(s, ctx, pickFriendly), 'deal 1 damage to a friendly unit', false),
  }],
  ifYouDo: (s, ctx) => drawCards(dealDamageToUnit(s, ctx.targetInstanceId!, 1), ctx.owner, 1),
})
registerCard('TWI_194', { // Ahsoka Tano
  ...gains((s, u) => friendliesOf(s, u).length < enemiesOf(s, u).length, KW.ambush),
  actionAbilities: [{
    description: "[C=2]: Return this unit and each upgrade on her to their owners' hands.",
    cost: 2,
    // Token upgrades have no card to return and cease to exist with her.
    effect: (s, ctx) => returnUnitToHand(returnOtherUpgradesToHand(s, ctx.sourceInstanceId!, ''), ctx.sourceInstanceId!),
  }],
})

// Plays from hand
const handUnitPlayable = (costDelta: number, test?: (c: EngineCard | undefined) => boolean) => (s: GameState, self: UnitState): boolean =>
  affordableHandUnits(s, controllerOf(s, self), 0, costDelta).some(ref => !test || test(s.cards[ref.cardId]))
registerCard('SOR_093', { actionAbilities: [{ // Alliance Dispatcher
  description: 'Play a unit from your hand. It costs 1 less.',
  exhaustCost: true,
  usable: handUnitPlayable(-1),
  effect: (s, ctx) => playFromHand(s, ctx, { costDelta: -1 }),
}] })
const isImperialCard = (c: EngineCard | undefined): boolean => printedTrait(c, 'Imperial')
registerCard('SOR_129', { actionAbilities: [{ // Admiral Ozzel
  description: 'Play an Imperial unit from your hand (paying its cost). It enters play ready. Each opponent may ready a unit.',
  exhaustCost: true,
  usable: handUnitPlayable(0, isImperialCard),
  effect: (s, ctx) => {
    const candidates = affordableHandUnits(s, ctx.owner, 0, 0).filter(ref => isImperialCard(s.cards[ref.cardId]))
    const played = pushChoice(s, { kind: 'playUnitFromHand', id: ctx.sourceInstanceId!, controller: ctx.owner, candidates, costDelta: 0, entersReady: true })
    // Queued behind the play, so it resolves once the unit is in; the opponent answers it.
    return targetChoice(played, { ...ctx, owner: opponentOf(ctx.owner) }, 'selectUnitToReady', allUnits(s).filter(x => x.exhausted).map(x => x.instanceId), true)
  },
}] })

// Heal, then damage
registerCard('LOF_246', { // Grogu
  actionAbilities: [{
    description: 'Heal up to 2 damage from a unit. If you do, deal that much damage to a unit.',
    exhaustCost: true,
    usable: anyPicked((_s, x) => x.damage > 0),
    effect: (s, ctx) => unitThen(s, ctx, pickedIds(s, ctx, (_s, x) => x.damage > 0), 'heal up to 2 damage from a unit', false),
  }],
  ifYouDo: (s, ctx) => {
    // Healing less than it can never helps, so "up to 2" heals as much as the unit has, to 2.
    const healed = Math.min(2, findUnit(s, ctx.targetInstanceId!)?.unit.damage ?? 0)
    const next = healed > 0 ? healUnit(s, ctx.targetInstanceId!, healed) : s
    return healed > 0 ? damageChoice(next, ctx, healed, picked(next, ctx, pickAny)) : next
  },
})

// Any player may use
registerCard('SHD_256', { actionAbilities: [{ // Mercenary Gunship
  description: 'Take control of this unit. Any player may use this ability.',
  cost: 4,
  anyPlayer: true,
  // Its controller gains nothing from it, so it is offered only to the other player.
  usable: (s, self) => controllerOf(s, self) !== s.activePlayer,
  effect: (s, ctx) => stealTo(s, ctx.owner, ctx.sourceInstanceId, 'permanent'),
}] })

// ── On Attack units from the other sealed sets ─────────────────────────────────────────────────────
// Built on the When Played helpers above: `onAttack` fires the same definition as the unit attacks. The
// source is the attacking unit, and the attack's target is on the context, so an ability about "the
// defender" reads `ctx.attackTarget`. Two steps that must not be answered out of order are chained
// through the card's `ifYouDo`, so the second is raised only once the first is settled.

/** A definition built with the When Played helpers, fired as its unit attacks instead. */
const onAttack = (def: CardDefinition): CardDefinition => ({
  ...def,
  abilities: def.abilities?.map(a => (a.trigger === 'whenPlayed' ? { ...a, trigger: 'onAttack' as const } : a)),
})
/** Several definitions as one card, keeping every ability each of them declares. */
const allOf = (...defs: CardDefinition[]): CardDefinition => Object.assign({}, ...defs, { abilities: defs.flatMap(d => d.abilities ?? []) })
const attacks = (description: string, effect: AbilityDef['effect']): CardDefinition => ({ abilities: [{ trigger: 'onAttack', description, effect }] })
const unitThenOa = (...args: Parameters<typeof unitThenWp>): CardDefinition => onAttack(unitThenWp(...args))
const selfOf = (s: GameState, ctx: EventCtx): UnitState | undefined => findUnit(s, ctx.sourceInstanceId!)?.unit
const selfIs = (test: (s: GameState, u: UnitState) => boolean): When => (s, ctx) => { const u = selfOf(s, ctx); return u !== undefined && test(s, u) }
const defenderOf = (s: GameState, ctx: EffectContext): UnitState | undefined =>
  (ctx.attackTarget?.kind === 'unit' ? findUnit(s, ctx.attackTarget.instanceId)?.unit : undefined)
const attackingPower = (s: GameState, ctx: EventCtx): number => { const u = selfOf(s, ctx); return u ? effectivePower(s, u, { attacking: true }) : 0 }
/** "<Unit> gets +X/+0 for this attack". */
const forThisAttack = (s: GameState, id: string, power: number): GameState => addLastingEffect(s, { targetInstanceId: id, power, untilEndOfAttack: true })
const leaderUnitYouControl: When = (s, ctx) => s.players[ctx.owner].units.some(u => isLeaderUnit(s, u))
const sharesAspectWithBase = (s: GameState, owner: PlayerId, cardId: string): boolean => {
  const base = s.cards[s.players[owner].base.cardId]?.aspects ?? []
  return (s.cards[cardId]?.aspects ?? []).some(a => base.includes(a))
}
const damaged: Pick = (_s, u) => u.damage > 0
const enemyGroundUnit = pickAll(pickEnemy, pickGround)

// A: targets, draws and base damage
registerCard('LAW_057', allOf( // Benthic "Two Tubes"
  onAttack(damageWp('Deal 1 damage to an enemy ground unit.', enemyGroundUnit, 1, false)),
  whenDefeated('Deal 1 damage to a base.', (s, ctx) => damageChoice(s, ctx, 1, [], BOTH_BASES)),
))
registerCard('LAW_181', onAttack(whenPlayed('Deal 2 damage to a base.', (s, ctx) => damageChoice(s, ctx, 2, [], BOTH_BASES)))) // Cloud-Rider Veteran
registerCard('IBH_6', onAttack(whenPlayed('Deal 1 damage to a base.', (s, ctx) => damageChoice(s, ctx, 1, [], BOTH_BASES)))) // Rebellion Y-Wing
registerCard('LAW_079', onAttack(damageWp('You may deal 3 damage to a damaged ground unit.', pickAll(pickGround, damaged), 3, true))) // K-2S0
registerCard('LAW_064', onAttack(damageWp("If you control another Bounty Hunter unit, you may deal damage equal to this unit's power to a ground unit.", pickGround, // Zuckuss
  attackingPower, true, (s, ctx) => youControl(s, ctx, pickOther, pickTrait('Bounty Hunter')))))
registerCard('LOF_144', onAttack(damageWp('You may deal 1 damage to a space unit.', pickArena('space'), 1, true))) // Jedi Starfighter
registerCard('LOF_163', onAttack(whenPlayed('If this unit has 6 or more power, you may deal 2 damage to an enemy base.', (s, ctx) => // Quinlan Vos
  (attackingPower(s, ctx) >= 6 ? damageChoice(s, ctx, 2, [], [opponentOf(ctx.owner)], true) : s))))
registerCard('JTL_151', onAttack(damageWp('You may deal 2 damage to a damaged unit.', damaged, 2, true))) // Red Five
registerCard('JTL_147', { // Black One
  statModifier: (_s, u) => (isUpgraded(u) ? { power: 1 } : {}),
  // An upgrade is controlled by the player who played it, wherever it is attached.
  ...onAttack(damageWp('If you control Poe Dameron (as a unit, upgrade, or leader), you may deal 1 damage to a unit.', pickAny, 1, true, (s, ctx) =>
    playerControlsNamed(s, ctx.owner, 'Poe Dameron')
      || allUnits(s).some(u => u.upgrades.some(up => up.owner === ctx.owner && s.cards[up.cardId]?.name === 'Poe Dameron'))))
})
registerCard('JTL_037', onAttack(damageWp('You may deal damage to a unit equal to the amount of damage on this unit.', pickAny, // Banshee
  (s, ctx) => selfOf(s, ctx)?.damage ?? 0, true)))
registerCard('TWI_154', onAttack(damageWp('If you have no cards in your hand, you may deal 3 damage to a ground unit.', pickGround, 3, true, // Mister Bones
  (s, ctx) => s.players[ctx.owner].hand.length === 0)))
registerCard('TWI_150', onAttack(whenPlayed('If your base has 15 or more damage on it, deal 1 damage to each enemy ground unit.', (s, ctx) => // Saw Gerrera
  (s.players[ctx.owner].base.damage >= 15 ? pickedIds(s, ctx, enemyGroundUnit).reduce((acc, id) => dealDamageToUnit(acc, id, 1), s) : s))))
registerCard('SHD_150', onAttack(damageWp('If this unit is upgraded, you may deal 2 damage to a ground unit.', pickGround, 2, true, selfIs((_s, u) => isUpgraded(u))))) // Koska Reeves
registerCard('SOR_158', onAttack(whenPlayed('If you control a leader unit, deal 2 damage to a ground unit or a base.', (s, ctx) => // Jedha Agitator
  (leaderUnitYouControl(s, ctx) ? damageChoice(s, ctx, 2, picked(s, ctx, pickGround), BOTH_BASES) : s))))
registerCard('LAW_184', { // Aerie
  ...onAttack(whenPlayed('Deal 2 damage to an enemy ground unit and 2 damage to a base.', (s, ctx) => {
    const targets = pickedIds(s, ctx, enemyGroundUnit)
    return targets.length ? unitThen(s, ctx, targets, 'deal 2 damage to an enemy ground unit', false, 'unit') : damageChoice(s, ctx, 2, [], BOTH_BASES)
  })),
  ifYouDo: (s, ctx) => damageChoice(dealDamageToUnit(s, ctx.targetInstanceId!, 2), ctx, 2, [], BOTH_BASES),
})
registerCard('LOF_170', onAttack(whenPlayed('Deal 3 damage to each other unit.', (s, ctx) => // Bendu
  pickedIds(s, ctx, pickOther).reduce((acc, id) => dealDamageToUnit(acc, id, 3), s))))
registerCard('TWI_202', onAttack(whenPlayed('Deal 2 damage to a random unit or base.', s => { // Jar Jar Binks
  // Random, not chosen: the seed on the state keeps it deterministic under replay.
  const options: (string | PlayerId)[] = [...allUnits(s).map(u => u.instanceId), ...BOTH_BASES]
  const pick = options[Math.floor(seededUnit(s.rngSeed) * options.length)]
  const next = { ...s, rngSeed: nextSeed(s.rngSeed) }
  return pick === 'player' || pick === 'opponent' ? dealDamageToBase(next, pick, 2) : dealDamageToUnit(next, pick, 2)
})))

// A: heal, shield, exhaust, ready
const healAnother = (description: string) =>
  onAttack(whenPlayed(description, (s, ctx) => healChoice(s, ctx, 2, pickedIds(s, ctx, pickOther), [], true)))
registerCard('LOF_250', healAnother('You may heal 2 damage from another unit.')) // Medical Frigate
registerCard('SOR_059', healAnother('You may heal 2 damage from another unit.')) // 2-1B Surgical Droid
registerCard('SHD_048', onAttack(whenPlayed('You may heal damage from another unit equal to the damage on this unit.', (s, ctx) => { // Gentle Giant
  const amount = selfOf(s, ctx)?.damage ?? 0
  return amount > 0 ? healChoice(s, ctx, amount, pickedIds(s, ctx, pickOther), [], true) : s
})))
registerCard('LAW_095', onAttack(whenPlayed('You may give a Shield token to a non-unique unit.', (s, ctx) => // Finn
  shieldChoice(s, ctx, pickedIds(s, ctx, (st, u) => !cardOf(st, u)?.unique), true))))
registerCard('LAW_087', onAttack(targetWp('If this unit is upgraded, exhaust an enemy unit.', 'mayExhaustUnit', pickEnemy, false, selfIs((_s, u) => isUpgraded(u))))) // Jango Fett
registerCard('SOR_208', onAttack(targetWp('If you control a leader unit, you may exhaust a non-leader unit.', 'mayExhaustUnit', nonLeader, true, leaderUnitYouControl))) // Outer Rim Headhunter
registerCard('SOR_244', onAttack(targetWp('Exhaust an enemy Vehicle ground unit.', 'mayExhaustUnit', pickAll(enemyGroundUnit, pickTrait('Vehicle')), false))) // Snowspeeder
registerCard('IBH_11', onAttack(targetWp('If you control a Command unit, exhaust an enemy ground unit that costs 4 or less.', 'mayExhaustUnit', // R2-D2
  pickAll(enemyGroundUnit, (s, u) => printedCost(s, u) <= 4), false, (s, ctx) => youControl(s, ctx, pickAspect('Command')))))
registerCard('SEC_204', onAttack(targetWp('Ready an exhausted enemy unit.', 'selectUnitToReady', pickAll(pickEnemy, (_s, u) => u.exhausted), false))) // Blue Ace
// Readying a resource costs nothing and can only help, so the "may" is always taken.
registerCard('SHD_199', onAttack(whenPlayed('You may ready a resource.', (s, ctx) => readyResource(s, ctx.owner)))) // Coruscant Dissident
registerCard('SEC_225', onAttack(whenPlayed('For each friendly unit, ready a friendly resource.', (s, ctx) => // Synara San
  s.players[ctx.owner].units.reduce(acc => readyResource(acc, ctx.owner), s))))
registerCard('SEC_188', { // Darth Traya
  // Either player's leader, while it is not a unit. The step lists whose leader each option is.
  ...onAttack(whenPlayed('You may ready a non-unit leader.', (s, ctx) => {
    const tired = (['player', 'opponent'] as PlayerId[]).filter(p =>!s.players[p].leader.deployed && s.players[p].leader.exhausted)
    return tired.length ? cardThen(s, ctx, tired.map(p => s.players[p].leader.cardId), 'ready a leader', true, tired.join(',')) : s
  })),
  ifYouDo: (s, ctx) => {
    const who = ctx.optionIndex === undefined ? undefined : (ctx.step ?? '').split(',')[ctx.optionIndex] as PlayerId | undefined
    return who ? updatePlayer(s, who, { leader: { ...s.players[who].leader, exhausted: false } }) : s
  },
})
const FIRESPRAY_KEY = 'JTL_157#ready'
registerCard('JTL_157', onAttack(whenPlayed('Ready this unit. Use this ability only once each round.', (s, ctx) => { // Relentless Firespray
  const u = selfOf(s, ctx)
  return u && !(u.usedAbilities ?? []).includes(FIRESPRAY_KEY) ? markAbilityUsed(readyUnit(s, u.instanceId), ctx.owner, u.instanceId, FIRESPRAY_KEY) : s
})))

// A: lasting buffs and keywords
registerCard('LAW_104', onAttack(buffWp('You may give a friendly Rebel unit Sentinel for this phase.', pickAll(pickFriendly, pickTrait('Rebel')), () => ({ keywords: [KW.sentinel] }), true))) // Bodhi Rook
registerCard('LAW_182', onAttack(buffWp('Another friendly unit gains Raid 2 for this phase.', pickAll(pickFriendly, pickOther), () => ({ keywords: [KW.raid(2)] }), false))) // Weazel
registerCard('SOR_156', onAttack(buffWp('Another friendly Aggression unit gains Raid 2 for this phase.', pickAll(pickFriendly, pickOther, pickAspect('Aggression')), () => ({ keywords: [KW.raid(2)] }), false))) // Benthic "Two Tubes"
registerCard('SEC_045', onAttack(buffWp('Give another friendly Official unit Restore 2 for this phase.', pickAll(pickFriendly, pickOther, pickTrait('Official')), () => ({ keywords: [KW.restore(2)] }), false))) // Senator Chuchi
registerCard('LOF_045', onAttack(whenPlayed('Each other friendly Jedi unit gains Restore 1 for this phase.', (s, ctx) => // Yaddle
  lastingOnEach(s, picked(s, ctx, pickAll(pickFriendly, pickOther, pickTrait('Jedi'))), { keywords: [KW.restore(1)] }))))
registerCard('LOF_106', onAttack(buffWp('You may give another unit +5/+5 for this phase.', pickOther, () => ({ power: 5, hp: 5 }), true))) // Acclamator Assault Ship
registerCard('LOF_135', onAttack(buffWp('You may give another friendly Inquisitor unit +2/+0 for this phase.', pickAll(pickFriendly, pickOther, pickTrait('Inquisitor')), () => ({ power: 2 }), true))) // Scythe
registerCard('JTL_160', onAttack(buffWp('You may give a ground unit +2/+0 for this phase.', pickGround, () => ({ power: 2 }), true))) // Supporting Eta-2
registerCard('TWI_063', onAttack(buffWp('Give an enemy unit -1/-1 for this phase.', pickEnemy, () => ({ power: -1, hp: -1 }), false))) // Vulture Interceptor Wing
registerCard('SOR_116', onAttack(buffWp('If you control a leader unit, give a friendly unit +2/+2 for this phase.', pickFriendly, () => ({ power: 2, hp: 2 }), false, leaderUnitYouControl))) // Steadfast Battalion
registerCard('TS26_75', { // Jango Fett
  ...gains((s, u) => { const o = unitOwner(s, u); return o !== undefined && baseAttackedThisPhase(s, o) }, KW.ambush),
  ...onAttack(buffWp('Give an enemy unit -3/-0 for this phase.', pickEnemy, () => ({ power: -3 }), false)),
})
registerCard('LAW_228', onAttack(buffWp('If no other units have attacked this phase (including enemy units), you may give a unit -2/-0 for this phase.', pickAny, // Canyon Frontrunner
  () => ({ power: -2 }), true, (s, ctx) => attackedThisPhase(s).every(id => id === ctx.sourceInstanceId))))
registerCard('LAW_031', { // Bossk
  ...onAttack(whenPlayed('Give a unit +1/+1 for this phase. You may give a unit -1/-1 for this phase.', (s, ctx) =>
    unitThen(s, ctx, pickedIds(s, ctx, pickAny), 'give a unit +1/+1 for this phase', false, 'plus'))),
  ifYouDo: (s, ctx) => {
    if (ctx.step === 'minus') return addLastingEffect(s, { targetInstanceId: ctx.targetInstanceId!, power: -1, hp: -1 })
    const next = addLastingEffect(s, { targetInstanceId: ctx.targetInstanceId!, power: 1, hp: 1 })
    return unitThen(next, ctx, pickedIds(next, ctx, pickAny), 'you may give a unit -1/-1 for this phase', true, 'minus')
  },
})
registerCard('LAW_068', { // Millennium Falcon
  ...onAttack(whenPlayed('You may give a space unit -2/-0 for this phase. You may give a ground unit +2/+0 for this phase.', (s, ctx) =>
    selectUnitWithDecline(s, ctx, pickedIds(s, ctx, pickArena('space')), 'you may give a space unit -2/-0 for this phase', 'space'))),
  ifYouDo: (s, ctx) => {
    const next = ctx.targetInstanceId ? addLastingEffect(s, { targetInstanceId: ctx.targetInstanceId, power: ctx.step === 'space' ? -2 : 2 }) : s
    return ctx.step === 'space' ? unitThen(next, ctx, pickedIds(next, ctx, pickGround), 'you may give a ground unit +2/+0 for this phase', true, 'ground') : next
  },
})
const kalaniSpec: UpToSpec = { text: 'give another unit +2/+2 for this phase', test: pickOther, apply: (s, _ctx, id) => addLastingEffect(s, { targetInstanceId: id, power: 2, hp: 2 }) }
const KALANI_TEXT = 'You may choose another unit. If you have the initiative, you may choose up to 2 other units instead. Give each chosen unit +2/+2 for this phase.'
registerCard('TWI_085', { // Kalani
  ...onAttack(whenPlayed(KALANI_TEXT, (s, ctx) => upToOffer(s, ctx, kalaniSpec, { left: haveInitiative(s, ctx) ? 2 : 1, chosen: [] }))),
  ifYouDo: eachOfUpTo(KALANI_TEXT, 2, kalaniSpec).ifYouDo,
})
registerCard('SEC_110', onAttack(whenPlayed('The next unit you play this phase costs 1 less.', (s, ctx) => grantNextUnit(s, ctx.owner, { costDelta: -1 })))) // GNK Power Droid
/** Every keyword a unit can have: "loses its Keywords (and can't gain keywords)" removes each by name. */
const EVERY_KEYWORD = ['Ambush', 'Bounty', 'Coordinate', 'Exploit', 'Grit', 'Hidden', 'Overwhelm', 'Piloting', 'Plot', 'Raid', 'Restore', 'Saboteur', 'Sentinel', 'Shielded', 'Smuggle', 'Support']
registerCard('SEC_185', unitThenOa('You may choose a ground unit. If you do, it loses its Keywords (and can\'t gain keywords) for this phase.', pickGround, // Screeching TIE Fighter
  'choose a ground unit to lose its keywords for this phase', true, (s, ctx) => addLastingEffect(s, { targetInstanceId: ctx.targetInstanceId!, removeKeywords: EVERY_KEYWORD })))

// A: draw and search
registerCard('LAW_107', onAttack(whenPlayed('Draw a card.', (s, ctx) => drawCards(s, ctx.owner, 1)))) // Swoop Bike Marauder
registerCard('IBH_60', onAttack(whenPlayed('If you control a Aggression unit, draw a card.', (s, ctx) => // Admiral Piett
  (youControl(s, ctx, pickAspect('Aggression')) ? drawCards(s, ctx.owner, 1) : s))))
registerCard('SOR_067', onAttack(whenPlayed('If you control a leader unit, you may draw a card.', (s, ctx) => // Rugged Survivors
  (leaderUnitYouControl(s, ctx) ? pushChoice(s, { kind: 'mayPayToDraw', id: ctx.sourceInstanceId!, controller: ctx.owner, cost: 0, draw: 1 }) : s))))
registerCard('LOF_068', onAttack(searchDrawWp('Search the top 5 cards of your deck for an Item upgrade, reveal it, and draw it.', 5, // Luthen Rael
  c => c?.type === 'upgrade' && printedTrait(c, 'Item'))))
registerCard('JTL_168', onAttack(mayDefeatUpgradeWp('You may defeat an upgrade.'))) // Insurgent Saboteurs
registerCard('TS26_43', onAttack(whenPlayed("An opponent heals 1 damage from their base.", (s, ctx) => healBase(s, opponentOf(ctx.owner), 1)))) // Wartime Refugee

// A: General Grievous. Up to 4 enemy units are simply all of them; past 4 the picks build up in the step.
const GRIEVOUS_TEXT = 'If this unit has 4 or more Lightsaber upgrades attached to him, defeat 4 enemy units.'
const grievousPick = (s: GameState, ctx: Resumable, picks: string[]): GameState => {
  const enemies = s.players[opponentOf(ctx.owner)].units.map(u => u.instanceId)
  if (enemies.length <= 4) return defeatUnits(s, enemies)
  if (picks.length === 4) return defeatUnits(s, picks)
  return unitThen(s, ctx, enemies.filter(id => !picks.includes(id)), `defeat an enemy unit (${picks.length + 1} of 4)`, false, picksStep(picks))
}
registerCard('TWI_034', { // General Grievous
  waivesAspectPenalty: (_s, source, ctx) => ctx.target?.instanceId === source.instanceId && ctx.card.type === 'upgrade' && printedTrait(ctx.card, 'Lightsaber'),
  ...onAttack(whenPlayed(GRIEVOUS_TEXT, (s, ctx) => {
    const lightsabers = selfOf(s, ctx)?.upgrades.filter(up => printedTrait(s.cards[up.cardId], 'Lightsaber')).length ?? 0
    return lightsabers >= 4 ? grievousPick(s, ctx, []) : s
  })),
  ifYouDo: (s, ctx) => grievousPick(s, ctx, [...picksOf(ctx.step), ctx.targetInstanceId!]),
})

// B: the defender, and this attack
registerCard('SHD_183', attacks('Exhaust the defender.', (s, ctx) => { const d = defenderOf(s, ctx); return d ? exhaustUnit(s, d.instanceId) : s })) // Kintan Intimidator
registerCard('SOR_142', { // Sabine Wren
  cannotBeAttacked: (s, u) => !unitHasKeyword(s, u, 'Sentinel')
    && new Set(friendliesOf(s, u).filter(x => x.instanceId !== u.instanceId).flatMap(x => cardOf(s, x)?.aspects ?? [])).size >= 3,
  ...attacks('You may deal 1 damage to the defender or to a base.', (s, ctx) => {
    const d = defenderOf(s, ctx)
    return damageChoice(s, ctx, 1, d ? [d] : [], BOTH_BASES, true)
  }),
})
registerCard('SHD_220', attacks("Deal 1 damage to the defender (if it's a unit) for each different cost among cards in your discard pile.", (s, ctx) => { // Fennec Shand
  const d = defenderOf(s, ctx)
  const costs = new Set(s.players[ctx.owner].discard.map(id => s.cards[id]?.cost ?? 0)).size
  return d && costs > 0 ? dealDamageToUnit(s, d.instanceId, costs) : s
}))
registerCard('SHD_151', attacks('If the defending player controls more resources than you, this unit gets +2/+0 for this attack.', (s, ctx) => // Valiant Assault Ship
  (s.players[opponentOf(ctx.owner)].resources.length > s.players[ctx.owner].resources.length ? forThisAttack(s, ctx.sourceInstanceId!, 2) : s)))
registerCard('SOR_179', attacks("If this unit is attacking an exhausted unit that didn't enter play this round, deal 3 damage to the defender.", (s, ctx) => { // Boba Fett
  // A unit enters play in the action phase, so "this round" is the phase's own record.
  const d = defenderOf(s, ctx)
  return d && d.exhausted && !enteredPlayThisPhase(s, opponentOf(ctx.owner)).includes(d.instanceId) ? dealDamageToUnit(s, d.instanceId, 3) : s
}))
registerCard('JTL_238', attacks('This unit gets +1/+0 for this attack for each damaged unit the defending player controls.', (s, ctx) => { // Sith Trooper
  const n = s.players[opponentOf(ctx.owner)].units.filter(u => u.damage > 0).length
  return n > 0 ? forThisAttack(s, ctx.sourceInstanceId!, n) : s
}))
registerCard('SEC_208', attacks('If the defender is exhausted, it gets -4/-0 for this attack.', (s, ctx) => { // Hunter
  const d = defenderOf(s, ctx)
  return d?.exhausted ? forThisAttack(s, d.instanceId, -4) : s
}))
registerCard('IBH_10', attacks('The defender gets -2/-0 for this attack.', (s, ctx) => { const d = defenderOf(s, ctx); return d ? forThisAttack(s, d.instanceId, -2) : s })) // Han Solo

// C: decks and discard piles
registerCard('LAW_192', onAttack(whenPlayed('Discard a card from your deck.', (s, ctx) => millTop(s, ctx.owner, 1)[0]))) // Bracca Shipbreaker
registerCard('LAW_173', onAttack(whenPlayed("Discard a card from your deck. If it's Aggression, you may deal 1 damage to a ground unit.", (s, ctx) => { // BT-1
  const [next, milled] = millTop(s, ctx.owner, 1)
  return milled.some(id => printedAspect(next.cards[id], 'Aggression')) ? damageChoice(next, ctx, 1, picked(next, ctx, pickGround), [], true) : next
})))
registerCard('LAW_194', onAttack(whenPlayed('Discard 3 cards from your deck. You may return an Underworld card discarded this way to your hand.', (s, ctx) => { // Doctor Aphra
  const [next, milled] = millTop(s, ctx.owner, 3)
  const candidates = milled.filter(id => printedTrait(next.cards[id], 'Underworld'))
  return candidates.length ? pushChoice(next, { kind: 'selectFromDiscard', id: ctx.sourceInstanceId!, controller: ctx.owner, candidates, optional: true }) : next
})))
registerCard('SHD_041', onAttack(whenPlayed('Discard a card from your deck. If it shares an aspect with your base, return it to your hand.', (s, ctx) => { // Kuiil
  const [next, milled] = millTop(s, ctx.owner, 1)
  return milled.length && sharesAspectWithBase(next, ctx.owner, milled[0]) ? returnCardFromDiscardToHand(next, ctx.owner, milled[0]) : next
})))
registerCard('TWI_195', { // Sabine Wren
  cannotBeAttacked: (s, u) => u.exhausted && !unitHasKeyword(s, u, 'Sentinel'),
  ...onAttack(whenPlayed("You may discard a card from your deck. If it doesn't share an aspect with your base, deal 2 damage to a ground unit.", (s, ctx) =>
    (s.players[ctx.owner].deck.length ? pushChoice(s, { kind: 'mayPayThen', id: ctx.sourceInstanceId!, controller: ctx.owner, cost: 0, text: 'discard a card from your deck', then: resume(ctx) }) : s))),
  ifYouDo: (s, ctx) => {
    const [next, milled] = millTop(s, ctx.owner, 1)
    return milled.length && !sharesAspectWithBase(next, ctx.owner, milled[0]) ? damageChoice(next, ctx, 2, picked(next, ctx, pickGround)) : next
  },
})
registerCard('LOF_184', { // Second Sister
  ...onAttack(whenPlayed('You may discard 2 cards from your deck. For each Force card discarded this way, ready a resource.', (s, ctx) =>
    (s.players[ctx.owner].deck.length ? pushChoice(s, { kind: 'mayPayThen', id: ctx.sourceInstanceId!, controller: ctx.owner, cost: 0, text: 'discard 2 cards from your deck', then: resume(ctx) }) : s))),
  ifYouDo: (s, ctx) => {
    const [next, milled] = millTop(s, ctx.owner, 2)
    return milled.filter(id => printedTrait(next.cards[id], 'Force')).reduce(acc => readyResource(acc, ctx.owner), next)
  },
})
registerCard('SOR_047', { // Kanan Jarrus
  ...onAttack(whenPlayed("You may discard 1 card from the defending player's deck for each friendly Spectre unit. Heal 1 damage from your base for each different aspect among the discarded cards.", (s, ctx) => {
    const n = picked(s, ctx, pickAll(pickFriendly, pickTrait('Spectre'))).length
    return n > 0 && s.players[opponentOf(ctx.owner)].deck.length
      ? pushChoice(s, { kind: 'mayPayThen', id: ctx.sourceInstanceId!, controller: ctx.owner, cost: 0, text: `discard ${n} card${n === 1 ? '' : 's'} from the defending player's deck`, then: resume(ctx, String(n)) })
      : s
  })),
  ifYouDo: (s, ctx) => {
    const [next, milled] = millTop(s, opponentOf(ctx.owner), Number(ctx.step))
    const aspects = new Set(milled.flatMap(id => next.cards[id]?.aspects ?? [])).size
    return aspects > 0 ? healBase(next, ctx.owner, aspects) : next
  },
})
registerCard('SOR_188', { // Chopper
  ...gains(another(isTrait('Spectre')), KW.raid(1)),
  ...onAttack(whenPlayed("Discard a card from the defending player's deck. If it's an event, exhaust a resource that player controls.", (s, ctx) => {
    const [next, milled] = millTop(s, opponentOf(ctx.owner), 1)
    return milled.some(id => next.cards[id]?.type === 'event') ? exhaustReadyResource(next, opponentOf(ctx.owner)) : next
  })),
})
registerCard('LAW_174', { // 0-0-0
  ...onAttack(whenPlayed('You may put an Aggression card from your discard pile on the bottom of your deck. If you do, deal 1 damage to each enemy base.', (s, ctx) => {
    const candidates = s.players[ctx.owner].discard.filter(id => printedAspect(s.cards[id], 'Aggression'))
    return candidates.length ? cardThen(s, ctx, candidates, 'put an Aggression card from your discard pile on the bottom of your deck', true, 'bottom') : s
  })),
  ifYouDo: (s, ctx) => (ctx.cardChosen ? dealDamageToBase(discardToDeckBottom(s, ctx.owner, [ctx.cardChosen]), opponentOf(ctx.owner), 1) : s),
})
registerCard('LAW_163', { // The Sarlacc of Carkoon
  ...onAttack(whenPlayed("Put a unit from your discard pile on the bottom of your deck. Deal damage equal to that unit's power to an enemy ground unit.", (s, ctx) => {
    const candidates = s.players[ctx.owner].discard.filter(id => printedUnit(s.cards[id]))
    return candidates.length ? cardThen(s, ctx, candidates, 'put a unit from your discard pile on the bottom of your deck', false, 'bottom') : s
  })),
  ifYouDo: (s, ctx) => {
    const next = discardToDeckBottom(s, ctx.owner, [ctx.cardChosen!])
    const power = s.cards[ctx.cardChosen!]?.power ?? 0
    return power > 0 ? damageChoice(next, ctx, power, picked(next, ctx, enemyGroundUnit)) : next
  },
})

// D: if you do
registerCard('SOR_131', { // Fifth Brother
  conditionalKeywords: (_s, u) => (u.damage > 0 ? [KW.raid(u.damage)] : []),
  ...unitThenOa('You may deal 1 damage to this unit and 1 damage to another ground unit.', pickAll(pickGround, pickOther), 'deal 1 damage to this unit and to another ground unit', true,
    (s, ctx) => dealDamageToUnit(dealDamageToUnit(s, ctx.sourceInstanceId!, 1), ctx.targetInstanceId!, 1)),
})
registerCard('LAW_048', { // Chio Fain
  // With two players, the only 2 players to choose are both of them.
  ...onAttack(whenPlayed('You may choose 2 players. If you do, they each draw a card.', (s, ctx) =>
    pushChoice(s, { kind: 'mayPayThen', id: ctx.sourceInstanceId!, controller: ctx.owner, cost: 0, text: 'have each player draw a card', then: resume(ctx) }))),
  ifYouDo: (s, ctx) => drawCards(drawCards(s, ctx.owner, 1), opponentOf(ctx.owner), 1),
})
registerCard('SEC_162', unitThenOa("You may deal 1 damage to another friendly unit. If you do, deal 2 damage to the defending player's base.", pickAll(pickFriendly, pickOther), // Crosshair
  'deal 1 damage to another friendly unit', true, (s, ctx) => dealDamageToBase(dealDamageToUnit(s, ctx.targetInstanceId!, 1), opponentOf(ctx.owner), 2)))
/** "You may discard a card from your hand. If you do, <then>", as a When Played; `onAttack` retargets it. */
const mayDiscardThen = (description: string, then: NonNullable<CardDefinition['ifYouDo']>): CardDefinition => ({
  ...whenPlayed(description, (s, ctx) =>
    (s.players[ctx.owner].hand.length ? pushChoice(s, { kind: 'selectDiscard', id: ctx.sourceInstanceId!, controller: ctx.owner, count: 1, optional: true, then: { ifYouDo: resume(ctx) } }) : s)),
  ifYouDo: then,
})
registerCard('SEC_197', onAttack(mayDiscardThen('You may discard a card from your hand. If you do, draw a card.', (s, ctx) => drawCards(s, ctx.owner, 1)))) // Furtive Handmaiden
registerCard('LOF_160', onAttack(mayDiscardThen('You may discard a card from your hand. If you do, deal 2 damage to a unit.', (s, ctx) => damageChoice(s, ctx, 2, picked(s, ctx, pickAny))))) // Merrin
registerCard('TWI_035', unitThenOa('You may defeat another friendly unit. If you do, draw a card.', pickAll(pickFriendly, pickOther), 'defeat another friendly unit', true, // Morgan Elsbeth
  (s, ctx) => drawCards(defeatUnit(s, ctx.targetInstanceId!), ctx.owner, 1)))
registerCard('SHD_118', unitThenOa('You may exhaust another friendly unit. If you do, this unit gets +3/+0 for this attack.', pickAll(pickFriendly, pickOther, (_s, u) => !u.exhausted), // Kihrazx Heavy Fighter
  'exhaust another friendly unit', true, (s, ctx) => forThisAttack(exhaustUnit(s, ctx.targetInstanceId!), ctx.sourceInstanceId!, 3)))
registerCard('SOR_206', onAttack(mayPayWp('You may pay 2. If you do, draw a card.', 2, 'pay 2 to draw a card', (s, ctx) => drawCards(s, ctx.owner, 1)))) // Mining Guild TIE Fighter
registerCard('TWI_179', { // Soulless One
  // A deployed General Grievous is a unit, so only an undeployed one is offered as the leader.
  ...onAttack(whenPlayed('You may exhaust a friendly Droid unit or General Grievous (leader or unit). If you do, this unit gets +2/+0 for this attack.', (s, ctx) => {
    const leader = s.players[ctx.owner].leader
    const units = pickedIds(s, ctx, soullessUnit)
    if (!leader.deployed && !leader.exhausted && s.cards[leader.cardId]?.name === 'General Grievous') {
      return pushChoice(s, { kind: 'mayPayThen', id: ctx.sourceInstanceId!, controller: ctx.owner, cost: 0, text: 'exhaust General Grievous (leader)', then: resume(ctx, 'leader'), ...(units.length ? { declineStep: 'units' } : {}) })
    }
    return unitThen(s, ctx, units, 'exhaust a friendly Droid unit or General Grievous', true, 'unit')
  })),
  ifYouDo: (s, ctx) => {
    if (ctx.step === 'units') return unitThen(s, ctx, pickedIds(s, ctx, soullessUnit), 'exhaust a friendly Droid unit or General Grievous', true, 'unit')
    const paid = ctx.step === 'leader'
      ? updatePlayer(s, ctx.owner, { leader: { ...s.players[ctx.owner].leader, exhausted: true } })
      : exhaustUnit(s, ctx.targetInstanceId!)
    return forThisAttack(paid, ctx.sourceInstanceId!, 2)
  },
})
function soullessUnit(s: GameState, u: UnitState, ctx: EventCtx): boolean {
  return pickFriendly(s, u, ctx) && !u.exhausted && (unitHasTrait(s, u, 'Droid') || cardOf(s, u)?.name === 'General Grievous')
}
registerCard('SEC_220', { // Hired Slicer
  ...onAttack(whenPlayed('Reveal the top 2 cards of a deck. If you do, you may exhaust a unit that shares a Trait with one of those cards. Put those cards on the bottom of that deck in a random order.', (s, ctx) =>
    choosePlayer(s, ctx, 'reveal the top 2 cards of the deck of', 'deck'))),
  ifYouDo: (s, ctx) => {
    if (ctx.step === 'exhaust') return exhaustUnit(s, ctx.targetInstanceId!)
    const who = ctx.playerChosen!
    const deck = s.players[who].deck
    const revealed = deck.slice(0, 2)
    if (revealed.length === 0) return s
    // The cards go under the deck straight away: exhausting a unit cannot change where they end up.
    const bottomed = { ...updatePlayer(s, who, { deck: [...deck.slice(2), ...seededShuffle(revealed, s.rngSeed)] }), rngSeed: nextSeed(s.rngSeed) }
    const traits = revealed.flatMap(id => s.cards[id]?.traits ?? [])
    const names = revealed.map(id => s.cards[id]?.name ?? id).join(', ')
    return unitThen(bottomed, ctx, pickedIds(bottomed, ctx, (st, u) => traits.some(t => unitHasTrait(st, u, t))), `revealed ${names}: you may exhaust a unit that shares a Trait with one of them`, true, 'exhaust')
  },
})
registerCard('SHD_046', { // Rey
  ignoresOwnAspectPenalty: (s, p) => (playerControlsNamed(s, p, 'Kylo Ren') ? ['Heroism'] : []),
  ...unitThenOa("You may heal 2 damage from a unit. If it's a non-Heroism unit, give a Shield token to it.", pickAny, 'heal 2 damage from a unit', true, (s, ctx) => {
    const healed = healUnit(s, ctx.targetInstanceId!, 2)
    const u = findUnit(healed, ctx.targetInstanceId!)?.unit
    return u && !printedAspect(cardOf(healed, u), 'Heroism') ? giveToken(healed, u.instanceId, TOKEN_SHIELD) : healed
  }),
})
const DRYDEN_KEY = 'SEC_137#noReady'
registerCard('SEC_137', { // Dryden Vos
  ...onAttack(whenPlayed("You may double this unit's power for this attack. If you do, this unit doesn't ready during the next regroup phase.", (s, ctx) =>
    pushChoice(s, { kind: 'mayPayThen', id: ctx.sourceInstanceId!, controller: ctx.owner, cost: 0, text: "double this unit's power for this attack", then: resume(ctx) }))),
  ifYouDo: (s, ctx) => markAbilityUsed(forThisAttack(s, ctx.sourceInstanceId!, attackingPower(s, ctx)), ctx.owner, ctx.sourceInstanceId!, DRYDEN_KEY),
  // The mark is cleared as the regroup phase readies units, so it holds for exactly the next one.
  readiesInRegroup: (_s, u) => !(u.usedAbilities ?? []).includes(DRYDEN_KEY),
})
const GRANT_DEFIANT_HAMMERHEAD = 'GRANT_DEFIANT_HAMMERHEAD'
registerCard(GRANT_DEFIANT_HAMMERHEAD, {
  sourceCardId: 'LAW_062',
  abilities: [{ trigger: 'onAttackEnd', description: 'Defeat this unit after completing this attack.', effect: (s, ctx) => defeatUnit(s, ctx.sourceInstanceId!) }],
})
registerCard('LAW_062', { // Defiant Hammerhead
  ...attacks('If this unit is attacking a unit, you may give this unit +4/+0 for this attack. If you do, defeat this unit after completing this attack.', (s, ctx) =>
    (ctx.attackTarget?.kind === 'unit'
      ? pushChoice(s, { kind: 'mayPayThen', id: ctx.sourceInstanceId!, controller: ctx.owner, cost: 0, text: 'give this unit +4/+0 for this attack, and defeat it after the attack', then: resume(ctx) })
      : s)),
  // The defeat rides on the attack as a granted "when this attack ends", so it goes when the attack's other grants do.
  ifYouDo: (s, ctx) => addLastingEffect(s, { targetInstanceId: ctx.sourceInstanceId!, power: 4, untilEndOfAttack: true, abilityCardIds: [GRANT_DEFIANT_HAMMERHEAD] }),
})

// E: an opponent chooses, or each player
registerCard('TS26_66', onAttack(whenPlayed('An opponent deals 1 damage to a unit.', (s, ctx) => // Wartime Pirate
  damageChoice(s, { ...ctx, owner: opponentOf(ctx.owner) }, 1, allUnits(s)))))
registerCard('TS26_29', { // Ziton Moj
  ...onAttack(whenPlayed('For each player, deal 1 damage to a unit that player controls.', (s, ctx) =>
    unitThen(s, ctx, pickedIds(s, ctx, pickFriendly), 'deal 1 damage to a unit you control', false, 'mine'))),
  ifYouDo: (s, ctx) => {
    const next = dealDamageToUnit(s, ctx.targetInstanceId!, 1)
    return ctx.step === 'mine' ? unitThen(next, ctx, pickedIds(next, ctx, pickEnemy), 'deal 1 damage to a unit an opponent controls', false, 'theirs') : next
  },
})
registerCard('SEC_218', { // Cikatro Vizago
  ...onAttack(whenPlayed("Reveal the top card of your deck. An opponent may pay 1. If they don't, draw that card.", (s, ctx) => {
    const top = s.players[ctx.owner].deck[0]
    if (top === undefined) return s
    const opp = opponentOf(ctx.owner)
    if (!canAfford(s.players[opp], 1)) return drawCards(s, ctx.owner, 1)
    return pushChoice(s, { kind: 'mayPayThen', id: ctx.sourceInstanceId!, controller: opp, cost: 1, text: `pay 1 to stop your opponent drawing ${s.cards[top]?.name ?? top}`, then: resume(ctx, 'paid'), declineStep: 'draw' })
  })),
  ifYouDo: (s, ctx) => (ctx.step === 'draw' ? drawCards(s, ctx.owner, 1) : s),
})
registerCard('LAW_216', { // Jabba's Rancor
  ...onAttack(whenPlayed('An opponent chooses a ground unit they control. You may deal 7 damage to that unit.', (s, ctx) => {
    const opp = opponentOf(ctx.owner)
    const targets = s.players[opp].units.filter(u => u.arena === 'ground').map(u => u.instanceId)
    return targets.length ? pushChoice(s, { kind: 'selectUnitThen', id: `${ctx.sourceInstanceId}-theirs`, controller: opp, targets, text: 'choose a ground unit you control', then: resume(ctx, 'chosen') }) : s
  })),
  ifYouDo: (s, ctx) => (ctx.step === 'chosen'
    ? pushChoice(s, { kind: 'mayPayThen', id: ctx.sourceInstanceId!, controller: ctx.owner, cost: 0, text: 'deal 7 damage to the chosen unit', then: resume(ctx, 'deal', ctx.targetInstanceId) })
    : dealDamageToUnit(s, ctx.unitChosen!, 7)),
})
registerCard('SHD_246', { // Grey Squadron Y-Wing
  // The opponent picks from their units' cards and their base's card; the step lists what each option is.
  ...onAttack(whenPlayed('An opponent chooses a unit or base they control. You may deal 2 damage to it.', (s, ctx) => {
    const opp = opponentOf(ctx.owner)
    const units = s.players[opp].units
    const options = [...units.map(u => u.instanceId), 'base']
    return pushChoice(s, {
      kind: 'selectCardThen', id: `${ctx.sourceInstanceId}-theirs`, controller: opp, candidates: [...units.map(u => u.cardId), s.players[opp].base.cardId],
      text: 'choose a unit or base you control', then: resume(ctx, `options:${options.join(',')}`),
    })
  })),
  ifYouDo: (s, ctx) => {
    if (ctx.step === 'hit') return ctx.unitChosen === 'base' ? dealDamageToBase(s, opponentOf(ctx.owner), 2) : dealDamageToUnit(s, ctx.unitChosen!, 2)
    const chosen = splitStep(ctx.step, 'options:')[ctx.optionIndex ?? -1]
    return chosen ? pushChoice(s, { kind: 'mayPayThen', id: ctx.sourceInstanceId!, controller: ctx.owner, cost: 0, text: 'deal 2 damage to the chosen unit or base', then: resume(ctx, 'hit', chosen) }) : s
  },
})

// F: needed a small engine addition
registerCard('LAW_051', onAttack(whenPlayed("Draw a card. You may deal damage to a ground unit equal to the number of cards you've drawn this phase.", (s, ctx) => { // Beilert Valance
  const next = drawCards(s, ctx.owner, 1)
  const n = cardsDrawnThisPhase(next, ctx.owner)
  return n > 0 ? damageChoice(next, ctx, n, picked(next, ctx, pickGround), [], true) : next
})))
registerCard('LAW_197', onAttack(whenPlayed("Bases can't be healed for this phase.", s => ({ ...s, basesUnhealable: true })))) // Shifty Suspects
registerCard('LOF_204', { // Zuckuss
  ...onAttack(whenPlayed("Name a card, then discard the top card of the defending player's deck. If a card with that name is discarded, this unit gets +4/+0 for this attack.", (s, ctx) =>
    pushChoice(s, { kind: 'nameCard', id: ctx.sourceInstanceId!, controller: ctx.owner, unitId: ctx.sourceInstanceId!, then: resume(ctx) }))),
  ifYouDo: (s, ctx) => {
    const [next, milled] = millTop(s, opponentOf(ctx.owner), 1)
    return milled.some(id => next.cards[id]?.name === ctx.nameChosen) ? forThisAttack(next, ctx.sourceInstanceId!, 4) : next
  },
})
registerCard('SOR_185', { // Chimaera
  // The reveal is information only: the discard it leads to is the whole effect.
  ...onAttack(whenPlayed('Name a card. An opponent reveals their hand and discards a card with that name from it.', (s, ctx) =>
    pushChoice(s, { kind: 'nameCard', id: ctx.sourceInstanceId!, controller: ctx.owner, unitId: ctx.sourceInstanceId!, then: resume(ctx) }))),
  ifYouDo: (s, ctx) => {
    const opp = opponentOf(ctx.owner)
    const at = s.players[opp].hand.findIndex(id => s.cards[id]?.name === ctx.nameChosen)
    return at === -1 ? s : discardFromHand(s, opp, at)
  },
})

// ── Leaders from the other sealed sets ──────────────────────────────────────────────────────────────
// Both sides of each leader. The front is an undeployed leader's action (using it exhausts the leader),
// built on the When Played helpers: it is handed the same context, with a source that names the leader
// side rather than a unit, so "another unit" excludes nothing and a choice still has a stable id. The
// back is the deployed leader unit, registered like any other unit. A card whose front and back both
// resume after a choice tell the two apart by `step`.

/** The source an undeployed leader's action hands its effect: the leader side, not a unit in play. */
const leaderSide = (cardId: string): string => `${cardId}-leader`
interface FrontSpec {
  /** The action's "C=N". */
  cost?: number
  /** Offered only while this holds, so the action is never used for nothing. */
  usable?: When
  effect: (s: GameState, ctx: Resumable) => GameState
}
/** "Action [Exhaust]: <effect>" on an undeployed leader. */
const leaderFront = (description: string, spec: FrontSpec): CardDefinition => ({
  leaderAbilities: {
    actions: [{
      description,
      ...(spec.cost ? { cost: spec.cost } : {}),
      usable: (s, owner) => spec.usable?.(s, { owner }) ?? true,
      effect: (s, ctx) => spec.effect(s, { owner: ctx.owner, cardId: ctx.cardId, sourceInstanceId: leaderSide(ctx.cardId) }),
    }],
  },
})
/** Some unit passes `test`, read as the leader's controller would. */
const anyUnitPasses = (test: Pick): When => (s, ctx) => picked(s, ctx, test).length > 0
/** "If you played a <card> this phase". */
const playedCardThisPhase = (test: (c: EngineCard | undefined) => boolean): When => (s, ctx) =>
  cardsPlayedThisPhase(s, ctx.owner).some(id => test(s.cards[id]))
/** "If you attacked with a <unit> this phase", read off the units still in play; the source itself is left out ("another"). */
const attackedWithThisPhase = (test: Pick): When => (s, ctx) =>
  attackedThisPhase(s).some(id => {
    const found = findUnit(s, id)
    return found !== undefined && found.owner === ctx.owner && id !== ctx.sourceInstanceId && test(s, found.unit, ctx)
  })
const enemyWasDefeated: When = (s, ctx) => defeatedThisPhase(s, opponentOf(ctx.owner)).length > 0
const friendlyTraitDefeated = (trait: string): When => (s, ctx) => defeatedThisPhase(s, ctx.owner).some(id => printedTrait(s.cards[id], trait))
const both = (...tests: When[]): When => (s, ctx) => tests.every(t => t(s, ctx))
const handOf = (s: GameState, u: UnitState): number => { const o = unitOwner(s, u); return o ? s.players[o].hand.length : 0 }
const selectUpgradeThen = (s: GameState, ctx: Resumable, candidates: UpgradeRef[], text: string, optional: boolean, step?: string): GameState =>
  candidates.length ? pushChoice(s, { kind: 'selectUpgradeThen', id: ctx.sourceInstanceId!, controller: ctx.owner, candidates, text, then: resume(ctx, step), ...mayFlag(optional) }) : s

// A: simple fronts, On Attack and constant backs
registerCard('SOR_014', allOf( // Sabine Wren
  leaderFront('Deal 1 damage to each base.', { effect: s => BOTH_BASES.reduce((acc, p) => dealDamageToBase(acc, p, 1), s) }),
  attacks('Deal 1 damage to each enemy base.', (s, ctx) => dealDamageToBase(s, opponentOf(ctx.owner), 1)),
))
registerCard('IBH_53', allOf( // Darth Vader
  leaderFront('Deal 1 damage to a base.', { cost: 1, effect: (s, ctx) => damageChoice(s, ctx, 1, [], BOTH_BASES) }),
  attacks('Deal 2 damage to a base.', (s, ctx) => damageChoice(s, ctx, 2, [], BOTH_BASES)),
))
const damagedFriendly = pickAll(pickFriendly, damaged)
registerCard('IBH_1', { // Leia Organa
  ...leaderFront('Heal 1 damage from a friendly unit.', {
    cost: 1,
    usable: anyUnitPasses(damagedFriendly),
    effect: (s, ctx) => healChoice(s, ctx, 1, pickedIds(s, ctx, damagedFriendly), []),
  }),
  ...attacks('Heal 1 damage from a friendly unit and 1 damage from another friendly unit.', (s, ctx) =>
    unitThen(s, ctx, pickedIds(s, ctx, damagedFriendly), 'heal 1 damage from a friendly unit', false)),
  ifYouDo: (s, ctx) => {
    const healed = healUnit(s, ctx.targetInstanceId!, 1)
    return healChoice(healed, ctx, 1, pickedIds(healed, ctx, damagedFriendly).filter(id => id !== ctx.targetInstanceId), [])
  },
})
registerCard('SOR_010', allOf( // Darth Vader
  leaderFront('If you played a Villainy card this phase, deal 1 damage to a unit and 1 damage to a base.', {
    cost: 1,
    usable: playedCardThisPhase(c => printedAspect(c, 'Villainy')),
    effect: (s, ctx) => damageChoice(damageChoice(s, ctx, 1, allUnits(s)), ctx, 1, [], BOTH_BASES),
  }),
  onAttack(damageWp('You may deal 2 damage to a unit.', pickAny, 2, true)),
))
/** A friendly non-leader, non-token unit that entered play this phase: one "you played". */
const playedUnitThisPhase: Pick = (s, u, ctx) =>
  enteredPlayThisPhase(s, ctx.owner).includes(u.instanceId) && !isLeaderUnit(s, u) && !isTokenCard(u.cardId)
const heroismPlayed = pickAll(pickFriendly, playedUnitThisPhase, pickAspect('Heroism'))
registerCard('SOR_005', allOf( // Luke Skywalker
  leaderFront('Give a Shield token to a Heroism unit you played this phase.', {
    cost: 1,
    usable: anyUnitPasses(heroismPlayed),
    effect: (s, ctx) => shieldChoice(s, ctx, pickedIds(s, ctx, heroismPlayed), false),
  }),
  attacks('You may give another unit a Shield token.', (s, ctx) => shieldChoice(s, ctx, pickedIds(s, ctx, pickOther), true)),
))
const resistanceOrUpgrade: Pick = (s, u) => unitHasTrait(s, u, 'Resistance') || u.upgrades.some(up => printedTrait(s.cards[up.cardId], 'Resistance'))
registerCard('JTL_007', allOf( // Admiral Holdo
  leaderFront('Give a Resistance unit or a unit with a Resistance upgrade on it +2/+2 for this phase.', {
    cost: 1,
    usable: anyUnitPasses(resistanceOrUpgrade),
    effect: (s, ctx) => lastingBuffChoice(s, ctx, pickedIds(s, ctx, resistanceOrUpgrade), { power: 2, hp: 2 }),
  }),
  onAttack(buffWp('You may give another Resistance unit or a unit with a Resistance upgrade on it +2/+2 for this phase.',
    pickAll(pickOther, resistanceOrUpgrade), () => ({ power: 2, hp: 2 }), true)),
))
const damagedVehicle = pickAll(pickTrait('Vehicle'), damaged)
const attackedThisPhasePick: Pick = (s, u) => attackedThisPhase(s).includes(u.instanceId)
registerCard('JTL_004', allOf( // Rose Tico
  leaderFront('Heal 2 damage from a Vehicle unit that attacked this phase.', {
    usable: anyUnitPasses(pickAll(damagedVehicle, attackedThisPhasePick)),
    effect: (s, ctx) => healChoice(s, ctx, 2, pickedIds(s, ctx, pickAll(damagedVehicle, attackedThisPhasePick)), []),
  }),
  attacks('You may heal 2 damage from a Vehicle unit.', (s, ctx) => healChoice(s, ctx, 2, pickedIds(s, ctx, damagedVehicle), [], true)),
))
registerCard('TWI_015', allOf( // General Grievous
  leaderFront('Give a Droid unit Sentinel for this phase.', {
    usable: anyUnitPasses(pickTrait('Droid')),
    effect: (s, ctx) => lastingBuffChoice(s, ctx, pickedIds(s, ctx, pickTrait('Droid')), { keywords: [KW.sentinel] }),
  }),
  onAttack(buffWp('You may give a Droid unit +1/+0 and Sentinel for this phase.', pickTrait('Droid'), () => ({ power: 1, keywords: [KW.sentinel] }), true)),
))
registerCard('TWI_006', allOf( // Wat Tambor
  leaderFront('If a friendly unit was defeated this phase, give a unit +2/+2 for this phase.', {
    usable: both(friendlyWasDefeated, anyUnitPasses(pickAny)),
    effect: (s, ctx) => lastingBuffChoice(s, ctx, pickedIds(s, ctx, pickAny), { power: 2, hp: 2 }),
  }),
  onAttack(buffWp('If a friendly unit was defeated this phase, you may give another unit +2/+2 for this phase.', pickOther, () => ({ power: 2, hp: 2 }), true, friendlyWasDefeated)),
))
registerCard('TWI_003', allOf( // Obi-Wan Kenobi
  leaderFront('Heal 1 damage from a unit.', {
    usable: anyUnitPasses(damaged),
    effect: (s, ctx) => healChoice(s, ctx, 1, pickedIds(s, ctx, damaged), []),
  }),
  onAttack(unitThenWp('Heal 1 damage from a unit. If you do, deal 1 damage to a different unit.', damaged, 'heal 1 damage from a unit', false, (s, ctx) => {
    const healed = healUnit(s, ctx.targetInstanceId!, 1)
    return damageChoice(healed, ctx, 1, allUnits(healed).filter(u => u.instanceId !== ctx.targetInstanceId))
  })),
))
const readyUnitPick: Pick = (_s, u) => !u.exhausted
const exhaustedPick: Pick = (_s, u) => u.exhausted
registerCard('SEC_015', allOf( // C-3PO
  leaderFront('If you control an exhausted unit, exhaust a unit.', {
    cost: 1,
    usable: (s, ctx) => youControl(s, ctx, exhaustedPick) && anyUnitPasses(readyUnitPick)(s, ctx),
    effect: (s, ctx) => targetChoice(s, ctx, 'mayExhaustUnit', pickedIds(s, ctx, readyUnitPick)),
  }),
  onAttack(targetWp('If you control another exhausted unit, you may exhaust a unit.', 'mayExhaustUnit', readyUnitPick, true,
    (s, ctx) => youControl(s, ctx, pickOther, exhaustedPick))),
))
const lowPowerFriendly = pickAll(pickFriendly, (s, u) => effectivePower(s, u) <= 3)
const damageAndReady = (s: GameState, ctx: EventCtx, amount: number, targets: string[], optional: boolean): GameState =>
  targets.length
    ? pushChoice(s, { kind: 'selectDamageTarget', id: ctx.sourceInstanceId!, controller: ctx.owner, amount, unitTargets: targets, baseTargets: [], thenReadyIt: true, ...mayFlag(optional) })
    : s
registerCard('SOR_011', allOf( // Grand Inquisitor
  leaderFront('Deal 2 damage to a friendly unit with 3 or less power and ready it.', {
    usable: anyUnitPasses(lowPowerFriendly),
    effect: (s, ctx) => damageAndReady(s, ctx, 2, pickedIds(s, ctx, lowPowerFriendly), false),
  }),
  attacks('You may deal 1 damage to another friendly unit with 3 or less power and ready it.', (s, ctx) =>
    damageAndReady(s, ctx, 1, pickedIds(s, ctx, pickAll(pickOther, lowPowerFriendly)), true)),
))
registerCard('SHD_003', { // Finn
  ...leaderFront('Defeat a friendly upgrade on a unit. If you do, give a Shield token to that unit.', {
    usable: (s, ctx) => friendlyUpgradeCandidates(s, ctx.owner, 'unit').length > 0,
    effect: (s, ctx) => selectUpgradeThen(s, ctx, friendlyUpgradeCandidates(s, ctx.owner, 'unit'), 'defeat a friendly upgrade and shield its unit', false),
  }),
  ...attacks('You may defeat a friendly upgrade on a unit. If you do, give a Shield token to that unit.', (s, ctx) =>
    selectUpgradeThen(s, ctx, friendlyUpgradeCandidates(s, ctx.owner, 'unit'), 'defeat a friendly upgrade and shield its unit', true)),
  ifYouDo: (s, ctx) => {
    const up = ctx.upgradeChosen
    if (!up) return s
    const defeated = defeatUpgradeAt(s, up.unitId, up.upgradeIndex)
    return findUnit(defeated, up.unitId) ? giveToken(defeated, up.unitId, TOKEN_SHIELD) : defeated
  },
})
const mandalorianAttacked = attackedWithThisPhase(pickTrait('Mandalorian'))
registerCard('SHD_012', { // Bo-Katan Kryze
  ...leaderFront('If you attacked with a Mandalorian unit this phase, deal 1 damage to a unit.', {
    usable: both(mandalorianAttacked, anyUnitPasses(pickAny)),
    effect: (s, ctx) => damageChoice(s, ctx, 1, allUnits(s)),
  }),
  // The second damage is offered whether or not the first was taken, so the first resumes on a decline too.
  ...attacks('You may deal 1 damage to a unit. If you attacked with another Mandalorian unit this phase, you may deal 1 damage to a unit.', (s, ctx) =>
    (allUnits(s).length ? pushChoice(s, { kind: 'selectUnitThen', id: ctx.sourceInstanceId!, controller: ctx.owner, targets: pickedIds(s, ctx, pickAny), optional: true, hookOnDecline: true, text: 'deal 1 damage to a unit', then: resume(ctx, 'first') }) : s)),
  ifYouDo: (s, ctx) => {
    const hit = ctx.targetInstanceId ? dealDamageToUnit(s, ctx.targetInstanceId, 1) : s
    return ctx.step === 'first' && mandalorianAttacked(hit, ctx) ? unitThen(hit, ctx, pickedIds(hit, ctx, pickAny), 'deal 1 damage to a unit', true, 'second') : hit
  },
})
const firstOrderPlayed = playedCardThisPhase(c => printedTrait(c, 'First Order'))
registerCard('JTL_010', { // Captain Phasma
  ...leaderFront('If you played a First Order card this phase, deal 1 damage to a base.', {
    usable: firstOrderPlayed,
    effect: (s, ctx) => damageChoice(s, ctx, 1, [], BOTH_BASES),
  }),
  ...attacks('If you played another First Order card this phase, you may deal 1 damage to a unit. If you do, deal 1 damage to a base.', (s, ctx) =>
    (firstOrderPlayed(s, ctx) ? unitThen(s, ctx, pickedIds(s, ctx, pickAny), 'deal 1 damage to a unit, then 1 damage to a base', true) : s)),
  ifYouDo: (s, ctx) => damageChoice(dealDamageToUnit(s, ctx.targetInstanceId!, 1), ctx, 1, [], BOTH_BASES),
})
registerCard('LOF_011', { // Kit Fisto
  ...leaderFront('If you attacked with a Jedi unit this phase, deal 2 damage to a unit.', {
    cost: 1,
    usable: both(attackedWithThisPhase(pickTrait('Jedi')), anyUnitPasses(pickAny)),
    effect: (s, ctx) => damageChoice(s, ctx, 2, allUnits(s)),
  }),
  statModifier: (s, u) => perEach(friendliesOf(s, u).filter(x => x.instanceId !== u.instanceId && unitHasTrait(s, x, 'Jedi')).length, 1),
})
const rebelDefeated = friendlyTraitDefeated('Rebel')
registerCard('LAW_005', allOf( // Jyn Erso
  leaderFront('If a friendly Rebel unit was defeated this phase, search the top 3 cards of your deck for a card and draw it.', {
    cost: 1,
    usable: both(rebelDefeated, (s, ctx) => s.players[ctx.owner].deck.length > 0),
    effect: (s, ctx) => searchDrawChoice(s, ctx, 3, () => true),
  }),
  attacks('If a friendly Rebel unit was defeated this phase, search the top 3 cards of your deck for a card and draw it.', (s, ctx) =>
    (rebelDefeated(s, ctx) ? searchDrawChoice(s, ctx, 3, () => true) : s)),
))
registerCard('SOR_002', { // Iden Versio
  ...leaderFront('If an enemy unit was defeated this phase, heal 1 damage from your base.', {
    usable: enemyWasDefeated,
    effect: (s, ctx) => healBase(s, ctx.owner, 1),
  }),
  abilities: [{ trigger: 'whenEnemyUnitDefeated', description: 'Heal 1 damage from your base.', effect: (s, ctx) => healBase(s, ctx.owner, 1) }],
})
registerCard('SHD_011', { // Kylo Ren
  ...leaderFront('[Discard a card from your hand]: Give a unit +2/+0 for this phase.', {
    usable: (s, ctx) => s.players[ctx.owner].hand.length > 0 && allUnits(s).length > 0,
    effect: (s, ctx) => discards(s, ctx.owner, 1, ctx.sourceInstanceId!, resume(ctx)),
  }),
  ifYouDo: (s, ctx) => lastingBuffChoice(s, ctx, pickedIds(s, ctx, pickAny), { power: 2 }),
  statModifier: (s, u) => perEach(handOf(s, u), -1),
})
registerCard('LAW_012', allOf( // Sebulba
  leaderFront('[Discard a card from your deck]: A friendly unit gains Raid 1 for this phase.', {
    usable: (s, ctx) => s.players[ctx.owner].deck.length > 0 && youControl(s, ctx),
    effect: (s, ctx) => {
      const [next] = millTop(s, ctx.owner, 1)
      return lastingBuffChoice(next, ctx, pickedIds(next, ctx, pickFriendly), { keywords: [KW.raid(1)] })
    },
  }),
  attacks('Discard a card from your deck.', (s, ctx) => millTop(s, ctx.owner, 1)[0]),
))
const creatureOrSpectre: Pick = (s, u) => unitHasTrait(s, u, 'Creature') || unitHasTrait(s, u, 'Spectre')
registerCard('LOF_004', { // Kanan Jarrus
  ...leaderFront('Give a Shield token to a Creature or Spectre unit.', {
    cost: 1,
    usable: anyUnitPasses(creatureOrSpectre),
    effect: (s, ctx) => shieldChoice(s, ctx, pickedIds(s, ctx, creatureOrSpectre), false),
  }),
  statModifier: (s, u) => (controlsAnother(s, u, (st, x) => creatureOrSpectre(st, x, asCtx(st, x))) ? { power: 2, hp: 2 } : {}),
})
registerCard('TWI_010', { // Pre Vizsla
  ...leaderFront("Deal damage to a unit equal to the number of cards you've drawn this phase.", {
    cost: 1,
    usable: (s, ctx) => cardsDrawnThisPhase(s, ctx.owner) > 0 && allUnits(s).length > 0,
    effect: (s, ctx) => damageChoice(s, ctx, cardsDrawnThisPhase(s, ctx.owner), allUnits(s)),
  }),
  ...gains((s, u) => handOf(s, u) >= 3, KW.saboteur),
  statModifier: (s, u) => (handOf(s, u) >= 6 ? { power: 2 } : {}),
})

// B: attack with a unit, and units entering play
/** "Attack with a unit" on a leader's front, offered only while that attack can be made. `before` is a cost paid first. */
const leaderAttack = (description: string, offer: (s: GameState, ctx: EventCtx) => AttackOffer, o: { cost?: number; usable?: When; before?: (s: GameState, ctx: EventCtx) => GameState } = {}): CardDefinition =>
  leaderFront(description, {
    ...(o.cost ? { cost: o.cost } : {}),
    usable: (s, ctx) => (o.usable?.(s, ctx) ?? true) && actionAttack(ctx.owner, s, offer(s, ctx)),
    effect: (s, ctx) => {
      const paid = o.before ? o.before(s, ctx) : s
      return offerAttack(paid, ctx.owner, `${ctx.sourceInstanceId}-attack`, offer(paid, ctx))
    },
  })
/** "If it's attacking a unit, it gets +N/+0 for this attack." */
const attackingAUnitBonus = (power: number): CardDefinition => ({ statModifier: (_s, _u, ctx) => (ctx.attacking && !ctx.attackingBase ? { power } : {}) })
const eventPlayed = playedCardThisPhase(c => c?.type === 'event')

const GRANT_ANAKIN_LEADER = 'GRANT_ANAKIN_LEADER'
registerCard(GRANT_ANAKIN_LEADER, { sourceCardId: 'TWI_012', ...attackingAUnitBonus(2) })
registerCard('TWI_012', { // Anakin Skywalker
  ...leaderAttack('[Deal 2 damage to your base]: Attack with a unit. If it’s attacking a unit, it gets +2/+0 for this attack.', () => ({ grantCardId: GRANT_ANAKIN_LEADER }),
    { before: (s, ctx) => dealDamageToBase(s, ctx.owner, 2) }),
  statModifier: (s, u) => { const o = unitOwner(s, u); return o ? perEach(Math.floor(s.players[o].base.damage / 5), 1) : {} },
})
const GRANT_ASAJJ_LEADER = 'GRANT_ASAJJ_LEADER'
registerCard(GRANT_ASAJJ_LEADER, { sourceCardId: 'TWI_014', ...attackBonus(1) })
registerCard('TWI_014', { // Asajj Ventress
  ...leaderAttack('Attack with a unit. If you played an event this phase, it gets +1/+0 for this attack.', (s, ctx) => (eventPlayed(s, ctx) ? { grantCardId: GRANT_ASAJJ_LEADER } : {})),
  // "On Attack: if you played an event this phase" cannot change during her own attack, so it reads as a constant while she attacks.
  statModifier: (s, u, ctx) => (ctx.attacking && eventPlayed(s, asCtx(s, u)) ? { power: 1 } : {}),
  dealsDamageFirst: (s, u) => eventPlayed(s, asCtx(s, u)),
})
const GRANT_MAUL_LEADER = 'GRANT_MAUL_LEADER'
registerCard(GRANT_MAUL_LEADER, { sourceCardId: 'TWI_009', conditionalKeywords: () => [KW.overwhelm] })
registerCard('TWI_009', { // Maul
  ...leaderAttack('Attack with a unit. It gains Overwhelm for this attack.', () => ({ grantCardId: GRANT_MAUL_LEADER })),
  ...friendlyAura(() => true, { keywords: [KW.overwhelm] }, true),
})
const GRANT_MOFF_GIDEON_LEADER = 'GRANT_MOFF_GIDEON_LEADER'
registerCard(GRANT_MOFF_GIDEON_LEADER, { sourceCardId: 'SHD_007', ...attackingAUnitBonus(1) })
const costsAtMost3: Pick = (s, u) => printedCost(s, u) <= 3
registerCard('SHD_007', { // Moff Gideon
  ...leaderAttack("Attack with a unit that costs 3 or less. If it's attacking a unit, it gets +1/+0 for this attack.", (s, ctx) =>
    ({ attacker: { only: pickedIds(s, ctx, pickAll(pickFriendly, costsAtMost3)) }, grantCardId: GRANT_MOFF_GIDEON_LEADER })),
  // "While attacking an enemy unit": the combat roles exist only for an attack on a unit.
  aura: (s, _src, tgt, friendly, combat) =>
    (friendly && combat?.attackerInstanceId === tgt.instanceId && printedCost(s, tgt) <= 3 ? { power: 1, keywords: [KW.overwhelm] } : undefined),
})
const GRANT_IG88_LEADER = 'GRANT_IG_EIGHTY_EIGHT_LEADER'
registerCard(GRANT_IG88_LEADER, { sourceCardId: 'SOR_012', statModifier: (s, u, ctx) => (ctx.attacking && friendliesOf(s, u).length > enemiesOf(s, u).length ? { power: 1 } : {}) })
registerCard('SOR_012', { // IG-88
  ...leaderAttack('Attack with a unit. If you control more units than the defending player, the attacker gets +1/+0 for this attack.', () => ({ grantCardId: GRANT_IG88_LEADER })),
  ...friendlyAura(() => true, { keywords: [KW.raid(1)] }, true),
})
const GRANT_JYN_LEADER = 'GRANT_JYN_LEADER'
registerCard(GRANT_JYN_LEADER, { sourceCardId: 'SOR_018', aura: defenderPowerAura(-1) })
registerCard('SOR_018', { // Jyn Erso
  ...leaderAttack('Attack with a unit. The defender gets -1/-0 for this attack.', () => ({ grantCardId: GRANT_JYN_LEADER })),
  aura: (s, src, tgt, _friendly, combat) => {
    if (combat?.defenderInstanceId !== tgt.instanceId) return undefined
    const mine = unitOwner(s, src)
    return mine !== undefined && findUnit(s, combat.attackerInstanceId)?.owner === mine ? { power: -1 } : undefined
  },
})
const GRANT_LEIA_LEADER = 'GRANT_LEIA_LEADER'
registerCard(GRANT_LEIA_LEADER, { sourceCardId: 'SOR_009', abilities: [thenAttack('Then, you may attack with another Rebel unit.', { attacker: { trait: 'Rebel' }, optional: true })] })
registerCard('SOR_009', { // Leia Organa
  ...leaderAttack('Attack with a Rebel unit. Then, you may attack with another Rebel unit.', () => ({ attacker: { trait: 'Rebel' }, grantCardId: GRANT_LEIA_LEADER })),
  abilities: [thenAttack('When this unit completes an attack: You may attack with another Rebel unit.', { attacker: { trait: 'Rebel' }, optional: true })],
})
const GRANT_ASAJJ_TOKEN_ATTACK = 'GRANT_ASAJJ_TOKEN_ATTACK'
registerCard(GRANT_ASAJJ_TOKEN_ATTACK, { sourceCardId: 'TS26_7', ...attackBonus(1) })
const friendlyToken: Pick = (s, u, ctx) => pickFriendly(s, u, ctx) && isTokenCard(u.cardId)
registerCard('TS26_7', { // Asajj Ventress
  ...leaderAttack('Attack with a token unit. It gets +1/+0 for this attack.', (s, ctx) => ({ attacker: { only: pickedIds(s, ctx, friendlyToken) }, grantCardId: GRANT_ASAJJ_TOKEN_ATTACK })),
  statModifier: (s, u) => (attackedWithThisPhase((_st, x) => isTokenCard(x.cardId))(s, asCtx(s, u)) ? { power: 2 } : {}),
})
const GRANT_PADME_LEADER = 'GRANT_PADME_LEADER'
registerCard(GRANT_PADME_LEADER, { sourceCardId: 'TS26_4', cannotAttackBases: () => true })
const enteredFriendly: Pick = (s, u, ctx) => pickFriendly(s, u, ctx) && enteredPlayThisPhase(s, ctx.owner).includes(u.instanceId)
const twoEntered: When = (s, ctx) => enteredPlayThisPhase(s, ctx.owner).length >= 2
registerCard('TS26_4', { // Padmé Amidala
  ...leaderAttack("If 2 or more friendly units entered play this phase, attack with 1 of them, even if it's exhausted. It can't attack bases for this attack.", (s, ctx) =>
    ({ attacker: { only: pickedIds(s, ctx, enteredFriendly) }, exhausted: true, grantCardId: GRANT_PADME_LEADER }), { usable: twoEntered }),
  abilities: [{
    trigger: 'onAttackEnd',
    description: "You may attack with another friendly unit that entered play this phase, even if it's exhausted. It can't attack bases for this attack.",
    effect: (s, ctx) => offerAttack(s, ctx.owner, `${ctx.sourceInstanceId}-next`, {
      attacker: { only: pickedIds(s, ctx, pickAll(enteredFriendly, pickOther)) }, exhausted: true, grantCardId: GRANT_PADME_LEADER, optional: true,
    }),
  }],
})
const GRANT_SAW_LEADER = 'GRANT_SAW_LEADER'
registerCard(GRANT_SAW_LEADER, {
  sourceCardId: 'LAW_001',
  ...attackBonus(2),
  conditionalKeywords: () => [KW.overwhelm],
  abilities: [{ trigger: 'onAttackEnd', description: 'Defeat this unit.', effect: (s, ctx) => (findUnit(s, ctx.sourceInstanceId!) ? defeatUnits(s, [ctx.sourceInstanceId!]) : s) }],
})
registerCard('LAW_001', { // Saw Gerrera
  ...leaderAttack('Attack with a unit. It gets +2/+0 and gains Overwhelm for this attack. After completing this attack, defeat it.', () => ({ grantCardId: GRANT_SAW_LEADER })),
  abilities: [{
    trigger: 'onAttackEnd',
    description: 'If this unit survived, you may attack with another unit. It gets +2/+0 and gains Overwhelm for this attack. After completing this attack, defeat it.',
    effect: (s, ctx) => (findUnit(s, ctx.sourceInstanceId!)
      ? offerAttack(s, ctx.owner, `${ctx.sourceInstanceId}-next`, { attacker: { exclude: [ctx.sourceInstanceId!] }, grantCardId: GRANT_SAW_LEADER, optional: true })
      : s),
  }],
})
registerCard('TS26_2', allOf( // Anakin Skywalker
  leaderFront('If 2 or more friendly units entered play this phase (including tokens and leaders), give a Shield token to 1 of them.', {
    usable: both(twoEntered, anyUnitPasses(enteredFriendly)),
    effect: (s, ctx) => shieldChoice(s, ctx, pickedIds(s, ctx, enteredFriendly), false),
  }),
  attacks('Give a Shield token to another friendly unit that entered play this phase.', (s, ctx) => shieldChoice(s, ctx, pickedIds(s, ctx, pickAll(enteredFriendly, pickOther)), false)),
))

// C: plays from hand
/** "Play a unit from your hand ..." on a leader's front, offered only while one can be paid for after the action's own cost. */
const leaderPlay = (description: string, o: PlayFromHandOptions, cost = 0): CardDefinition =>
  leaderFront(description, {
    ...(cost ? { cost } : {}),
    usable: (s, ctx) => playableFromHand(s, ctx.owner, o, cost).length > 0,
    effect: (s, ctx) => playFromHand(s, ctx, o),
  })
/** The same play as a deployed leader's "Action:", with no exhaust. */
const unitPlayAction = (description: string, o: PlayFromHandOptions): CardDefinition => ({
  actionAbilities: [{ description, usable: (s, self) => playableFromHand(s, controllerOf(s, self), o).length > 0, effect: (s, ctx) => playFromHand(s, ctx, o) }],
})
const printedCostAtMost = (n: number) => (c: EngineCard | undefined): boolean => (c?.cost ?? 0) <= n

registerCard('LOF_010', allOf( // Third Sister
  leaderPlay('Play a unit from your hand. It gains Hidden for this phase.', { gains: [{ name: 'Hidden' }] }),
  attacks('The next unit you play this phase gains Hidden.', (s, ctx) => grantNextUnit(s, ctx.owner, { keywords: [{ name: 'Hidden' }] })),
))
const capitalShip = (c: EngineCard | undefined): boolean => printedUnit(c) && printedTrait(c, 'Capital Ship')
registerCard('JTL_005', { // Admiral Piett
  ...leaderPlay('Play a Capital Ship unit from your hand. It costs 1 less.', { costDelta: -1, test: capitalShip }),
  costDiscount: (_s, _source, ctx) => (capitalShip(ctx.card) ? -2 : 0),
})
const fennecPlay: PlayFromHandOptions = { test: printedCostAtMost(4), gains: [KW.ambush] }
registerCard('SHD_016', { // Fennec Shand
  ...leaderPlay('Play a unit that costs 4 or less from your hand (paying its cost). Give it Ambush for this phase.', fennecPlay, 1),
  ...unitPlayAction('Play a unit that costs 4 or less from your hand (paying its cost). Give it Ambush for this phase.', fennecPlay),
})
const hanPlay: PlayFromHandOptions = { costDelta: -1, thenDamageIt: 2 }
registerCard('SHD_013', { // Han Solo
  ...leaderPlay('Play a unit from your hand. It costs 1 less. Deal 2 damage to it.', hanPlay),
  ...unitPlayAction('Play a unit from your hand. It costs 1 less. Deal 2 damage to it.', hanPlay),
})
// The deployed side is Grit and Sentinel, both read from the card.
registerCard('SOR_003', leaderPlay('Play a unit that costs 3 or less from your hand (paying its cost). It gains Sentinel for this phase.', // Chewbacca
  { test: printedCostAtMost(3), gains: [KW.sentinel] }))
const drydenCostly = (s: GameState, owner: PlayerId): number[] =>
  s.players[owner].hand.flatMap((id, i) => ((s.cards[id]?.cost ?? 0) >= 6 ? [i] : []))
const drydenFront: PlayFromHandOptions = { test: printedCostAtMost(5), gains: [KW.ambush] }
const drydenBack: PlayFromHandOptions = { gains: [KW.ambush] }
registerCard('SEC_007', { // Dryden Vos
  ...leaderFront('[Discard a card that costs 6 or more from your hand]: Play a unit that costs 5 or less from your hand (paying its cost). It gains Ambush for this phase.', {
    usable: (s, ctx) => drydenCostly(s, ctx.owner).length > 0 && playableFromHand(s, ctx.owner, drydenFront).length > 0,
    effect: (s, ctx) => pushChoice(s, { kind: 'selectHandCardThen', id: ctx.sourceInstanceId!, controller: ctx.owner, handIndices: drydenCostly(s, ctx.owner), text: 'discard a card that costs 6 or more', then: resume(ctx, 'front') }),
  }),
  actionAbilities: [{
    description: '[Discard a card from your hand]: Play a unit from your hand (paying its cost). It gains Ambush for this phase.',
    // The discard is a cost, so a unit must still be left to play once it is paid.
    usable: (s, self) => s.players[controllerOf(s, self)].hand.length >= 2 && playableFromHand(s, controllerOf(s, self), drydenBack).length > 0,
    effect: (s, ctx) => handCardThen(s, ctx, 'discard a card from your hand', 'back'),
  }],
  ifYouDo: (s, ctx) => playFromHand(discardFromHand(s, ctx.owner, ctx.handIndex!), ctx, ctx.step === 'front' ? drydenFront : drydenBack),
})
const sharesKeywordWith = (s: GameState, u: UnitState) => {
  const names = new Set(unitKeywords(s, u).map(k => k.name))
  return (c: EngineCard | undefined): boolean => (c?.keywords ?? []).some(k => names.has(k.name))
}
const morganTargets = (s: GameState, ctx: EventCtx): string[] =>
  picked(s, ctx, pickAll(pickFriendly, attackedThisPhasePick))
    .filter(u => playableFromHand(s, ctx.owner, { costDelta: -1, test: sharesKeywordWith(s, u) }).length > 0)
    .map(u => u.instanceId)
registerCard('LOF_005', { // Morgan Elsbeth
  ...leaderFront('Choose a friendly unit that attacked this phase. Play a unit from your hand that shares a Keyword with the chosen unit. It costs 1 less.', {
    usable: (s, ctx) => morganTargets(s, ctx).length > 0,
    effect: (s, ctx) => unitThen(s, ctx, morganTargets(s, ctx), 'choose a friendly unit that attacked this phase', false),
  }),
  ...attacks('The next unit you play this phase costs 1 less if it shares a Keyword with a friendly unit.', (s, ctx) =>
    grantNextUnit(s, ctx.owner, { costDelta: -1, sharesKeywordWithFriendly: true })),
  ifYouDo: (s, ctx) => {
    const chosen = findUnit(s, ctx.targetInstanceId!)?.unit
    return chosen ? playFromHand(s, ctx, { costDelta: -1, test: sharesKeywordWith(s, chosen) }) : s
  },
})

// D: When Deployed
const whenDeployed = (description: string, effect: AbilityDef['effect']): CardDefinition => ({ abilities: [{ trigger: 'whenDeployed', description, effect }] })
const remainingAtMost = (n: number): Pick => (s, u) => nonLeader(s, u) && remainingHp(s, u) <= n
registerCard('LAW_004', allOf( // Aurra Sing
  leaderFront('Defeat a non-leader unit with 1 or less remaining HP.', {
    usable: anyUnitPasses(remainingAtMost(1)),
    effect: (s, ctx) => targetChoice(s, ctx, 'selectUnitToDefeat', pickedIds(s, ctx, remainingAtMost(1))),
  }),
  whenDeployed('You may defeat a non-leader unit with 5 or less remaining HP.', (s, ctx) =>
    targetChoice(s, ctx, 'selectUnitToDefeat', pickedIds(s, ctx, remainingAtMost(5)), true)),
))
registerCard('LOF_012', { // Rey
  ...leaderFront('If you played a non-unit Force card this phase, deal 1 damage to a unit.', {
    usable: both(playedCardThisPhase(c => c?.type !== 'unit' && printedTrait(c, 'Force')), anyUnitPasses(pickAny)),
    effect: (s, ctx) => damageChoice(s, ctx, 1, allUnits(s)),
  }),
  ...whenDeployed('You may discard your hand. If you do, draw 2 cards.', (s, ctx) =>
    (s.players[ctx.owner].hand.length ? pushChoice(s, { kind: 'mayPayThen', id: ctx.sourceInstanceId!, controller: ctx.owner, cost: 0, text: 'discard your hand and draw 2 cards', then: resume(ctx) }) : s)),
  ifYouDo: (s, ctx) => {
    let next = s
    while (next.players[ctx.owner].hand.length > 0) next = discardFromHand(next, ctx.owner, 0)
    return drawCards(next, ctx.owner, 2)
  },
})
const damagedEnemy = pickAll(pickEnemy, damaged)
registerCard('TWI_013', { // Mace Windu
  ...leaderFront('Deal 1 damage to a damaged enemy unit. Then, if it has 5 or more damage on it, deal 1 damage to it.', {
    cost: 1,
    usable: anyUnitPasses(damagedEnemy),
    effect: (s, ctx) => unitThen(s, ctx, pickedIds(s, ctx, damagedEnemy), 'deal 1 damage to a damaged enemy unit', false),
  }),
  ...whenDeployed('Deal 2 damage to each damaged enemy unit.', (s, ctx) =>
    pickedIds(s, ctx, damagedEnemy).reduce((acc, id) => dealDamageToUnit(acc, id, 2), s)),
  ifYouDo: (s, ctx) => {
    const hit = dealDamageToUnit(s, ctx.targetInstanceId!, 1)
    return (findUnit(hit, ctx.targetInstanceId!)?.unit.damage ?? 0) >= 5 ? dealDamageToUnit(hit, ctx.targetInstanceId!, 1) : hit
  },
})
const aUnitLeftPlay: When = s => BOTH_BASES.some(p => leftPlayThisPhase(s, p).length > 0)
registerCard('TWI_004', { // Yoda
  ...leaderFront('If a unit left play this phase, draw a card, then put a card from your hand on the top or bottom of your deck.', {
    usable: aUnitLeftPlay,
    effect: (s, ctx) => handCardThen(drawCards(s, ctx.owner, 1), ctx, 'put a card from your hand on the top or bottom of your deck', 'card'),
  }),
  ...whenDeployed('You may discard a card from your deck. If you do, defeat an enemy non-leader unit that costs the same as or less than the discarded card.', (s, ctx) =>
    (s.players[ctx.owner].deck.length
      ? pushChoice(s, { kind: 'mayPayThen', id: ctx.sourceInstanceId!, controller: ctx.owner, cost: 0, text: 'discard the top card of your deck to defeat an enemy non-leader unit that costs as much or less', then: resume(ctx, 'mill') })
      : s)),
  ifYouDo: (s, ctx) => {
    if (ctx.step === 'card') {
      return pushChoice(s, { kind: 'mayPayThen', id: ctx.sourceInstanceId!, controller: ctx.owner, cost: 0, text: 'put it on the top of your deck (otherwise the bottom)', then: resume(ctx, `top:${ctx.handIndex}`), declineStep: `bottom:${ctx.handIndex}` })
    }
    if (ctx.step?.startsWith('top:') || ctx.step?.startsWith('bottom:')) {
      const [where, index] = ctx.step.split(':')
      return handToDeck(s, ctx.owner, Number(index), where as 'top' | 'bottom')
    }
    const [next, milled] = millTop(s, ctx.owner, 1)
    const cost = next.cards[milled[0]]?.cost ?? 0
    return targetChoice(next, ctx, 'selectUnitToDefeat', pickedIds(next, ctx, pickAll(pickEnemy, nonLeader, (st, u) => printedCost(st, u) <= cost)))
  },
})
registerCard('SHD_002', { // Qi'ra
  ...leaderFront('Deal 2 damage to a friendly unit. Then, give a Shield token to it.', {
    cost: 1,
    usable: anyUnitPasses(pickFriendly),
    effect: (s, ctx) => unitThen(s, ctx, pickedIds(s, ctx, pickFriendly), 'deal 2 damage to a friendly unit, then give it a Shield token', false),
  }),
  ...whenDeployed('Heal all damage from each unit. Then, deal damage to each unit equal to half its remaining HP, rounded down.', s => {
    const healed = allUnits(s).reduce((acc, u) => (u.damage > 0 ? healUnit(acc, u.instanceId, u.damage) : acc), s)
    const amounts = allUnits(healed).map(u => [u.instanceId, Math.floor(remainingHp(healed, u) / 2)] as const)
    return amounts.reduce((acc, [id, n]) => (n > 0 ? dealDamageToUnit(acc, id, n) : acc), healed)
  }),
  ifYouDo: (s, ctx) => {
    const hit = dealDamageToUnit(s, ctx.targetInstanceId!, 2)
    return findUnit(hit, ctx.targetInstanceId!) ? giveToken(hit, ctx.targetInstanceId!, TOKEN_SHIELD) : hit
  },
})
registerCard('SOR_006', { // Emperor Palpatine
  ...leaderFront('[Defeat a friendly unit]: Deal 1 damage to a unit and draw a card.', {
    cost: 1,
    usable: anyUnitPasses(pickFriendly),
    effect: (s, ctx) => unitThen(s, ctx, pickedIds(s, ctx, pickFriendly), 'defeat a friendly unit to deal 1 damage to a unit and draw a card', false),
  }),
  abilities: [
    ...whenDeployed('Take control of a damaged non-leader unit.', (s, ctx) =>
      unitThen(s, ctx, pickedIds(s, ctx, pickAll(pickEnemy, nonLeader, damaged)), 'take control of a damaged non-leader unit', false, 'steal')).abilities!,
    ...attacks('You may defeat another friendly unit. If you do, deal 1 damage to a unit and draw a card.', (s, ctx) =>
      unitThen(s, ctx, pickedIds(s, ctx, pickAll(pickFriendly, pickOther)), 'defeat another friendly unit to deal 1 damage to a unit and draw a card', true)).abilities!,
  ],
  ifYouDo: (s, ctx) => {
    if (ctx.step === 'steal') return stealTo(s, ctx.owner, ctx.targetInstanceId, 'permanent')
    const drawn = drawCards(defeatUnits(s, [ctx.targetInstanceId!]), ctx.owner, 1)
    return damageChoice(drawn, ctx, 1, allUnits(drawn))
  },
})
/** One card id per name in `owner`'s discard pile, leaving out names already picked. */
const namesInDiscard = (s: GameState, owner: PlayerId, pickedIdsSoFar: string[]): string[] => {
  const taken = new Set(pickedIdsSoFar.map(id => s.cards[id]?.name))
  const seen = new Set<string | undefined>()
  return s.players[owner].discard.filter(id => {
    const name = s.cards[id]?.name
    if (taken.has(name) || seen.has(name)) return false
    seen.add(name)
    return true
  })
}
const aphraPick = (s: GameState, ctx: Resumable, picks: string[]): GameState => {
  const candidates = namesInDiscard(s, ctx.owner, picks)
  // "If you do" needs all three, so nothing is offered when fewer names are there to begin with.
  if (picks.length + candidates.length < 3) return s
  return pushChoice(s, { kind: 'selectCardThen', id: ctx.sourceInstanceId!, controller: ctx.owner, candidates, text: `choose a card in your discard pile (${picks.length + 1} of 3, different names)`, then: resume(ctx, picksStep(picks)) })
}
registerCard('SHD_015', { // Doctor Aphra
  leaderAbilities: {
    abilities: [{ trigger: 'whenRegroupStarts', description: 'Discard a card from your deck.', effect: (s, ctx) => millTop(s, ctx.owner, 1)[0] }],
  },
  statModifier: (s, u) => {
    const o = unitOwner(s, u)
    return o && new Set(s.players[o].discard.map(id => s.cards[id]?.cost ?? 0)).size >= 5 ? { power: 3 } : {}
  },
  ...whenDeployed('Choose 3 cards in your discard pile with different names. If you do, return 1 of them at random to your hand.', (s, ctx) => aphraPick(s, ctx, [])),
  ifYouDo: (s, ctx) => {
    const picks = [...picksOf(ctx.step), ctx.cardChosen!]
    if (picks.length < 3) return aphraPick(s, ctx, picks)
    // Random, not chosen: the seed on the state keeps it deterministic under replay.
    const back = picks[Math.floor(seededUnit(s.rngSeed) * picks.length)]
    const p = s.players[ctx.owner]
    const at = p.discard.indexOf(back)
    return { ...updatePlayer(s, ctx.owner, { discard: p.discard.filter((_, i) => i !== at), hand: [...p.hand, back] }), rngSeed: nextSeed(s.rngSeed) }
  },
})
interface TrenchStep { left: number; cards: string[] }
/** Admiral Trench's reveal: the opponent discards while `left` lasts, then its owner draws 1 of what is left and discards the rest. */
const trenchOffer = (s: GameState, ctx: Resumable, st: TrenchStep): GameState => {
  if (st.left > 0 && st.cards.length > 0) {
    return pushChoice(s, { kind: 'selectCardThen', id: `${ctx.sourceInstanceId}-discard`, controller: opponentOf(ctx.owner), candidates: st.cards, text: "discard one of your opponent's revealed cards", then: resume(ctx, `discard:${JSON.stringify(st)}`) })
  }
  if (st.cards.length === 0) return s
  return pushChoice(s, { kind: 'selectCardThen', id: `${ctx.sourceInstanceId}-draw`, controller: ctx.owner, candidates: st.cards, text: 'draw one of the revealed cards; the others are discarded', then: resume(ctx, `draw:${JSON.stringify(st)}`) })
}
registerCard('JTL_014', { // Admiral Trench
  ...leaderFront('Discard a card that costs 3 or more from your hand. If you do, draw a card.', {
    usable: (s, ctx) => s.players[ctx.owner].hand.some(id => (s.cards[id]?.cost ?? 0) >= 3),
    effect: (s, ctx) => pushChoice(s, {
      kind: 'selectHandCardThen', id: ctx.sourceInstanceId!, controller: ctx.owner, text: 'discard a card that costs 3 or more, then draw a card', then: resume(ctx, 'front'),
      handIndices: s.players[ctx.owner].hand.flatMap((id, i) => ((s.cards[id]?.cost ?? 0) >= 3 ? [i] : [])),
    }),
  }),
  ...whenDeployed('Reveal the top 4 cards of your deck. An opponent discards 2 of them. Draw 1 of the remaining cards and discard the other.', (s, ctx) => {
    const p = s.players[ctx.owner]
    const cards = p.deck.slice(0, 4)
    // Held out of the deck while the picks are made, so nothing else can draw or move them meanwhile.
    return cards.length ? trenchOffer(updatePlayer(s, ctx.owner, { deck: p.deck.slice(cards.length) }), ctx, { left: 2, cards }) : s
  }),
  ifYouDo: (s, ctx) => {
    if (ctx.step === 'front') return drawCards(discardFromHand(s, ctx.owner, ctx.handIndex!), ctx.owner, 1)
    const [stage, json] = [ctx.step!.slice(0, ctx.step!.indexOf(':')), ctx.step!.slice(ctx.step!.indexOf(':') + 1)]
    const st = JSON.parse(json) as TrenchStep
    const chosen = ctx.optionIndex ?? 0
    const p = s.players[ctx.owner]
    if (stage === 'discard') {
      const next = updatePlayer(s, ctx.owner, { discard: [...p.discard, st.cards[chosen]] })
      return trenchOffer(next, ctx, { left: st.left - 1, cards: st.cards.filter((_, i) => i !== chosen) })
    }
    // The drawn card goes back on top and is drawn from there, so it is a draw like any other.
    const rest = st.cards.filter((_, i) => i !== chosen)
    return drawCards(updatePlayer(s, ctx.owner, { deck: [st.cards[chosen], ...p.deck], discard: [...p.discard, ...rest] }), ctx.owner, 1)
  },
})

// E: constant abilities on the leader side. The front's `leaderAbilities.aura` and waiver take the
// leader's controller where a unit's take the source unit; the deployed side is an ordinary unit hook.
type LeaderAura = NonNullable<NonNullable<CardDefinition['leaderAbilities']>['aura']>
/** The same "each friendly unit that ..." contribution from both sides. `self` says whether the deployed leader counts itself. */
const friendlyBothSides = (test: Holds, contribution: AuraContribution, self: boolean): CardDefinition => ({
  leaderAbilities: { aura: (s, _owner, target, friendly) => (friendly && test(s, target) ? contribution : undefined) },
  ...friendlyAura(test, contribution, !self),
})
/** The same aspect-penalty waiver from both sides, for the cards `test` accepts. */
const waiverBothSides = (test: (s: GameState, owner: PlayerId, card: EngineCard) => boolean): CardDefinition => ({
  leaderAbilities: { waivesAspectPenalty: (s, owner, ctx) => test(s, owner, ctx.card) },
  waivesAspectPenalty: (s, _source, ctx) => test(s, ctx.owner, ctx.card),
})
const mergeLeaderSides = (...defs: CardDefinition[]): CardDefinition => ({
  ...allOf(...defs),
  leaderAbilities: Object.assign({}, ...defs.map(d => d.leaderAbilities ?? {})),
})

registerCard('SOR_001', friendlyBothSides((_s, u) => u.damage > 0, { power: 1 }, true)) // Director Krennic
registerCard('LAW_009', waiverBothSides((s, owner, c) => // Hera Syndulla
  c.type === 'unit' && printedAspect(c, 'Heroism') && s.players[owner].units.length >= 2))
registerCard('SEC_009', mergeLeaderSides( // Mon Mothma
  waiverBothSides((_s, _owner, c) => c.type === 'unit' && printedTrait(c, 'Official') && !printedAspect(c, 'Villainy')),
  friendlyBothSides(isTrait('Official'), { hp: 1 }, false),
))

const GRANT_NALA_SE = 'GRANT_NALA_SE'
registerCard(GRANT_NALA_SE, { sourceCardId: 'TWI_001', ...whenDefeated('Heal 2 damage from your base.', (s, ctx) => healBase(s, ctx.owner, 2)) })
registerCard('TWI_001', { // Nala Se
  ...waiverBothSides((_s, _owner, c) => c.type === 'unit' && printedTrait(c, 'Clone')),
  grantsAbilities: (s, _source, target, friendly) => (friendly && unitHasTrait(s, target, 'Clone') ? [GRANT_NALA_SE] : []),
})

const GRANT_GAR_SAXON = 'GRANT_GAR_SAXON'
registerCard(GRANT_GAR_SAXON, {
  sourceCardId: 'SHD_001',
  ...whenDefeated('You may return an upgrade that was attached to this unit to its owner\'s hand.', (s, ctx) => {
    // The upgrades went to their owners' discard piles as the unit left play; tokens are gone.
    const cards = (ctx.defeatedUnit?.upgrades ?? []).filter(up => !isTokenCard(up.cardId) && s.players[up.owner].discard.includes(up.cardId))
    return cards.length
      ? pushChoice(s, { kind: 'selectCardThen', id: `${ctx.defeatedUnit!.instanceId}-garSaxon`, controller: ctx.owner, candidates: cards.map(up => up.cardId), optional: true, text: "return an upgrade that was on it to its owner's hand", then: { cardId: GRANT_GAR_SAXON, owner: ctx.owner, step: cards.map(up => up.owner).join(',') } })
      : s
  }),
  ifYouDo: (s, ctx) => returnCardFromDiscardToHand(s, (ctx.step ?? '').split(',')[ctx.optionIndex ?? 0] as PlayerId, ctx.cardChosen!),
})
registerCard('SHD_001', { // Gar Saxon
  ...friendlyBothSides((_s, u) => isUpgraded(u), { power: 1 }, true),
  grantsAbilities: (_s, _source, target, friendly) => (friendly && isUpgraded(target) ? [GRANT_GAR_SAXON] : []),
})

/**
 * "Each friendly unit with the most power among friendly units gains Overwhelm." Overwhelm only acts on
 * an attack against a unit, so it is granted to that attacker alone, which is also what keeps the power
 * comparison from reading the aura pass it is part of: the other units' power is asked with no combat.
 */
const savageAura: LeaderAura = (s, owner, target, friendly, combat) => {
  if (!friendly || combat?.attackerInstanceId !== target.instanceId) return undefined
  const mine = effectivePower(s, target)
  return s.players[owner].units.every(u => u.instanceId === target.instanceId || effectivePower(s, u) <= mine) ? { keywords: [KW.overwhelm] } : undefined
}
registerCard('TS26_5', { // Savage Opress
  leaderAbilities: { aura: savageAura },
  ...friendlyAura(() => true, { keywords: [KW.overwhelm] }, true),
})

// F: one small engine addition each
registerCard('SEC_005', { // Satine Kryze (Restore 4 on the deployed side, from the card)
  ...leaderFront('Heal up to 2 damage from a unit. If you do, deal that much damage to your base.', {
    usable: anyUnitPasses(damaged),
    effect: (s, ctx) => unitThen(s, ctx, pickedIds(s, ctx, damaged), 'heal up to 2 damage from a unit, and deal that much to your base', false),
  }),
  ifYouDo: (s, ctx) => {
    // Healing less than it can never helps, so "up to 2" heals as much as the unit has, to 2.
    const healed = Math.min(2, findUnit(s, ctx.targetInstanceId!)?.unit.damage ?? 0)
    return healed > 0 ? dealDamageToBase(healUnit(s, ctx.targetInstanceId!, healed), ctx.owner, healed) : s
  },
})
registerCard('SEC_010', { // Dedra Meero
  ...leaderFront("Choose an enemy unit. Its controller may deal 2 damage to it. If they don't, draw a card.", {
    cost: 1,
    usable: anyUnitPasses(pickEnemy),
    effect: (s, ctx) => unitThen(s, ctx, pickedIds(s, ctx, pickEnemy), 'choose an enemy unit', false, 'unit'),
  }),
  ifYouDo: (s, ctx) => {
    if (ctx.step === 'deal') return dealDamageToUnit(s, ctx.unitChosen!, 2)
    if (ctx.step === 'draw') return drawCards(s, ctx.owner, 1)
    const name = s.cards[findUnit(s, ctx.targetInstanceId!)?.unit.cardId ?? '']?.name ?? 'the unit'
    return pushChoice(s, {
      kind: 'mayPayThen', id: ctx.sourceInstanceId!, controller: opponentOf(ctx.owner), cost: 0, text: `deal 2 damage to your ${name} (otherwise your opponent draws a card)`,
      then: resume(ctx, 'deal', ctx.targetInstanceId), declineStep: 'draw',
    })
  },
  ...gains((s, u) => { const o = unitOwner(s, u); return o !== undefined && s.players[o].hand.length > s.players[opponentOf(o)].hand.length }, KW.raid(2)),
})
/** Darth Vader's "discard any number of cards": one at a time with Done, then damage equal to the count. */
const vaderDiscards = (s: GameState, ctx: Resumable, n: number): GameState => {
  const hand = s.players[ctx.owner].hand
  if (hand.length === 0) return n > 0 ? damageChoice(s, ctx, n, allUnits(s), BOTH_BASES) : s
  return pushChoice(s, { kind: 'selectCardThen', id: ctx.sourceInstanceId!, controller: ctx.owner, candidates: hand, optional: true, hookOnDecline: true, text: `discard a card from your hand (${n} discarded)`, then: resume(ctx, `n:${n}`) })
}
registerCard('LAW_011', { // Darth Vader
  ...leaderFront('[Discard a card from your hand]: Deal 1 damage to a unit or base.', {
    usable: (s, ctx) => s.players[ctx.owner].hand.length > 0,
    effect: (s, ctx) => discards(s, ctx.owner, 1, ctx.sourceInstanceId!, resume(ctx, 'front')),
  }),
  ...attacks('Discard any number of cards from your hand. Deal damage to a unit or base equal to the number of cards discarded this way.', (s, ctx) => vaderDiscards(s, ctx, 0)),
  ifYouDo: (s, ctx) => {
    if (ctx.step === 'front') return damageChoice(s, ctx, 1, allUnits(s), BOTH_BASES)
    const n = Number(ctx.step!.slice('n:'.length))
    if (ctx.optionIndex === undefined) return n > 0 ? damageChoice(s, ctx, n, allUnits(s), BOTH_BASES) : s
    return vaderDiscards(discardFromHand(s, ctx.owner, ctx.optionIndex), ctx, n + 1)
  },
})
const readyEnemy = pickAll(pickEnemy, readyUnitPick)
const clientExhaust = (s: GameState, ctx: EventCtx): GameState => targetChoice(s, ctx, 'mayExhaustUnit', pickedIds(s, ctx, readyEnemy))
registerCard('LAW_016', allOf( // The Client
  leaderFront('If you created a token this phase, exhaust an enemy unit.', {
    usable: both((s, ctx) => tokenCreatedThisPhase(s, ctx.owner), anyUnitPasses(readyEnemy)),
    effect: clientExhaust,
  }),
  attacks('If you created a token this phase, exhaust an enemy unit.', (s, ctx) => (tokenCreatedThisPhase(s, ctx.owner) ? clientExhaust(s, ctx) : s)),
))
const CASSIAN_ROUND_KEY = 'SOR_013#round'
registerCard('SOR_013', { // Cassian Andor
  ...leaderFront("If you've dealt 3 or more damage to an enemy base this phase, draw a card.", {
    cost: 1,
    usable: (s, ctx) => baseDamageThisPhase(s, opponentOf(ctx.owner)) >= 3,
    effect: (s, ctx) => drawCards(s, ctx.owner, 1),
  }),
  abilities: [{
    trigger: 'whenEnemyBaseDamaged',
    description: 'You may draw a card. Use this ability only once each round.',
    effect: (s, ctx) => (selfOf(s, ctx)?.usedAbilities?.includes(CASSIAN_ROUND_KEY)
      ? s
      : pushChoice(s, { kind: 'mayPayThen', id: `${ctx.sourceInstanceId}-draw`, controller: ctx.owner, cost: 0, text: 'draw a card', then: resume(ctx) })),
  }],
  ifYouDo: (s, ctx) => drawCards(markAbilityUsed(s, ctx.owner, ctx.sourceInstanceId!, CASSIAN_ROUND_KEY), ctx.owner, 1),
})
registerCard('SOR_004', { // Chirrut Îmwe
  ...leaderFront('Give a unit +0/+2 for this phase.', {
    usable: anyUnitPasses(pickAny),
    effect: (s, ctx) => lastingBuffChoice(s, ctx, pickedIds(s, ctx, pickAny), { hp: 2 }),
  }),
  // "During the regroup phase, if he has no remaining HP, defeat him": the sweep as the phase changes does it.
  survivesNoHp: s => s.phase === 'action',
})
const exhaustedEnemy = pickAll(pickEnemy, exhaustedPick)
registerCard('TS26_6', { // Rex
  ...leaderFront('[Ready an exhausted enemy unit]: The next event you play this phase costs 1 less.', {
    usable: anyUnitPasses(exhaustedEnemy),
    effect: (s, ctx) => unitThen(s, ctx, pickedIds(s, ctx, exhaustedEnemy), 'ready an exhausted enemy unit', false, '1'),
  }),
  ...attacks('You may ready an exhausted enemy unit. If you do, the next event you play this phase costs 2 less.', (s, ctx) =>
    unitThen(s, ctx, pickedIds(s, ctx, exhaustedEnemy), 'ready an exhausted enemy unit so the next event costs 2 less', true, '2')),
  ifYouDo: (s, ctx) => grantNextUnit(readyUnit(s, ctx.targetInstanceId!), ctx.owner, { event: true, costDelta: -Number(ctx.step) }),
})
const JABBA_ROUND_KEY = 'SEC_002#round'
registerCard('SEC_002', { // Jabba the Hutt
  ...leaderFront('A friendly damaged unit deals 1 damage to an enemy unit. If the friendly unit has 3 or more damage on it, it deals 2 damage instead.', {
    cost: 1,
    usable: both(anyUnitPasses(damagedFriendly), anyUnitPasses(pickEnemy)),
    effect: (s, ctx) => unitThen(s, ctx, pickedIds(s, ctx, damagedFriendly), 'choose the damaged friendly unit that deals the damage', false, 'dealer'),
  }),
  abilities: [{
    trigger: 'whenFriendlyDamagedSurvives',
    description: 'You may have that unit deal that much damage to an enemy unit. Use this ability only once each round.',
    effect: (s, ctx) => {
      if (selfOf(s, ctx)?.usedAbilities?.includes(JABBA_ROUND_KEY)) return s
      const hurt = (ctx.damagedSurvivors ?? []).filter(d => d.instanceId !== ctx.sourceInstanceId && findUnit(s, d.instanceId)?.owner === ctx.owner)
      if (hurt.length === 0 || !pickedIds(s, ctx, pickEnemy).length) return s
      return hurt.length === 1
        ? unitThen(s, ctx, pickedIds(s, ctx, pickEnemy), `have it deal ${hurt[0].amount} damage to an enemy unit`, true, `deal:${hurt[0].amount}`, hurt[0].instanceId)
        : unitThen(s, ctx, hurt.map(d => d.instanceId), 'choose the damaged unit that deals damage to an enemy unit', true, `dealer:${JSON.stringify(hurt)}`)
    },
  }],
  ifYouDo: (s, ctx) => {
    const step = ctx.step ?? ''
    if (step === 'dealer') return unitThen(s, ctx, pickedIds(s, ctx, pickEnemy), 'choose the enemy unit to damage', false, 'target', ctx.targetInstanceId)
    if (step === 'target') {
      const dealer = findUnit(s, ctx.unitChosen ?? '')?.unit
      return dealer ? dealDamageToUnit(s, ctx.targetInstanceId!, dealer.damage >= 3 ? 2 : 1) : s
    }
    if (step.startsWith('dealer:')) {
      const amount = (JSON.parse(step.slice('dealer:'.length)) as { instanceId: string; amount: number }[]).find(d => d.instanceId === ctx.targetInstanceId)?.amount ?? 0
      return unitThen(s, ctx, pickedIds(s, ctx, pickEnemy), `have it deal ${amount} damage to an enemy unit`, true, `deal:${amount}`, ctx.targetInstanceId)
    }
    // "deal:N": the once-a-round limit is spent only when the ability is used.
    return dealDamageToUnit(markAbilityUsed(s, ctx.owner, ctx.sourceInstanceId!, JABBA_ROUND_KEY), ctx.targetInstanceId!, Number(step.slice('deal:'.length)))
  },
})

// ── When Defeated units from the other sealed sets ─────────────────────────────────────────────────
// Built on the When Played helpers, as the On Attack units are: `defeated` fires the same definition as
// its unit is defeated instead. The unit has left play by then, so `ctx.sourceInstanceId` names no unit
// in play ("another" leaves nothing out) and `ctx.defeatedUnit` is the unit as it last was.

/** A definition built with the When Played helpers, fired as its unit is defeated instead. */
const defeated = (def: CardDefinition): CardDefinition => ({
  ...def,
  abilities: def.abilities?.map(a => (a.trigger === 'whenPlayed' ? { ...a, trigger: 'whenDefeated' as const } : a)),
})
const costsAtMost = (n: number): Pick => (s, u) => printedCost(s, u) <= n

// A: targets, draws and base damage
const twoToABase = defeated(whenPlayed('Deal 2 damage to a base.', (s, ctx) => damageChoice(s, ctx, 2, [], BOTH_BASES)))
registerCard('LAW_189', twoToABase) // Cavern Angels X-Wing
registerCard('TWI_131', twoToABase) // OOM-Series Officer
const healTwoFromYourBase = defeated(whenPlayed('Heal 2 damage from your base.', (s, ctx) => healBase(s, ctx.owner, 2)))
registerCard('LAW_097', healTwoFromYourBase) // Imperial Door Technician
registerCard('IBH_15', healTwoFromYourBase) // Tauntaun Mount
registerCard('JTL_033', defeated(whenPlayed('Heal 2 damage from a base.', (s, ctx) => healChoice(s, ctx, 2, [], BOTH_BASES)))) // Onyx Squadron Brute
registerCard('LOF_059', defeated(whenPlayed('Draw a card.', (s, ctx) => drawCards(s, ctx.owner, 1)))) // Nightsister Warrior
registerCard('JTL_063', defeated(mayPayWp('You may draw a card.', 0, 'draw a card', (s, ctx) => drawCards(s, ctx.owner, 1)))) // Landing Shuttle
registerCard('SHD_164', defeated(whenPlayed('Deal 1 damage to a unit or base.', (s, ctx) => damageChoice(s, ctx, 1, allUnits(s), BOTH_BASES)))) // Rhokai Gunship
registerCard('SEC_263', defeated(whenPlayed('Deal 1 damage to each exhausted enemy ground unit.', (s, ctx) => // Assassin Probe
  pickedIds(s, ctx, pickAll(pickEnemy, pickGround, (_s, u) => u.exhausted)).reduce((acc, id) => dealDamageToUnit(acc, id, 1), s))))
registerCard('LOF_235', defeated(whenPlayed('Deal 2 damage to each ground unit.', (s, ctx) => // HK-87 Assassin Droid
  pickedIds(s, ctx, pickGround).reduce((acc, id) => dealDamageToUnit(acc, id, 2), s))))
registerCard('SEC_154', defeated(targetWp('You may ready a unit that costs 5 or less.', 'selectUnitToReady', costsAtMost(5), true))) // Inner Rim Coalition
registerCard('SOR_226', defeated(targetWp('You may ready a Villainy unit.', 'selectUnitToReady', pickAspect('Villainy'), true))) // Admiral Motti
registerCard('SEC_221', defeated(targetWp('Exhaust an enemy unit.', 'mayExhaustUnit', pickEnemy, false))) // Unruly Astromech
registerCard('SOR_060', defeated(whenPlayed('You may give a Shield token to a Vigilance unit.', (s, ctx) => // Distant Patroller
  shieldChoice(s, ctx, pickedIds(s, ctx, pickAspect('Vigilance')), true))))
registerCard('LOF_064', defeated(whenPlayed('You may give a Shield token to a damaged non-Vehicle unit.', (s, ctx) => // Tauntaun
  shieldChoice(s, ctx, pickedIds(s, ctx, pickAll(damaged, (st, u) => !unitHasTrait(st, u, 'Vehicle'))), true))))
registerCard('JTL_060', defeated(buffWp('You may give a unit -1/-1 for this phase.', pickAny, () => ({ power: -1, hp: -1 }), true))) // Desperate Commando
registerCard('TWI_104', defeated(buffWp('You may give a Trooper unit +2/+2 for this phase.', pickTrait('Trooper'), () => ({ power: 2, hp: 2 }), true))) // Obedient Vanguard
registerCard('JTL_040', defeated(targetWp('You may defeat a space unit that costs 3 or less.', 'selectUnitToDefeat', pickAll(pickArena('space'), costsAtMost(3)), true))) // Fleet Interdictor
registerCard('JTL_220', defeated(targetWp("You may return a non-leader unit with 2 or less power to its owner's hand.", 'selectUnitToReturn', // Skyway Cloud Car
  pickAll((s, u) => nonLeader(s, u), (s, u) => effectivePower(s, u) <= 2), true)))
const opponentDiscardsOnDefeat = defeated(whenPlayed('Each opponent discards a card from their hand.', (s, ctx) => opponentDiscards(s, ctx.owner, ctx.sourceInstanceId!)))
registerCard('TWI_148', opponentDiscardsOnDefeat) // Senatorial Corvette
registerCard('IBH_82', opponentDiscardsOnDefeat) // Admiral Ozzel
registerCard('SOR_163', defeated(whenPlayed('If you have the initiative, draw 2 cards.', (s, ctx) => (haveInitiative(s, ctx) ? drawCards(s, ctx.owner, 2) : s)))) // Star Wing Scout
registerCard('LOF_057', defeated(searchDrawWp('Search the top 5 cards of your deck for a Force unit, reveal it, and draw it.', 5, // Owen Lars
  c => printedUnit(c) && printedTrait(c, 'Force'))))
registerCard('SHD_157', defeated(whenPlayed('For each player with 15 or more damage on their base, draw a card.', (s, ctx) => // Bo-Katan Kryze
  drawCards(s, ctx.owner, BOTH_BASES.filter(p => s.players[p].base.damage >= 15).length))))
registerCard('LOF_213', defeated(whenPlayed('Deal 6 damage divided as you choose among enemy units.', (s, ctx) => { // The Legacy Run
  const targets = s.players[opponentOf(ctx.owner)].units.map(u => u.instanceId)
  return targets.length ? pushChoice(s, { kind: 'distributeDamage', id: ctx.sourceInstanceId!, controller: ctx.owner, remaining: 6, total: 6, targets, enemiesOf: ctx.owner }) : s
})))
// "Up to" heals as much as it can, as It Binds All Things reads it.
registerCard('JTL_071', defeated(whenPlayed('Heal up to 3 damage from a unit or base.', (s, ctx) => // CR90 Relief Runner
  healChoice(s, ctx, 3, allUnits(s).map(u => u.instanceId), BOTH_BASES))))

// B: two steps, or a choice of modes. A yes or no with a `declineStep` is how a card offers two modes.
registerCard('SEC_136', defeated(unitThenWp('You may defeat another friendly unit. If you do, deal 4 damage to each enemy base.', // Arihnda Pryce
  pickFriendly, 'defeat another friendly unit', true, (s, ctx) => dealDamageToBase(defeatUnit(s, ctx.targetInstanceId!), opponentOf(ctx.owner), 4))))
registerCard('SEC_207', { // Lightmaker
  ...defeated(whenPlayed('Choose an arena. Exhaust each enemy unit in that arena.', (s, ctx) => chooseArena(s, ctx, 'exhaust each enemy unit in'))),
  ifYouDo: (s, ctx) => s.players[opponentOf(ctx.owner)].units.filter(u => u.arena === ctx.arenaChosen).reduce((acc, u) => exhaustUnit(acc, u.instanceId), s),
})
registerCard('SOR_204', { // Greedo
  ...defeated(whenPlayed("You may discard a card from your deck. If it's not a unit, deal 2 damage to a ground unit.", (s, ctx) =>
    (s.players[ctx.owner].deck.length ? pushChoice(s, { kind: 'mayPayThen', id: ctx.sourceInstanceId!, controller: ctx.owner, cost: 0, text: 'discard a card from your deck', then: resume(ctx) }) : s))),
  ifYouDo: (s, ctx) => {
    const [next, milled] = millTop(s, ctx.owner, 1)
    return milled.length && !printedUnit(next.cards[milled[0]]) ? damageChoice(next, ctx, 2, picked(next, ctx, pickGround)) : next
  },
})
registerCard('SOR_045', { // Yoda
  ...defeated(whenPlayed('Choose any number of players. They each draw a card.', (s, ctx) =>
    pushChoice(s, { kind: 'mayPayThen', id: ctx.sourceInstanceId!, controller: ctx.owner, cost: 0, text: 'choose yourself to draw a card', then: resume(ctx, 'you'), declineStep: 'notYou' }))),
  ifYouDo: (s, ctx) => {
    if (ctx.step === 'them') return drawCards(s, opponentOf(ctx.owner), 1)
    if (ctx.step === 'notThem') return s
    const next = ctx.step === 'you' ? drawCards(s, ctx.owner, 1) : s
    return pushChoice(next, { kind: 'mayPayThen', id: `${ctx.sourceInstanceId}-them`, controller: ctx.owner, cost: 0, text: 'choose your opponent to draw a card', then: resume(ctx, 'them'), declineStep: 'notThem' })
  },
})
registerCard('SOR_145', { // K-2SO
  ...defeated(whenPlayed("For each opponent, choose one: either deal 3 damage to that player's base, or that player discards a card from their hand.", (s, ctx) =>
    pushChoice(s, { kind: 'mayPayThen', id: ctx.sourceInstanceId!, controller: ctx.owner, cost: 0, text: "deal 3 damage to your opponent's base (otherwise they discard a card from their hand)", then: resume(ctx, 'base'), declineStep: 'discard' }))),
  ifYouDo: (s, ctx) => (ctx.step === 'base' ? dealDamageToBase(s, opponentOf(ctx.owner), 3) : opponentDiscards(s, ctx.owner, ctx.sourceInstanceId!)),
})
registerCard('LOF_200', { // Qui-Gon Jinn
  ...defeated(whenPlayed("You may choose a non-leader ground unit. Its owner puts it on the top or bottom of their deck.", (s, ctx) =>
    unitThen(s, ctx, pickedIds(s, ctx, pickAll(pickGround, (st, u) => nonLeader(st, u))), 'choose a non-leader ground unit for its owner to put on their deck', true))),
  ifYouDo: (s, ctx) => {
    if (ctx.step === 'top' || ctx.step === 'bottom') return unitToDeck(s, ctx.unitChosen!, ctx.step)
    const found = findUnit(s, ctx.targetInstanceId!)
    if (!found) return s
    // Its owner decides, which is not always the player resolving the ability.
    return pushChoice(s, {
      kind: 'mayPayThen', id: `${ctx.sourceInstanceId}-deck`, controller: found.unit.owner ?? found.owner, cost: 0,
      text: `put ${s.cards[found.unit.cardId]?.name ?? 'the unit'} on the top of your deck (otherwise the bottom)`, then: resume(ctx, 'top', found.unit.instanceId), declineStep: 'bottom',
    })
  },
})
registerCard('TS26_39', { // Captain Vaughn
  // The search settles before the hand card is chosen, so the card it draws can be the one put back.
  ...defeated(whenPlayed('Search the top 3 cards of your deck for a card and draw it. Then, put a card from your hand on top of your deck.', (s, ctx) =>
    (s.players[ctx.owner].deck.length
      ? searchDrawChoice(s, ctx, 3, () => true, 1, resume(ctx, 'hand'))
      : handCardThen(s, ctx, 'put a card from your hand on top of your deck', 'top')))),
  ifYouDo: (s, ctx) => (ctx.step === 'hand' ? handCardThen(s, ctx, 'put a card from your hand on top of your deck', 'top') : handToDeck(s, ctx.owner, ctx.handIndex, 'top')),
})
/** The defeated card itself, out of whichever discard pile it went to and into play as a ready resource. */
const resourceDefeatedReady = (s: GameState, ctx: { owner: PlayerId; cardId: string }): GameState => {
  const pile = [ctx.owner, opponentOf(ctx.owner)].find(p => s.players[p].discard.includes(ctx.cardId))
  if (!pile) return s
  const discard = s.players[pile].discard
  const at = discard.lastIndexOf(ctx.cardId)
  const removed = updatePlayer(s, pile, { discard: discard.filter((_, i) => i !== at) })
  return updatePlayer(removed, ctx.owner, { resources: [...removed.players[ctx.owner].resources, { cardId: ctx.cardId, exhausted: false }] })
}
const superlaserTechnician = defeated(mayPayWp('You may put this unit into play as a resource and ready it.', 0, 'put this unit into play as a resource and ready it', resourceDefeatedReady))
registerCard('SHD_085', superlaserTechnician) // Superlaser Technician
registerCard('SOR_083', superlaserTechnician) // Superlaser Technician (a different card with the same text: 2/1 rather than 2/3)

// C: the next unit played, and a constant ability alongside
registerCard('SEC_261', defeated(whenPlayed('The next Official unit you play this phase costs 1 less.', (s, ctx) => // Inspiring Senator
  grantNextUnit(s, ctx.owner, { costDelta: -1, trait: 'Official' }))))
registerCard('LOF_180', defeated(whenPlayed('The next unit you play this phase gains Ambush for this phase.', (s, ctx) => // Deceptive Shade
  grantNextUnit(s, ctx.owner, { keywords: [KW.ambush] }))))
/** "Another Resistance card (unit, upgrade, or leader)" its controller controls. An undeployed leader counts. */
const controlsAnotherResistanceCard: Holds = (s, u) => {
  const owner = unitOwner(s, u)
  if (!owner) return false
  const resistance = (cardId: string) => printedTrait(s.cards[cardId], 'Resistance')
  return friendliesOf(s, u).some(x => x.instanceId !== u.instanceId && unitHasTrait(s, x, 'Resistance'))
    || allUnits(s).some(x => x.upgrades.some(up => up.owner === owner && resistance(up.cardId)))
    || resistance(s.players[owner].leader.cardId)
}
registerCard('JTL_104', { // Raddus
  ...gains(controlsAnotherResistanceCard, KW.sentinel),
  // His power as he last was in play.
  ...whenDefeated("Deal damage equal to this unit's power to an enemy unit.", (s, ctx) => {
    const power = ctx.defeatedUnit ? effectivePower(s, ctx.defeatedUnit) : 0
    return power > 0 ? damageChoice(s, ctx, power, s.players[opponentOf(ctx.owner)].units) : s
  }),
})
/** A card whose own printed abilities include a When Defeated. */
const hasWhenDefeated = (cardId: string): boolean => getCardDefinition(cardId)?.abilities?.some(a => a.trigger === 'whenDefeated') ?? false
registerCard('JTL_032', { // Director Krennic
  // Units are played only in the action phase, so this phase's plays are the round's.
  costDiscount: (s, _source, ctx) =>
    (ctx.card.type === 'unit' && hasWhenDefeated(ctx.card.id)
      && !cardsPlayedThisPhase(s, ctx.owner).some(id => s.cards[id]?.type === 'unit' && hasWhenDefeated(id)) ? -1 : 0),
})

// ── Bases ─────────────────────────────────────────────────────────────────────────────────────────
// A base is never played, never leaves play and is not a unit, so its ability belongs to the player
// whose base zone holds it. An "Epic Action" is that player's action, once each game; a constant is
// an aura over units in play with the controller in place of a source unit.

/** The source a base's ability hands its effect: the base card, which names no unit in play. */
const baseSide = (cardId: string): string => `${cardId}-base`
interface EpicSpec {
  /** Offered only while this holds, so the one use a game is never spent for nothing. */
  usable?: When
  effect: (s: GameState, ctx: Resumable) => GameState
}
/** "Epic Action: <effect>" on a base. */
const baseEpic = (description: string, spec: EpicSpec): CardDefinition => ({
  baseAbilities: {
    epicAction: {
      description,
      usable: (s, owner) => spec.usable?.(s, { owner }) ?? true,
      effect: (s, ctx) => spec.effect(s, { owner: ctx.owner, cardId: ctx.cardId, sourceInstanceId: baseSide(ctx.cardId) }),
    },
  },
})

// A: Epic Actions that pick a target, a card or a pile
registerCard('SOR_019', baseEpic('Give a Shield token to a non-leader unit.', { // Security Complex
  usable: anyUnitPasses(nonLeader),
  effect: (s, ctx) => shieldChoice(s, ctx, pickedIds(s, ctx, nonLeader), false),
}))
const damagedNonLeader = pickAll(nonLeader, damaged)
registerCard('SOR_025', baseEpic('Deal 3 damage to a damaged non-leader unit.', { // Tarkintown
  usable: anyUnitPasses(damagedNonLeader),
  effect: (s, ctx) => damageChoice(s, ctx, 3, picked(s, ctx, damagedNonLeader)),
}))
registerCard('SOR_028', baseEpic('Give a non-leader unit -4/-0 for this phase.', { // Jedha City
  usable: anyUnitPasses(nonLeader),
  effect: (s, ctx) => lastingBuffChoice(s, ctx, pickedIds(s, ctx, nonLeader), { power: -4 }),
}))
const SARLACC = 'The Sarlacc of Carkoon'
registerCard('LAW_023', { // Great Pit of Carkoon
  ...baseEpic(`[Discard a unit from your hand]: Search your deck for a card named ${SARLACC}, reveal it, and draw it.`, {
    usable: (s, ctx) => s.players[ctx.owner].hand.some(id => printedUnit(s.cards[id])),
    effect: (s, ctx) => handCardThen(s, ctx, 'discard a unit from your hand', 'cost', printedUnit),
  }),
  // The whole deck is searched, so the window is its length. The card prints no shuffle.
  ifYouDo: (s, ctx) => {
    const discarded = discardFromHand(s, ctx.owner, ctx.handIndex!)
    return searchDrawChoice(discarded, ctx, discarded.players[ctx.owner].deck.length, c => c?.name === SARLACC)
  },
})
/** Move `cardId` out of its owner's discard pile and onto the top of their deck. */
const discardToTop = (s: GameState, owner: PlayerId, cardId: string): GameState => {
  const discard = s.players[owner].discard
  const at = discard.lastIndexOf(cardId)
  return at === -1 ? s : updatePlayer(s, owner, { discard: discard.filter((_, i) => i !== at), deck: [cardId, ...s.players[owner].deck] })
}
registerCard('LAW_026', { // Shipbreaking Yard
  ...baseEpic('Discard 3 cards from your deck. You may return a card discarded this way to the top of your deck.', {
    usable: (s, ctx) => s.players[ctx.owner].deck.length > 0,
    effect: (s, ctx) => {
      const [next, milled] = millTop(s, ctx.owner, 3)
      return milled.length ? pushChoice(next, { kind: 'selectCardThen', id: ctx.sourceInstanceId!, controller: ctx.owner, candidates: milled, optional: true, text: 'return a card discarded this way to the top of your deck', then: resume(ctx) }) : next
    },
  }),
  ifYouDo: (s, ctx) => discardToTop(s, ctx.owner, ctx.cardChosen!),
})

// B: Epic Actions that play a unit, or repeat for each friendly leader unit
/** "Epic Action: Play a unit from your hand …", offered only while there is one to play. */
const basePlay = (description: string, o: (s: GameState, owner: PlayerId) => PlayFromHandOptions): CardDefinition =>
  baseEpic(description, {
    usable: (s, ctx) => playableFromHand(s, ctx.owner, o(s, ctx.owner)).length > 0,
    effect: (s, ctx) => playFromHand(s, ctx, o(s, ctx.owner)),
  })
registerCard('SOR_022', basePlay('Play a unit that costs 6 or less from your hand. Give it Ambush for this phase.', // Energy Conversion Lab
  () => ({ test: printedCostAtMost(6), gains: [KW.ambush] })))
/** Friendly leader units, which is what "for each friendly leader unit" counts (The Darksaber makes one). */
const leaderUnitCount = (s: GameState, owner: PlayerId): number => s.players[owner].units.filter(u => isLeaderUnit(s, u)).length
registerCard('TS26_10', basePlay('Play a unit from your hand. It costs 1 less for each friendly leader unit.', // Dooku's Palace
  (s, owner) => { const n = leaderUnitCount(s, owner); return n > 0 ? { costDelta: -n } : {} }))
/**
 * "For each friendly leader unit, you may deal 2 damage to a unit": asked one at a time, so each
 * offer reads the units still in play after the one before it resolved. A decline resumes too
 * (`hookOnDecline`), so passing on the first leader unit's damage does not swallow the second's.
 */
const executionerOffer = (s: GameState, ctx: Resumable, i: number): GameState => {
  const targets = allUnits(s).map(u => u.instanceId)
  return i < leaderUnitCount(s, ctx.owner) && targets.length
    ? pushChoice(s, { kind: 'selectUnitThen', id: `${ctx.sourceInstanceId}-${i}`, controller: ctx.owner, targets, text: 'deal 2 damage to a unit', then: resume(ctx, `dmg:${i}`), optional: true, hookOnDecline: true })
    : s
}
registerCard('TS26_11', { // Executioner's Arena
  ...baseEpic('For each friendly leader unit, you may deal 2 damage to a unit.', {
    usable: (s, ctx) => leaderUnitCount(s, ctx.owner) > 0 && allUnits(s).length > 0,
    effect: (s, ctx) => executionerOffer(s, ctx, 0),
  }),
  ifYouDo: (s, ctx) => {
    const i = Number((ctx.step ?? 'dmg:0').slice('dmg:'.length))
    return executionerOffer(ctx.targetInstanceId ? dealDamageToUnit(s, ctx.targetInstanceId, 2) : s, ctx, i + 1)
  },
})

// C: constants. An aura from a base reads its controller's leader units; the setup numbers are read
// where the game is set up (`initGame`) and where a deck list is checked (`parseProtectThePod`).
/** "Each leader unit you control gets <buff>." */
const leaderUnitAura = (buff: AuraContribution): CardDefinition => ({
  baseAbilities: {
    aura: (s, _owner, target, sameController) => (sameController && isLeaderUnit(s, target) ? buff : undefined),
  },
})
registerCard('TWI_019', leaderUnitAura({ hp: 1 })) // Pau City
registerCard('TWI_028', leaderUnitAura({ power: 1 })) // Petranaki Arena
registerCard('JTL_021', { baseAbilities: { startingHandDelta: -1 } }) // Colossus
registerCard('JTL_024', { baseAbilities: { deckMinimumDelta: 10 } }) // Data Vault
registerCard('JTL_025', { baseAbilities: { deckMinimumDelta: -5 } }) // Thermal Oscillator

// ══ Experience tokens ═════════════════════════════════════════════════
// An Experience token is a +1/+1 upgrade an ability attaches (CR 3.7.2), so the machinery is the token
// machinery: `giveTokens` attaches and fires the attach event once, `mayGiveTokens` offers one target,
// and the stats pipeline reads the +1/+1 off the token card like any other upgrade. These cards are
// therefore registrations, and the helpers below are the Experience-shaped spellings of `shieldChoice`
// and friends.

/** "Give `count` Experience tokens to a unit that ...", or nothing when nothing is eligible. */
const expChoice = (s: GameState, ctx: EventCtx, targets: string[], count = 1, optional = false, id?: string): GameState =>
  targets.length
    ? pushChoice(s, { kind: 'mayGiveTokens', id: id ?? ctx.sourceInstanceId!, controller: ctx.owner, token: TOKEN_EXPERIENCE, count, targets, optional })
    : s
/** "Give `count` Experience tokens to this unit." */
const expSelf = (s: GameState, ctx: EventCtx, count = 1): GameState => giveTokens(s, ctx.sourceInstanceId!, TOKEN_EXPERIENCE, count)
/** "(If ...,) give `count` Experience tokens to this unit", the count read as the ability resolves. */
const expSelfWp = (description: string, count: number | ((s: GameState, ctx: EventCtx) => number) = 1, when: When = always) =>
  whenPlayed(description, (s, ctx) => (when(s, ctx) ? expSelf(s, ctx, typeof count === 'number' ? count : count(s, ctx)) : s))
/** "(If ...,) (you may) give `count` Experience tokens to a unit that ...". */
const expWp = (description: string, test: Pick, count = 1, optional = false, when: When = always) =>
  whenPlayed(description, (s, ctx) => (when(s, ctx) ? expChoice(s, ctx, pickedIds(s, ctx, test), count, optional) : s))

// A: the token goes on the unit itself.
registerCard('LAW_037', attacks('Give an Experience token to this unit.', (s, ctx) => expSelf(s, ctx))) // Han Solo
registerCard('LAW_055', expSelfWp('Give an Experience token to this unit. If you control a Cunning or Vigilance unit, give 2 instead.', // Chopper
  (s, ctx) => (youControl(s, ctx, pickOther, pickAspect('Cunning', 'Vigilance')) ? 2 : 1)))
registerCard('LOF_092', whenPlayed('If you control a Jedi unit, you may give an Experience token to this unit.', (s, ctx) => // Point Rain Reclaimer
  (youControl(s, ctx, pickTrait('Jedi')) ? expChoice(s, ctx, [ctx.sourceInstanceId!], 1, true) : s)))
registerCard('SHD_096', { // Maz Kanata
  // `whenPlayUnit` fires on the controller's OTHER units, which is exactly "another unit".
  abilities: [{ trigger: 'whenPlayUnit', description: 'Give an Experience token to this unit.', effect: (s, ctx) => expSelf(s, ctx) }],
})
/** How many different aspects appear among a player's units, counting both icons on a dual-aspect card. */
const aspectsAmongUnits = (s: GameState, owner: PlayerId): number =>
  new Set(s.players[owner].units.flatMap(u => cardOf(s, u)?.aspects ?? [])).size
registerCard('LAW_147', expSelfWp('Give an Experience token to this unit for each different aspect among units you control.', // Jaunty Light Freighter
  (s, ctx) => aspectsAmongUnits(s, ctx.owner)))
registerCard('SEC_089', expSelfWp('Give an Experience token to this unit for each ground unit you control.', // PreMor Personnel Carrier
  (s, ctx) => unitsIn(s, ctx.owner, 'ground').length))
registerCard('SEC_035', { // Darth Sion
  abilities: [
    { trigger: 'whenPlayed', description: 'Give an Experience token to this unit for each enemy unit that was defeated this phase.',
      effect: (s, ctx) => expSelf(s, ctx, defeatedThisPhase(s, opponentOf(ctx.owner)).length) },
    // He is already in the discard when this resolves, so the power is read off `defeatedUnit`, the
    // snapshot taken at the moment of defeat, and the return is a discard-to-hand move.
    { trigger: 'whenDefeated', description: "If this unit had 7 or more power, return him to his owner's hand.",
      effect: (s, ctx) => (ctx.defeatedUnit && effectivePower(s, ctx.defeatedUnit) >= 7 ? returnCardFromDiscardToHand(s, ctx.owner, ctx.defeatedUnit.cardId) : s) },
  ],
})
registerCard('SOR_191', expSelfWp('Give an Experience token to this unit for each other card you played this phase.', // Vanguard Ace
  // This unit's own play is already recorded when its When Played resolves, so it is discounted here.
  (s, ctx) => Math.max(0, cardsPlayedThisPhase(s, ctx.owner).length - 1)))
registerCard('LAW_034', { abilities: [{ trigger: 'onAttackEnd', description: 'If the defending unit was defeated, give an Experience token to this unit and heal 3 damage from him.', effect: (s, ctx) => // Chewbacca
  (ctx.defenderDefeated ? healUnit(expSelf(s, ctx), ctx.sourceInstanceId!, 3) : s) }] })
registerCard('TS26_77', mayPayWp('You may pay 2. If you do, give an Experience token and a Shield token to this unit.', 2, 'give an Experience token and a Shield token to this unit', // Deployed Droideka
  (s, ctx) => giveMixedTokens(s, ctx.sourceInstanceId!, [TOKEN_EXPERIENCE, TOKEN_SHIELD])))
registerCard('LAW_231', expSelfWp('If no resources were paid to play this unit, give an Experience token to it.', 1, // Weequay Pirate
  (s, ctx) => (selfOf(s, ctx)?.resourcesPaidToPlay ?? 0) === 0))
registerCard('JTL_096', mayPayWp('You may pay 2. If you do, move this unit to the ground arena and give 2 Experience tokens to it.', 2, 'move this unit to the ground arena and give it 2 Experience tokens', // Blue Leader
  (s, ctx) => expSelf(moveUnitToArena(s, ctx.sourceInstanceId!, 'ground'), ctx, 2)))

// B: a fixed number of tokens on a chosen unit. "A unit" is either side's; "friendly" and "another"
// narrow it, exactly as they do for the Shield and Advantage cards above.
const pickUnique: Pick = (s, u) => s.cards[u.cardId]?.unique === true
registerCard('SHD_040', expWp('Give an Experience token to a unit.', pickAny)) // Clan Wren Rescuer
registerCard('LAW_249', expWp('Give an Experience token to another friendly Underworld unit.', pickAll(pickOther, pickFriendly, pickTrait('Underworld')))) // Black Sun Cabalist
registerCard('LAW_059', allOf( // Highsinger
  expWp('Give an Experience token to another friendly Command unit.', pickAll(pickOther, pickFriendly, pickAspect('Command'))),
  defeated(expWp('Give an Experience token to a friendly Aggression unit.', pickAll(pickFriendly, pickAspect('Aggression')))),
))
registerCard('SEC_095', expWp('If an opponent controls an upgrade, give an Experience token to a unit.', pickAny, 1, false, // Theed Security
  // Tokens are upgrades (CR 3.7.2), so a Shield on an enemy unit satisfies this as a card upgrade does.
  (s, ctx) => s.players[opponentOf(ctx.owner)].units.some(u => u.upgrades.length > 0)))
registerCard('SHD_082', expWp('You may give an Experience token to another unit that costs 3 or less.', pickAll(pickOther, costsAtMost(3)), 1, true)) // Outland TIE Vanguard
registerCard('SHD_258', expWp('You may give an Experience token to another Mandalorian unit.', pickAll(pickOther, pickTrait('Mandalorian')), 1, true)) // Mandalorian Warrior
registerCard('SOR_231', expWp('Give 2 Experience tokens to another friendly Imperial unit.', pickAll(pickOther, pickFriendly, pickTrait('Imperial')), 2)) // TIE Advanced
registerCard('SOR_241', expWp('Give 2 Experience tokens to another friendly Rebel unit.', pickAll(pickOther, pickFriendly, pickTrait('Rebel')), 2)) // Wing Leader
registerCard('LAW_142', defeated(expWp('Give an Experience token to a friendly Rebel unit.', pickAll(pickFriendly, pickTrait('Rebel'))))) // Scarif Lieutenant
registerCard('SOR_108', defeated(expWp('You may give an Experience token to a unit.', pickAny, 1, true))) // Vanguard Infantry
registerCard('LOF_095', defeated(expWp('You may give an Experience token to a unique unit.', pickUnique, 1, true))) // Lor San Tekka
registerCard('SEC_027', defeated(expWp('If you control Chancellor Palpatine, you may give an Experience token to a unit.', pickAny, 1, true, // The Chancellor's Shuttle
  (s, ctx) => playerControlsNamed(s, ctx.owner, 'Chancellor Palpatine'))))
registerCard('SOR_049', defeated(unitThenWp('Give 2 Experience tokens to another friendly unit. If it\'s a Force unit, draw a card.', // Obi-Wan Kenobi
  pickAll(pickOther, pickFriendly), 'give it 2 Experience tokens', false,
  (s, ctx) => {
    const target = findUnit(s, ctx.targetInstanceId!)
    if (!target) return s
    const given = giveTokens(s, ctx.targetInstanceId!, TOKEN_EXPERIENCE, 2)
    return unitHasTrait(given, target.unit, 'Force') ? drawCards(given, ctx.owner, 1) : given
  })))
registerCard('LAW_067', whenPlayed('Either give an Experience token to a unit or exhaust a unit.', (s, ctx) => { // Jyn Erso
  // Both halves need a unit in play, so either both modes are offered or neither is (as Leia Organa does).
  const modes = allUnits(s).length ? ['giveExperience', 'exhaustUnit'] : []
  return modes.length ? pushChoice(s, { kind: 'chooseMode', id: ctx.sourceInstanceId!, controller: ctx.owner, modes }) : s
}))
registerCard('TS26_54', defeated(whenPlayed('An opponent may give an Experience token to a unit.', (s, ctx) => { // Wartime Mercenaries
  const opp = opponentOf(ctx.owner)
  const targets = allUnits(s).map(u => u.instanceId)
  return targets.length ? pushChoice(s, { kind: 'mayGiveTokens', id: ctx.sourceInstanceId!, controller: opp, token: TOKEN_EXPERIENCE, count: 1, targets, optional: true }) : s
})))

// C: a token on each of several units. "Each" is applied outright; "each of up to N" is `eachOfUpTo`,
// one pick at a time with Done available, which is how the engine resolves every repeated effect.
/** "Give `count` Experience tokens to each unit that ...", no choice: the picking is already settled. */
const expEach = (s: GameState, ctx: EventCtx, test: Pick, count = 1): GameState =>
  pickedIds(s, ctx, test).reduce((acc, id) => giveTokens(acc, id, TOKEN_EXPERIENCE, count), s)
/** One pick of an "each of up to N Experience tokens" offer. */
const expEachPick = (s: GameState, _ctx: IfYouDoContext, id: string): GameState => giveToken(s, id, TOKEN_EXPERIENCE)
const expUpTo = (description: string, n: number, text: string, test: Pick, when: When = always): CardDefinition =>
  eachOfUpTo(description, n, { text, test, apply: expEachPick }, when)

registerCard('SEC_252', defeated(whenPlayed('Give an Experience token to each friendly Rebel unit.', (s, ctx) => // Maarva Andor
  expEach(s, ctx, pickAll(pickFriendly, pickTrait('Rebel'))))))
registerCard('SOR_037', whenPlayed('Give an Experience token to each friendly damaged unit.', (s, ctx) => // Academy Defense Walker
  expEach(s, ctx, pickAll(pickFriendly, damaged))))
registerCard('LOF_055', { // Dume
  abilities: [{ trigger: 'whenRegroupStarts', description: 'Give an Experience token to each other friendly non-Vehicle unit.',
    effect: (s, ctx) => expEach(s, ctx, pickAll(pickOther, pickFriendly, (st, u) => !unitHasTrait(st, u, 'Vehicle'))) }],
})
const tagge = expUpTo('Give an Experience token to each of up to 3 Trooper units.', 3, 'give an Experience token to a Trooper unit (up to 3)', pickTrait('Trooper'))
registerCard('SHD_081', tagge) // General Tagge
registerCard('SOR_080', tagge) // General Tagge, the SOR printing: same text, a separate card id
registerCard('LOF_099', expUpTo('You may give an Experience token to each of up to 3 Force units.', 3, 'give an Experience token to a Force unit (up to 3)', pickTrait('Force'))) // Paladin Training Corvette
registerCard('SEC_124', expUpTo('Give an Experience token to each of up to 3 Official units.', 3, 'give an Experience token to an Official unit (up to 3)', pickTrait('Official'))) // Budget Scheming
registerCard('LOF_241', expUpTo('Give an Experience token to each of up to 3 friendly units with Hidden.', 3, 'give an Experience token to a friendly unit with Hidden (up to 3)', // In the Shadows
  pickAll(pickFriendly, (_s, u) => u.hidden === true)))
registerCard('SOR_245', expUpTo('Give an Experience token to each of up to 3 Rebel units that attacked this phase.', 3, 'give an Experience token to a Rebel unit that attacked this phase (up to 3)', // Medal Ceremony
  pickAll(pickTrait('Rebel'), (s, u) => attackedThisPhase(s).includes(u.instanceId))))
registerCard('TS26_60', { // Take Charge
  ...perLeaderUnitDiscount,
  ...expUpTo('Give an Experience token to each of up to 3 units.', 3, 'give an Experience token to a unit (up to 3)', pickAny),
})

// D: the number of tokens is decided as the ability resolves — by what is paid, revealed, named or
// carried. `chooseNumber` asks for the count and hands it back as `optionIndex`.
const readyResources = (s: GameState, owner: PlayerId): number => s.players[owner].resources.filter(r => !r.exhausted).length
/** Exhaust `n` ready resources, one at a time through the one door that exhausts one. */
const payResources = (s: GameState, owner: PlayerId, n: number): GameState =>
  Array.from({ length: n }).reduce<GameState>(acc => exhaustReadyResource(acc, owner), s)
const chooseNumberUpTo = (s: GameState, ctx: Resumable, max: number, text: string, step?: string, unit?: string): GameState =>
  (max > 0 ? pushChoice(s, { kind: 'chooseNumber', id: ctx.sourceInstanceId!, controller: ctx.owner, max, text, then: resume(ctx, step, unit) }) : s)

registerCard('SEC_040', { // Emergency Powers
  ...whenPlayed('Choose a non-leader unit and pay any number of resources. For each resource paid this way, give an Experience token to the chosen unit.',
    (s, ctx) => unitThen(s, ctx, pickedIds(s, ctx, nonLeader), 'choose a non-leader unit', false, 'target')),
  ifYouDo: (s, ctx) => {
    if (ctx.step === 'target') return chooseNumberUpTo(s, ctx, readyResources(s, ctx.owner), 'choose how many resources to pay', 'pay', ctx.targetInstanceId)
    const n = ctx.optionIndex ?? 0
    return giveTokens(payResources(s, ctx.owner, n), ctx.unitChosen!, TOKEN_EXPERIENCE, n)
  },
})
registerCard('LOF_255', { // Curious Flock
  ...whenPlayed('Pay up to 6. For each resource paid this way, give an Experience token to this unit.',
    (s, ctx) => chooseNumberUpTo(s, ctx, Math.min(6, readyResources(s, ctx.owner)), 'choose how many resources to pay (up to 6)')),
  ifYouDo: (s, ctx) => {
    const n = ctx.optionIndex ?? 0
    return expSelf(payResources(s, ctx.owner, n), ctx, n)
  },
})
registerCard('SOR_035', { // Lieutenant Childsen
  // Revealing is free and public, so the only decision is how many to show; the engine does not model
  // hidden information beyond the count, and `chooseNumber` is exactly that decision.
  ...whenPlayed('Reveal up to 4 Vigilance cards from your hand. For each card revealed this way, give an Experience token to this unit.',
    (s, ctx) => chooseNumberUpTo(s, ctx, Math.min(4, s.players[ctx.owner].hand.filter(id => printedAspect(s.cards[id], 'Vigilance')).length),
      'choose how many Vigilance cards to reveal (up to 4)')),
  ifYouDo: (s, ctx) => expSelf(s, ctx, ctx.optionIndex ?? 0),
})
registerCard('SEC_260', { // Inspector's Shuttle
  ...whenPlayed('Name a card, then an opponent reveals their hand. For each copy of the named card in their hand, give an Experience token to this unit.',
    (s, ctx) => pushChoice(s, { kind: 'nameCard', id: ctx.sourceInstanceId!, controller: ctx.owner, unitId: ctx.sourceInstanceId!, then: resume(ctx) })),
  ifYouDo: (s, ctx) => expSelf(s, ctx, s.players[opponentOf(ctx.owner)].hand.filter(id => s.cards[id]?.name === ctx.nameChosen).length),
})
registerCard('SHD_039', { // Calculated Lethality
  ...whenPlayed('Defeat a non-leader unit that costs 3 or less. For each upgrade that was on that unit, give an Experience token to a friendly unit.',
    (s, ctx) => unitThen(s, ctx, pickedIds(s, ctx, pickAll(nonLeader, costsAtMost(3))), 'defeat a non-leader unit that costs 3 or less', false, 'left:0')),
  ifYouDo: (s, ctx) => {
    // First pass: the pick is the unit to defeat, and its upgrade count (tokens included, CR 3.7.2)
    // is read before it leaves play. After that each pass hands out one of those tokens.
    if (ctx.step === 'left:0') {
      const victim = findUnit(s, ctx.targetInstanceId!)
      if (!victim) return s
      return calculatedPayout(defeatUnit(s, ctx.targetInstanceId!), ctx, victim.unit.upgrades.length)
    }
    const left = stepCount(ctx.step) - 1
    return calculatedPayout(ctx.targetInstanceId ? giveToken(s, ctx.targetInstanceId, TOKEN_EXPERIENCE) : s, ctx, left)
  },
})
/** Hand out the remaining Calculated Lethality tokens, one friendly unit at a time. */
function calculatedPayout(s: GameState, ctx: Resumable, left: number): GameState {
  const targets = pickedIds(s, ctx, pickFriendly)
  return left > 0 && targets.length
    ? pushChoice(s, { kind: 'selectUnitThen', id: `${ctx.sourceInstanceId}-${left}`, controller: ctx.owner, targets, text: `give an Experience token to a friendly unit (${left} left)`, then: resume(ctx, `left:${left}`) })
    : s
}
registerCard('TS26_51', { // Lom Pyke
  // Two players, so "in player order, each opponent" is the one opponent, and "for each player that
  // does" is 2 tokens or none. A cost of 0 makes `mayPayThen` the plain yes/no the card asks for.
  ...whenPlayed('In player order, each opponent may heal 5 damage from their base. For each player that does, give 2 Experience tokens to a unit.',
    (s, ctx) => pushChoice(s, { kind: 'mayPayThen', id: ctx.sourceInstanceId!, controller: opponentOf(ctx.owner), cost: 0, text: 'heal 5 damage from your base', then: resume(ctx) })),
  ifYouDo: (s, ctx) => expChoice(healBase(s, opponentOf(ctx.owner), 5), ctx, allUnits(s).map(u => u.instanceId), 2),
})

// E: a token alongside something else — an exhaust, a defeat, a play from hand, an attack, damage.
/** "<Do something> to a unit, then give it `count` Experience tokens": one pick, both halves applied. */
const expAfter = (description: string, test: Pick, text: string, optional: boolean, first: (s: GameState, id: string, ctx: IfYouDoContext) => GameState, count = 1, mixed: readonly string[] = []): CardDefinition => ({
  ...whenPlayed(description, (s, ctx) => unitThen(s, ctx, pickedIds(s, ctx, test), text, optional)),
  ifYouDo: (s, ctx) => {
    const id = ctx.targetInstanceId
    if (!id) return s
    const after = first(s, id, ctx)
    // Still in play? A defeat that removed it leaves nothing to put a token on.
    if (!findUnit(after, id)) return after
    return mixed.length ? giveMixedTokens(after, id, mixed) : giveTokens(after, id, TOKEN_EXPERIENCE, count)
  },
})
registerCard('LAW_165', expAfter('Exhaust a friendly unit. If you do, give 2 Experience tokens to it.', // Combat Exercise
  pickAll(pickFriendly, readyUnitPick), 'exhaust a friendly unit', false, (s, id) => exhaustUnit(s, id), 2))
registerCard('LOF_054', expAfter('Exhaust a friendly unit. If you do, give a Shield token and 2 Experience tokens to it.', // Calm in the Storm
  pickAll(pickFriendly, readyUnitPick), 'exhaust a friendly unit', false, (s, id) => exhaustUnit(s, id), 2,
  [TOKEN_SHIELD, TOKEN_EXPERIENCE, TOKEN_EXPERIENCE]))
registerCard('LOF_239', { // Consumed by the Dark Side
  ...whenPlayed('Give 2 Experience tokens to a unit, then deal 2 damage to it.',
    (s, ctx) => unitThen(s, ctx, pickedIds(s, ctx, pickAny), 'give 2 Experience tokens to a unit, then deal 2 damage to it', false)),
  // In the printed order: the tokens land first, so the +2/+2 is what the 2 damage is measured against.
  ifYouDo: (s, ctx) => (ctx.targetInstanceId ? dealDamageToUnit(giveTokens(s, ctx.targetInstanceId, TOKEN_EXPERIENCE, 2), ctx.targetInstanceId, 2) : s),
})
registerCard('LOF_263', expWp('If a friendly unit was defeated this phase, give 2 Experience tokens to a unit.', pickAny, 2, false, friendlyWasDefeated)) // Last Words
registerCard('LAW_168', { // Haymaker
  ...whenPlayed('Give an Experience token to a friendly unit. That unit deals damage equal to its power to an enemy unit in the same arena.',
    (s, ctx) => unitThen(s, ctx, pickedIds(s, ctx, pickFriendly), 'give an Experience token to a friendly unit', false, 'give')),
  ifYouDo: (s, ctx) => {
    const id = ctx.step === 'give' ? ctx.targetInstanceId! : ctx.unitChosen!
    if (ctx.step === 'give') {
      const given = giveToken(s, id, TOKEN_EXPERIENCE)
      const dealer = findUnit(given, id)?.unit
      if (!dealer) return given
      // Power is read after the token, which is the point of giving it first.
      const targets = pickedIds(given, ctx, pickAll(pickEnemy, (_s, u) => u.arena === dealer.arena))
      return targets.length ? unitThen(given, ctx, targets, 'deal damage equal to its power to an enemy unit in the same arena', false, 'hit', id) : given
    }
    const dealer = findUnit(s, id)?.unit
    return dealer && ctx.targetInstanceId ? dealDamageToUnit(s, ctx.targetInstanceId, effectivePower(s, dealer)) : s
  },
})
registerCard('JTL_091', { // Apology Accepted
  ...whenPlayed('Defeat a friendly unit. You may give 2 Experience tokens to a unit.',
    (s, ctx) => unitThen(s, ctx, pickedIds(s, ctx, pickFriendly), 'defeat a friendly unit', false)),
  ifYouDo: (s, ctx) => (ctx.targetInstanceId ? expChoice(defeatUnit(s, ctx.targetInstanceId), ctx, allUnits(defeatUnit(s, ctx.targetInstanceId)).map(u => u.instanceId), 2, true, `${ctx.sourceInstanceId}-exp`) : s),
})
registerCard('JTL_055', { // You're All Clear, Kid
  ...whenPlayed('Defeat an enemy space unit with 3 or less remaining HP. If you do and an opponent controls no space units, you may give an Experience token to a unit.',
    (s, ctx) => unitThen(s, ctx, pickedIds(s, ctx, pickAll(pickEnemy, pickArena('space'), (st, u) => remainingHp(st, u) <= 3)), 'defeat an enemy space unit with 3 or less remaining HP', false)),
  ifYouDo: (s, ctx) => {
    if (!ctx.targetInstanceId) return s
    const after = defeatUnit(s, ctx.targetInstanceId)
    return unitsIn(after, opponentOf(ctx.owner), 'space').length === 0
      ? expChoice(after, ctx, allUnits(after).map(u => u.instanceId), 1, true, `${ctx.sourceInstanceId}-exp`)
      : after
  },
})
registerCard('TS26_58', { // Backed by the Pykes
  ...whenPlayed('Give an Experience token to a friendly unit. You may deal damage to a unit equal to the number of Experience tokens on friendly units.',
    (s, ctx) => unitThen(s, ctx, pickedIds(s, ctx, pickFriendly), 'give an Experience token to a friendly unit', false)),
  ifYouDo: (s, ctx) => {
    if (!ctx.targetInstanceId) return s
    const given = giveToken(s, ctx.targetInstanceId, TOKEN_EXPERIENCE)
    // Counted after the grant, so the token just given is included.
    const n = given.players[ctx.owner].units.reduce((acc, u) => acc + u.upgrades.filter(up => up.cardId === TOKEN_EXPERIENCE).length, 0)
    return damageChoice(given, ctx, n, allUnits(given), [], true)
  },
})
registerCard('LAW_257', mayPayWp('You may pay 1. If you do, give an Experience token to another unit.', 1, 'give an Experience token to another unit', // Hidden Hand Supplier
  (s, ctx) => expChoice(s, ctx, pickedIds(s, ctx, pickOther), 1, false, `${ctx.sourceInstanceId}-exp`)))
registerCard('LAW_144', whenPlayed('You may play a Heroism unit from your hand (paying its cost) and give an Experience token to it.', (s, ctx) => // Phantom
  playFromHand(s, ctx, { test: c => printedAspect(c, 'Heroism') && printedUnit(c), thenTokens: [TOKEN_EXPERIENCE] })))
registerCard('LOF_225', whenPlayed('Play a unit from your hand (paying its cost). It gains Hidden for this phase. Give an Experience token and a Shield token to it.', (s, ctx) => // Three Lessons
  // One `thenTokens` grant, so the two tokens attach together: the card states it as one giving.
  playFromHand(s, ctx, { gains: [{ name: 'Hidden' }], thenTokens: [TOKEN_EXPERIENCE, TOKEN_SHIELD] })))
registerCard('LOF_125', { // The Burden of Masters
  ...whenPlayed('Put a Force unit from your discard pile on the bottom of your deck. If you do, play a unit from your hand and give 2 Experience tokens to it.', (s, ctx) => {
    const candidates = [...new Set(s.players[ctx.owner].discard.filter(id => printedUnit(s.cards[id]) && printedTrait(s.cards[id], 'Force')))]
    return candidates.length ? cardThen(s, ctx, candidates, 'put a Force unit from your discard pile on the bottom of your deck', false, 'bottom') : s
  }),
  ifYouDo: (s, ctx) =>
    (ctx.cardChosen ? playFromHand(discardToDeckBottom(s, ctx.owner, [ctx.cardChosen]), ctx, { thenTokens: [TOKEN_EXPERIENCE, TOKEN_EXPERIENCE] }) : s),
})
registerCard('SHD_099', mayDiscardThen('You may discard a card from your hand. Give 2 Experience tokens to a unit in play with the same name as the discarded card.', // Echo
  (s, ctx) => {
    const name = s.cards[ctx.cardChosen ?? '']?.name
    return expChoice(s, ctx, pickedIds(s, ctx, (st, u) => cardOf(st, u)?.name === name), 2, false, `${ctx.sourceInstanceId}-exp`)
  }))
registerCard('LAW_069', { // The Ghost
  ...whenPlayed('You may give an Experience token and a Shield token to a unit. If you control a Vigilance or Aggression unit, you may give them to each of up to 2 units instead.',
    (s, ctx) => ghostOffer(s, ctx, youControl(s, ctx, pickOther, pickAspect('Vigilance', 'Aggression')) ? 2 : 1)),
  ifYouDo: (s, ctx) => {
    const left = stepCount(ctx.step) - 1
    return ghostOffer(ctx.targetInstanceId ? giveMixedTokens(s, ctx.targetInstanceId, [TOKEN_EXPERIENCE, TOKEN_SHIELD]) : s, ctx, left, ctx.targetInstanceId)
  },
})
/** One offer of The Ghost's "give an Experience token and a Shield token to a unit", up to `left` times. */
function ghostOffer(s: GameState, ctx: Resumable, left: number, exclude?: string): GameState {
  const targets = allUnits(s).map(u => u.instanceId).filter(id => id !== exclude)
  return left > 0 && targets.length
    ? pushChoice(s, { kind: 'selectUnitThen', id: `${ctx.sourceInstanceId}-${left}`, controller: ctx.owner, targets, optional: true, text: 'give an Experience token and a Shield token to a unit', then: resume(ctx, `left:${left}`) })
    : s
}
registerCard('LOF_042', { // Always Two
  ...whenPlayed('Choose 2 friendly unique Sith units. If you do, give 2 Shield tokens and 2 Experience tokens to each chosen unit. Defeat all other friendly units.',
    (s, ctx) => (sithPair(s, ctx).length >= 2 ? unitThen(s, ctx, sithPair(s, ctx), 'choose a friendly unique Sith unit (2 of them)', false, 'first') : s)),
  ifYouDo: (s, ctx) => {
    if (ctx.step === 'first') {
      const rest = sithPair(s, ctx).filter(id => id !== ctx.targetInstanceId)
      return rest.length ? unitThen(s, ctx, rest, 'choose the second friendly unique Sith unit', false, 'second', ctx.targetInstanceId) : s
    }
    const chosen = [ctx.unitChosen!, ctx.targetInstanceId!]
    const tokens = [TOKEN_SHIELD, TOKEN_SHIELD, TOKEN_EXPERIENCE, TOKEN_EXPERIENCE]
    const given = chosen.reduce((acc, id) => giveMixedTokens(acc, id, tokens), s)
    return given.players[ctx.owner].units.filter(u => !chosen.includes(u.instanceId)).reduce((acc, u) => defeatUnit(acc, u.instanceId), given)
  },
})
/** The friendly unique Sith units Always Two may choose between. */
const sithPair = (s: GameState, ctx: EventCtx): string[] => pickedIds(s, ctx, pickAll(pickFriendly, pickUnique, pickTrait('Sith')))
registerCard('SOR_055', { // The Force Is With Me
  ...whenPlayed('Choose a friendly unit and give 2 Experience tokens to it. If you control a Force unit, also give a Shield token to the chosen unit. You may attack with the chosen unit.',
    (s, ctx) => unitThen(s, ctx, pickedIds(s, ctx, pickFriendly), 'give 2 Experience tokens to a friendly unit', false)),
  ifYouDo: (s, ctx) => {
    const id = ctx.targetInstanceId
    if (!id) return s
    const tokens = youControl(s, ctx, pickTrait('Force'))
      ? [TOKEN_EXPERIENCE, TOKEN_EXPERIENCE, TOKEN_SHIELD]
      : [TOKEN_EXPERIENCE, TOKEN_EXPERIENCE]
    return offerAttack(giveMixedTokens(s, id, tokens), ctx.owner, `${ctx.sourceInstanceId}-attack`, { attacker: { only: [id] } })
  },
})

// F: attacks, reactions and activated Actions. The trigger changes; the grant is the same one.
registerCard('JTL_200', { // Shuttle Tydirium
  ...onAttack(whenPlayed('Discard a card from your deck. If it has an odd cost, you may give an Experience token to another unit.', (s, ctx) => {
    const [next, milled] = millTop(s, ctx.owner, 1)
    const cost = milled.length ? next.cards[milled[0]]?.cost ?? 0 : 0
    return milled.length && cost % 2 === 1 ? expChoice(next, ctx, pickedIds(next, ctx, pickOther), 1, true) : next
  })),
})
registerCard('JTL_250', { // Sabine's Masterpiece
  // Four independent clauses, each gated on an aspect you control. Only the Command one grants a token;
  // the rest are the ordinary heal / damage / resource effects, raised in the printed order.
  ...onAttack(whenPlayed('On Attack: if you control a Vigilance unit, heal 2 damage from a base; a Command unit, give an Experience token to a unit; an Aggression unit, deal 1 damage to a unit or a base; a Cunning unit, exhaust or ready a resource.', (s, ctx) => {
    let next = s
    if (youControl(next, ctx, pickAspect('Vigilance'))) next = healChoice(next, ctx, 2, [], BOTH_BASES)
    if (youControl(next, ctx, pickAspect('Command'))) next = expChoice(next, ctx, allUnits(next).map(u => u.instanceId), 1, false, `${ctx.sourceInstanceId}-exp`)
    if (youControl(next, ctx, pickAspect('Aggression'))) next = damageChoice(next, ctx, 1, allUnits(next), BOTH_BASES)
    if (youControl(next, ctx, pickAspect('Cunning'))) next = exhaustReadyResource(next, ctx.owner)
    return next
  })),
})
registerCard('LAW_039', { // Latts Razzi
  ...whenPlayed('Give a Shield token or an Experience token to this unit. Then, she deals damage equal to her power to an enemy ground unit.',
    (s, ctx) => pushChoice(s, { kind: 'chooseMode', id: ctx.sourceInstanceId!, controller: ctx.owner, modes: ['lattsShield', 'lattsExperience'] })),
})
registerCard('LAW_073', { // Patient Hunter
  abilities: [{ trigger: 'whenRegroupStarts', description: "You may give an Experience token to a non-leader unit. If you do, that unit can't ready during this regroup phase.",
    effect: (s, ctx) => unitThen(s, ctx, pickedIds(s, ctx, nonLeader), "give an Experience token to a non-leader unit, which then can't ready this regroup phase", true) }],
  ifYouDo: (s, ctx) => (ctx.targetInstanceId
    ? addLastingEffect(giveToken(s, ctx.targetInstanceId, TOKEN_EXPERIENCE), { targetInstanceId: ctx.targetInstanceId, cannotReady: true, untilRoundEnd: true })
    : s),
})
const quadjumper = onAttack(mayPayWp("You may reveal the top card of your deck. If it's not a unit, give an Experience token to another unit.", 0, 'reveal the top card of your deck',
  // The card stays where it is: revealing is not drawing, and the cost of 0 makes this the plain yes/no.
  (s, ctx) => {
    const top = s.players[ctx.owner].deck[0]
    return top !== undefined && !printedUnit(s.cards[top]) ? expChoice(s, ctx, pickedIds(s, ctx, pickOther), 1, false, `${ctx.sourceInstanceId}-exp`) : s
  }))
registerCard('LAW_115', quadjumper) // Rickety Quadjumper
registerCard('SHD_057', quadjumper) // Rickety Quadjumper, the SHD printing: same text, a separate card id
registerCard('LAW_152', onAttack(expWp('You may give an Experience token to another non-leader unit that shares a Trait with a friendly leader.', // C-3P0
  pickAll(pickOther, nonLeader, (s, u, ctx) => {
    const leaderTraits = leaderTraitsOf(s, ctx.owner).map(t => t.toLowerCase())
    return unitTraits(s, u).some(t => leaderTraits.includes(t.toLowerCase()))
  }), 1, true)))
/** The traits of a player's leader, whether it is deployed as a unit or still on its front side. */
const leaderTraitsOf = (s: GameState, owner: PlayerId): string[] => {
  const deployed = s.players[owner].units.find(u => u.isLeader)
  return deployed ? unitTraits(s, deployed) : s.cards[s.players[owner].leader.cardId]?.traits ?? []
}
registerCard('LOF_046', onAttack(expWp('You may give an Experience token to another Creature or Spectre unit.', // Ezra Bridger
  pickAll(pickOther, (s, u) => unitHasTrait(s, u, 'Creature') || unitHasTrait(s, u, 'Spectre')), 1, true)))
registerCard('LOF_065', attacks('An opponent chooses one: you give an Experience token to a friendly unit, or you draw a card.', (s, ctx) => // Watto
  pushChoice(s, { kind: 'chooseMode', id: ctx.sourceInstanceId!, controller: opponentOf(ctx.owner), modes: ['wattoExperience', 'wattoDraw'] })))
registerCard('LOF_258', onAttack(expWp('Give an Experience token to a friendly Vehicle or Droid unit.', // Peli Motto
  pickAll(pickFriendly, (s, u) => unitHasTrait(s, u, 'Vehicle') || unitHasTrait(s, u, 'Droid')))))
registerCard('SEC_051', { // Bo-Katan Kryze
  abilities: [
    { trigger: 'whenPlayed', description: 'Give each enemy unit -3/-3 for this phase.',
      effect: (s, ctx) => lastingOnEach(s, enemyUnitsOf(s, ctx.owner), { power: -3, hp: -3 }) },
    { trigger: 'whenEnemyUnitDefeated', description: 'Give an Experience token to a friendly unit.',
      effect: (s, ctx) => expChoice(s, ctx, pickedIds(s, ctx, pickFriendly)) },
  ],
})
registerCard('SHD_045', { // Rose Tico
  ...onAttack(unitThenWp('You may defeat a Shield token on a friendly unit. If you do, give 2 Experience tokens to that unit.',
    pickAll(pickFriendly, (_s, u) => hasToken(u.upgrades, TOKEN_SHIELD)), 'defeat a Shield token on a friendly unit', true,
    (s, ctx) => giveTokens(defeatUpgrade(s, ctx.targetInstanceId!, TOKEN_SHIELD), ctx.targetInstanceId!, TOKEN_EXPERIENCE, 2))),
})
registerCard('SHD_141', { // Kylo Ren
  // "While playing this unit, ignore his Villainy aspect penalty if you control Rey": a hook on the card
  // being played, unlike the in-play `waivesAspectPenalty` that a unit holds over other cards.
  ignoresOwnAspectPenalty: (s, owner) => (playerControlsNamed(s, owner, 'Rey') ? ['Villainy'] : []),
  ...onAttack(unitThenWp("Give a unit +2/+0 for this phase. If it's a non-Villainy unit, also give an Experience token to it.",
    pickAny, 'give a unit +2/+0 for this phase', false,
    (s, ctx) => {
      const id = ctx.targetInstanceId!
      const buffed = addLastingEffect(s, { targetInstanceId: id, power: 2 })
      const target = findUnit(buffed, id)
      return target && !printedAspect(cardOf(buffed, target.unit), 'Villainy') ? giveToken(buffed, id, TOKEN_EXPERIENCE) : buffed
    })),
})
registerCard('SOR_036', { // Gideon Hask
  abilities: [{ trigger: 'whenEnemyUnitDefeated', description: 'Give an Experience token to a friendly unit.',
    effect: (s, ctx) => expChoice(s, ctx, pickedIds(s, ctx, pickFriendly)) }],
})
registerCard('SOR_094', { actionAbilities: [{ // Bail Organa
  description: 'Give an Experience token to another friendly unit.',
  exhaustCost: true,
  usable: (s, self) => friendliesOf(s, self).some(u => u.instanceId !== self.instanceId),
  effect: (s, ctx) => expChoice(s, ctx, pickedIds(s, ctx, pickAll(pickOther, pickFriendly))),
}] })

// G: leaders and a base. Both sides of a leader grant the same token, so each is `leaderFront` for the
// undeployed action and an `onAttack` (or `whenDeployed`) ability for the deployed unit.
/** The friendly Villainy units tied for the most power (Supreme Leader Snoke chooses among them). */
const strongestVillainy = (s: GameState, ctx: EventCtx): string[] => {
  const villains = picked(s, ctx, pickAll(pickFriendly, pickAspect('Villainy')))
  if (!villains.length) return []
  const best = Math.max(...villains.map(u => effectivePower(s, u)))
  return villains.filter(u => effectivePower(s, u) === best).map(u => u.instanceId)
}
registerCard('LOF_006', mergeLeaderSides( // Supreme Leader Snoke
  leaderFront('Give an Experience token to the unit with the most power among friendly Villainy units.', {
    cost: 1,
    usable: (s, ctx) => strongestVillainy(s, ctx).length > 0,
    effect: (s, ctx) => expChoice(s, ctx, strongestVillainy(s, ctx)),
  }),
  attacks('Give an Experience token to the unit with the most power among friendly Villainy units.',
    (s, ctx) => expChoice(s, ctx, strongestVillainy(s, ctx))),
))
const lowPower: Pick = (s, u) => effectivePower(s, u) <= 2
registerCard('SHD_004', mergeLeaderSides( // Rey
  leaderFront('Give an Experience token to a unit with 2 or less power.', {
    cost: 1,
    usable: anyUnitPasses(lowPower),
    effect: (s, ctx) => expChoice(s, ctx, pickedIds(s, ctx, lowPower)),
  }),
  attacks('You may give an Experience token to a unit with 2 or less power.',
    (s, ctx) => expChoice(s, ctx, pickedIds(s, ctx, lowPower), 1, true)),
))
registerCard('SOR_007', mergeLeaderSides( // Grand Moff Tarkin
  leaderFront('Give an Experience token to an Imperial unit.', {
    cost: 1,
    usable: anyUnitPasses(pickTrait('Imperial')),
    effect: (s, ctx) => expChoice(s, ctx, pickedIds(s, ctx, pickTrait('Imperial'))),
  }),
  attacks('You may give an Experience token to another Imperial unit.',
    (s, ctx) => expChoice(s, ctx, pickedIds(s, ctx, pickAll(pickOther, pickTrait('Imperial'))), 1, true)),
))
registerCard('LAW_010', mergeLeaderSides( // Leia Organa
  leaderFront('For this phase, give a unit +1/+1 for each different aspect it has.', {
    cost: 2,
    usable: anyUnitPasses(pickAny),
    // The amount is fixed per target, so it is read from the unit the choice will land on: every
    // eligible unit is offered and the buff is that unit's own aspect count.
    effect: (s, ctx) => unitThen(s, ctx, pickedIds(s, ctx, pickAny), 'give a unit +1/+1 for each different aspect it has', false),
  }),
  { ifYouDo: (s, ctx) => {
    const target = ctx.targetInstanceId ? findUnit(s, ctx.targetInstanceId)?.unit : undefined
    if (!target) return s
    const n = new Set(cardOf(s, target)?.aspects ?? []).size
    return addLastingEffect(s, { targetInstanceId: target.instanceId, power: n, hp: n })
  } },
  whenDeployed('Choose a unit. Give an Experience token to that unit for each different aspect among units you control.',
    (s, ctx) => expChoice(s, ctx, allUnits(s).map(u => u.instanceId), aspectsAmongUnits(s, ctx.owner))),
))
registerCard('SOR_008', mergeLeaderSides( // Hera Syndulla
  waiverBothSides((_s, _owner, c) => printedTrait(c, 'Spectre')),
  attacks('You may give an Experience token to another unique unit.',
    (s, ctx) => expChoice(s, ctx, pickedIds(s, ctx, pickAll(pickOther, pickUnique)), 1, true)),
))
registerCard('TS26_9', { // First Battle Memorial
  ...baseEpic('For each friendly leader unit, give an Experience token to a unit.', {
    usable: (s, ctx) => leaderUnitCount(s, ctx.owner) > 0 && allUnits(s).length > 0,
    effect: (s, ctx) => memorialOffer(s, ctx, leaderUnitCount(s, ctx.owner)),
  }),
  ifYouDo: (s, ctx) => {
    const left = stepCount(ctx.step) - 1
    return memorialOffer(ctx.targetInstanceId ? giveToken(s, ctx.targetInstanceId, TOKEN_EXPERIENCE) : s, ctx, left)
  },
})
/** One of First Battle Memorial's per-leader-unit token grants; each offer re-reads the board. */
function memorialOffer(s: GameState, ctx: Resumable, left: number): GameState {
  const targets = allUnits(s).map(u => u.instanceId)
  return left > 0 && targets.length
    ? pushChoice(s, { kind: 'selectUnitThen', id: `${ctx.sourceInstanceId}-${left}`, controller: ctx.owner, targets, text: `give an Experience token to a unit (${left} left)`, then: resume(ctx, `left:${left}`), optional: true, hookOnDecline: true })
    : s
}

// ── Token units: Spy, X-Wing, TIE Fighter, Clone Trooper, Battle Droid, Beast ──────────────────────
// A token unit is created straight into play by `createTokenUnits` (exhausted unless Chancellor
// Palpatine says otherwise) and ceases to exist when it leaves. The Mandalorian already worked that way,
// so these are registrations; the helpers below are the token-unit spellings of the Experience ones.

/** The ids of the units `owner` has in `after` that were not in `before`: the tokens an effect just made. */
const newUnits = (before: GameState, after: GameState, owner: PlayerId): string[] => {
  const had = new Set(before.players[owner].units.map(u => u.instanceId))
  return after.players[owner].units.filter(u => !had.has(u.instanceId)).map(u => u.instanceId)
}
/**
 * `owner` creates `n` `token` units; `then` is applied to each one made (ready it, damage it, buff it).
 * A top-up offered by Moff Jerjerrod is made after this returns, so it is not among them.
 */
const create = (s: GameState, owner: PlayerId, token: string, n = 1, then?: (s: GameState, id: string) => GameState): GameState => {
  if (n <= 0) return s
  const after = createTokenUnits(s, owner, token, n)
  return then ? newUnits(s, after, owner).reduce(then, after) : after
}
const readyIt = (s: GameState, id: string): GameState => readyUnit(s, id)
/** "(If ...,) create `n` <token> tokens", as a When Played; `onAttack` retargets it. */
const createWp = (description: string, token: string, n = 1, when: When = always) =>
  whenPlayed(description, (s, ctx) => (when(s, ctx) ? create(s, ctx.owner, token, n) : s))
const createWd = (description: string, token: string, n = 1) =>
  whenDefeated(description, (s, ctx) => create(s, ctx.owner, token, n))
const isToken: Pick = (_s, u) => isTokenCard(u.cardId)
const readyUnits = (s: GameState): UnitState[] => allUnits(s).filter(u => !u.exhausted)
/** "Any number" for an up-to offer: more than any board holds, and a plain number so the step serialises. */
const ANY_NUMBER = 99

// A: tokens on a trigger
registerCard('JTL_082', createWp('Create a TIE Fighter token.', TOKEN_TIE_FIGHTER)) // Kijimi Patrollers
registerCard('JTL_099', createWp('Create an X-Wing token.', TOKEN_X_WING)) // Veteran Fleet Officer
registerCard('JTL_252', createWp('Create an X-Wing token.', TOKEN_X_WING)) // Tantive IV
registerCard('JTL_243', onAttack(createWp('Create a TIE Fighter token.', TOKEN_TIE_FIGHTER))) // Quasar TIE Carrier
registerCard('SEC_097', createWp('Create a Spy token.', TOKEN_SPY)) // Beloved Orator
registerCard('SEC_191', createWp('Create 2 Spy tokens.', TOKEN_SPY, 2)) // Trade Federation Delegates
registerCard('SEC_083', createWp('If a friendly unit was defeated this phase, create a Spy token.', TOKEN_SPY, 1, friendlyWasDefeated)) // ISB Shuttle
registerCard('SEC_087', onAttack(createWp('Create a Spy token.', TOKEN_SPY))) // Dedra Meero
registerCard('SEC_115', onAttack(createWp('If you have the initiative, create a Spy token.', TOKEN_SPY, 1, haveInitiative))) // Taylander Shuttle
registerCard('SEC_132', createWd('Create a Spy token.', TOKEN_SPY)) // Imperial Occupier
registerCard('SEC_175', createWp('Create a Spy token.', TOKEN_SPY)) // Ambition's Reward
registerCard('SEC_227', { // Special Modifications
  attachRestriction: (s, t) => unitHasTrait(s, t, 'Vehicle'),
  ...whenPlayed('If attached unit is a Transport, you may create a Spy token.', (s, ctx) =>
    (hostPasses(s, ctx, (st, h) => unitHasTrait(st, h, 'Transport'))
      ? pushChoice(s, { kind: 'mayCreateToken', id: ctx.sourceInstanceId!, controller: ctx.owner, token: TOKEN_SPY, count: 1 })
      : s)),
})
registerCard('TS26_23', { // Assault Lander LAAT
  abilities: [
    ...createWp('Create 2 Clone Trooper tokens.', TOKEN_CLONE_TROOPER, 2).abilities,
    { trigger: 'whenRegroupStarts', description: 'Deal 4 damage to this unit.', effect: (s, ctx) => dealDamageToUnit(s, ctx.sourceInstanceId!, 4) },
  ],
})
registerCard('TWI_032', createWd('Create a Battle Droid token.', TOKEN_BATTLE_DROID)) // Wartime Trade Official
registerCard('TWI_043', { // Outspoken Representative
  ...gains(another(isTrait('Republic')), KW.sentinel),
  ...createWd('Create a Clone Trooper token.', TOKEN_CLONE_TROOPER),
})
registerCard('TWI_060', createWp('If you control a damaged unit, create a Battle Droid token.', TOKEN_BATTLE_DROID, 1, (s, ctx) => youControl(s, ctx, damaged))) // Trade Federation Shuttle
registerCard('TWI_079', createWd('Create a Battle Droid token.', TOKEN_BATTLE_DROID)) // Confederate Courier
registerCard('TWI_097', createWp('Create 2 Clone Trooper tokens.', TOKEN_CLONE_TROOPER, 2)) // Captain Rex
registerCard('TWI_112', createWp('If you have the initiative, create a Battle Droid token.', TOKEN_BATTLE_DROID, 1, haveInitiative)) // Subjugating Starfighter
registerCard('TWI_144', createWp('Create a Clone Trooper token.', TOKEN_CLONE_TROOPER)) // Batch Brothers
registerCard('TWI_145', whenPlayed('An opponent creates 2 Battle Droid tokens.', (s, ctx) => create(s, opponentOf(ctx.owner), TOKEN_BATTLE_DROID, 2))) // Jesse
registerCard('TWI_183', onAttack(createWp('If the defending player controls no ready resources, create a Battle Droid token.', TOKEN_BATTLE_DROID, 1, // Rush Clovis
  (s, ctx) => readyResources(s, opponentOf(ctx.owner)) === 0)))
registerCard('TWI_247', createWd('Create 2 Clone Trooper tokens.', TOKEN_CLONE_TROOPER, 2)) // AT-TE Vanguard
registerCard('HMW_038', whenPlayed('If attached unit is a Creature or a Force unit, create a Beast token.', (s, ctx) => // Bestial Bond
  (hostPasses(s, ctx, (st, h) => unitHasTrait(st, h, 'Creature') || unitHasTrait(st, h, 'Force')) ? create(s, ctx.owner, TOKEN_BEAST) : s)))
registerCard('HMW_047', attacks('Create a Beast token and ready it.', (s, ctx) => create(s, ctx.owner, TOKEN_BEAST, 1, readyIt))) // Eravana
registerCard('HMW_152', whenPlayed('An opponent creates a Beast token.', (s, ctx) => create(s, opponentOf(ctx.owner), TOKEN_BEAST))) // Babwa Venomor
registerCard('HMW_250', whenPlayed('Create a Beast token and deal 1 damage to an enemy unit.', (s, ctx) => // Imperial Cavalry
  damageChoice(create(s, ctx.owner, TOKEN_BEAST), ctx, 1, picked(s, ctx, pickEnemy))))
registerCard('HMW_262', whenPlayed('Create a Beast token and heal 2 damage from your base.', (s, ctx) => healBase(create(s, ctx.owner, TOKEN_BEAST), ctx.owner, 2))) // Mylaya Rider
/** "Each Republic leader you control (as a leader or unit)": the player's own leader, either side, and any unit made a leader. */
const republicLeaders = (s: GameState, owner: PlayerId): number =>
  (leaderTraitsOf(s, owner).some(t => t.toLowerCase() === 'republic') ? 1 : 0)
  + s.players[owner].units.filter(u => !u.isLeader && isLeaderUnit(s, u) && unitHasTrait(s, u, 'Republic')).length
registerCard('TS26_55', whenPlayed('For each Republic leader you control (as a leader or unit), create a Clone Trooper token and give an Experience token to it.', // Jedi General
  (s, ctx) => create(s, ctx.owner, TOKEN_CLONE_TROOPER, republicLeaders(s, ctx.owner), (st, id) => giveToken(st, id, TOKEN_EXPERIENCE))))

// B: units that do more with their tokens, or with a choice
registerCard('HMW_153', mayPayWp('You may defeat this unit. If you do, create a Beast token and deal 1 damage to it.', 0, 'defeat this unit', // Poacher's Starfighter
  (s, ctx) => create(defeatUnit(s, ctx.sourceInstanceId!), ctx.owner, TOKEN_BEAST, 1, (st, id) => dealDamageToUnit(st, id, 1))))
/** A unit's "When Defeated" abilities, printed, granted or lent, collected as if it had just been defeated. */
const whenDefeatedOf = (s: GameState, u: UnitState, owner: PlayerId) => collectUnitTriggers(s, 'whenDefeated', u, owner, { defeatedUnit: u })
registerCard('JTL_039', allOf( // Chimaera
  whenPlayed('You may use a "When Defeated" ability on another friendly unit.', (s, ctx) =>
    unitThen(s, ctx, pickedIds(s, ctx, pickAll(pickFriendly, pickOther, (st, u) => whenDefeatedOf(st, u, ctx.owner).length > 0)),
      'use a "When Defeated" ability on another friendly unit', true)),
  // The unit stays in play and its ability resolves as if it had just been defeated. A unit with two
  // When Defeated abilities uses the first; no card in the sealed sets has two.
  { ifYouDo: (s, ctx) => {
    const target = findUnit(s, ctx.targetInstanceId!)?.unit
    return target ? fireBatch(s, whenDefeatedOf(s, target, ctx.owner).slice(0, 1)) : s
  } },
  createWd('Create 2 TIE Fighter tokens.', TOKEN_TIE_FIGHTER, 2),
))
registerCard('SEC_198', onAttack(mayDiscardThen('You may discard a card from your hand. If you do, create a Spy token.', (s, ctx) => create(s, ctx.owner, TOKEN_SPY)))) // Bail Organa
registerCard('TWI_080', { // Poggle the Lesser
  // A created token raises `whenCreateUnit`, not `whenPlayUnit` (only a unit arriving through a play does), which
  // is exactly "when you play another unit".
  abilities: [{ trigger: 'whenPlayUnit', description: 'You may exhaust this unit. If you do, create a Battle Droid token.',
    effect: (s, ctx) => (readyNow(s, ctx.sourceInstanceId)
      ? pushChoice(s, { kind: 'mayPayThen', id: `${ctx.sourceInstanceId}-poggle`, controller: ctx.owner, cost: 0, text: 'exhaust this unit to create a Battle Droid token', then: resume(ctx) })
      : s) }],
  ifYouDo: (s, ctx) => (readyNow(s, ctx.sourceInstanceId) ? create(exhaustUnit(s, ctx.sourceInstanceId!), ctx.owner, TOKEN_BATTLE_DROID) : s),
})
registerCard('TWI_084', allOf( // Kraken
  createWp('Create 2 Battle Droid tokens.', TOKEN_BATTLE_DROID, 2),
  attacks('Give each friendly token unit +1/+1 for this phase.', (s, ctx) => lastingOnEach(s, picked(s, ctx, pickAll(pickFriendly, isToken)), { power: 1, hp: 1 })),
))
registerCard('TWI_094', { // Shaak Ti
  ...friendlyAura((_s, u) => isTokenCard(u.cardId), { power: 1 }, false),
  ...onAttack(createWp('Create a Clone Trooper token.', TOKEN_CLONE_TROOPER)),
})
registerCard('TWI_203', { // Chancellor Palpatine
  tokensEnterReady: () => true,
  ...onAttack(createWp('If a unit left play this phase, create a Clone Trooper token.', TOKEN_CLONE_TROOPER, 1, aUnitLeftPlay)),
})
registerCard('TWI_234', allOf( // The Invisible Hand
  createWp('Create 4 Battle Droid tokens.', TOKEN_BATTLE_DROID, 4),
  onAttack(eachOfUpTo("Exhaust any number of friendly Separatist units. Deal 1 damage to the defending player's base for each unit exhausted this way.", ANY_NUMBER, {
    text: "exhaust a friendly Separatist unit for 1 damage to the defending player's base",
    test: pickAll(pickFriendly, pickTrait('Separatist'), (_s, u) => !u.exhausted),
    apply: (s, ctx, id) => dealDamageToBase(exhaustUnit(s, id), opponentOf(ctx.owner), 1),
  })),
))
registerCard('TWI_119', { attachRestriction: (_s, t) => isTokenCard(t.cardId) }) // Nameless Valor: Overwhelm comes from its keyword data

// C: events. A token created by the same event is only a target for what the card prints after it.
registerCard('JTL_254', createWp('Create 2 X-Wing tokens.', TOKEN_X_WING, 2)) // Dedicated Wingmen
registerCard('SEC_092', createWp('Create 5 Spy tokens.', TOKEN_SPY, 5)) // I Am the Senate
registerCard('TWI_237', createWp('Create 2 Battle Droid tokens.', TOKEN_BATTLE_DROID, 2)) // Droid Deployment
registerCard('TWI_251', createWp('Create 2 Clone Trooper tokens.', TOKEN_CLONE_TROOPER, 2)) // Drop In
registerCard('TWI_190', whenPlayed('Create 3 Battle Droid tokens and ready them.', (s, ctx) => create(s, ctx.owner, TOKEN_BATTLE_DROID, 3, readyIt))) // On the Doorstep
registerCard('HMW_058', { // Mysterious Disappearance
  ...whenPlayed('A player chooses a non-leader unit they control. You may defeat that unit. If you do, that player creates a Beast token.', (s, ctx) =>
    choosePlayer(s, ctx, 'choose a player to pick a non-leader unit they control', 'player')),
  ifYouDo: (s, ctx) => {
    if (ctx.step === 'player') {
      const who = ctx.playerChosen!
      const targets = s.players[who].units.filter(u => nonLeader(s, u)).map(u => u.instanceId)
      return targets.length
        ? pushChoice(s, { kind: 'selectUnitThen', id: `${ctx.sourceInstanceId}-pick`, controller: who, targets, text: 'choose a non-leader unit you control', then: resume(ctx, 'unit') })
        : s
    }
    if (ctx.step === 'unit') {
      return pushChoice(s, { kind: 'mayPayThen', id: `${ctx.sourceInstanceId}-defeat`, controller: ctx.owner, cost: 0, text: 'defeat that unit', then: resume(ctx, 'defeat', ctx.targetInstanceId) })
    }
    const found = findUnit(s, ctx.unitChosen ?? '')
    return found ? create(defeatUnit(s, found.unit.instanceId), found.owner, TOKEN_BEAST) : s
  },
})
registerCard('HMW_150', whenPlayed('For every 3 resources you control, create a Beast token.', (s, ctx) => // Migrate
  create(s, ctx.owner, TOKEN_BEAST, Math.floor(s.players[ctx.owner].resources.length / 3))))
registerCard('HMW_194', whenPlayed('Create a Beast token. Deal 1 damage to a friendly ground unit and 1 damage to an enemy ground unit.', (s, ctx) => { // Run Amok
  const made = create(s, ctx.owner, TOKEN_BEAST)
  const friendly = damageChoice(made, { ...ctx, sourceInstanceId: `${ctx.sourceInstanceId}-friendly` }, 1, picked(made, ctx, pickAll(pickFriendly, pickGround)))
  return damageChoice(friendly, { ...ctx, sourceInstanceId: `${ctx.sourceInstanceId}-enemy` }, 1, picked(made, ctx, pickAll(pickEnemy, pickGround)))
}))
registerCard('HMW_195', whenPlayed('Create 2 Beast tokens and ready 1 of them.', (s, ctx) => { // Catch the Scent
  const made = create(s, ctx.owner, TOKEN_BEAST, 2)
  // The two are identical, so which one is readied is no choice at all.
  const first = newUnits(s, made, ctx.owner)[0]
  return first ? readyUnit(made, first) : made
}))
registerCard('HMW_241', whenPlayed("Create a Beast token. You may return a non-leader unit to its owner's hand.", (s, ctx) => { // Howl
  const made = create(s, ctx.owner, TOKEN_BEAST)
  return targetChoice(made, ctx, 'selectUnitToReturn', pickedIds(made, ctx, nonLeader), true)
}))
registerCard('HMW_272', whenPlayed('Create a Beast token. Heal 3 damage from your base. Draw a card.', (s, ctx) => // Growth
  drawCards(healBase(create(s, ctx.owner, TOKEN_BEAST), ctx.owner, 3), ctx.owner, 1)))
registerCard('JTL_076', whenPlayed('Create an X-Wing token. You may give a Shield token to another unit.', (s, ctx) => { // Covering the Wing
  const made = create(s, ctx.owner, TOKEN_X_WING)
  const xwing = newUnits(s, made, ctx.owner)
  return shieldChoice(made, ctx, allUnits(made).filter(u => !xwing.includes(u.instanceId)).map(u => u.instanceId), true)
}))
registerCard('JTL_092', whenPlayed("Create 8 TIE Fighter tokens and ready them. They can't attack bases for this phase.", (s, ctx) => // Scramble Fighters
  create(s, ctx.owner, TOKEN_TIE_FIGHTER, 8, (st, id) => addLastingEffect(readyUnit(st, id), { targetInstanceId: id, cannotAttackBases: true }))))
registerCard('JTL_122', eachOfUpTo('Exhaust up to 2 friendly space units. For each unit exhausted this way, create an X-Wing token.', 2, { // All Wings Report In
  text: 'exhaust a friendly space unit to create an X-Wing token (up to 2)',
  test: pickAll(pickFriendly, pickArena('space'), (_s, u) => !u.exhausted),
  apply: (s, ctx, id) => create(exhaustUnit(s, id), ctx.owner, TOKEN_X_WING),
}))
registerCard('JTL_130', whenPlayed('Choose an opponent. For every 2 resources they control, create an X-Wing token and give it Sentinel for this phase.', (s, ctx) => // Timely Reinforcements
  create(s, ctx.owner, TOKEN_X_WING, Math.floor(s.players[opponentOf(ctx.owner)].resources.length / 2),
    (st, id) => addLastingEffect(st, { targetInstanceId: id, keywords: [KW.sentinel] }))))
registerCard('JTL_155', whenPlayed('An opponent creates 2 TIE Fighter tokens and readies them. Then, play a Vehicle unit from your hand. It costs 3 less.', (s, ctx) => // They Hate That Ship
  playFromHand(create(s, opponentOf(ctx.owner), TOKEN_TIE_FIGHTER, 2, readyIt), ctx, { costDelta: -3, test: c => printedTrait(c, 'Vehicle') })))
/** Commence Patrol: pick another card from `owner`'s discard pile to put on the bottom of their deck. */
const patrolPick = (s: GameState, ctx: Resumable, owner: PlayerId): GameState => {
  const pile = discardBesides(s, owner, ctx)
  return pile.length ? cardThen(s, ctx, pile, "put a card on the bottom of its owner's deck", false, `patrol:${owner}`) : s
}
registerCard('JTL_205', { // Commence Patrol
  ...whenPlayed("Put another card in a discard pile on the bottom of its owner's deck. If you do, create an X-Wing token.", (s, ctx) => {
    const piles = BOTH_BASES.filter(p => discardBesides(s, p, ctx).length > 0)
    if (piles.length === 2) return choosePlayer(s, ctx, 'choose whose discard pile to take a card from', 'pile')
    return piles.length ? patrolPick(s, ctx, piles[0]) : s
  }),
  ifYouDo: (s, ctx) => {
    if (ctx.step === 'pile') return patrolPick(s, ctx, ctx.playerChosen!)
    const owner = splitStep(ctx.step, 'patrol:')[0] as PlayerId
    return ctx.cardChosen ? create(discardToDeckBottom(s, owner, [ctx.cardChosen]), ctx.owner, TOKEN_X_WING) : s
  },
})
registerCard('SEC_105', whenPlayed('Return a unit from your discard pile to your hand. Create 2 Spy tokens.', (s, ctx) => { // Renewed Friendship
  const candidates = s.players[ctx.owner].discard.filter(id => printedUnit(s.cards[id]))
  const returned = candidates.length ? pushChoice(s, { kind: 'selectFromDiscard', id: ctx.sourceInstanceId!, controller: ctx.owner, candidates, optional: false }) : s
  return create(returned, ctx.owner, TOKEN_SPY, 2)
}))
registerCard('SEC_128', whenPlayed('Search the top 8 cards of your deck for up to 2 Official units, reveal them, and draw them. Create a Spy token.', (s, ctx) => // Convene the Senate
  searchDrawChoice(create(s, ctx.owner, TOKEN_SPY), ctx, 8, c => printedUnit(c) && printedTrait(c, 'Official'), 2)))
registerCard('SEC_177', whenPlayed("You may ready a unit that didn't attack or enter play this phase. Create a Spy token.", (s, ctx) => { // It's Not Over Yet
  const busy = new Set([...attackedThisPhase(s), ...BOTH_BASES.flatMap(p => enteredPlayThisPhase(s, p))])
  const targets = allUnits(s).filter(u => u.exhausted && !busy.has(u.instanceId)).map(u => u.instanceId)
  return create(targetChoice(s, ctx, 'selectUnitToReady', targets, true), ctx.owner, TOKEN_SPY)
}))
registerCard('SEC_178', { // Pursue the Lead
  ...whenPlayed('Choose a player. That player discards a card from their hand. If it costs 3 or less, create a Spy token.', (s, ctx) =>
    choosePlayer(s, ctx, 'choose a player to discard a card', 'player')),
  ifYouDo: (s, ctx) => {
    if (ctx.step === 'player') return discards(s, ctx.playerChosen!, 1, `${ctx.sourceInstanceId}-discard`, resume(ctx, 'discarded'))
    return (s.cards[ctx.cardChosen ?? '']?.cost ?? Infinity) <= 3 ? create(s, ctx.owner, TOKEN_SPY) : s
  },
})
registerCard('SEC_236', { // Undercover Operation
  // "Played", so a created token (which also enters play) is not one.
  ...whenPlayed('Ready a unit that was played this phase. If it costs 3 or less, create a Spy token.', (s, ctx) => {
    const played = new Set(BOTH_BASES.flatMap(p => enteredPlayThisPhase(s, p)))
    return unitThen(s, ctx, allUnits(s).filter(u => played.has(u.instanceId) && !isTokenCard(u.cardId)).map(u => u.instanceId), 'ready a unit that was played this phase', false)
  }),
  ifYouDo: (s, ctx) => {
    const target = findUnit(s, ctx.targetInstanceId!)?.unit
    if (!target) return s
    const readied = readyUnit(s, target.instanceId)
    return printedCost(s, target) <= 3 ? create(readied, ctx.owner, TOKEN_SPY) : readied
  },
})
registerCard('SEC_246', whenPlayed('Deal 2 damage to a non-Vehicle unit. Create a Spy token.', (s, ctx) => // Contempt for Culture
  create(damageChoice(s, ctx, 2, picked(s, ctx, (st, u) => !unitHasTrait(st, u, 'Vehicle'))), ctx.owner, TOKEN_SPY)))
registerCard('TWI_073', whenPlayed('Heal 3 damage from a unit. Create a Battle Droid token.', (s, ctx) => // Grievous Reassembly
  create(healChoice(s, ctx, 3, allUnits(s).map(u => u.instanceId), []), ctx.owner, TOKEN_BATTLE_DROID)))
registerCard('TWI_076', whenPlayed('Defeat a unit that costs 3 or less. Create 2 Battle Droid tokens.', (s, ctx) => // Death by Droids
  create(targetChoice(s, ctx, 'selectUnitToDefeat', pickedIds(s, ctx, costsAtMost(3))), ctx.owner, TOKEN_BATTLE_DROID, 2)))
/** Reprocess: pick the units one at a time from your discard pile; the picks so far ride in the step. */
const reprocessFinish = (s: GameState, ctx: Resumable, picks: string[]): GameState =>
  create(discardToDeckBottom(s, ctx.owner, picks), ctx.owner, TOKEN_BATTLE_DROID, picks.length)
const reprocessPick = (s: GameState, ctx: Resumable, picks: string[]): GameState => {
  const left = withoutEach(s.players[ctx.owner].discard.filter(id => printedUnit(s.cards[id])), picks)
  if (picks.length >= 4 || left.length === 0) return reprocessFinish(s, ctx, picks)
  return cardThen(s, ctx, left, 'put a unit from your discard pile on the bottom of your deck (up to 4)', true, `reprocess:${picks.join(',')}`)
}
registerCard('TWI_088', { // Reprocess
  ...whenPlayed('Choose up to 4 units in your discard pile. Put them on the bottom of your deck in a random order and create that many Battle Droid tokens.', (s, ctx) =>
    reprocessPick(s, ctx, [])),
  ifYouDo: (s, ctx) => {
    const picks = splitStep(ctx.step, 'reprocess:')
    return ctx.cardChosen ? reprocessPick(s, ctx, [...picks, ctx.cardChosen]) : reprocessFinish(s, ctx, picks)
  },
})
registerCard('TWI_125', { // The Clone Wars
  ...whenPlayed('Pay any number of resources. Create that many Clone Trooper tokens. Each opponent creates that many Battle Droid tokens.', (s, ctx) =>
    chooseNumberUpTo(s, ctx, readyResources(s, ctx.owner), 'choose how many resources to pay')),
  ifYouDo: (s, ctx) => {
    const n = ctx.optionIndex ?? 0
    return create(create(payResources(s, ctx.owner, n), ctx.owner, TOKEN_CLONE_TROOPER, n), opponentOf(ctx.owner), TOKEN_BATTLE_DROID, n)
  },
})
registerCard('TWI_200', whenPlayed('Exhaust a non-unique unit. Create a Clone Trooper token.', (s, ctx) => // Creative Thinking
  create(targetChoice(s, ctx, 'mayExhaustUnit', allUnits(s).filter(u => !cardOf(s, u)?.unique).map(u => u.instanceId)), ctx.owner, TOKEN_CLONE_TROOPER)))
registerCard('TWI_222', { // Political Pressure
  ...whenPlayed("Choose an opponent. They may discard a random card from their hand. If they don't, create 2 Battle Droid tokens.", (s, ctx) =>
    (s.players[opponentOf(ctx.owner)].hand.length
      ? pushChoice(s, { kind: 'mayPayThen', id: ctx.sourceInstanceId!, controller: opponentOf(ctx.owner), cost: 0, text: 'discard a random card from your hand', then: resume(ctx), declineStep: 'refused' })
      : create(s, ctx.owner, TOKEN_BATTLE_DROID, 2))),
  ifYouDo: (s, ctx) => {
    if (ctx.step === 'refused') return create(s, ctx.owner, TOKEN_BATTLE_DROID, 2)
    const enemy = opponentOf(ctx.owner)
    const hand = s.players[enemy].hand
    if (!hand.length) return s
    // Random, not chosen: the seed on the state keeps it deterministic under replay.
    return { ...discardFromHand(s, enemy, Math.floor(seededUnit(s.rngSeed) * hand.length)), rngSeed: nextSeed(s.rngSeed) }
  },
})
registerCard('TWI_239', whenPlayed('Deal 6 damage to each Jedi unit. For each unit defeated this way, its controller creates a Clone Trooper token.', s => { // Execute Order 66
  const jedi = BOTH_BASES.flatMap(p => s.players[p].units.filter(u => unitHasTrait(s, u, 'Jedi')).map(u => [u.instanceId, p] as const))
  const hit = jedi.reduce((acc, [id]) => dealDamageToUnit(acc, id, 6), s)
  return jedi.reduce((acc, [id, p]) => (findUnit(acc, id) ? acc : create(acc, p, TOKEN_CLONE_TROOPER)), hit)
}))

// D: leaders. Each side's token-making step resumes into the one `ifYouDo`, so a card's hook serves both.
registerCard('HMW_010', mergeLeaderSides( // Tarfful
  leaderFront('Discard a card from your hand: create a Beast token.', {
    cost: 2,
    usable: (s, ctx) => s.players[ctx.owner].hand.length > 0,
    effect: (s, ctx) => discards(s, ctx.owner, 1, ctx.sourceInstanceId!, resume(ctx)),
  }),
  onAttack(mayPayWp('You may pay 1. If you do, create a Beast token.', 1, 'pay 1 to create a Beast token', s => s)),
  { ifYouDo: (s, ctx) => create(s, ctx.owner, TOKEN_BEAST) },
))
const friendlyCreature = pickAll(pickFriendly, pickTrait('Creature'))
registerCard('HMW_012', mergeLeaderSides( // Poggle the Lesser
  leaderFront('Ready a friendly Creature unit and deal 1 damage to it.', {
    cost: 1,
    usable: anyUnitPasses(friendlyCreature),
    effect: (s, ctx) => unitThen(s, ctx, pickedIds(s, ctx, friendlyCreature), 'ready a friendly Creature unit and deal 1 damage to it', false),
  }),
  whenDeployed('Create a Beast token.', (s, ctx) => create(s, ctx.owner, TOKEN_BEAST)),
  attacks('You may ready a friendly Creature unit and deal 1 damage to it.', (s, ctx) =>
    unitThen(s, ctx, pickedIds(s, ctx, friendlyCreature), 'ready a friendly Creature unit and deal 1 damage to it', true)),
  { ifYouDo: (s, ctx) => dealDamageToUnit(readyUnit(s, ctx.targetInstanceId!), ctx.targetInstanceId!, 1) },
))
const readyNonLeader: Pick = (s, u) => !u.exhausted && nonLeader(s, u)
registerCard('JTL_016', mergeLeaderSides( // Admiral Ackbar
  leaderFront('Exhaust a non-leader unit. If you do, its controller creates an X-Wing token.', {
    cost: 1,
    usable: anyUnitPasses(readyNonLeader),
    effect: (s, ctx) => unitThen(s, ctx, pickedIds(s, ctx, readyNonLeader), 'exhaust a non-leader unit; its controller creates an X-Wing token', false),
  }),
  attacks('You may exhaust a unit. If you do, its controller creates an X-Wing token.', (s, ctx) =>
    unitThen(s, ctx, readyUnits(s).map(u => u.instanceId), 'exhaust a unit; its controller creates an X-Wing token', true)),
  { ifYouDo: (s, ctx) => {
    const found = findUnit(s, ctx.targetInstanceId!)
    return found && !found.unit.exhausted ? create(exhaustUnit(s, found.unit.instanceId), found.owner, TOKEN_X_WING) : s
  } },
))
const exhaustedToken: Pick = (_s, u) => u.exhausted && isTokenCard(u.cardId)
registerCard('SEC_011', mergeLeaderSides( // Governor Pryce
  leaderFront('Ready a token unit.', {
    cost: 1,
    usable: anyUnitPasses(exhaustedToken),
    effect: (s, ctx) => targetChoice(s, ctx, 'selectUnitToReady', pickedIds(s, ctx, exhaustedToken)),
  }),
  { statModifier: (s, u) => perEach(friendliesOf(s, u).filter(x => isTokenCard(x.cardId) && !x.exhausted).length, 1) },
  attacks('Create a Spy token.', (s, ctx) => create(s, ctx.owner, TOKEN_SPY)),
))
registerCard('SEC_014', mergeLeaderSides( // Sly Moore
  leaderFront('If there are 4 or more exhausted units in play, create a Spy token.', {
    cost: 1,
    usable: s => allUnits(s).filter(u => u.exhausted).length >= 4,
    effect: (s, ctx) => create(s, ctx.owner, TOKEN_SPY),
  }),
  attacks('You may deal 2 damage to an exhausted unit.', (s, ctx) => damageChoice(s, ctx, 2, allUnits(s).filter(u => u.exhausted), [], true)),
))
registerCard('TS26_1', mergeLeaderSides( // Count Dooku
  // Two players, so "choose 2 players" is both of them.
  leaderFront('Choose 2 players. They each heal 1 damage from their base and create a Battle Droid token.', {
    effect: s => BOTH_BASES.reduce((acc, p) => create(healBase(acc, p, 1), p, TOKEN_BATTLE_DROID), s),
  }),
  attacks('Create 2 Battle Droid tokens.', (s, ctx) => create(s, ctx.owner, TOKEN_BATTLE_DROID, 2)),
))
const twoFriendliesDefeated: When = (s, ctx) => defeatedThisPhase(s, ctx.owner).length >= 2
registerCard('TWI_002', mergeLeaderSides( // Nute Gunray
  leaderFront('If 2 or more friendly units were defeated this phase, create a Battle Droid token.', {
    usable: twoFriendliesDefeated,
    effect: (s, ctx) => create(s, ctx.owner, TOKEN_BATTLE_DROID),
  }),
  attacks('Create a Battle Droid token.', (s, ctx) => create(s, ctx.owner, TOKEN_BATTLE_DROID)),
))
registerCard('TWI_007', mergeLeaderSides( // Captain Rex
  leaderFront('If a friendly unit attacked this phase, create a Clone Trooper token.', {
    cost: 2,
    usable: attackedWithThisPhase(pickAny),
    effect: (s, ctx) => create(s, ctx.owner, TOKEN_CLONE_TROOPER),
  }),
  whenDeployed('Create a Clone Trooper token.', (s, ctx) => create(s, ctx.owner, TOKEN_CLONE_TROOPER)),
  friendlyAura(isTrait('Trooper'), { hp: 1 }, true),
))

// ══ Weakness tokens ═══════════════════════════════════════════════════
// A Weakness token is a -1/-1 upgrade an ability attaches, so it is the Experience token with the signs
// flipped: `giveTokens` attaches it, `mayGiveTokens` offers one target, and the stats pipeline reads the
// -1/-1 off the token card. A unit it takes to 0 HP is defeated by the state-based sweep that closes the
// action. These are the Weakness-shaped spellings of `expChoice` and `expWp`.

/** "Give `count` Weakness tokens to a unit that ...", or nothing when nothing is eligible. */
const weakChoice = (s: GameState, ctx: EventCtx, targets: string[], count = 1, optional = false): GameState =>
  targets.length
    ? pushChoice(s, { kind: 'mayGiveTokens', id: ctx.sourceInstanceId!, controller: ctx.owner, token: TOKEN_WEAKNESS, count, targets, optional })
    : s
/** "(If ...,) (you may) give `count` Weakness tokens to a unit that ...". */
const weakWp = (description: string, test: Pick, count = 1, optional = false, when: When = always) =>
  whenPlayed(description, (s, ctx) => (when(s, ctx) ? weakChoice(s, ctx, pickedIds(s, ctx, test), count, optional) : s))
const weakened: Pick = (_s, u) => hasToken(u.upgrades, TOKEN_WEAKNESS)
const giveWeakness = (s: GameState, id: string, count = 1): GameState => giveTokens(s, id, TOKEN_WEAKNESS, count)
/** "While you control a <planet> base": a base's planet is its trait. */
const controlsBaseWith = (s: GameState, owner: PlayerId, trait: string): boolean => printedTrait(s.cards[s.players[owner].base.cardId], trait)

// A: a token on a chosen unit
registerCard('HMW_197', whenPlayed('An opponent chooses a unit they control. Give a Weakness token to it.', (s, ctx) => { // Cid Scaleback
  const opp = opponentOf(ctx.owner)
  const targets = s.players[opp].units.map(u => u.instanceId)
  return targets.length ? pushChoice(s, { kind: 'mayGiveTokens', id: ctx.sourceInstanceId!, controller: opp, token: TOKEN_WEAKNESS, count: 1, targets, optional: false }) : s
}))
registerCard('HMW_059', defeated(weakWp('You may give a Weakness token to a unit.', pickAny, 1, true))) // Clone X Assassin
registerCard('HMW_087', defeated(weakWp('You may give a Weakness token to a damaged unit.', damaged, 1, true))) // Venomous Wyyyshokk
registerCard('HMW_065', allOf( // Clone of the Zillo Beast
  friendlyAura(() => true, { power: -2, hp: -2 }, true),
  onAttack(weakWp('You may give a Weakness token to a unit.', pickAny, 1, true)),
))
registerCard('HMW_097', weakWp('You may give a Weakness token to a unit.', pickAny, 1, true)) // Dire Prowess
registerCard('HMW_242', weakWp('If you control 6 or more resources, you may give a Weakness token to a unit.', pickAny, 1, true, // Occupation Officer
  (s, ctx) => s.players[ctx.owner].resources.length >= 6))
registerCard('HMW_040', weakWp('If an opponent played 2 or more cards this phase, you may give 2 Weakness tokens to a unit.', pickAny, 2, true, // Talzin's Shuttle
  (s, ctx) => cardsPlayedThisPhase(s, opponentOf(ctx.owner)).length >= 2))
registerCard('HMW_100', whenPlayed('Give a Weakness token to a unit. If you control a Naboo base, give 2 Weakness tokens to that unit instead.', (s, ctx) => // Torrent
  weakChoice(s, ctx, pickedIds(s, ctx, pickAny), controlsBaseWith(s, ctx.owner, 'Naboo') ? 2 : 1)))
registerCard('HMW_231', unitThenWp("You may give a Weakness token to a unit. If it's a unique unit, exhaust it.", pickAny, 'give a Weakness token to a unit', true, // Dragonboat Freighter
  (s, ctx) => {
    const id = ctx.targetInstanceId!
    const given = giveWeakness(s, id)
    const target = findUnit(given, id)?.unit
    return target && cardOf(given, target)?.unique ? exhaustUnit(given, id) : given
  }))
const infernoSquad = unitThenWp('You may deal 1 damage to a unit and give a Weakness token to it.', pickAny, 'deal 1 damage to a unit and give a Weakness token to it', true,
  (s, ctx) => {
    const id = ctx.targetInstanceId!
    // "And", not "if you do": a Shield that prevents the damage does not stop the token.
    const hit = dealDamageToUnit(s, id, 1)
    return findUnit(hit, id) ? giveWeakness(hit, id) : hit
  })
registerCard('HMW_202', allOf(infernoSquad, defeated(infernoSquad))) // Inferno Squad: When Played/When Defeated
registerCard('HMW_196', defeated({ // Qimir
  ...whenPlayed("You may discard the top card of your deck. If it's not Villainy, give a Weakness token to an enemy unit.", (s, ctx) =>
    (s.players[ctx.owner].deck.length
      ? pushChoice(s, { kind: 'mayPayThen', id: ctx.sourceInstanceId!, controller: ctx.owner, cost: 0, text: 'discard the top card of your deck', then: resume(ctx) })
      : s)),
  ifYouDo: (s, ctx) => {
    const [next, milled] = millTop(s, ctx.owner, 1)
    return milled.length && !printedAspect(next.cards[milled[0]], 'Villainy') ? weakChoice(next, ctx, pickedIds(next, ctx, pickEnemy)) : next
  },
}))

// B: tokens on several units, or on a unit that attacks
registerCard('HMW_071', whenPlayed('Distribute up to 3 Weakness tokens among any number of units.', (s, ctx) => { // Ravage
  const targets = allUnits(s).map(u => u.instanceId)
  return targets.length
    ? pushChoice(s, { kind: 'distributeTokens', id: ctx.sourceInstanceId!, controller: ctx.owner, token: TOKEN_WEAKNESS, remaining: 3, total: 3, targets, upTo: true, anyUnit: true })
    : s
}))
registerCard('HMW_240', { // Sandstorm
  costModifier: (s, owner) => (controlsBaseWith(s, owner, 'Tatooine') ? -1 : 0),
  ...whenPlayed('Choose an arena. Give a Weakness token to each exhausted enemy unit in that arena.', (s, ctx) =>
    chooseArena(s, ctx, 'give a Weakness token to each exhausted enemy unit in')),
  ifYouDo: (s, ctx) => pickedIds(s, ctx, pickAll(pickEnemy, exhaustedPick, (_s, u) => u.arena === ctx.arenaChosen)).reduce((acc, id) => giveWeakness(acc, id), s),
})
registerCard('HMW_248', { // Defoliator Tank
  ...attacks("If the defending unit isn't a Droid or Vehicle, you may pay 2. If you do, give 2 Weakness tokens to it.", (s, ctx) => {
    const defender = defenderOf(s, ctx)
    if (!defender || unitHasTrait(s, defender, 'Droid') || unitHasTrait(s, defender, 'Vehicle') || !canAfford(s.players[ctx.owner], 2)) return s
    return pushChoice(s, { kind: 'mayPayThen', id: ctx.sourceInstanceId!, controller: ctx.owner, cost: 2, text: 'give 2 Weakness tokens to the defending unit', then: resume(ctx, undefined, defender.instanceId) })
  }),
  ifYouDo: (s, ctx) => (ctx.unitChosen ? giveWeakness(s, ctx.unitChosen, 2) : s),
})
registerCard('HMW_067', { // The Great Progenitor
  abilities: [{ trigger: 'onAttackEnd', description: 'You may give a Weakness token to this unit. If you do, create a Beast token for each Weakness token on this unit.',
    // Nothing to give the token to once the attack has defeated it.
    effect: (s, ctx) => (selfOf(s, ctx)
      ? pushChoice(s, { kind: 'mayPayThen', id: ctx.sourceInstanceId!, controller: ctx.owner, cost: 0, text: 'give this unit a Weakness token and create a Beast token for each one on it', then: resume(ctx) })
      : s) }],
  ifYouDo: (s, ctx) => {
    const given = giveWeakness(s, ctx.sourceInstanceId!)
    const self = findUnit(given, ctx.sourceInstanceId!)?.unit
    return self ? create(given, ctx.owner, TOKEN_BEAST, self.upgrades.filter(u => u.cardId === TOKEN_WEAKNESS).length) : given
  },
})

// C: control, and reading the token
registerCard('HMW_110', unitThenWp('You may take control of an enemy non-leader unit that costs 3 or less. If you do, give 2 Weakness tokens to it.', // Emperor Palpatine
  pickAll(pickEnemy, nonLeader, costsAtMost(3)), 'take control of an enemy non-leader unit that costs 3 or less', true,
  (s, ctx) => giveWeakness(stealTo(s, ctx.owner, ctx.targetInstanceId, 'permanent'), ctx.targetInstanceId!, 2)))
registerCard('HMW_200', unitThenWp('Take control of an enemy non-leader unit with a Weakness token on it. At the start of the next regroup phase, its owner takes control of it.', // Rish Loo
  pickAll(pickEnemy, nonLeader, weakened), 'take control of an enemy non-leader unit with a Weakness token on it', false,
  // "Until the regroup phase" is the default duration of a change of control.
  (s, ctx) => stealTo(s, ctx.owner, ctx.targetInstanceId)))
const NUVO_ROUND_KEY = 'HMW_062#round'
registerCard('HMW_062', { // Nuvo Vindi
  ...weakWp('You may give a Weakness token to a unit.', pickAny, 1, true),
  abilities: [
    ...weakWp('You may give a Weakness token to a unit.', pickAny, 1, true).abilities,
    { trigger: 'whenEnemyUnitDefeated', description: 'When an enemy unit with a Weakness token on it is defeated: You may give a Weakness token to a unit. Use this ability only once each round.',
      effect: (s, ctx) => {
        // `defeatedUnit` is the unit as it last was, so its tokens are still on it.
        if (!ctx.defeatedUnit || !hasToken(ctx.defeatedUnit.upgrades, TOKEN_WEAKNESS) || selfOf(s, ctx)?.usedAbilities?.includes(NUVO_ROUND_KEY)) return s
        return unitThen(s, ctx, pickedIds(s, ctx, pickAny), 'give a Weakness token to a unit', true)
      } },
  ],
  // Only a taken "may" uses up the once each round.
  ifYouDo: (s, ctx) => markAbilityUsed(giveWeakness(s, ctx.targetInstanceId!), ctx.owner, ctx.sourceInstanceId!, NUVO_ROUND_KEY),
})
registerCard('HMW_199', whenPlayed('Create a Beast token. Then, give a Weakness token to a friendly unit.', (s, ctx) => { // Geonosian Picador
  const made = create(s, ctx.owner, TOKEN_BEAST)
  return weakChoice(made, ctx, pickedIds(made, ctx, pickFriendly))
}))
registerCard('HMW_237', whenPlayed('Create a Beast token. An opponent creates a Beast token. Give a Weakness token to it.', (s, ctx) => // Easy Prey
  create(create(s, ctx.owner, TOKEN_BEAST), opponentOf(ctx.owner), TOKEN_BEAST, 1, (st, id) => giveWeakness(st, id))))

// D: leaders
const underworldOrFringe = (c: EngineCard | undefined): boolean => printedUnit(c) && (printedTrait(c, 'Underworld') || printedTrait(c, 'Fringe'))
const mazPlay: PlayFromHandOptions = { costDelta: -1, test: underworldOrFringe, thenTokens: [TOKEN_WEAKNESS] }
registerCard('HMW_002', { // Maz Kanata: the deployed side's Hidden is read from the card
  ...leaderPlay('Play a Fringe or Underworld unit from your hand. It costs 1 less. Give a Weakness token to it.', mazPlay),
  ...unitPlayAction('Play a Fringe or Underworld unit from your hand. It costs 1 less. Give a Weakness token to it.', mazPlay),
})
const unweakened: Pick = (s, u, ctx) => !weakened(s, u, ctx)
registerCard('HMW_003', mergeLeaderSides( // Doctor Hemlock
  leaderFront('Give a Weakness token to a unit without a Weakness token on it.', {
    cost: 1,
    usable: anyUnitPasses(unweakened),
    effect: (s, ctx) => weakChoice(s, ctx, pickedIds(s, ctx, unweakened)),
  }),
  onAttack(weakWp('You may give a Weakness token to a unit.', pickAny, 1, true)),
))
/** "A unit with a token upgrade on it": Shield and Weakness tokens are token upgrades, as are Experience and Advantage. */
const tokenUpgraded: Pick = (s, u) => u.upgrades.some(up => s.cards[up.cardId]?.type === 'token')
registerCard('HMW_015', mergeLeaderSides( // Bossk
  leaderFront('Heal 1 damage from a damaged enemy unit and give a Weakness token to it.', {
    usable: anyUnitPasses(damagedEnemy),
    effect: (s, ctx) => unitThen(s, ctx, pickedIds(s, ctx, damagedEnemy), 'heal 1 damage from a damaged enemy unit and give a Weakness token to it', false),
  }),
  attacks('You may deal 2 damage to a unit with a token upgrade on it.', (s, ctx) => damageChoice(s, ctx, 2, picked(s, ctx, tokenUpgraded), [], true)),
  { ifYouDo: (s, ctx) => giveWeakness(healUnit(s, ctx.targetInstanceId!, 1), ctx.targetInstanceId!) },
))

// ══ Fortify: upgrades on a base ════════════════════════════════════════
// A Fortify upgrade attaches to its player's base (`playBaseUpgrade`), and "Attached base gains: ..." makes
// its ability the base's. So a constant is `baseAbilities.aura`, an action is `baseAbilities.actions`, and
// a triggered ability is an ordinary `abilities` entry, which `collectBaseTriggers` reads off the base's
// upgrades: its source is `<cardId>-base`, and "this upgrade" is the first copy of the card on the
// controller's base. The cards that read a base's upgrades count them off `BaseState.upgrades`.

const baseUpgradeCount = (s: GameState, owner: PlayerId): number => s.players[owner].base.upgrades?.length ?? 0
const baseUpgraded = (s: GameState, owner: PlayerId): boolean => baseUpgradeCount(s, owner) > 0
const onBase = (s: GameState, owner: PlayerId, cardId: string): boolean => (s.players[owner].base.upgrades ?? []).some(u => u.cardId === cardId)
/** A "Friendly units ..." constant a base upgrade hands its base. */
const friendlyBaseAura = (test: (u: UnitState) => boolean, contribution: AuraContribution): CardDefinition => ({
  baseAbilities: { aura: (_s, _owner, target, sameController) => (sameController && test(target) ? contribution : undefined) },
})
/** "You may defeat this upgrade. If you do, ...": a yes/no, then the card's `ifYouDo` with the unit it is about. */
const mayDefeatThisUpgrade = (s: GameState, ctx: Resumable, text: string, unit: string): GameState =>
  (onBase(s, ctx.owner, ctx.cardId) ? pushChoice(s, { kind: 'mayPayThen', id: ctx.sourceInstanceId!, controller: ctx.owner, cost: 0, text, then: resume(ctx, undefined, unit) }) : s)
/** The rest of `mayDefeatThisUpgrade`, only if the upgrade was there to defeat. */
const ifDefeatedThisUpgrade = (then: (s: GameState, unit: string, ctx: IfYouDoContext) => GameState) => (s: GameState, ctx: IfYouDoContext): GameState =>
  (onBase(s, ctx.owner, ctx.cardId) && ctx.unitChosen ? then(defeatBaseUpgrade(s, ctx.owner, ctx.cardId), ctx.unitChosen, ctx) : s)
const nonVehicleUnitCard = (c: EngineCard | undefined): boolean => printedUnit(c) && !printedTrait(c, 'Vehicle')

// A: constants on the base
registerCard('HMW_271', friendlyBaseAura(u => u.arena === 'space', { power: 1 })) // Landing Pad
registerCard('HMW_112', friendlyBaseAura(() => true, { keywords: [{ name: 'Overwhelm' }] })) // Military Academy
registerCard('HMW_126', friendlyBaseAura(() => true, { keywords: [{ name: 'Raid', value: 1 }] })) // Verdant Fortress
registerCard('HMW_081', { baseAbilities: { // Alliance Shield Generator
  interceptDamage: (s, owner, amount) => (amount >= 5 && onBase(s, owner, 'HMW_081') ? drawCards(defeatBaseUpgrade(s, owner, 'HMW_081'), owner, 1) : undefined),
} })

// B: triggered abilities the base gains, or the upgrade has there
registerCard('HMW_070', { abilities: [{ trigger: 'whenRegroupStarts', description: 'When the regroup phase starts: Draw a card and deal 2 damage to this base.', // Dark Sanctum
  effect: (s, ctx) => dealDamageToBase(drawCards(s, ctx.owner, 1), ctx.owner, 2, { cardId: ctx.cardId, controller: ctx.owner }) }] })
registerCard('HMW_160', { abilities: [{ trigger: 'whenRegroupStarts', description: "When the regroup phase starts: Reveal the top card of your deck. If it's Aggression, deal 1 damage to an enemy unit.", // Noxious Refinery
  effect: (s, ctx) => (printedAspect(s.cards[s.players[ctx.owner].deck[0]], 'Aggression') ? damageChoice(s, ctx, 1, s.players[opponentOf(ctx.owner)].units) : s) }] })
registerCard('HMW_113', { abilities: [{ trigger: 'whenFriendlyUnitDefeated', description: 'When a friendly unit is defeated: Heal 1 damage from this base.', // Sinister War Memorial
  effect: (s, ctx) => healBase(s, ctx.owner, 1) }] })
/**
 * "If you control Grand Moff Tarkin". The HMW leader's two sides have different names ("Grand Moff Tarkin //
 * The Death Star"), so his undeployed side counts by its front name and his deployed side, The Death Star,
 * does not; any unit of that name counts as usual.
 */
const controlsTarkin = (s: GameState, owner: PlayerId): boolean => {
  const leader = s.players[owner].leader
  return (!leader.deployed && s.cards[leader.cardId]?.name.split(' // ')[0] === 'Grand Moff Tarkin') || playerControlsNamed(s, owner, 'Grand Moff Tarkin')
}
registerCard('HMW_206', { // The Tarkin Doctrine
  abilities: [
    { trigger: 'whenPlayUpgrade', description: 'When you play a Fortification upgrade: Exhaust an enemy unit.',
      effect: (s, ctx) => (printedTrait(s.cards[ctx.playedCardId ?? ''], 'Fortification')
        ? targetChoice(s, ctx, 'mayExhaustUnit', s.players[opponentOf(ctx.owner)].units.map(u => u.instanceId))
        : s) },
    ...whenPlayed('If you control Grand Moff Tarkin, give an enemy unit -3/-0 for this phase.', (s, ctx) =>
      (controlsTarkin(s, ctx.owner) ? lastingBuffChoice(s, ctx, pickedIds(s, ctx, pickEnemy), { power: -3 }) : s)).abilities!,
  ],
})
registerCard('HMW_216', { // Insurgent Camp
  abilities: [{ trigger: 'whenPlayUnit', description: 'When you play a unit with 3 or less power: You may defeat this upgrade. If you do, ready that unit.',
    effect: (s, ctx) => {
      const played = findUnit(s, ctx.targetInstanceId ?? '')?.unit
      return played && effectivePower(s, played) <= 3 ? mayDefeatThisUpgrade(s, ctx, 'defeat Insurgent Camp to ready the unit you played', played.instanceId) : s
    } }],
  ifYouDo: ifDefeatedThisUpgrade((s, unit) => readyUnit(s, unit)),
})
registerCard('HMW_171', { // Trap Field
  abilities: [{ trigger: 'whenUnitEntersPlay', description: 'When a non-leader ground unit enters play (including token units): You may defeat this upgrade. If you do, deal 3 damage to that unit.',
    effect: (s, ctx) => {
      const entered = findUnit(s, ctx.targetInstanceId ?? '')?.unit
      return entered && entered.arena === 'ground' && nonLeader(s, entered)
        ? mayDefeatThisUpgrade(s, ctx, 'defeat Trap Field to deal 3 damage to the unit that entered play', entered.instanceId)
        : s
    } }],
  ifYouDo: ifDefeatedThisUpgrade((s, unit, ctx) => dealDamageToUnit(s, unit, 3, { cardId: ctx.cardId, controller: ctx.owner })),
})

// C: When Played, and actions the base gains
registerCard('HMW_172', { // Heavy Ion Cannon
  ...whenPlayed('Draw a card.', (s, ctx) => drawCards(s, ctx.owner, 1)),
  baseAbilities: { actions: [{
    description: 'Action [discard a card from your hand]: Deal 2 damage to a unit. Use this ability only once each phase.',
    oncePerPhase: true,
    usable: (s, owner) => allUnits(s).length > 0 && s.players[owner].hand.length > 0,
    effect: (s, ctx) => discards(s, ctx.owner, 1, ctx.sourceInstanceId!, resume(ctx)),
  }] },
  ifYouDo: (s, ctx) => damageChoice(s, ctx, 2, allUnits(s)),
})
registerCard('HMW_037', { // Bacta Tank
  ...whenPlayed('Heal up to 3 damage from a non-Vehicle unit.', (s, ctx) =>
    healChoice(s, ctx, 3, allUnits(s).filter(u => u.damage > 0 && nonVehicle(s, u)).map(u => u.instanceId), [], true)),
  baseAbilities: { actions: [{
    description: 'Action [defeat this upgrade]: Put a non-Vehicle unit from your discard pile on top of your deck.',
    defeatsSelf: true,
    usable: (s, owner) => s.players[owner].discard.some(id => nonVehicleUnitCard(s.cards[id])),
    effect: (s, ctx) => cardThen(s, ctx, s.players[ctx.owner].discard.filter(id => nonVehicleUnitCard(s.cards[id])), 'put a non-Vehicle unit from your discard pile on top of your deck', false, 'deck'),
  }] },
  ifYouDo: (s, ctx) => {
    const p = s.players[ctx.owner]
    const at = ctx.cardChosen ? p.discard.indexOf(ctx.cardChosen) : -1
    return at === -1 ? s : updatePlayer(s, ctx.owner, { discard: p.discard.filter((_, i) => i !== at), deck: [ctx.cardChosen!, ...p.deck] })
  },
})
registerCard('HMW_095', { // Carbonite Chamber
  baseAbilities: { actions: [{
    description: "Action [defeat this upgrade]: Choose a non-Vehicle unit. It doesn't ready during the next regroup phase.",
    defeatsSelf: true,
    usable: s => allUnits(s).some(u => nonVehicle(s, u)),
    effect: (s, ctx) => unitThen(s, ctx, allUnits(s).filter(u => nonVehicle(s, u)).map(u => u.instanceId), "choose a non-Vehicle unit; it doesn't ready during the next regroup phase", false),
  }] },
  ifYouDo: (s, ctx) => addLastingEffect(s, { targetInstanceId: ctx.targetInstanceId!, skipsRegroupReady: true, untilRoundEnd: true }),
})
registerCard('HMW_205', whenPlayed("Look at an opponent's hand. You may discard a card from it. If you do, they draw a card.", (s, ctx) => // Intelligence Agency
  // "You may look at the top card of your deck at any time" is information the engine does not model.
  pushChoice(s, { kind: 'lookAtHand', id: ctx.sourceInstanceId!, controller: ctx.owner, target: opponentOf(ctx.owner), mayDiscard: true, thenDraw: true })))

// D: cards that read a base's upgrades
registerCard('HMW_061', attacks('If your base is upgraded, draw a card.', (s, ctx) => (baseUpgraded(s, ctx.owner) ? drawCards(s, ctx.owner, 1) : s))) // Director Krennic
const baseUpgradesOf = (s: GameState, u: UnitState): number => { const o = unitOwner(s, u); return o ? baseUpgradeCount(s, o) : 0 }
registerCard('HMW_066', { // Carrion Spike
  statModifier: (s, u) => perEach(baseUpgradesOf(s, u), 1),
  conditionalKeywords: (s, u) => { const n = baseUpgradesOf(s, u); return n > 0 ? [{ name: 'Restore', value: n }] : [] },
})
registerCard('HMW_260', { costModifier: (s, owner) => (baseUpgraded(s, owner) ? -2 : 0) }) // Queen Amidala
registerCard('HMW_270', whenPlayed('You may defeat an upgrade on a base.', (s, ctx) => { // Wild Space Wanderer
  const candidates = upgradeCandidates(s, { on: 'base' })
  return candidates.length ? pushChoice(s, { kind: 'selectUpgradeToDefeat', id: ctx.sourceInstanceId!, controller: ctx.owner, candidates, optional: true }) : s
}))
/** "A base with 10 or less remaining HP". Only the enemy's is offered: defeating your own loses the game. */
const tarkinBase = (s: GameState, owner: PlayerId): boolean => {
  const base = s.players[opponentOf(owner)].base
  return (s.cards[base.cardId]?.hp ?? 0) - base.damage <= 10
}
registerCard('HMW_004', { // Grand Moff Tarkin
  leaderAbilities: { waivesAspectPenalty: (_s, _owner, c) => isFortify(c.card) },
  waivesAspectPenalty: (_s, _source, c) => isFortify(c.card),
  abilities: [{ trigger: 'whenRegroupStarts', description: 'When the regroup phase starts: You may defeat a base with 10 or less remaining HP.',
    effect: (s, ctx) => (tarkinBase(s, ctx.owner)
      ? pushChoice(s, { kind: 'mayPayThen', id: ctx.sourceInstanceId!, controller: ctx.owner, cost: 0, text: "defeat the opponent's base", then: resume(ctx) })
      : s) }],
  ifYouDo: (s, ctx) => {
    const opp = opponentOf(ctx.owner)
    const base = s.players[opp].base
    return updatePlayer(s, opp, { base: { ...base, damage: Math.max(base.damage, s.cards[base.cardId]?.hp ?? 0) } })
  },
})
