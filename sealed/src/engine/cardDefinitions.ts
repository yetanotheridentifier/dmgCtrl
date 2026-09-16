import type { EffectContext } from './abilities'
import { registerCard } from './abilities'
import { giveToken, giveTokens, exhaustUnit, drawCards, discardFromHand, returnUnitToHand, returnOtherUpgradesToHand, returnUpgradeFromDiscardToHand, defeatUpgrade, defeatUpgradeAt, createTokenUnit, createTokenUnits, findUnit, searchCount, grantNextUnit, healUnit, healBase, dealDamageToBase, exhaustReadyResource, readyResource, readyUnit, openSupportChoice, leaderCanExhaust, resourceTopOfDeck } from './effects'
import { dealDamageToUnit, defeatUnit, defeatUnits } from './combat'
import { seededUnit, nextSeed } from './rng'
import { effectiveHp, effectivePower } from './stats'
import { TOKEN_SHIELD, TOKEN_ADVANTAGE, hasToken } from './tokenUpgrades'
import { discardUnitsMatching } from './resolve'
import { TOKEN_MANDALORIAN, isTokenCard } from './tokenUnits'
import { opponentOf, pushChoice, addLastingEffect, defeatedThisPhase, damagedThisPhase, leftPlayThisPhase, leaderLeftPlayThisPhase, enteredPlayThisPhase, baseAttackedThisPhase, baseDamagedThisPhase, upgradeDefeatedThisPhase, cardsPlayedThisPhase, markAbilityUsed, updatePlayer } from './types'
import { affordableHandUnits, resourceUpgradeCandidates, enemyAttackTargets, effectiveCost } from './legalMoves'
import { canAfford } from './resources'
import { unitHasTrait, unitTraits, isLeaderUnit, nonAuraKeywordNames, unitHasKeyword, unitKeywords } from './keywords'
import type { EngineCard, GameState, KeywordInstance, LastingEffect, PlayerId, UnitState, UpgradeRef } from './types'

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
      return returnUpgradeFromDiscardToHand(s, owner, ctx.cardId)
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
 */
interface UpgradeFilter {
  /** The player who played the upgrade. */
  owner?: PlayerId
  /** The controller of the unit the upgrade is attached to. */
  hostController?: PlayerId
  /** Printed cost cap. Tokens are cost 0, so they always satisfy one. */
  maxCost?: number
}

const upgradeCandidates = (s: GameState, filter: UpgradeFilter = {}): UpgradeRef[] => {
  const out: UpgradeRef[] = []
  for (const side of ['player', 'opponent'] as PlayerId[]) {
    if (filter.hostController !== undefined && side !== filter.hostController) continue
    for (const u of s.players[side].units) {
      u.upgrades.forEach((up, i) => {
        if (filter.owner !== undefined && up.owner !== filter.owner) return
        const c = s.cards[up.cardId]
        if (filter.maxCost !== undefined && (c?.cost ?? 0) > filter.maxCost) return
        out.push({ unitId: u.instanceId, upgradeIndex: i, cardId: up.cardId })
      })
    }
  }
  return out
}

/** "A friendly upgrade": every upgrade the player OWNS, card upgrades and tokens alike. */
const friendlyUpgradeCandidates = (s: GameState, owner: PlayerId): UpgradeRef[] =>
  upgradeCandidates(s, { owner })

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
  s.players[owner].units.some(u => {
    if (u.exhausted) return false
    const { targets, canAttackBase } = enemyAttackTargets(s, u)
    return targets.length > 0 || canAttackBase
  })

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
    return candidates.length ? pushChoice(s, { kind: 'selectUpgradeToReturn', id: ctx.sourceInstanceId!, controller: ctx.owner, candidates, optional: true }) : s
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
 * on an attack being legal rather than merely on a ready unit existing.
 */
const attackWithRider = (description: string, grantCardId: string) =>
  whenPlayed(description, (s, ctx) => (canAnyUnitAttack(s, ctx.owner)
    ? pushChoice(s, { kind: 'mayAttackAnyUnit', id: ctx.sourceInstanceId!, controller: ctx.owner, restore: 0, grantCardId })
    : s))

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
 * Raising their choice directly from `enterUnit` instead is what made a Snub Fighter Squadron unable
 * to deal its 1 damage until after it had taken its Ambush attack: a choice on the board stops the
 * rest of the batch (CR 7.6.12), and this one was there before the batch began.
 *
 * The unit's ready state is NOT decided here. Ambush enters its unit ready so it can attack, which is
 * part of entering play rather than part of the ability, and stays in `enterUnit`.
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
const searchDrawWp = (description: string, depth: number, test: CardTest, count = 1) =>
  whenPlayed(description, (s: GameState, ctx: EventCtx) => {
    const revealed = s.players[ctx.owner].deck.slice(0, searchCount(s, ctx.owner, depth))
    if (revealed.length === 0) return s
    const eligibleIndices = revealed.flatMap((id, i) => (test(s.cards[id], s, ctx) ? [i] : []))
    return pushChoice(s, {
      kind: 'searchDraw', id: ctx.sourceInstanceId!, controller: ctx.owner, revealed, eligibleIndices,
      ...(count > 1 && { remaining: count, upTo: true }),
    })
  })

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
