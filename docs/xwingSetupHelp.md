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

Once both lists are confirmed, the **Go to game** button appears (portrait: below the help button; landscape: top-right). Tap **Edit** next to either player to go back and change their list — editing one player does not affect the other.

### XWS Import

Export your squad from YASB as XWS, copy the JSON text, and paste it into the text box. A valid XWS list must:

- Contain between 3 and 8 ships.
- Have a total points cost between 46 and 50.

If the list is imported via XWA, the mission point deficit is calculated automatically as `50 − total points`. If the total is exactly 50, the deficit is 0.
