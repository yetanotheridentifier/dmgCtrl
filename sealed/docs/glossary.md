# Glossary

Two vocabularies meet in this codebase and they are easy to confuse.

**Game terms** come from the Star Wars Unlimited Comprehensive Rules (`docs/SWU-comprehensive-rules.pdf`
at the repo root). They have exact meanings, and using a near-synonym makes a statement about the
game unverifiable: "deploy a unit" cannot be checked against the rules, because units are not
deployed.

**Project terms** were invented here for the AI and the benchmark. They have no meaning outside this
repo, so anyone reading a comment or a result needs them defined somewhere.

Rule of thumb: **if it happens on the table it is a game term, and the rules decide what it is
called.** If it happens in the search or the harness, it is ours to name.

---

## Game terms

### Card types

| Term | Meaning |
| --- | --- |
| **Leader** | Starts in play on its Leader side, in the base zone. Can later be **deployed**. |
| **Base** | Starts in play. Defeated when damage on it reaches its HP, which loses its owner the game. |
| **Unit** | Played into the ground or space arena. Has power, HP, and an arena type. |
| **Event** | Played for its effect, then placed in its owner's discard pile. |
| **Upgrade** | Played attached to a unit, changing its power, HP or abilities. |
| **Token** | A unit or upgrade **created** by an ability rather than played. Cost 0. Shield and Experience are upgrade tokens. |

### Getting a card into play

The three verbs are not interchangeable, and each triggers different abilities.

- **Play** a unit, event or upgrade, from hand, paying its cost. This is what "When Played" abilities
  trigger on. **Never "cast"**, which belongs to a different game.
- **Deploy** a leader, and **only** a leader, using its Epic Action. The Leader side leaves play and
  the Leader Unit side enters play in the ground arena. The rules are explicit that this is
  "considered deployed, not played", so a deploy does not trigger "When Played".
- **Create** a token. Tokens are "created" rather than played, so they do not trigger
  play-dependent abilities, but they do enter play and can be defeated.

### Leaving play

- **Defeated** is the word, for units, upgrades, tokens, bases and resources alike. A unit or base is
  defeated when damage on it reaches its HP, or when an ability defeats it directly. An upgrade is
  defeated when the unit it is attached to leaves play.
- Non-token cards go to the owner's discard pile; tokens are set aside out of play.

### Ready and exhausted

This is the distinction most often got wrong, and it drives most of what the AI has to judge.

- A **unit** enters play **exhausted** when played, with exceptions. A **leader** enters play
  **ready** when deployed. That asymmetry is real and matters: a leader can act the turn it arrives
  and a played unit usually cannot.
- A unit can only **attack** if it is ready, with exceptions such as **Ambush**.
- A **resource** enters play exhausted unless stated otherwise, and can only be spent while ready.
- **Upgrades are neither ready nor exhausted.**
- Everything **readies during the regroup phase**, unless a card says otherwise. So exhaustion is
  temporary, and its cost is bounded by how much of the round is left.

### Resources

- **Resource** is both a noun and a verb. A card added to the resource zone has been **resourced**.
- Players may resource one card from hand during each regroup phase.
- **Do not say "banked".** It is not a rules term and reads as a synonym for "saved for later", which
  is a different idea from putting a card permanently into the resource zone where it can no longer
  be played.

### Structure of a game

- A game is a series of **rounds**. Each round is an **action phase** then a **regroup phase**.
- In the action phase players alternate taking one **action** each: play a card, attack with a unit,
  use an action ability, take the initiative, or pass.
- In the regroup phase players resource a card and ready their exhausted cards.
- The **initiative counter** decides who acts first in a round. **Taking the initiative** is an
  action, and it means passing for the rest of the round, so it trades the remainder of this round
  for acting first in the next one.

  **Claim** is accepted shorthand for taking the initiative, in common use among players and
  throughout the code (`claimCost`, `beam-claim-ties`, "claim offers"). Either is fine. What matters
  is that a claim costs the **rest of your actions this round**, which is the part that gets left out
  when the trade is described loosely.

### Combat and stats

- **Power** is damage dealt; **HP** is damage survived. A unit attacking a unit deals damage to it
  and takes damage back.
- An attack targets an enemy **unit in the same arena** or the enemy **base**.
- **Heal** removes damage counters.

### Keywords

The rules define these, in bold red on a card: **Ambush**, **Bounty**, **Coordinate**, **Exploit X**,
**Grit**, **Hidden**, **Overwhelm**, **Piloting [Y]**, **Plot**, **Raid X**, **Restore X**,
**Saboteur**, **Sentinel**, **Shielded**, **Smuggle [Y]**, **Support**.

The ones the AI reasons about most: **Sentinel** (must be attacked before others in its arena),
**Saboteur** (ignores Sentinel), **Ambush** (can attack on arrival despite being exhausted),
**Shielded** (arrives with a Shield token, which absorbs one instance of damage).

---

## Project terms

Invented here. If one of these appears in a comment, a report or a ticket, this is where it is
defined.

### The search

| Term | Meaning |
| --- | --- |
| **Beam** | The search the AI uses. It expands a limited number of candidate lines per level rather than all of them. |
| **Width** / **depth** | How many candidates survive each level, and how many actions deep a line runs. |
| **Nodes** / **budget** | A cap on positions examined before the search gives up. |
| **Rail** | A budget that is *supposed* to be a safety net but fires routinely, so it has quietly become the real width or depth. Naming the failure was worth a whole ticket. |
| **Null move** | The assumption that the opponent does nothing while our line plays out. Necessary because players alternate single actions, so "my turn" does not exist. |
| **Reply** | Modelling the opponent's answer. `pessimistic` assumes their best answer, `selfish` assumes they ignore us. |
| **Two-ply** | Our move, their answer, then score. |
| **Quiescence** / **chain** | Continuing past the horizon while a sequence is still resolving, so the search does not score a half-finished exchange. |
| **Tie-break** / **second opinion** | Re-searching only the candidates that scored equal, under different assumptions, and taking whichever now leads. |
| **Horizon** / **crossing** / **tail** | How far past the round boundary a line may run. The shipped search does **not** cross the boundary, so it never sees anything ready again. |

### The evaluation

| Term | Meaning |
| --- | --- |
| **Reach** | Damage a seat can put into the enemy base. **Unit reach** is one unit's contribution, and reads 0 for a unit a Sentinel is holding back. **Reach this round** aggregates the ready board. |
| **Blocked reach** | Reach that exists but cannot land, because a Sentinel is in the way. |
| **Clock** | How many rounds until a seat's reach finishes the enemy base. |
| **Role** | Whether a seat is the aggressor or the defender, derived from the position and used to shift the weights. |
| **Lockout** | A lane shut by a Sentinel that keeps being re-shielded, so nothing gets through. A **locked lane** is one arena in that state. |
| **Presence** | The board summary the evaluation scores: unit count, total power, total remaining HP. |
| **Tempo** | Actions available now. **Forfeited tempo** is what taking the initiative gives up, currently counted as ready units only. |
| **Lethal** | A sequence of a seat's own actions that finishes the enemy base, under the null move. |
| **Attacks to finish** | The fewest ready attackers whose reach covers the base. Closed form, no search needed. |
| **Exposure** | Handing the opponent a position they can win from immediately. |
| **Headroom** | What a proposed change could gain that the current bot does not already get. Usually much smaller than the raw rate suggests. |
| **Gate** | A cheap test deciding whether an expensive computation is worth running. Every gate is a way of *not* finding something, so each is measured rather than trusted. |

### The benchmark

| Term | Meaning |
| --- | --- |
| **Decision** | One position where the AI chose an action. The unit most rates are measured against. |
| **Corpus** | The set of decisions or games a measurement is taken over. |
| **Coverage decks** | The standard generated deck set, one algorithmic build per leader and base. **Mirror** plays a deck against itself; the **lockout** set is built to contain a position self-play otherwise never reaches. |
| **Arm** / **control** | The changed bot and the unchanged one it is measured against, on the same seeds. |
| **Paired difference** | Arm minus control, seed by seed. The result. Identical bots do not measure 50%, so a raw rate read against a fixed baseline can invert. |
| **Shard** | One parallel slice of a run, pooled with the others. |
| **Screen** | A short run (~80 games) used as a disaster filter before a long one. **Never evidence of parity.** |
| **Prevalence** | How often a situation arises at all. It justifies an attempt but does not predict the outcome, and a low enough prevalence retires an idea without building it. |
| **Oracle** | An exhaustive, obviously correct, slow reference used to check a fast pruned search against. |
| **Setup AI** | The heuristic that plays the opening (mulligan and resourcing) without consulting the search. |

---

## Words to avoid

| Instead of | Say |
| --- | --- |
| cast a card | **play** a card |
| deploy a unit | **play** a unit (only leaders are deployed) |
| bank a card | **resource** a card |
| burn event | an **event that deals damage** |
| kill a unit | **defeat** a unit |
| tapped / untapped | **exhausted** / **ready** |
| creature, minion | **unit** |
| spell | **event** |
| mana | **resources** |
