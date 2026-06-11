# X-Wing: Help

## Mission Points

Each player's mission points are shown on the left (**You**) and right (**Opp**). Points start equal to the opponent's deficit as entered on the setup screen; the first player to reach 50 wins.

- Tap **+** to add a point
- Tap **−** to remove a point (won't go below zero)

### Adding or removing multiple points at once

Press and hold **+** or **−**, then drag upward:

1. **Press and hold** — keep your finger down
2. **Drag upward** — a number appears showing how many points will be applied
3. **Release** — all points are applied at once

The number increases by 1 for roughly every 14px of upward movement, starting from 2.

## Timer

The countdown timer is shown in the centre of the screen during a game. It starts when you tap **Start Game** and runs continuously until the game ends.

- The timer turns amber when less than 5 minutes remain
- The timer turns red when less than 1 minute remains
- The timer stops when the game ends (50 points reached, or End phase confirmed at round 12 or timer expiry)

To configure the timer duration, tap <svg width="3.5%" height="3.5%" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> **Settings** → **X-Wing** → **Game Timer**.

## Phase Tracker

When **Enable Phase Tracker** is on in Settings, a phase button appears in the centre of the screen between the two score displays.

- Tap it to advance to the next phase: **Planning → System → Activation → Engagement → End**
- Tapping **End** advances the round and resets to Planning (unless the game is about to end — see below)
- When Round 12 is reached, or when the timer has expired, tapping **End** ends the game and shows the result

Initiative can only be set during the **Planning** phase. It is locked for all other phases and unlocks again at the start of the next Planning phase.

## Scenario Scoring

When a named scenario is selected on the setup screen, the scenario name is shown in the centre of the game screen during play.

From round 2 onwards, three scoring buttons (**0**, **2**, **4**) appear at the bottom of each player's column during the **End** phase. Tap the number of scenario points scored by each player this round. The inc/dec buttons are disabled while these buttons are active.

- Points are applied when you advance from the End phase (by tapping the phase button or the next round in the round tracker)
- Each set of scenario points is logged as a separate entry ("Scenario: You +Y, Opp +Z") before the round advance
- If the running total of ship points plus scenario points reaches 50, the game ends immediately
- Scenario buttons are disabled if points have already been entered for the current round (e.g. after an undo) — undo a second time to re-enable them

## Initiative Bar

When **Enable Initiative Bar** is on in Settings, a narrow vertical bar appears on the left side of the game screen.

- Tap the **top half** (OPP) to record that your opponent has initiative this round
- Tap the **bottom half** (YOU) to record that you have initiative this round
- Tapping the same side again has no effect
- When the phase tracker is enabled, initiative can only be set during the **Planning** phase

Initiative resets to neutral at the start of each round (when you tap the next segment in the round tracker), ready for the next roll-off.

## Round Tracker

The round tracker bar runs across the top of the screen, showing all 12 rounds. The current round is highlighted and extends slightly below the bar as a tab.

- Tap the **next** segment to advance to that round
- The tracker is not available until the game has started

## Game End

The game ends when:
- Either player reaches **50 mission points** — a result banner (Game Won / Game Lost / Draw) replaces the timer immediately
- The **phase tracker** is enabled and the **End** phase is tapped at Round 12 or after the timer has expired — the result is calculated from current scores

To undo a game-end result, open the action log and tap **Undo**. The game state is restored to the moment before the end was confirmed, and the timer resumes from where it left off.

## Navigation

| Button | Position | Action |
|---|---|---|
| <svg width="0.8em" height="0.8em" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="vertical-align:middle;display:inline-block"><path d="M15.5 5L7 12L15.5 19Z"/></svg> Back | Top-left | Return to the X-Wing setup screen |
| <svg width="3.5%" height="3.5%" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> Settings | Top-right | Open Settings |
| ? Help | Top-right | Open this screen |

## Settings

Tap the <svg width="3.5%" height="3.5%" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> button (top-right) to open the Settings screen.

| Setting | Default | Description |
|---|---|---|
| **Game Timer** | 75 min | Timer duration for an X-Wing game. Adjust in the **X-Wing** section using **+** and **−**. |
| **Enable Phase Tracker** | On | Shows a phase button in the centre of the game screen. Tap to cycle through Planning → System → Activation → Engagement → End. Tapping End advances the round or ends the game. |
| **Enable Screen Wake Lock** | On | Keeps the screen on during play. May affect battery life. |
| **Enable Initiative Bar** | On | Shows a vertical initiative tracker on the left side of the game screen. Resets each round when you advance the round tracker. |

---

*dmgCtrl is an unofficial fan site and is not produced by or endorsed by Atomic Mass Games, Lucasfilm or Disney. Star Wars: X-Wing and all related marks are property of Disney and/or Atomic Mass Games.*
