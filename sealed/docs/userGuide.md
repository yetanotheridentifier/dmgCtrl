# Sealed: User Guide

dmgCtrl Sealed lets you play Star Wars: Unlimited **Sealed** games against an AI opponent, using a deck built from your own sealed pool.

## Importing a deck

1. Build your sealed deck in **ProtectThePod** and copy its JSON export to the clipboard.
2. On the deck selection screen, paste the JSON into the **Import deck** box and press **Import**.
3. A legal Sealed deck needs exactly 1 leader, exactly 1 base, and at least 30 other cards. The importer will tell you if something is missing.

Your decks are saved on this device and appear in the deck list. The first time you play a deck, its card details are fetched and cached locally — later games work from the cache.

## Choosing an opponent

The **Opponent** selector controls which deck the AI plays:

- **Random deck** — the AI picks one of your imported decks at random (it may pick the same deck you're playing).
- **A specific deck** — choose any imported deck by name.

The current AI opponent plays **random legal moves**. It exists to exercise the full rules engine; smarter opponents are on the roadmap.

## Playing a game

Press **Play** next to your deck. Cards hydrate, hands are dealt (6 cards, of which 2 become your starting resources), and the board appears.

### The board

- **Opponent panel and your panel** — base HP, ready/total resources, leader status, hand size, and units in the ground and space arenas. Each unit shows its power and remaining HP; exhausted units are dimmed.
- **Your hand** — cards you can afford right now are highlighted; unplayable cards are dimmed. A card's shown cost includes any **aspect penalty** (+2 per aspect icon your leader and base don't provide).
- **Your move** — every legal action appears as a button: play a card, attack (choose any legal target), deploy your leader, take the initiative, or pass.
- **Log** — a running record of every action both players have taken.

### Turn structure

Players alternate single actions. When both players pass consecutively, the round moves to the **regroup phase**: each player draws 2, may put 1 card from hand into resources, then everything readies and a new round begins. Whoever holds the **initiative** acts first each round — take it during a round to act first in the next one (but you'll pass for the rest of the current one).

### Winning

Reduce the opponent's base to 0 HP before they do the same to you. If your deck runs out, drawing deals 3 damage to your own base per missed card — don't dawdle.

### Current limitations

- Card **abilities, keywords, events, and upgrades are not executed** yet — units play with their printed stats ("vanilla"). Events and upgrades can still be used as resources.
- No mulligan during setup; starting resources are chosen automatically.

## After the game

The result banner offers a **Rematch** (fresh shuffle, same decks) or **Back to decks**. Completed games are recorded on-device for future analysis.
