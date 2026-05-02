# dmgCtrl: Help

## About

dmgCtrl is a damage tracker for Star Wars Unlimited. For the best experience, install it on your iPhone via Safari, tap the Share button, then **Add to Home Screen**.

## Getting Started

Open the app and the loading screen appears for a moment while base data is fetched from the internet. Once ready, the **Setup** screen opens automatically.

Use the **Input Mode** selector to choose how you want to pick your base.

### Base Selector

Use the three dropdowns to find your base:

1. **Set**: choose the set your base is from
2. **Aspect**: choose the base's aspect (Vigilance, Command, Aggression, Cunning, or None)
3. **Base**: choose your specific base

Each base option shows its name and HP. If only one option is available at any step, it is selected automatically.

Once you've chosen a base, a preview of the card art appears below. Tap <svg width="0.8em" height="0.8em" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="vertical-align:middle;display:inline-block"><path d="M8.5 5L17 12L8.5 19Z"/></svg> to start the game.

### SWUDB Import

If you have a unlisted or public deck link on swudb.com, you can load your base directly from the deck list:

1. Tap **Input Mode** and select **SWUDB Import**
2. Paste your SWUDB deck link (e.g. `https://swudb.com/deck/AbCdEfGhI`). Edit links are autocorrected to view links
3. Tap **Load** — the deck name and a <svg width="0.8em" height="0.8em" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="vertical-align:middle;display:inline-block"><path d="M8.5 5L17 12L8.5 19Z"/></svg> button appear below
4. Tap <svg width="0.8em" height="0.8em" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="vertical-align:middle;display:inline-block"><path d="M8.5 5L17 12L8.5 19Z"/></svg> to start the game

If your deck can't be loaded, check that the link is correct and the deck is set to unlisted or public on swudb.com.

### Favourites

If **Enable Favourites** is turned on in Settings, you can save bases for quick reselection.

**Saving a favourite:** once you have chosen a base, a star button (☆) appears in the same row as the base controls — next to the base dropdown in Base Selector mode, or next to the start button after loading a deck in SWUDB Import mode. Tap it to save the base as a favourite — the star fills (★). Tap the filled star again to remove it.

**Using Favourites mode:**

1. Tap **Input Mode** and select **Favourites**
2. Choose a base from the dropdown — each option shows the set, name, and HP
3. Tap <svg width="0.8em" height="0.8em" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="vertical-align:middle;display:inline-block"><path d="M8.5 5L17 12L8.5 19Z"/></svg> to start the game

The Favourites option only appears in Input Mode when **Enable Favourites** is on and you have at least one saved base. Your saved bases are kept even if you turn Enable Favourites off — they will be there when you turn it back on.

## During a Game

The base card fills the screen, with the damage counter overlaid across the middle.

- Tap **+** to add 1 damage
- Tap **−** to remove 1 damage (won't go below zero)
- **Remaining** shows your starting HP minus damage taken so far

### Adding or removing multiple damage at once

For larger hits or recovery, press and hold **+** or **−**, then drag upward:

1. **Press and hold** the button — keep your finger down
2. **Drag upward** — a number appears showing how many damage points will be applied
3. **Release** — all the damage is applied at once

The number increases by 1 for roughly every 14px of upward movement, starting from 2. It is capped at the remaining capacity: the `+` button won't exceed the base's remaining HP, and `−` won't go below zero.

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
- Tap the token overlay or the button again to undo the mark if needed

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
| **Enable Favourites** | On | Reveals a star button on the setup screen to save bases as favourites, and adds a Favourites input mode for quick reselection. Saved bases are kept even when this setting is off. |

### Managing saved favourites

When **Enable Favourites** is on, your saved bases are listed below the toggle in the Settings screen.

- Tap **Remove** next to a base to delete it from your favourites
- Tap **Clear All** to remove all saved bases at once — tap **Confirm** to proceed, or **Cancel** to go back

If no bases have been saved yet, "No favourites saved" is shown in this section.

Tap <svg width="0.8em" height="0.8em" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="vertical-align:middle;display:inline-block"><path d="M15.5 5L7 12L15.5 19Z"/></svg> to return to the previous screen, or <svg width="0.85em" height="0.85em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="round" aria-hidden="true" style="vertical-align:middle;display:inline-block"><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> for help.

## Formats and Base Selection

The Set and Aspect dropdowns help narrow down which base you're playing. Star Wars Unlimited has multiple sets, each containing bases with different aspects and HP values.

Note: at the moment, all bases across all sets are shown regardless of format (Premier, Sealed, etc.). Format filtering, which would limit the list to bases legal in your chosen format is planned for a future update.

## Rules

The full Comprehensive Rules for Star Wars Unlimited are available on the official website:

[starwarsunlimited.com/how-to-play](https://starwarsunlimited.com/how-to-play?chapter=rules)

## Troubleshooting

**Base art isn't loading:**
Check your connection and try restarting the app. The app needs an internet connection on first load to fetch card data. Once loaded, data is cached on your device for 24 hours.

**The wrong base is showing:**
Tap <svg width="0.8em" height="0.8em" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="vertical-align:middle;display:inline-block"><path d="M15.5 5L7 12L15.5 19Z"/></svg> on the game screen to return to the setup screen and make a new selection.

**Card art isn't loading:**
This can happen if the image server is temporarily unavailable. The app will show the base name and game text in place of the card art, all game functions still work normally.

**Newly previewed bases not selectable:**
Card data refreshes automatically every 24 hours. If a new base from spoiler season is not appearing, try again once published to https://starwarsunlimited.com/ and wait for the cache to refresh.

---

*dmgCtrl is an unofficial fan site and is not produced by or endorsed by Fantasy Flight Games, Lucasfilm or Disney. The Star Wars Unlimited cards, logos and art used on the site are property of Disney and/or Fantasy Flight Games.*