# X-Wing: Setup Help

dmgCtrl supports the **X-Wing Alliance (XWA)** ruleset.

## Match Type

- **Casual** — a standard pick-up game with no round limit.
- **Tournament** — enables the **Rounds** stepper so you can set the maximum number of rounds (2–10).

## Scenario

Choose the scenario for this game:

- **None** — no scenario; mission points come from ship kills only (casual deathmatch).
- **Assault at the Satellite Array**
- **Chance Engagement**
- **Salvage Mission**
- **Scramble the Transmissions**
- **Ancient Knowledge**

Tap the **dice button** to pick a scenario at random from the five named options.

The scenario selection is not saved between sessions — choose it fresh each game.

## List Import

Lists are entered one at a time in sequence. Confirm **Your list** before the **Opp list** section appears.

Each player's import method is set independently:

- **None** — manual deficit entry only. Use the stepper to enter the player's mission point deficit (0–4). The deficit is automatically added to the opponent's score if all of your ships are destroyed during the game.
- **XWA** — paste the XWS JSON exported from the YASB (Yet Another Squad Builder) website. Tap the **tick button** to validate the list; if the list cannot be parsed, a descriptive error message will appear and you can correct the text before trying again. Once confirmed, your squad is shown as a list of pilots with their ship name and points so you can verify before starting.
- **YASB** — direct YASB import (coming soon).
- **Favourites** — load a previously saved squad. Appears only when you have saved squads. Select a squad from the dropdown, then tap the **tick button** to load it.

Once both lists are confirmed, the **Go to game** button appears at the bottom-right of the screen. Tap **Edit** next to either player to go back and change their list — editing one player does not affect the other.

### Saving squads

After confirming an XWA import or loading a Favourites squad, the squad name is shown in a read-only field below the import selector, with a **star button** (☆/★) on the right:

- **☆ (empty star)** — squad is not saved. Tap to save it to your favourites.
- **★ (filled star)** — squad is currently saved. Tap to remove it from your favourites.

If you save a squad with the same name as an existing favourite, a confirmation prompt appears asking you to confirm the overwrite. Saved squads can be managed (removed or cleared) from the Settings screen under **X-Wing Saved Squads**.

### XWS Import

Export your squad from YASB as XWS, copy the JSON text, and paste it into the text box. A valid XWS list must:

- Contain between 3 and 8 ships.
- Have a total points cost between 46 and 50.

If the list is imported via XWA, the mission point deficit is calculated automatically as `50 − total points`. If the total is exactly 50, the deficit is 0.
