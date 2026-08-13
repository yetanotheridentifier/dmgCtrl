# dmgCtrl

Two applications in one repository:

- **The tracker** — a mobile-first progressive web app for tracking game state in tabletop games, supporting Star Wars: Unlimited and Star Wars X-Wing.
  **Live:** https://yetanotheridentifier.github.io/dmgCtrl/
- **Sealed** (`sealed/`) — a playable digital Star Wars: Unlimited sealed-deck game: a full rules engine, card abilities, and a searching AI opponent with its own benchmark harness. Desktop browser only.
  **Live:** https://dmgctrl.app/sealed

They are separate npm projects with separate dependencies, build steps and docs. Most changes touch one or the other, not both.

---

## Installing the app

### iPhone
1. Open the link above in **Safari** (must be Safari, not Chrome or any other browser)
2. Tap the **Share** button — the box with an arrow pointing upward at the bottom of the screen
3. Scroll down and tap **Add to Home Screen**
4. Confirm the name and tap **Add**

The app will appear on your home screen and open full screen without any browser chrome.

### Android
1. Open the link above in **Chrome**
2. Tap the three-dot menu in the top right
3. Tap **Add to Home Screen**
4. Confirm and tap **Add**

---

## Developer quickstart

### Prerequisites
- Node.js (LTS) — [nodejs.org](https://nodejs.org)
- Git — [git-scm.com](https://git-scm.com/download/win)
- GitHub CLI — [cli.github.com](https://cli.github.com)

### Setup

There are no npm workspaces, so each project installs its own dependencies. All three are needed before `npm test` will run, because it shells into `proxy` and `sealed`.

```bash
gh repo clone yetanotheridentifier/dmgCtrl
cd dmgCtrl
npm install --legacy-peer-deps
npm install --prefix proxy
npm install --prefix sealed
```

### Run locally

The tracker:

```bash
npm run dev          # http://localhost:5173/dmgCtrl/
```

Sealed, or both at once:

```bash
npm run dev:sealed   # sealed only, http://localhost:5174/
npm run dev:all      # both: sealed on 5174, tracker on 5173 over https, proxying /sealed
```

`dev:all` is the one to use when working on Sealed as it is actually served, at `https://localhost:5173/sealed/`. Ctrl+C stops both.

### Test
```bash
npm test                        # all three suites: tracker, proxy, sealed
npm run check --prefix sealed   # sealed's own gate: tests, tsc -b and eslint in sequence
```

`npm run check` is what to run before handing over a sealed change. It regenerates the build identity first, then stops at the first failure.

### Deploy
All changes pushed to `main` are automatically built and deployed via GitHub Actions. Deployment takes approximately one minute — progress is visible in the **Actions** tab of the repository.

```bash
git push
```

---

## Documentation

Each application has its own docs, and they do not overlap: `docs/` is the tracker's, `sealed/docs/` is Sealed's.

### Sealed

Start at [sealed/docs/README.md](sealed/docs/README.md), which maps one file per concern.

| Document | Description |
|---|---|
| [sealed/docs/architecture.md](sealed/docs/architecture.md) | System shape, rules engine, data model, runtime flow, storage, network |
| [sealed/docs/abilities.md](sealed/docs/abilities.md) | How a card's behaviour is declared, registered and dispatched |
| [sealed/docs/choices.md](sealed/docs/choices.md) | Pending choices: raising, answering, prompts, the guarantees |
| [sealed/docs/keywords-effects.md](sealed/docs/keywords-effects.md) | Stats pipeline, auras, lasting effects, token defeats, targeting |
| [sealed/docs/ai-model.md](sealed/docs/ai-model.md) | What the opponent AI thinks: terms, weights, invariants |
| [sealed/docs/ai-benchmark.md](sealed/docs/ai-benchmark.md) | The benchmark harness and its modes |
| [sealed/docs/operations.md](sealed/docs/operations.md) | Local dev, build, deploy, support playbook, diagnostics |
| [sealed/docs/planned-work.md](sealed/docs/planned-work.md) | What is next, what is deferred, what was tried and rejected |
| [sealed/docs/userGuide.md](sealed/docs/userGuide.md) | How the game plays, and the in-app Help page at build time |

### The tracker

| Document | Description |
|---|---|
| [docs/architecture-overview.md](docs/architecture-overview.md) | System overview, goals, tech stack, component tree, glossary |
| [docs/architecture-implementation.md](docs/architecture-implementation.md) | Folder structure, state management, data layer, UI system, feature details, performance |
| [docs/architecture-process.md](docs/architecture-process.md) | Workflow, CI/CD, analytics, testing strategy, future improvements |
| [docs/project-overview.md](docs/project-overview.md) | Product vision, planned features, known issues, notes for AI assistants |
| [docs/swuSetupHelp.md](docs/swuSetupHelp.md) | SWU setup screen help (shown via the ? button on the setup screen) |
| [docs/swuGameHelp.md](docs/swuGameHelp.md) | SWU game screen help (shown via the ? button on the game screen) |
| [docs/swuTournamentHelp.md](docs/swuTournamentHelp.md) | SWU tournament screen help (shown via the ? button on the tournament screen) |
| [docs/xwingSetupHelp.md](docs/xwingSetupHelp.md) | X-Wing setup screen help (shown via the ? button on the X-Wing setup screen) |
| [docs/xwingGameHelp.md](docs/xwingGameHelp.md) | X-Wing game screen help (shown via the ? button on the X-Wing game screen) |
| [docs/settingsHelp.md](docs/settingsHelp.md) | Settings screen help (shown via the ? button on the settings screen) |

---

## Licence
MIT
