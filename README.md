# dmgCtrl

A mobile-first progressive web app for tracking game state in tabletop games, starting with Star Wars: Unlimited.

**Live app:** https://yetanotheridentifier.github.io/dmgCtrl/

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
```bash
gh repo clone yetanotheridentifier/dmgCtrl
cd dmgCtrl
npm install --legacy-peer-deps
```

### Run locally
```bash
npm run dev
```

Open [http://localhost:5173/dmgCtrl/](http://localhost:5173/dmgCtrl/) in your browser.

### Test
```bash
npm test
```

### Deploy
All changes pushed to `main` are automatically built and deployed via GitHub Actions. Deployment takes approximately one minute — progress is visible in the **Actions** tab of the repository.

```bash
git push
```

---

## Documentation

| Document | Description |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Tech stack, application structure, data layer, testing strategy, CI/CD |
| [docs/project-overview.md](docs/project-overview.md) | Product vision, planned features, known issues, notes for AI assistants |
| [docs/help.md](docs/help.md) | User guide (also served in-app via the ? button) |

---

## Licence
MIT