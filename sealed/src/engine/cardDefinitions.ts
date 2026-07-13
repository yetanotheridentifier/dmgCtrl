import { registerCard } from './abilities'
import { giveToken, exhaustUnit, drawCards, returnOtherUpgradesToHand, returnUpgradeFromDiscardToHand, defeatUpgrade, createTokenUnit, findUnit } from './effects'
import { dealDamageToUnit } from './combat'
import { TOKEN_SHIELD, TOKEN_ADVANTAGE } from './tokenUpgrades'
import { TOKEN_MANDALORIAN } from './tokenUnits'
import { opponentOf, pushChoice } from './types'
import type { EngineCard, GameState, UnitState } from './types'

/**
 * Real card definitions (#341+). Side-effect module: importing it registers every
 * card's behaviour into the ability registry. Built card-type-agnostic — the same
 * hooks and primitives serve units, leaders, events and upgrades.
 *
 * ASH upgrades whose effects need infrastructure not yet built (deck search, token
 * units, damage-dealing/replacement, the pending-choice mechanism) register only
 * their attach restriction here; their abilities land with Tier 2/3.
 */

const trait = (card: EngineCard | undefined, name: string): boolean =>
  (card?.traits ?? []).some(t => t.toLowerCase() === name.toLowerCase())
const cardOf = (state: GameState, unit: UnitState): EngineCard | undefined => state.cards[unit.cardId]
const nonVehicle = (state: GameState, target: UnitState): boolean => !trait(cardOf(state, target), 'Vehicle')

// ── Stat / damage modifiers ─────────────────────────────────────────────────
registerCard('ASH_054', { statModifier: (_s, _u, ctx) => (ctx.attackingBase ? { power: -3 } : {}) }) // Pointless to Resist — −3 power attacking a base
registerCard('ASH_150', { // Deadly Vulnerability — takes double damage; attacker loses Overwhelm while it defends
  damageMultiplier: () => 2,
  negatesOverwhelm: () => true,
})

// ── Cost modifiers ──────────────────────────────────────────────────────────
registerCard('ASH_262', { costModifier: (s, _p, target) => (target && trait(cardOf(s, target), 'Imperial') ? -1 : 0) }) // Faith in the Empire
registerCard('ASH_263', { costModifier: (s, _p, target) => (target && trait(cardOf(s, target), 'Mandalorian') ? -1 : 0) }) // The Way of the Mand'alor

// ── Attach restrictions + conditional keywords ─────────────────────────────
registerCard('ASH_066', { // Luke's Jedi Lightsaber — Sentinel if attached to Luke Skywalker
  attachRestriction: nonVehicle,
  conditionalKeywords: (s, u) => (cardOf(s, u)?.name === 'Luke Skywalker' ? [{ name: 'Sentinel' }] : []),
})
registerCard('ASH_114', { // Sabine's Lightsaber — Restore 2 if Sabine Wren or a Force unit
  attachRestriction: nonVehicle,
  conditionalKeywords: (s, u) => (cardOf(s, u)?.name === 'Sabine Wren' || trait(cardOf(s, u), 'Force') ? [{ name: 'Restore', value: 2 }] : []),
})
registerCard('ASH_181', { attachRestriction: (_s, t) => t.damage > 0 }) // Mark My Words — attach to a damaged unit (Overwhelm from keyword data)
registerCard('ASH_198', { conditionalKeywords: () => [{ name: 'Sentinel' }] }) // Nowhere to Hide — attached unit gains Sentinel
registerCard('ASH_230', { attachRestriction: (_s, t) => t.arena === 'ground' }) // Improvised Identity — ground unit (ability: #343)

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
      if (!ctx.dealtDamageToBase) return s
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
      if (!host || !trait(s.cards[host.cardId], 'Night')) return s
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

// ── Attach restriction only (abilities land with Tier 2/3) ─────────────────
registerCard('ASH_210', { attachRestriction: nonVehicle }) // DDC Defender (onDefense "may" — Tier 2)
