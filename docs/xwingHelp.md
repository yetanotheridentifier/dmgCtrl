# X-Wing help

## Setup

Setup has the **Match type**, the **Scenario**, a list for each player, and **Go to game**.

### Match type

- **Casual**: a standard pick-up game with no round limit.
- **Tournament**: shows the **Rounds** stepper (see Tournament).

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

Each player has a card. Tap it to choose that player's list from a sheet of your saved squads, each shown with its points total and faction.

- **Your list** is remembered, so next time it is already chosen. Tap **Change list** to pick another.
- **Your opponent** is chosen each game. Their card says **Choose opponent's list** and offers last game's opponent in one tap; **Choose another list** opens the sheet.
- **Import XWS** in the sheet opens **Squad Lists** (see Squad lists), where you paste a squad from YASB and save it. Tap **Back** to return; your choices so far are kept and the new list is ready to pick.
- **No list** comes last, as a fallback: there are no ships to tap on the game screen, so you set the player's mission point deficit (0–4) with the stepper on their card. The deficit is added to the opponent's score if all of that player's ships are destroyed.

A chosen list shows its points, faction and pilots so you can check it before starting. Its deficit is worked out for you as `50 − total points` (0 for a 50-point list) and isn't shown.

**Go to game** becomes available once both players have chosen.

Your choices, the scenario and the deficits are kept while you visit Squad Lists, Help or Settings, and after a game: tap **Back** on the game screen for a rematch with the same lists. Apart from your list, they reset when you leave X-Wing for game select.

**More** (top right) holds **Squad lists**, **Help** and **Settings**.

## Squad lists

Squad Lists is where you create and manage your saved squads, which are offered for each player on setup. Open it with **Squad lists** in setup's More menu, with **Import XWS** when choosing a player's list, or with **Squad lists** in the X-Wing group of Settings. **Back** returns you to where you came from.

### Creating a list

1. Export your squad from YASB (Yet Another Squad Builder) as XWS and copy the JSON text.
2. Paste it into the box under **New list** and tap the **tick button** to check it. If the list cannot be read, an error explains why so you can correct the text.
3. Once the list is valid, its pilots, points total and faction are shown. The name is filled in from the XWS export; change it if you like. Tap **Edit** to go back to the pasted text.
4. Tap the **tick button** next to **Save list**. The save button stays disabled until the list has a name.

If another saved list already has that name, you are asked to confirm the overwrite first.

A valid list must contain between 3 and 8 ships and cost between 46 and 50 points.

### Saved lists

Each saved list shows its name, points total and faction (when the XWS export included one). Tap a list to show or hide its pilots.

- **Rename**: edit the name in place, then tap the tick to save or ✕ to cancel. A name already used by another list is not accepted.
- **Delete**: tap **Delete**, then **Delete** again to confirm (or **Cancel**).
- **Clear All**: removes every saved list, after a confirmation step.

Points totals are the pilot costs from the XWS export when the list was created. They do not update when pilot points change.

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

### Log

**Log** opens the drawer over your opponent's side: newest first, under the round it happened in. **Undo** takes back the newest entry; repeat to step further back. Undoing a game's end resumes the timer.

## Tournament

Choose **Tournament** under Match type on setup and set the number of **Rounds** (2 to 10). A tournament game is played as a casual one, except that **One more round** is not offered at game over.

## Rules

dmgCtrl follows the **X-Wing Alliance (XWA)** ruleset: a game is won on 50 points, ships score half their points when damaged and the rest when destroyed, and a list under 50 points gives its opponent the difference if all its ships are destroyed.
