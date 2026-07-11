# Sealed: User Guide

dmgCtrl Sealed lets you play Star Wars: Unlimited **Sealed** games against an AI opponent, using a deck built from your own sealed pool.

## Importing a deck

1. Build your sealed deck in **ProtectThePod** and copy its JSON export to the clipboard.
2. On the deck selection screen, paste the JSON into the **Import deck** box and press **Import**.
3. A legal Sealed deck needs exactly 1 leader, exactly 1 base, and at least 30 other cards. The importer will tell you if something is missing.

Your decks are saved on this device and appear in the deck list. The first time you play a deck, its card details are fetched and cached locally — later games work from the cache.

## Caching a full set

The **Card catalogue** section lets you cache an entire set by its code (e.g. `ASH`): one click fetches every card in the set and stores it on this device. Games and deck views then work without touching the network — and this also covers the handful of base cards whose individual lookups are unreliable upstream.

## Choosing an opponent

The **Opponent** selector controls which deck the AI plays:

- **Random deck** — the AI picks one of your imported decks at random (it may pick the same deck you're playing).
- **A specific deck** — choose any imported deck by name.

The current AI opponent plays **random legal moves**. It exists to exercise the full rules engine; smarter opponents are on the roadmap.

## Playing a game

Press **Play** next to your deck. Cards hydrate, both players draw 6, and the board appears in the **setup step**: choose **Keep hand** or **Mulligan** (shuffle your hand back and draw a fresh 6 — once only; whoever holds the initiative decides first). Then **resource 2 cards, one pick at a time** — **click a hand card to resource it** (or use the action buttons), and you can also just avoid banking your early plays. Aim to keep a curve: something to play on turn 1 (cost ≤ 2), turn 2 (≤ 3), turn 3 (≤ 4). Once both players have resourced 2, round 1 begins. Resourcing is private: the log shows only that your opponent resourced, never which card.

The AI opponent mulligans any hand without a turn-1 play and resources the pair of cards that best preserves its early curve.

### The board

- **The battlefield** — laid out like the tabletop around a central **battlefront**. The **Ground** and **Space** lanes flank a central strip holding both bases and leaders: reading down the middle you'll find the opponent's leader, the opponent's base, your base, then your leader — so the two bases meet at the battlefront and the leaders are outermost. Units line up **along the battlefront** (level with the bases); as you play more, they stack **further back** — the opponent's toward the top, yours toward the bottom. **Sentinels** are held at the front, closest to the battlefront. Each player's **resources, leader status, hand size and pile counts** sit in a compact line above (opponent) and below (you).
- **Cards** — each card is shown as its **card art** (power and health are on the art itself). Any **damage** a unit has taken is shown as a **red token** (white number) over the middle of the card art, like a physical token; it stays upright even when the card is rotated, and keeps the card's name, ability text and stats visible. Cards are drawn at a fixed size in a uniform square slot and in their true orientation — units stand **portrait** when ready and rotate **landscape** (sideways, dimmed) when exhausted; a **deployed leader** shows its unit side. The square slots mean cards never overlap, even when rotated. A **highlight hugs the card edge** when it's selectable, a target, or your playable hand card. If a card's art can't be loaded, the card instead shows a **text summary** — cost, name, power/HP, keywords and abilities — so it's always readable.
- **Zoom** — hold **Shift** and move the mouse over a card to enlarge it at full size for reading (or **long-press** on a touch screen); release, or move away, to dismiss. Zoom needs Shift so plain hovering doesn't get in the way of making a play. While zoomed, hold **Alt** over a **leader** to see its other (unit) side.
- **Your hand** — clickable cards are highlighted: **blue** when a click will **play** the card (action phase), **green** when a click will **resource** it (setup/regroup). Cards you can't act on are dimmed. A card's shown cost includes any **aspect penalty** (+2 per aspect icon your leader and base don't provide).
- **Your move** — click a **glowing unit** to select it, then click a highlighted target (enemy unit or their base) to attack. Every legal action also appears as a button below the board: play a card, attack, deploy your leader, take the initiative, or pass.
- **Log** — a running record of every action, in a panel on the right of the board.

### Turn structure

Players alternate single actions. When both players pass consecutively, the round moves to the **regroup phase**: each player draws 2, may put 1 card from hand into resources, then everything readies and a new round begins. In regroup, **click any hand card to resource it** (or Skip resourcing to bank nothing). Whoever holds the **initiative** acts first each round — take it during a round to act first in the next one (but you'll pass for the rest of the current one).

### Winning

Deal damage to the opponent's base until it reaches its health before they do the same to you. Each base shows the **damage it has taken as a large number over the card**, counting up to its printed health (which varies from base to base). If a single action defeats **both** bases at once, the game is a **draw**. If your deck runs out, drawing deals 3 damage to your own base per missed card — don't dawdle.

### Current limitations

- **Keywords work**: Sentinel (you must attack it), Saboteur, Raid, Grit, Overwhelm and Restore all apply. **Card ability text, events, and upgrades are not executed yet** — those cards still make fine resources. Ambush and Shielded arrive with abilities/upgrades support.

## After the game

The result banner offers a **Rematch** (fresh shuffle, same decks) or **Back to decks**. Completed games are recorded on-device for future analysis.
