#!/usr/bin/env bash
# One-command local dev stack for the sealed app:
#   - sealed dev server (port 5174)
#   - main PWA dev server (port 5173, mkcert https) proxying /sealed → 5174
# Browse https://dev.dmgctrl.app/sealed (via your tunnel) or https://localhost:5173/sealed/
# Ctrl+C stops both servers.
set -e
cd "$(dirname "$0")/.."

trap 'kill $(jobs -p) 2>/dev/null' EXIT INT TERM

npm --prefix sealed run dev -- --clearScreen false &
npm run dev:https -- --clearScreen false &

wait
