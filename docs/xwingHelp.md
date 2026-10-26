# X-Wing help

## Setup

Setup has the **Match type**, the **Scenario**, a list for each player, and **Go to game**.

### Match type

- **Casual**: a standard pick-up game with no round limit.
- **Tournament**: the button at the foot reads **Start tournament**, or **Go to tournament** while one is under way (see Tournament).

### Scenario

Choose the scenario for this game:

- **None**: no scenario; mission points come from ship kills only (casual deathmatch).
- **Assault at the Satellite Array**
- **Chance Engagement**
- **Salvage Mission**
- **Scramble the Transmissions**
- **Ancient Knowledge**

Tap the scenario to choose it from a list, or the **dice button** to pick one at random from the five named options. The scenario isn't saved between sessions: choose it fresh each game.

### Choosing lists

Each player has a card. Tap it to choose that player's list from a sheet of your saved squads, each shown with its faction symbol, points total and faction.

- **Your list** is remembered, so next time it is already chosen. Tap **Change list** to pick another.
- **Your opponent** is chosen each game. Their card says **Choose opponent's list** and offers last game's opponent in one tap; **Choose another list** opens the sheet.
- **Build a list** in the sheet opens the list builder (see Squad lists) for that player. When you save, you come back to setup with the new list already chosen for them. **Back** returns to setup without saving.
- **Import XWS** in the sheet opens the paste box on **Squad Lists** (see Squad lists). Tap **Back** to return; your choices so far are kept and the new list is ready to pick.
- **No list** comes last, as a fallback: there are no ships to tap on the game screen, so you set the player's mission point deficit (0–4) with the stepper on their card. The deficit is added to the opponent's score if all of that player's ships are destroyed.

A chosen list shows its points, faction and pilots so you can check it before starting. Its deficit is worked out for you as `50 − total points` (0 for a 50-point list) and isn't shown.

**Go to game** becomes available once both players have chosen.

Your choices, the scenario and the deficits are kept while you visit Squad Lists, Help or Settings, and after a game: tap **Back** on the game screen for a rematch with the same lists. Apart from your list, they reset when you leave X-Wing for game select.

**More** (top right) holds **Squad lists**, **Help** and **Settings**.

## Squad lists

Squad Lists is where you build, import and manage your saved squads, which are offered for each player on setup. Open it with **Squad lists** in setup's More menu, with **Import XWS** when choosing a player's list, or with **Squad lists** in the X-Wing group of Settings. **Back** returns you to where you came from.

A list can be saved only when it is legal for scoring: 3 to 8 ships, 46 to 50 points, no unique pilot twice (a character counts once whichever of their cards it is), and no pilot over its per-list limit. Lists are pilot points only: upgrades are not part of the total.

### Building a list

Tap **New list** (or **Build a list** on setup).

1. Choose a faction. Each shows how many ships it has. The faction is fixed for the list.
2. Pick a ship on the left (a **Ship** button in portrait), then tap a pilot to add it. Pilots show their current points, cheapest first, and the search box narrows that ship's pilots.
3. The total against 50 and the ship count sit at the top, with what is still needed to save, such as "3 more points to save (46–50)".
4. **Your list** shows what you have added. A unique pilot (marked •) has its own row with ✕ to remove it; tap the row to swap that pilot for the next one you choose, in the same place (**Cancel** stops the swap). Repeats of a generic pilot share one row with **−** and **+**.
5. Tap **Save list** once it is enabled.

While building, a unique pilot already in the list is greyed out, a generic pilot at its per-list limit shows "2 of 2, the limit" and its **+** is disabled, and at 8 ships every pilot is disabled with the reason shown.

**Back** with nothing added returns to the faction choice; after that it leaves the builder without saving.

### Saving

The save sheet shows the list's points, ships, faction and pilots, with a **Name** box. Left blank, the list is saved as "*Faction* list *N*" (the lowest number not already used). A name another saved list already has turns **Save list** into **Overwrite**, naming the list it replaces; change the name to keep both.

### Importing a list

Export your squad from any squad builder as XWS and copy the JSON text. Tap **Import XWS**, paste it into the box and tap **Check**. A list that cannot be read, or that breaks a rule above, shows each problem and cannot be saved; otherwise its pilots, points and faction are shown and **Save list** opens the same save sheet. **Clear** empties the box.

### Saved lists

Each saved list shows its faction symbol, name, points, ship count, faction and pilots.

- **Edit**: opens the list in the builder at today's points, showing what it cost when saved. **Save changes** keeps the name and updates the list in place; change the name to save a copy instead.
- **Rename**: edit the name in place, then **Save name** or **Cancel**. A name already used by another list is not accepted.
- **Delete**: asks you to confirm, naming the list.

Points totals on Squad Lists and setup are the costs the list was saved with. They do not update when pilot points change until you edit and save the list. A tournament keeps its own copy of each list, so editing or deleting a saved list does not change a tournament under way.

## Game

The game screen has three columns: **your ships** on the left, the centre panel, and **your opponent's ships** on the right. **Back** (to setup) sits above your ships; **Log** and **More** (Help and Settings) sit above your opponent's.

### Ships

Every ship in each list has a tile. Tap a ship to damage it; tap again or long-press to destroy.

- **Damaged** shows half its points scored, such as "Half · 2 of 5", and gives the other player half the ship's points (rounded down)
- **Destroyed** gives the rest of the points, strikes the name through and shows the dmgCtrl mark; the tile stays in place
- Before the game the tiles are shown but can't be tapped; at game over the ships still flying show **Survived**
- When the last ship of a squad is destroyed, that player's mission point deficit (if any) goes to the other player with it

Up to 4 ships each get a full-width row, with the ship type and points. From the 5th ship, rows hold two, and generic pilots pair up before unique ones, so 8 ships fit in 4 rows without scrolling. Duplicate pilots are numbered ("Academy Pilot 2").

### Scores

Both scores are in the centre panel, under the round and timer button. Points start at 0. The game ends at the end of the round in which a player reaches 50, and both players can finish above 50: the player with the most points wins.

The score **−** and **+** buttons are off unless **Score −/+ buttons** is on in Settings › X-Wing; they then show above each ship column, and those above a column score its ships, so the ones over your opponent's ships change your score. A side with **No list** has no tiles, so the buttons above it always show: they are the only way to score it.

### Round and timer

Tap the round and timer button at the top of the centre panel to see the round and the time left. Before **Start game**, it also sets the **Game length** in 5-minute steps; the next X-Wing game starts at the same length. The timer starts with **Start game** and turns amber under 5 minutes and red under 1 minute.

### Phase tracker on

With **Phase tracker** on in Settings › X-Wing (off by default), the centre panel follows the round:

- **Before the game**: **Start game**, which starts the timer
- **Planning**: who has initiative, **You** or **Opponent**
- **System**, **Activation**, **Engagement**: the phase button, and **FIRST** under the score of the player with initiative
- **End**: the round's mission points (0, 2 or 4 each, from round 2 with a scenario), and the phase button starts the next round

The phase button names the phase and what tapping it does next.

### Phase tracker off

With the phase tracker off, the centre panel holds:

- **First**: **You** or **Opp**, under the scores, which you can change at any time
- the round button ("Round 3 of 12", "Tap to score the round"): one tap opens the round's mission points, and **Start round 4** scores them and starts the next round

Opening the scoring is logged, so **Undo** takes back a mistaken tap.

### Mission points

From round 2 onwards with a named scenario, tap the points each player scored this round. They are added when the round ends, logged as one entry, and count towards 50 for that round. Points already entered for a round (after an undo) can't be entered again until that entry is undone too.

Invalid combinations are disabled:

- *Standard scenarios* (Assault at the Satellite Array, Salvage Mission, Scramble the Transmissions, Ancient Knowledge): both players scoring 4 is impossible, so 4 on one side disables 4 on the other
- *Chance Engagement*: only (0, 0), (2, 2), (4, 0) and (0, 4) are valid

### Game over

The game ends when a round ends with a player on 50 or more, at the end of round 12, or at the end of the round in which time runs out. The centre panel then shows the result, the score breakdown for both sides (mission points, ship points, the opponent's deficit and the total) and:

- **Rematch**: back to before the game with the same lists
- **One more round**: in a Casual game that ended on time or after round 12, while both sides have ships left. The game goes on for one round with the timer at 0:00, and ends again at that round's end
- **New setup**: back to setup

In a tournament game, **Back to tournament** takes the place of all three and records the round (see Tournament).

### Log

**Log** opens the drawer over your opponent's side: newest first, under the round it happened in. **Undo** takes back the newest entry; repeat to step further back. Undoing a game's end resumes the timer.

## Tournament

A tournament keeps your record across its rounds. Each round is one game.

### Starting

Choose **Tournament** under Match type on setup, choose your list and round 1's opponent, and tap **Start tournament**. A sheet asks for the number of **Rounds** (2 to 10), which is fixed once round 1 starts. **Start round 1** goes straight to the game.

Your list is fixed for the whole tournament. Round 1 is played with the scenario chosen on setup; the opponent and the scenario are chosen again for each later round.

### Playing a round

A tournament game is played as a casual one. At game over the only way on is **Back to tournament**, which records the round from the game's scores: a win or a loss (a draw if the scores are level), and the score. **Back** during a game also returns to the tournament without recording anything: **Return to round N** goes back to the game as you left it. If the app was closed during a round, it starts that round's game again.

### Between rounds

The tournament screen shows:

- your **record** (wins and losses) and the **margin**, the total of the score differences of every round played
- your list for the tournament
- every round: those played with their result, score, the opponent's list and the scenario (unless it was None), the next one outlined

**Start round N** opens a sheet of your saved lists for the opponent, with **Import XWS** and **No list**; choosing one starts the game. The round's **Scenario** sits at the top of the sheet, set to last round's: tap it to choose another, or the **dice button** to roll one. If the app was closed during a round, that round's game starts again with its own scenario. **Drop** asks first, then clears the tournament and returns to setup.

Once every round is played the screen reads **Tournament complete**, and **Finish** clears it and returns to setup.

The tournament is saved as you go: close the app between rounds and it opens at the tournament next time. **Back** goes to setup, where **Go to tournament** returns to it.

## Rules

dmgCtrl follows the **X-Wing Alliance (XWA)** ruleset: a game is won on 50 points, ships score half their points when damaged and the rest when destroyed, and a list under 50 points gives its opponent the difference if all its ships are destroyed.
