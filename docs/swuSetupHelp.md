# dmgCtrl: Help

## About

dmgCtrl is a damage tracker for Star Wars Unlimited. For the best experience, install it on your iPhone via Safari, tap the Share button, then **Add to Home Screen**.

## Getting Started

Open the app and the loading screen appears for a moment while base data is fetched from the internet. Once ready, the **Setup** screen opens automatically.

Use the **Format** selector to choose your game format (which filters the available bases), then use the **Source** selector to choose how you want to pick your base.

### Base Selector

Use the three dropdowns to find your base:

1. **Set**: choose the set your base is from
2. **Aspect**: choose the base's aspect (Vigilance, Command, Aggression, Cunning, or None)
3. **Base**: choose your specific base

Each base option shows its name and HP. If only one option is available at any step, it is selected automatically.

Once you've chosen a base, a preview of the card art appears below. Tap <svg width="0.8em" height="0.8em" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="vertical-align:middle;display:inline-block"><path d="M8.5 5L17 12L8.5 19Z"/></svg> to start the game.

### SWUDB Import

If you have a unlisted or public deck link on swudb.com, you can load your base directly from the deck list:

1. Tap **Source** and select **SWUDB Import**
2. Paste your SWUDB deck link (e.g. `https://swudb.com/deck/AbCdEfGhI`). Edit links are autocorrected to view links
3. Tap **Load** — the deck name and a <svg width="0.8em" height="0.8em" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="vertical-align:middle;display:inline-block"><path d="M8.5 5L17 12L8.5 19Z"/></svg> button appear below
4. Tap <svg width="0.8em" height="0.8em" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="vertical-align:middle;display:inline-block"><path d="M8.5 5L17 12L8.5 19Z"/></svg> to start the game

If your deck can't be loaded, check that the link is correct and the deck is set to unlisted or public on swudb.com.

### Favourites

If **Enable Favourites** is turned on in Settings, you can save bases for quick reselection.

**Saving a favourite:** once you have chosen a base, a star button (☆) appears in the same row as the base controls — next to the base dropdown in Base Selector mode, or next to the start button after loading a deck in SWUDB Import mode. Tap it to save the base as a favourite — the star fills (★). Tap the filled star again to remove it.

**Using Favourites mode:**

1. Tap **Source** and select **Favourites**
2. Choose a base from the dropdown — each option shows the set, name, and HP
3. Tap <svg width="0.8em" height="0.8em" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="vertical-align:middle;display:inline-block"><path d="M8.5 5L17 12L8.5 19Z"/></svg> to start the game

The Favourites option only appears in Source when **Enable Favourites** is on and you have at least one saved base. Your saved bases are kept even if you turn Enable Favourites off — they will be there when you turn it back on.

## Settings

Tap the <svg width="3.5%" height="3.5%" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> button (top-right of the setup screen or game screen) to open the Settings screen.

Your preferences are saved automatically and persist between sessions.

| Setting | Default | Description |
|---|---|---|
| **Use Hyperspace Art** | On | When enabled, the Hyperspace variant is used by default on the game screen for any base that has one. If the Hyperspace image can't be loaded, the app falls back to the standard art. |
| **Force Token Display** | LOF bases only | Controls when the Force token button is shown: **Always on** shows it for every base; **LOF bases only** shows it only for Force-relevant bases in the Legends of the Force set; **Always off** hides it entirely. |
| **Enable Epic Actions** | On | Shows the Epic Action button on the game screen. Turn off if you prefer not to track epic actions. |
| **Enable Screen Wake Lock** | On | Keeps the screen on during play. May affect battery life. |
| **Enable Action Log** | On | Shows a scrollable log of game actions with an Undo button for the most recent action. Also enables the round tracker button. |
| **Enable Favourites** | On | Reveals a star button on the setup screen to save bases as favourites, and adds a Favourites input mode for quick reselection. Saved bases are kept even when this setting is off. |
| **Enable Long Press** | On | Allows long-pressing or dragging the +/− buttons to apply larger damage or healing values quickly. Turn off if accidental large hits are a problem. |
| **Enable Competitive Mode** | Off | Adds a **Match** selector to the setup screen for tracking Best of 1 or Best of 3 matches with a score panel and match timer. See [Competitive Play](#competitive-play) below. |
| **Bo1 Timer** | 25 min | Match timer duration for Best of 1 games. Adjustable in 5-minute steps (5–90 min). Shown only when Enable Competitive Mode is on. |
| **Bo3 Timer** | 55 min | Match timer duration for Best of 3 games. Adjustable in 5-minute steps (5–90 min). Shown only when Enable Competitive Mode is on. |

### Managing saved favourites

When **Enable Favourites** is on, your saved bases are listed below the toggle in the Settings screen.

- Tap **Remove** next to a base to delete it from your favourites
- Tap **Clear All** to remove all saved bases at once — tap **Confirm** to proceed, or **Cancel** to go back

If no bases have been saved yet, "No favourites saved" is shown in this section.

Tap <svg width="0.8em" height="0.8em" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="vertical-align:middle;display:inline-block"><path d="M15.5 5L7 12L15.5 19Z"/></svg> to return to the previous screen, or <svg width="0.85em" height="0.85em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="round" aria-hidden="true" style="vertical-align:middle;display:inline-block"><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> for help.

## Format

The **Format** selector filters which bases are available based on the format you're playing.

| Format | Which bases are available |
|---|---|
| **Premier** | Sets in the current rotation, plus Infinite Bad Habits (IBH) which is always Premier-legal |
| **Limited** | All standard sets (Sealed, Draft, and Chaos all use the same pool) |
| **Eternal** | All sets with no restrictions |
| **Twin Suns** | All sets with no restrictions |

Your format preference is saved and restored between sessions. If you load a deck via SWUDB Import and the base is not legal in the selected format, the start button is disabled and an error message is shown — switching to a valid format re-enables it without re-loading the deck.

## Competitive Play

When **Enable Competitive Mode** is turned on in Settings, a **Match** selector appears on the setup screen alongside the Format selector.

| Option | Description |
|---|---|
| **Casual** | No score tracking. Standard play with no timer or result recording. |
| **Best of 1** | Single-game match. Records a win, loss, or draw. Includes a match timer (default 25 min). |
| **Best of 3** | First to 2 game wins. Records each game result and tracks the overall match score. Includes a match timer (default 55 min). |

Once a match mode is selected and the game starts, the score panel appears on the right side of the game screen showing your score (You) and your opponent's score (Opp), plus the match timer. See the game help for full details on how scoring and the timer work.

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
