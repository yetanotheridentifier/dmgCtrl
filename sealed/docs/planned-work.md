# Planned work

Where the next session picks up. **This is the only doc that tracks tickets**; every other file
describes what the software does now.

**It does not record findings.** [experiments.md](experiments.md) holds what has been measured and
which avenues that closes off, and [ai-model.md](ai-model.md) holds the measured constraints that
explain the model's current shape. Evidence appears below only where it decides what to build next,
and then in one line with a pointer.

**Three streams, in this order: the heuristic bot, then the card programme, then the player-facing
UI.** They sit on separate branches and share no code, so the order is a decision about attention
rather than a dependency.

## Next up

Ordered on one principle: **correctness, then structure, then calibration.** Anything that changes the
engine or the horizon invalidates a calibration done before it.

1. **#587 turn the leader ranking into a blind-spot queue.** The matrix has run on the corrected
   generator (55,120 games over 52 decks, none dropped) and its findings are in
   [experiments.md](experiments.md).

   Read against real-play reputation, most of the bottom of the ranking is **pool-dependent rather than
   misplayed**: Grogu, Bo-Katan Kryze, Moff Gideon, The Mandalorian and Vane each need specific cards an
   algorithmic deck rarely supplies. **Sabine Wren is the candidate blind spot, filed as #589 with a
   replay**: the bot used her ability with no ready resources and passed, so the opponent got 2
   Advantage tokens and no unit collected the Shielded. It is intermittent: the log attached to #588
   shows the same bot using it with 4 resources ready and following with a 4-cost unit. Next: a scripted
   position built from the #589 replay, against a matched one where a unit can still be played.

   **Whether a different deck suite moves a leader's rating is still open.** The runs replayed one
   suite because the matrix children built the default seed; that is fixed, and a payload played on
   different decks is now refused. A real multi-suite run waits for the pool generator below: the copy
   caps alone moved leaders by up to 12 points, and a pool step will move them again.

2. **Make the deck generator model a sealed pool.** Open six packs, then build from what came out,
   rather than from the full set under quotas. Duplicates are already rolled by rarity; the pool step
   is what remains, and example pools from real openings will calibrate it.

   It also unlocks two things that are thin today. Several deck suites become more meaningful, since a
   pool varies which cards a leader can have at all, where a seed only varies the draw from the whole
   set. And per-card win
   rates need far more decks than 52 before a card-sized effect can clear the noise.
3. **#565 split what a run plays from what it records.** Fifteen modes, two real shapes: a game run and
   a corpus run. The fragmentation already costs something measured, since the generalisation harness
   and `runBench` read 50.4% and 48.70% for the same AI on the same decks, which is why every harness
   needs its own baseline established before a number from it can be trusted. The benefit is mostly
   for repeated A/B runs.
4. **#585 use the game's own terms for game actions.** Units are played and only leaders are
   deployed; cards are resourced rather than banked; things are defeated rather than killed.
   [glossary.md](glossary.md) records the correct terms and the ones this project invented. Not
   urgent and not blocking anything, but it is prose-level debt that makes comments carrying measured
   facts harder to check, and it grows with every new comment written in the wrong vocabulary.

## Deferred

Optional abilities, token value, and hand and resource optionality are all "value something whose
payoff arrives later", and all were closed once the search tie-break turned out to be the answer rather
than a new term. **One idea survived unbuilt** and is worth a ticket: resource count and hand SIZE are
**public**, so "I am holding up three resources" may legitimately outrank the board score, where "I hold
Vanquish" cannot.

The initiative tie policy is settled: always taking a tied initiative and never taking one measured
**+0.00 apart** over 2016 games, so the seeded coin flip that ships is right. A **conditional** policy
is not strictly ruled out, since a zero gap between blanket arms is also what a half-right-half-wrong
rule would produce, and the tying candidates do split (attack 46%, pass 38%). The ceiling is too low to
chase: the tie is 2.0% of claim offers, the lowest tie rate of the five decision kinds.

That is the heuristic baseline. **Stop there before ML.**

### What ML would look like, and why the GPU sits idle until then

The machine has an **RTX 2080 Max-Q (8 GB)** and CUDA works under WSL2. It is untouched by any current
work, and that is correct rather than wasteful.

**The search cannot use it.** A GPU runs 32 threads in lockstep, so it needs many threads doing the
same operation on regular data. `resolve` is the opposite: a large switch over action types, card
abilities dispatched as registered closures, and a fresh object graph per call. Divergent branches
serialise, closures do not compile to kernels, and the state is not a flat array. GPU game simulation
works for bitboard games; the card-ability system is exactly the part of this engine that cannot
vectorise, and it is the part worth keeping.

**MCTS plus a network is where it fits**, in the standard split: tree search and self-play generation
on CPU, batched position evaluation on GPU.

- **MCTS probably arrives with the network, not before it.** Classic MCTS wants thousands of cheap
  playouts a move; `resolve` gives a few hundred nodes per 126 ms, so naive MCTS could easily be weaker
  than the shipped beam for want of samples. The network is what removes the need to play games out.
- **CPU and GPU share a thermal budget on a Max-Q laptop.** The GPU idles at 61 C purely from a
  saturated CPU, so expect alternating phases rather than both flat out.

The sharded bench harness is already the CPU half of this. Not a detour.

## Gated on the baseline: the opponent model

**#434**, which consolidated the five sub-tickets that used to sit under it.

The gate is **whatever the public search fails to recover**, and the measured headroom is small: a
one-action lethal is available to the opponent in 2.2% of decisions, absent before round 5, and 86% of
those positions are unavoidable. The belief model does not need to beat zero, it needs to beat the
public version, and it is the heaviest machinery in the series.

If it is built, the first customer should be the **general tap-out risk gate**, which applies to every
action-phase decision, rather than the carried initiative rules, which are worth 2 to 3 points across
about nine decisions a game.

One design question to settle deliberately rather than by accident: the opponent's deck comes from our
own generator, so a sampler could draw from the true generating distribution instead of inferring from
revealed aspects. More accurate, arguably legitimate, but a different honesty claim.

## After the baseline

- **Epic 7 data pipeline** (#403 export, #404 consent, #405 collection Worker, #406 training store).
  #403 is small and would let a self-play corpus accumulate from the current bot immediately.

## The card programme (second stream)

ASH is implemented. The other nine sets are not: 1,960 distinct cards, triaged by what the engine
cannot yet express rather than by how hard the text looks. The triage is repeatable and fetches live,
so the next set can be sized on release day. See [ai-benchmark.md](ai-benchmark.md).

It runs on its own branch and shares no code with the AI work, so it is sequenced rather than
blocked: it starts when the heuristic baseline is finished.

**The programme is #452 to #478.** GitHub holds them and their current state; this section holds only
the shape.

Its prerequisites have shipped: the sweep reports cards *played* rather than *decked*, it sweeps any
sealed set or several at once with `--set` (what every acceptance criterion below rests on), and the
setup panel credits a registered card to whichever set its id names, with the manifest test covering
every set.

Two phases:

- **Phase 1 (#453 to #460), 926 cards blocked by nothing.** 56% of the cards with ability text are
  expressible with the primitives already in `engine/effects.ts`. Cut by trigger point. **Events are finished** as far as the engine's choices express them.
  The rest are recorded on the ticket of what blocks them: #602 Credit, #603
  Disclose, #604 indirect damage, #469 Smuggle, #467 Bounty, #468 (playing any card type from a zone
  other than the hand, or through an ability), #471 play from discard, and #686 for state the engine
  does not record and the unique one-offs. **Losing all abilities is finished** (#682): one gate on
  every ability lookup, and the twelve cards that needed it.
  **When Played units and upgrades are finished**, and so are **constant abilities on units and
  upgrades**: the ones existing primitives expressed shipped first, and the hooks and choices the rest
  needed followed, group by group. Vult Skerris's Defender (needs "discarded a card this phase") is
  on #678, and the 14 other constant-ability cards lifted out shipped with #682 (losing abilities) or are on #465
  (Phantom II) and #686; Fives, borrowing another unit's When Played abilities, shipped with #683. **When Defeated units are
  finished** (#459) where the head stands alone, with Director Krennic built alongside them; a head
  shared with another trigger point ("When Played/When Defeated") is built on the compound-head framework
(#463) as its groups ship, with the groups still outstanding on #674; Stolen AT-Hauler
  (an opponent may play it from the discard pile) shipped with #471. **Leaders are finished** on both sides (#458): the 17 not built are on the ticket of what
  blocks them, #465 pilots (7),
  #467 Bounty (Bossk's front is built; his back needs a new "react to a Bounty collection" primitive
  and is its own ticket, #710; Jabba the Hutt's back reads capture too, but #707 already built its
  chosen-guardian-and-target shape — what's left blocking the whole leader is an unbuilt "grant a
  chosen unit a temporary keyword ability" primitive his Action needs, on #715),
  #468 playing any card type, #602 Credit
  (a friendly token of any kind) and #686 (defeat by an enemy card ability, and Chancellor Palpatine,
  the one leader that flips between two faces rather than deploying). Chancellor Palpatine's own
  front (SEC_001, search for a card with Plot) shipped with Plot (#470); his back ("the next card
  you play using Plot this phase costs 3 less") needs a new `NextUnitGrant` restriction plus
  play-route context in `effectiveCost` and is not built.
  **Bases are finished** (#460), which completes Phase 1: the engine gained base abilities (an Epic
  Action once a game, an aura over units in play, and the two setup numbers a base can change), and
  the eight LAW bases that play any card type from hand went to #468, and Sundari Palace has shipped
  with the resource zone (#475).
  The ticket bodies carry the sizes from before token units, Credit
  tokens, Disclose and indirect damage were blockers, so most are smaller than they say (bases barely); the corrected counts are commented on each.
- **Phase 2 (#461 to #476, #602 to #605), 585 cards blocked by exactly one thing each**, ordered by how
  many cards each unlocks on its own. **Experience tokens are finished** (#461), the largest single
  unlock: all 80 shipped, the last two (Covert Strength, needing Smuggle's alternate cost, and
  Trandoshan Hunters, reading a Bounty) landing with those mechanics' own tickets, and the two leaders
  #458 had lifted out built alongside them. **Token units are
  finished** (#605), the second largest: Spy, X-Wing, TIE Fighter, Clone Trooper, Battle Droid and
  HMW's Beast, with 76 cards (73 the triage blocked on them alone, and Governor Pryce, HMW's Poggle the
  Lesser and Nameless Valor lifted onto it). **Bounty is finished** (#467): a `bounty` trigger point
  collected under the unit's own opponent at both a defeat and a capture, always optional, dispatched
  through a `mayCollectBounty` choice (`keywords-effects.md` "Bounty"). 24 cards, Trandoshan Hunters
  among them (its own Experience token is conditional on reading one). TS26_27 Fortune and Glory was a
  chosen-guardian-and-target capture and shipped with #707; Jabba the Hutt's leader waits on #715 for
  an unbuilt keyword-grant primitive his Action needs, beyond the capture shape #707 already built for
  his back. Bossk's back ("collect that Bounty again, once each round") is on #710: using an ability
  again (`whenAbilityUsed`, `runAbilitiesAgain`) is built, and a Bounty collection is not yet announced
  as a use.
  **Playing a card out of a discard pile is finished**
  (#471): the discard piles became zones on the existing `playCardFrom` door, the unit-only
  `mayPlayUnitFromDiscard` it duplicated was retired onto it, and "for this phase you may play that
  card from a discard pile" became a standing permission on the Play a Card action. 20 cards, the
  five HMW ones among them. Three cards need an "Action:" dispatched from a card sitting IN the
  discard pile, a site the engine does not have, and are on #678; L3-37 shipped with #477 and
  Obi-Wan Kenobi with #474; Second Chance, Stolen Landspeeder,
  Sifo-Dyas and Mother Talzin are on the ticket of their own other blocker.
  **Exploit is finished** (#473), and now so is every TWI Exploit card: 22 of TWI's 23 shipped with it
  (seven play as printed, Count Dooku's leader gives it) with HMW's The Marauder on the same step, and
  Osi Sobeck shipped with #466 once capture existed for it to read. Exploit is not offered on a play
  an ability makes (`playCardFrom`, `playUnitFromHand`), which no sealed Exploit card needs yet.
  **The resource zone is finished** (#475): resources are defeated, returned to hand and put into play
  from any zone, a resource records its owner where that is not its controller, and Greater Sarlacc is
  Exploit's step on ready resources. 19 cards shipped (HMW's Greater Sarlacc and Giant Gorax among
  them). Each card left touching the zone waits on another mechanic's ticket: Smuggle #723 (Lando
  Calrissian's leader and DJ, which also needs taking control of a resource, the one piece of the zone
  not built — Enterprising Lackeys shipped with #469), Credit #719 (Chewbacca, Intimidator). Eeth Koth
  shipped with the Force (#462). When Has Become Now shipped with Plot (#470). Outlaw Corona and Price on
  Your Head shipped with Bounty (#467); Chancellor Valorum shipped with Disclose (#603).
  **Smuggle is finished** (#469): a full alternate cost (CR 14) read off the printed bracket
  (`EngineCard.smuggle`), not a discount — its own aspect list can differ from the card's printed
  aspects (Hotshot DL-44 Blaster is Aggression but smuggles as Cunning). A standing action read
  straight off the resource zone (`smuggleMoves`/`takeSmuggle`), reusing `playFromZone` (#468) with an
  `altCost` term, exactly the way a `DiscardPlayGrant` reuses it. 27 of the 34 SHD cards that print the
  keyword shipped (Scanning Officer was already built, reading the keyword on revealed enemy
  resources without playing through it). Six split to **#723**: DJ (taking control of a resource, the
  zone's one unbuilt piece), Tech (granting Smuggle to other resources at a computed cost — a keyword
  grant, not a play), First Light (its own bracket carries an additional cost beyond resources),
  Hondo Ohnaka and Lando Calrissian (both leaders read/use "using SMUGGLE" globally rather than
  printing the keyword, needing a watch flag and, for Lando, an ability that initiates a smuggle play),
  and Millennium Falcon ("if you play this unit from your hand" needs a zone-specific read the engine
  does not have — every non-resource door already collapses to one `fromResources`-shaped boolean).
  **Plot is finished** (#470): CR 14, an alternate ROUTE into play rather than an alternate cost
  (unlike Smuggle): a Plot card sits inert in the resource zone, so `deployLeader` raises one
  `playCardFrom` choice over every Plot card there, re-offered until declined or empty, at full
  printed cost. 28 of the 31 candidate cards shipped (recounted from the ticket's stale "unlocks 27";
  29 sole-blocked per the triage aggregate, plus two the tool itself missed: Lurking Snub Fighter,
  whose source record ships no `Keywords` array at all despite printing the reminder in `FrontText`,
  and First Light, whose trigger head text isn't literal in `EXISTING_TRIGGERS` though the point it
  needs already dispatches). Chancellor Palpatine's front (search for a card with Plot) shipped;
  his back, Sly Moore, Vigil and Fully Armed and Operational each need a primitive beyond Plot and
  are on **#726**. One in a Million (its only route into play, `cannotPlayFromHand`) and Trade Route
  Taxation (`eventsBanned`, "that opponent can't play events this phase") each needed one small
  addition alongside the mechanic. One in a Million never shows as played by `--sweep`: it is an
  event whose only route is a choice rather than `playEvent`, the coverage tool's own documented
  blind spot (`playCoverage.ts`), confirmed still firing correctly by direct engine stepping (played
  in 173 of 1,000 games) and by its own unit test.
  **Capture's primitive is finished** (#466): `captureUnit`/`baseCapturesUnit`/`rescueCaptured`/
  `discardCaptured`/`appendCaptured` plus the `cannotBeCaptured`/`captureReplacement` hooks are built
  and documented in `keywords-effects.md`. Of the 29 cards it unlocks on its own, the 10 with a single
  guardian and one immediate chosen target shipped alongside it. **Wave 2 is finished** (#707): a
  chosen guardian AND/OR a chosen target in one action (either order) is `captureGuardianTargetWp`/
  `captureTargetGuardianWp`, two ordinary `selectUnitThen` picks chained the way `unitDealsWp` already
  chains dealer-then-target — no new choice kind. 13 cards shipped (Lando Calrissian, Libertine,
  Relentless Pursuit, Take Captive plus its reprint, Encircle, Prisoner of War, Grand Admiral Thrawn,
  Ephant Mon, Fortune and Glory, Rule with Respect, Unexpected Escape and Altering the Deal). A
  budgeted or "each-guardian" multi-target capture, a capture ordered before an embedded play's own
  When Played, a base guardian with a scheduled rescue, playing a captured card outright, and Jabba the
  Hutt's leader (which needs an unbuilt "grant a chosen unit a temporary keyword ability" primitive as
  well as capture) are on #715. 17 more that only needed Bounty's "When Captured" half shipped once
  Bounty landed (#467). L3-37 shipped with Smuggle (#469); Sanctioner's Shuttle shipped with
  Coordinate (#472); Charged with Corruption shipped with Disclose (#603).
  **The enemy-ability protection primitive is finished** (#708): `cannotBeTargetedByEnemyAbility`
  (a unit or a granting upgrade protecting itself), `grantsEnemyAbilityProtection` (an aura granting it
  to another unit) and `protectsAttachedUpgrade` (the one printed case landing on an attached upgrade,
  Willrow Hood), read by `protectedFromEnemyAbility` at the capture, damage, defeat, exhaust,
  return-to-hand and take-control sites, and documented in `keywords-effects.md`. Lurking TIE Phantom
  and Shadowed Intentions shipped with it, plus LAW_149 Rey and LOF_073 Mythosaur's prohibition clause
  from #701's matching group. SEC_061 Willrow Hood shipped for the upgrade-protection case, and
  SEC_012 Cassian Andor's back only; his front, now unblocked (#690 names the dealing unit on ability
  damage), is on #701. #701 keeps the rest of that group and its unrelated one-offs.
  **The trigger-head batch is finished** (#474, #680). Most heads needed only context on points that
  already fired; the damage points became one both-sides event (`whenDamageDealt`), and the heads no
  point raised got their own (a unit attacking, healing, the ready step, a card being drawn, a unit
  leaving play). "Choose two, in any order" is `chooseMode` with a queued continuation. The cards
  whose other blocker is a keyword are on that keyword's ticket (the Force #462, Pilot #465,
  capture #466; Jango Fett, Krrsantan and Chain Code Collector shipped with Bounty, #467;
  Ahsoka Tano, Captain Typho and Chancellor Valorum shipped with Disclose, #603; First Light shipped
  with Plot, #470), Arquitens Assault
  Cruiser (an opponent-owned resource) shipped with #475, and
  Traitorous, Nabat Village and Lux Bonteri are on #686.
  Darth Vader, Victor Squadron Leader waits on #465 (his
  back is a Pilot), Queen Amidala (defeat a unit to prevent damage) shipped with the replacement effects (#684), and Roger Roger (an
  upgrade's own When Defeated) and the flipping Chancellor Palpatine are on #686. **Weakness tokens are finished**
  (#649), HMW's -1/-1 token: its 18 cards and five more it touched (Beast-token cards, Inferno Squad's
  "When Played/When Defeated" and Nuvo Vindi's one-off trigger), with Tireless Magnaguard shipping on
  #471 (play from discard). **Fortify is finished** (#650), HMW's upgrades attached to a base: 17 of its 18 cards and
  Trap Field and Insurgent Camp, with Vice Admiral Rampart shipping on #684 (a replacement for a base upgrade's
  defeat); Beast Lair shipped with #653, which gave it the action-phase-start trigger it waited on.
  **Keyword identity as a runtime value is finished** (#476), the smallest of the sixteen: a keyword
  swapped for another over the finished keyword list (`swappedKeywords`), a keyword its controller
  picked and remembered on the unit (`UnitState.namedKeyword`), a unit's own keywords lent to others,
  and a count of how many different ones a unit has. All 5 cards shipped, with the literal
  `Keyword`/`Keywords` the source parses out of their ability text corrected away.
  **Credit tokens are finished** (#602): a per-PLAYER count (`PlayerState.creditTokens`), unlike
  Experience/Shield/Weakness which attach to a unit, with its own standing payment rule ("while
  paying resources, you may defeat this token, pay 1 less") read by `exploitTerms` as a fourth mode of
  the Exploit/`whilePlaying` step (#473) rather than a parallel mechanism. 20 of the 35 cards it
  unlocked on its own shipped (Unmarked Credits, Windfall, Backed by the Hutts, Bank Job Fugitives,
  Champion's KT9 Podracer, Canto Bight Security, The Max Rebo Band, Rodian Bondsman, Bib Fortuna,
  Getaway Freighter, Criminal Contact, Bix Caleen, Cad Bane, Defiant Scrapper, Lieutenant Gorn, Arvel
  Skeen, Taramyn Barcona, Partisan U-Wing, Fett's Firespray, Scavenging Sandcrawler); the other 15 (6
  leaders' activated-action wiring, a base Epic Action spanning three token kinds, an "any player may
  use this" unit action, an ordinary action ability and an "any number" resource-zone return each cut
  only for time, two cards where an opponent decides a friendly When Played, a reveal-then-play-for-free
  chain, and an "exchange control of two units" primitive Double-Cross needs) are on #719. Conveyex
  Security Captain shipped with #682; Han's Golden Dice, Targeted For Removal and Payroll Heist are
  no longer held by the granted ability block (#464, shipped) and wait only on #719;
  Boba Fett and Dengar need a one-off trigger head with no ticket of its own yet.
  **Disclose is finished** (#603, #721): "reveal cards from your hand with these aspect icons among
  them" is a flat aspect multiset (`need`) matched against each hand card's own `aspects`, which can
  itself repeat an entry (a double-icon card counts twice on its own). All 33 cards it unlocked
  shipped: 28 needed nothing else, and three needed a small primitive of their own (#721) —
  `LastingEffect.whileSourceInPlay` (Cantwell Arrestor Cruiser's ready-lock tied to its own presence,
  not a round boundary), the `discardOrDamage` choice (Syril Karn's "unless the controller discards"),
  and Chairman Papanoida turned out to need no new trigger point at all, since `whenDrawCards` already
  covers "when a player draws during the action phase". Diplomatic Immunity shipped with the granted
  ability blocks (#464); Condemn shipped with #682 (its host loses all other abilities).
  **Indirect damage is finished** (#604): unlike every other instance of damage, the RECEIVING
  player assigns it, as unpreventable damage, among their own base and units — `dealIndirectDamage`
  raises a mandatory `distributeIndirectDamage` choice, folding in Hunting Aggressor's +1 and
  Devastator's "you assign it instead" as two new hooks asked only of the dealer's own board.
  Allegiant General Pryde's "when indirect damage is dealt to a unit" reuses the existing
  `whenDamageDealt` point, filtered on a new flag, rather than a trigger point of its own. 18 of the
  22 candidate cards shipped (recounted; the ticket's stale "unlocks 15" undercounted). Left out: Boba
  Fett's leader (a further, unrelated trigger point, noted on #680) and Dengar (needs Piloting, #465).
  Targeting Computer and Superheavy Ion Cannon shipped with the granted ability blocks (#464).
  **Coordinate is finished** (#472): "Gain this ability while you control 3 or more units" is a
  live board-state condition (`hasCoordinate`/`unitHasCoordinate`, read fresh everywhere it's asked,
  the same treatment every other conditional keyword/stat/aura grant already gets), not a new hook:
  a stat buff uses `statModifier`, a self-keyword grant uses `conditionalKeywords`, an effect on other
  units or the current defender uses `aura`, and a gated one-shot effect checks the condition inline.
  15 of the 23 candidate cards shipped (recounted; the ticket's "unlocks 15" held, though which 15
  moved: Sanctioner's Shuttle's capture half reused the existing primitive, so it's in this batch
  in place of one whose second blocker was really a triage mis-parse). Left out: Aayla Secura needs
  a new "prevent all combat damage for this attack" lasting-effect field; Ki-Adi-Mundi needs a new
  "opponent's Nth card this phase" refinement of `whenPlayCard`; Ahsoka Tano and Padmé Amidala's
  leader front are deployed-leader action abilities; Anakin Skywalker, Kit Fisto and Padmé Amidala's
  unit are simple gated `onAttack` effects held back only for time, and so is For The Republic now
  that the granted ability block has shipped (#464). All of these are on #730.
  **The Force's primitive is finished** (#462): a token capped at one per player (`PlayerState.forceToken`,
  a flag rather than Credit's count), "the Force is with you" a no-op while already held, "use the
  Force" always optional even where a card's own text omits "may" (CR 8.37.4). Two cost surfaces
  extend existing machinery rather than adding new ones: `mayPayThen.useForce` (a fourth mode beside
  `cost`/`damageSelf`/`revealEvent`) and `useForceCost` on an action ability (beside `exhaustCost`).
  28 of the 57 sole-blocked cards shipped (recounted against `registeredCardIds()`; the ticket's
  "unlocks 57" holds once a triage false-positive on two cards that merely mention losing the Force
  *trait* is discounted). Left for a follow-up ticket: the 8 identical "When a friendly Force unit
  attacks" bases plus 3 more (12 cards, needing a new `baseAbilities` primitive for a base's own
  printed ability, nothing today covers one); a new `whenUseForce` player-level trigger point (Yoda,
  The Father); a Force-gated option inside a "Choose one:" (Shatterpoint); an exhaust-OR-use-the-Force
  alternate cost (Impossible Escape); Leia Organa (her own gated Action, no longer blocked, #464);
  Chirrut Îmwe (the `onDefense` context now carries the attacker, #464); a `whenUpgradeAttached`
  context read (Kylo Ren); filtering "play another unit" down to unique units (Luke Skywalker); a new
  "damage dealt to your base" trigger point (The Daughter). All on #733.
  **Granted ability blocks are finished** (#464): "Attached unit gains: ...", "for this phase, each
  friendly unit gains: ..." and "each other friendly unit gains: ..." needed no new hook, since an
  upgrade's abilities are its host's, a phase grant is a lasting effect and an aura grant is
  `grantsAbilities`. What was missing was an "Action:" gained from an aura or for a phase (Satine
  Kryze), a printed HP set for the phase, the attacker on the `onDefense` context, and the triage tool
  reading the quoted ability's own head instead of blocking on the lead-in. 51 cards shipped (recounted
  per card against the registry; the ticket's "43 sole" and "81 touched" had counted the pilots and
  the other tickets' cards). Split to #740: Rex's DC-17s shipped (a new `whenEnemyUnitReadies` trigger
  point, raised by the `readyUnit` primitive itself rather than a resolver call site so it hears every
  route a unit readies through). Foresight split again to **#744**: it needs the regroup phase's draw
  to wait on `whenRegroupStarts` choices, an engine-wide sequencing change rather than a card
  registration. Condemn shipped with #682; the 16 pilot cards and pilot leaders are on #465; Han's
  Golden Dice, Targeted For Removal and Payroll Heist on #719; Leia Organa on #733; For The Republic on
  #730.

**Homeworlds (HMW), 272 cards, is accepted and triaged**, and of its abilities the Beast-token cards
(with the token units, #605), the Weakness-token cards (#649), the Fortify cards (#650), the When Played
units and upgrades (#651, all 50), the constant abilities (#652 and #473, 37 of 39) and the events, leaders and
remaining trigger points (#653, 36 of 40) are built. 58 play
as printed (all 16 bases are vanilla). Of the 214 with ability text, **128 were blocked by nothing** once
four the triage passed are lifted to their mechanic's ticket, cut like Phase 1 by trigger point, and
**all three batches have now shipped**. Of the constants, Vernestra Rwoh (an additional cost from the
discard pile, and borrowed When Played abilities) shipped with #683, Zam Wesell (a leader's traits while she
is out of play) on #686, and The Marauder shipped with Exploit (#473), whose step it shares. Of the events and leaders, The First Legion (enemy cards out
of play lose a Trait) and Jar Jar Binks (reading who gave a token upgrade, which the phase record does
not distinguish from who received one) are on #686, Ty Yorrick (a replacement on every friendly
ability's damage) shipped with #684, and Asajj Ventress (Raid swapped for Restore on an attack) with #476.

**70 were blocked by exactly one thing**: the 18 Fortify, 18 Weakness and 14 Beast-token cards are
built (less one Fortify card lifted, above), and the rest are the 3 compound-head cards (built, #463), 3 trigger-head cards (built, #680),
#468 (1), the resource zone (1, built, #475) and the one-off heads. The 2 play-from-discard cards are built (#471), which also
closed Boga, Tireless Magnaguard and L3-37's other blockers.

**The deferred-cards spike (#477) closed with no twin.** A recount against the registry found 192
cards held on it, and read against the engine as it now is, 28 needed no engine work beyond a
registration (six HMW among them, and "when an opponent plays" now read from the far side of
`whenPlayCard`), and shipped. Every other card went to the ticket that owns its real blocker: the
mechanic tickets above by comment, #680 for trigger heads no point raises, #678 for the discard
record, and five new ones, #682 losing abilities (8, all shipped), #683 re-using abilities (7, of which the two that
borrow another card's When Played abilities shipped and the five that re-run an ability already used
moved to #704, all shipped), #684 replacement
effects (5, all shipped), #685 cards that need only writing (22) and #686 the one-offs no other ticket owns (23).
**Homeworlds is complete: every HMW card is built.** Vernestra Rwoh, the last of them, shipped with
#683. Jar Jar Binks, The First Legion, Zam Wesell and Maul's front shipped off #686; the rest of that
ticket's one-offs moved to #701. Asajj Ventress shipped with #476.

**Batches shrink, never grow.** A card that turns out not to fit is lifted to the ticket that owns its
blocker (#701 for a one-off nothing else shares) and the batch ships without it. The classification is regex triage over ability prose: it catches new nouns but not
familiar nouns in an unfamiliar shape.

Three findings that contradict the assumptions the programme started from:

- **Experience tokens were the largest single unlock at 80 cards, and were unplanned.** Printed in every
  set, and with Shield the most common token in the game. They also cost the least of any mechanic in the
  programme: the token was already a card in the db and the token machinery already attached it, so the
  work was registrations plus a handful of helpers.
- **Resource manipulation was near the bottom at 15 cards, not the top.** What matters is *playing a
  card out of the resource zone*, which gated Smuggle and Plot (both shipped, #469/#470), over 50
  cards between them. That door is built: see `playCardFrom` in `choices.md`.
- **Bounty is gated behind capture**, not resources.

The 292 vanilla and keyword-only cards need no ticket: `PLAYABLE_AS_PRINTED` in
`data/implementedCards.ts` credits them, and a test holds it to the triage of each set's fixture. 29 cards with ability text are printed in more than one set, covering 30
extra ids for no extra work: each needs one line in `data/reprints.ts` naming its other printings, and
`--triage` marks the ones that do not have it yet.

## Player-facing UI (third stream)

Both came out of play-testing the trigger-ordering work, and both sort the same ~72 pending-choice
kinds, so **#552 first**: it has to classify every kind anyway, which is where #553's mapping then hangs.

Coming after the card programme means the set of kinds is still growing while this is built, so the
classification wants to be a rule read off the payload rather than a table of the kinds that exist on
the day it ships. #553 already has to work that way for a different reason.

- **#552 triggered choices belong in an overlay, not the action column.** A triggered choice reads as a
  centre-screen overlay when two abilities trigger and as small buttons beside Pass when one does. The
  split to aim for is by how a choice is answered: click-a-unit stays on the board, pick-a-button moves
  to an overlay. The action column keeps what the player initiates.
- **#553 highlight colour should say what the effect does.** Today it says what kind of interaction it
  is: every board target is red, so a heal, a buff and a lethal hit look alike, and healing your own
  base paints it the same red as an enemy attacking it. The intended scheme is red for damage, debuff
  and weakness, green for tokens and buffs, blue for heal, yellow for exhaust and capture, white for
  attaching a real upgrade. Not a lookup table: green and blue are already spoken for, the palette is
  two colours short, and one kind can carry either sign (Baylan's +2/+2 and Ezra's −3/−0 are both
  `mayLastingBuff`), so the mapping reads the payload.
- **#578 the log should say what changed, not just what was chosen.** Lowest of the three. The log
  is one entry per submitted action, so an effect that resolves without a choice of its own leaves no
  trace: a base healed and hit again before the player looks reads as a heal that never fired. A
  board diff in `useGame` covers the common case with no engine change. Its limit is that it says
  what changed and never why, which is what #579 is for.

## Deferred

- **Web Worker** for the AI. **Downgraded, probably unnecessary.** It existed to stop a blocking search
  freezing a phone's UI, and Sealed is desktop only, where ~85 ms a decision reads as instant. Revisit
  only if a winning configuration lands in the hundreds of milliseconds, or if mobile happens.
- **Mobile and PWA adaptation** (#482). A redesign rather than breakpoints, and it would reinstate the
  Web Worker question.
- **#579 an engine record of the effects it applies.** The correct answer to what #578 approximates,
  and it **replaces** #578 rather than joining it. Held back on cost: most effect helpers do not know
  their cause, so attribution has to be threaded through `effects.ts`, and a journal on `GameState`
  sits in the search's hot path, so landing it needs a bench run against a matched control rather
  than a green suite.
- **Token-unit art**, and a permanent set for ASH tokens.
- **#591 decks across sets**, for Premier (the default format), Eternal and chaos sealed. The sweep and
  the deck generator build one set per deck, because they model sealed. Mixing sets needs copy limits
  by card rather than by id, a coverage report that maps one engine id back to several printings,
  per-format set legality, and deck-shape rules of its own.
- **Unique rule on change of control.** The rule is built for units and upgrades and is per-player, but
  `takeControlOfUnit` never re-checks it. Two cases slip through: stealing a unique unit you already
  control, and your unique being stolen, you legally play your own second copy, then regroup handing
  the first back. The unit fix is a `uniqueUnitCheck` call for the receiving player; the upgrade check
  separately keys on the upgrade's owner rather than the controlling unit's controller, which is wrong
  for a stolen unit carrying one. Raising a mandatory choice during regroup needs thought first.
- **Per-player unique-symbol rule** (defeat a duplicate).
- **Suppressing a trigger-ordering prompt where the order cannot matter.** Three of one player's units
  dying together still asks two questions even when all three abilities do the same thing. Two slices
  are suppressed today, both where the property is checkable rather than judged: **indistinguishable**
  abilities (the same ability, on the same card, on the **same unit**, firing more than once for one
  event) and **inert** ones (running the effect changes nothing). Everything else still asks: different
  units, different cards, different abilities.
  Widening it stays deliberately unattempted: "cannot matter" is a hard property to establish, and
  getting it wrong silently removes a real decision. Gather play-testing and suppress with evidence,
  gated on the prompt genuinely being a nuisance in play rather than on how it reads in the suite.
- **An inert ability that a batch-mate would have enabled** is handled: abilities that can act resolve
  first and the board is re-read, so Grogu's deploy meets Luke Skywalker's "at least 4 units" rather
  than Luke being spent while inert (`lukeGroguEnable.test.ts`). What is **not** offered is the reverse
  choice: deliberately fizzling a conditional ability by taking it while its condition is still unmet,
  which matters only for a conditional *drawback* an ability in the same batch would switch on. No such
  pairing is known in ASH. Offering it means putting inert abilities back in the prompt, which is the
  thing play-testing asked to remove, so it needs a real case before it is worth the noise.
- **Naming a unit in the trigger-ordering prompt.** Two copies of one card triggering together are
  numbered, because the prompt has no way to point at a unit on the board. It carries each candidate's
  `sourceInstanceId`, so highlighting the unit is available whenever the prompt is worth the work.
- **Offensive pinning.** Closed on prevalence rather than deferred; see experiments.md.
