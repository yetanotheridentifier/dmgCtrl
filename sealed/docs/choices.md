# Player choices

How a decision is put to a player, answered, and described. Read this when touching anything that
interrupts play to ask a question: a "may" ability, a target selection, a search, or a prompt.

## The model

An interactive decision cannot be a callback, because the resolver is pure and game records replay
`initialState + moves`. So a choice becomes **game state**:

```ts
GameState.pendingChoices?: PendingChoice[]
```

`PendingChoice` is a discriminated union of ~71 `kind`s in `engine/types.ts`. Every variant carries
`id`, `controller`, and an optional `source` naming the card that raised it. Helpers live alongside
it: `activeChoice`, `findChoice`, `hasPendingChoices`, `pushChoice`, `removeChoice`.

`pushChoice` **guarantees a unique id** among pending choices, suffixing `#1`, `#2` on collision. Two
triggers on the same played unit would otherwise share an id and mislabel each other, and an ability
that fires more than once for one event relies on it.

## Answering

`legalMoves` → `choiceMoves` offers options for **every** pending choice the active player controls,
not just the head, so a player resolves their own simultaneous triggers in any order they like
(CR 7.6.9).

- **`acceptChoice { choiceId, targetInstanceId?, deckIndex?, optionIndex?, baseTarget?, handIndex?, cardName? }`**
  takes the positive option.
- **`skipTrigger { choiceId? }`** declines.
- An **attack** can itself be the answer (Ambush, Support, "you may attack"), so `attack` carries an
  optional `choiceId` naming which choice it answers.

Choices are always removed **by id**. A player may answer any of their outstanding choices rather
than the head, so a "remove the head" helper consumed the wrong one and left the real choice pending,
making the answered ability appear not to resolve. There is deliberately no such helper.

`resumeAfterChoice` decides what happens as the queue drains: the active player finishes theirs
first, then control passes; round-start choices (`resumeAtInitiative`) begin the action phase with
the initiative holder, mid-turn choices `advanceTurn`.

### Nested abilities jump the queue

**CR 7.6.11 and 7.6.12**: an ability triggered *while resolving* another must resolve before anything
triggered at the same time as its parent, and each layer resolves fully before returning to an earlier
one.

`pushChoice` appends, which is correct for a **batch** of simultaneous triggers (`finishDefeats` fires
one per defeated unit, and those genuinely are at the same time) and wrong for a nested one, which
landed behind the opponent's waiting trigger.

The signal separating the two is **when the push happened**: during a plain action it is a batch,
during the resolution of an answer it is nested. `promoteNested` keys on exactly that, next to
`inheritSource` which already hooks both answer paths, so nothing has to be threaded through the effect
layer. Relative order within each group is preserved, since simultaneous nested abilities are their
own controller's to order.

The CR's worked example is the test: two units trade, one's When Defeated defeats a third unit, and
that third unit's trigger resolves before the opponent's original.

### Who resolves first is the active player's choice

**CR 7.6.10** gives the **active player** the choice of which *player* resolves their triggers first,
and only that: the opponent's internal order is never theirs to pick.

With triggers owed on both sides, `handOffOpponentChoice` raises a `chooseTriggerOrder` choice for the
active player at the **front** of the queue. Option 0 keeps the turn; option 1 hands it over and
`resumeAfterChoice` brings it back once their side drains, the same path an interjected choice uses.

**It gates the queue.** While it is pending, `choiceMoves` offers only that choice. Without the gate a
player could answer one of their own triggers instead and settle the order by accident, choosing
themselves without ever being asked.

It carries no target and no list, deliberately: offering anything finer would be offering a decision
that is not the active player's to make.

The AI answers it through quiescent scoring, which drives the owed chain before scoring, so each option
is priced by the boards it reaches rather than the board it starts from. Where the two still tie,
`settleTriggerOrderTie` resolves first. That is a regression guard rather than a preference: the engine
always went first before this choice existed, and asking the question must not turn a fixed sensible
answer into a coin flip.

**It is the only choice no card raises**, so it is the one exemption in the source-attribution guarantee
below.

### A decided game has no pending choices

**CR 6.6.2**: once a player's base has 0 remaining HP they "cannot take any actions, and cannot resolve
any abilities or effects", and CR 1.16.5 ranks base defeat first among the state-based situations that
pre-empt waiting triggers. So winning discards whatever was waiting, in two places:

- `checkWin` clears `pendingChoices` when it sets a winner.
- `pushChoice` refuses to add one to a decided game.

Both, because whether a trigger is raised before or after the win check varies by card and by code path.
A choice left pending on a won game is **unanswerable**, since `legalMoves` returns nothing once
`winner` is set, so it strands whatever is presenting it: an attack that won the game while triggering
Camtono put a card-reveal on top of the game-over screen that could be neither played nor dismissed, and
the menu could not be reached.

The rule belongs in the engine rather than in overlay ordering. A choice that does not exist cannot be
rendered, whereas a UI fix would leave the impossible state in the model for the next surface to trip
over.

### Suspending combat

An attack that raises a choice mid-flight splits into `beginAttack` (exhaust, Restore, `onDefense`,
suspend into `GameState.pendingAttack` if a choice is raised) and `completeAttack` (the damage step,
recomputed on the post-choice board per CR 6.3.4). It re-finds attacker and defender, so a ping that
defeats either fizzles gracefully, and clears Support-granted keywords last so they survive the
suspension.

## Every choice can name the card that raised it

A prompt has to be able to say *why* the player is being asked, which matters most when the choice
came from the opponent's card.

**One exemption, and it should stay at one.** `chooseTriggerOrder` is raised by the rules rather than by
a card: it exists precisely *because* two cards triggered at once, so naming either would be arbitrary
and misleading. Its overlay lists the waiting triggers with their own sources, which is the real answer
to "why am I being asked this". `choiceSource.test.ts` carries the exemption as a one-element list, and
anything a card raises must still name that card.

Threading a source through by hand does not hold: there are **~185 `pushChoice` call sites**. There
are only **five** places an ability effect is invoked, and each already knows its card, so the source
is **stamped automatically**:

- `PendingChoice` gains `source?: DamageSource` via a **distributive conditional**
  (`T extends unknown ? T & { source? } : never`). A plain intersection collapses the union and
  breaks every `Extract<PendingChoice, { kind: 'x' }>` in the UI and tests.
- `stampChoiceSource(before, after, source)` diffs choice **ids**, not array length, because an
  effect can remove choices as well as add them. A choice that already names a source keeps it, so
  the most specific source wins when effects nest.
- Follow-ups raised while *answering* a choice inherit the answered choice's source, carrying the
  original card down an arbitrarily long chain. The resolved choice's own id counts as absent there,
  because repeatable picks (`multiPick`, `distributeDamage`, `dealOwnBaseForDiscount`) re-offer
  themselves under the same id and still need the source.
- A `GRANT_*` pseudo card is an internal ability carrier with no card-database entry, so it declares
  `sourceCardId` naming the real card, and prompts show that instead.

## Every choice also says what it is asking

Naming the source is half of a usable prompt. `choiceBody` in `utils/describeChoice.ts` writes the
instruction, and it is an **exhaustive switch**: the `default` branch assigns `choice` to `never`, so
adding a kind to `PendingChoice` without a prompt is a **compile error**.

That matters because the fallback is not merely vague, it can be wrong. A damage-prevention offer
rendered as "choose a target on the board" reads as *pick something to hit*, which is the opposite of
what it asks, and a player will reasonably conclude the decision was handed to the wrong side.

Two guards, catching different failures:

| Guard | Catches |
| --- | --- |
| Exhaustive `switch` on `choice.kind` | a new kind with no prompt, at compile time |
| `choicePrompt.test.ts` coverage sweep | a prompt that exists but renders as the fallback or empty in a real game |
| `choiceSource.test.ts` coverage sweep | a choice that cannot name the card that raised it |

The combined guarantee is that every choice reaching a player renders as
**`<the card that caused it>: <what you must do>`**.

Button labels are the same problem in a different place. `describeAction` never falls through to a
kind's internal name, and a bare `Accept`/`Decline` is avoided where it would be ambiguous: a
prevention offer reads `Prevent 1` / `Take the damage`.

## Presentation

- **Board-target kinds** (`BOARD_TARGET_KINDS` in `describeChoice.ts`) are answered by clicking a
  highlighted unit or base. The list lives next to the prompt table so the two cannot drift.
- **`CardSelectOverlay`** is the centre-screen card picker: click the highlighted card to choose it,
  with a Cancel only when the choice is optional. Token art included.
- **"Look at a card" is PRIVATE.** The overlay renders only for the human's own choice, so the AI's
  look-at never surfaces and hidden information is preserved. A future public "reveal" reuses the
  shell with a public prompt and a confirm action.

### Searching always shows what it looked at

A search reveals the cards it examined even when none of them match, because they are about to go to
the bottom of the deck and knowing which ones is worth having. Pressing **Done** sends them there.

The trap is that some search kinds are mandatory and have no decline, so pushing an empty-eligible
choice would leave zero legal moves and deadlock the game. The rule is therefore: **offer the
acknowledge move only when nothing is eligible**, which keeps a real pick mandatory.

## Unique rule

A player cannot control two cards with the same unique title. Both checks are keyed by card id
(a deck's duplicates share one), applied **per controller**, and re-run so three or more copies
resolve down to one.

- **Upgrades:** `uniqueUpgradeCheck(state, owner)` runs after every attach path. Two or more unique
  upgrades of one card id raises `selectUniqueToDefeat`; you pick one to defeat (mandatory, no
  cancel, centre-screen overlay). Keyed on the upgrade's `owner`, so the opponent's copy does not
  conflict.
- **Units:** `uniqueUnitCheck(state, owner)` runs at the end of `enterUnit`, covering every
  play-a-unit path. It raises `selectUniqueUnitToDefeat` as a **board-target** selection, since the
  copies may differ in damage and upgrades.
