# dmgCtrl

A progressive web app that tracks game state for Star Wars Unlimited.

## Tech stack
- React + TypeScript
- Vite
- vite-plugin-pwa

## Using the app

The app is hosted at [https://yetanotheridentifier.github.io/dmgCtrl/](https://yetanotheridentifier.github.io/dmgCtrl/)

### Installing on iPhone
1. Open the link above in **Safari** (must be Safari, not Chrome or any other browser)
2. Tap the **Share button** — the box with an arrow pointing upward at the bottom of the screen
3. Scroll down and tap **Add to Home Screen**
4. Confirm the name and tap **Add**

The app will appear on your home screen and open full screen without any browser chrome.

### Installing on Android
1. Open the link above in **Chrome**
2. Tap the three dot menu in the top right
3. Tap **Add to Home Screen**
4. Confirm and tap **Add**

## Development

### Prerequisites
- Node.js (LTS version) — [nodejs.org](https://nodejs.org)
- Git for Windows — [git-scm.com](https://git-scm.com/download/win)
- GitHub CLI — [cli.github.com](https://cli.github.com)

### Setup
Clone the repository:
```bash
gh repo clone yetanotheridentifier/dmgCtrl
cd dmgCtrl
```

Install dependencies:
```bash
npm install --legacy-peer-deps
```

Run locally:
```bash
npm run dev
```

Open [http://localhost:5173/dmgCtrl/](http://localhost:5173/dmgCtrl/) in your browser.

### Publishing changes
All changes pushed to `main` are automatically deployed via GitHub Actions.

```bash
git add .
git commit -m "description of your changes"
git push
```

Deployment takes approximately one minute. Progress can be monitored in the **Actions** tab of the GitHub repository. The app will be live at [https://yetanotheridentifier.github.io/dmgCtrl/](https://yetanotheridentifier.github.io/dmgCtrl/) once the action completes.

## Licence
MIT