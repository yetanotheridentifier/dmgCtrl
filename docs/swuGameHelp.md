# dmgCtrl: Help

## During a Game

The base card fills the screen, with the damage counter overlaid across the middle.

**Starting a game:** the counter shows **Start** until you tap it (or tap the round tracker). Tapping Start advances the round to 1, enables the **+** and **−** buttons, and shows the Remaining HP display.

- Tap **+** to add 1 damage
- Tap **−** to remove 1 damage (won't go below zero)
- **Remaining** shows your starting HP minus damage taken so far

### Adding or removing multiple damage at once

For larger hits or recovery, press and hold **+** or **−**, then drag upward:

1. **Press and hold** the button — keep your finger down
2. **Drag upward** — a number appears showing how many damage points will be applied
3. **Release** — all the damage is applied at once

The number increases by 1 for roughly every 14px of upward movement, starting from 2. It is capped at the remaining capacity: the `+` button won't exceed the base's remaining HP, and `−` won't go below zero.

### Action Log

When **Enable Action Log** is on in Settings, a log button appears in the bottom-right corner of the game screen.

- Tap it to open the action log — a scrollable panel listing all game events
- The most recent action shows an **Undo** button — tap it to revert to the state before that action
- Round entries cannot be undone
- Tap the log button again to close it

### Round Tracker

When **Enable Action Log** is on in Settings, a round counter button appears in the bottom-left corner.

- Tap it to start the game (when at 0) or advance to the next round
- The counter starts at 0 and advances to Round 1 when you tap **Start** or the round tracker
- Round changes appear in the action log

### Competitive Mode (Best of 1 / Best of 3)

When **Competitive Mode** is enabled in Settings and you select **Best of 1** or **Best of 3** on the setup screen, a score panel appears in the left column — **Opp** at the top and **You** at the bottom, with win marker circles between them.

**Recording a result:**
- Tap **You** to record a win, or **Opp** to record a loss — the button changes to **Confirm**
- Tap **Confirm** to apply the result: the score advances, damage resets to 0, and a "Game N Won/Lost" entry is added to the log
- Tap anywhere else to cancel without recording

**If your base reaches 0 HP** in a competitive game, the loss confirmation is triggered automatically — tap **Confirm** to record it.

**Between games (Best of 3):**
- After a result is confirmed, the counter shows **Start Game N** — tap it to begin the next game
- The "Game N Won/Lost" result is shown below the Start button for reference
- Tap the **Undo** button on the game result log entry to reverse the result (restores score, damage, and the previous log entries); only available before you start the next game

**Match over:**
- After the match is decided, **Match Won** or **Match Lost** is shown on screen
- The Start button and round tracker are hidden; the You/Opp buttons are disabled

To return to base selection, tap <svg width="0.8em" height="0.8em" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="vertical-align:middle;display:inline-block"><path d="M15.5 5L7 12L15.5 19Z"/></svg> in the top-left corner. This resets the damage counter to zero, ready for the next game.

### The Force

A dimmed Force token icon sits just below the <svg width="0.8em" height="0.8em" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="vertical-align:middle;display:inline-block"><path d="M15.5 5L7 12L15.5 19Z"/></svg> button at all times. Most games won't need it — it's there for when a card or leader ability grants you the Force mid-game.

- Tap the dimmed icon once to enable it — it turns blue, showing it's ready
- Tap the blue icon to gain the Force — a blue **"The Force is With You"** overlay appears over the lower portion of the card, mirroring the physical Force token
- Tap the overlay or the greyed Force icon to dismiss it and restore the button, ready to gain the Force again

When playing a **Legends of the Force** base whose ability creates a Force token, the icon starts **fully active** (no enable tap needed).

#### Mystic Monastery

**Mystic Monastery** (LOF-022) can generate the Force up to three times per game as an action. A numbered button appears, which shows how many uses remain.
- Tap the numbered button to gain the Force — the count decrements and the Force overlay appears
- The numbered button greys out while the Force overlay is active; dismiss the overlay first before using it again
- The regular Force icon is still available for gaining the Force by other means.

### Epic Action

Some bases have a special **Epic Action** — a once-per-game ability. When your base has one, an epic action button appears in the top-left corner.

- The epic action button starts **highlighted in yellow**, showing the epic action is available
- Tap it to mark it as used — the button dims and a gold token overlay appears over the lower portion of the card, covering the epic action text (mirroring the physical token used in the tabletop game)
- When the **action log is enabled**, use the Undo button in the action log to revert the mark
- When the **action log is disabled**, tap the overlay to dismiss it

If both the Force token and the epic action token are active at the same time, they sit side by side across the bottom of the card rather than overlapping.

## Settings

Tap the <svg width="3.5%" height="3.5%" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> button (top-right of the setup screen or game screen) to open the Settings screen.

Your preferences are saved automatically and persist between sessions.

| Setting | Default | Description |
|---|---|---|
| **Use Hyperspace Art** | On | When enabled, the Hyperspace variant is used by default on the game screen for any base that has one. If the Hyperspace image can't be loaded, the app falls back to the standard art. |
| **Enable Force Token** | On | Shows the Force token button on the game screen. Turn off if you prefer not to track the Force. |
| **Enable Epic Actions** | On | Shows the Epic Action button on the game screen. Turn off if you prefer not to track epic actions. |
| **Enable Screen Wake Lock** | On | Keeps the screen on during play. May affect battery life. |
| **Enable Action Log** | On | Shows a scrollable log of game actions with an Undo button for the most recent action. Also enables the round tracker button. |
| **Enable Favourites** | On | Reveals a star button on the setup screen to save bases as favourites, and adds a Favourites input mode for quick reselection. Saved bases are kept even when this setting is off. |

## Rules

The full Comprehensive Rules for Star Wars Unlimited are available on the official website:

[starwarsunlimited.com/how-to-play](https://starwarsunlimited.com/how-to-play?chapter=rules)

## Troubleshooting

**The wrong base is showing:**
Tap <svg width="0.8em" height="0.8em" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="vertical-align:middle;display:inline-block"><path d="M15.5 5L7 12L15.5 19Z"/></svg> on the game screen to return to the setup screen and make a new selection.

**Card art isn't loading:**
This can happen if the image server is temporarily unavailable. The app will show the base name and game text in place of the card art, all game functions still work normally.

---

*dmgCtrl is an unofficial fan site and is not produced by or endorsed by Fantasy Flight Games, Lucasfilm or Disney. The Star Wars Unlimited cards, logos and art used on the site are property of Disney and/or Fantasy Flight Games.*
