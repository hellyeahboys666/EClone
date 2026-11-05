#!/bin/zsh
# Double-click to start the twin (Mac). The first time, it installs what's needed and
# runs the setup questions. Then it starts the twin and opens it in your browser.
# Close this window (or press Ctrl+C) to stop the twin.
cd "${0:A:h}"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js isn't installed. Download the LTS version from https://nodejs.org,"
  echo "install it, then double-click this file again."
  read -k1 "?Press any key to close."
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "Installing (first time only)..."
  npm install || { read -k1 "?Install failed. Press any key to close."; exit 1; }
fi

if [[ ! -f .env ]]; then
  npm run setup || { read -k1 "?Setup didn't finish. Press any key to close."; exit 1; }
fi

PORT=$(grep -E '^PORT=' .env | cut -d= -f2)
PORT=${PORT:-4747}
if curl -s -o /dev/null "http://localhost:$PORT/api/config"; then
  echo "The twin is already running. Opening it..."
  open "http://localhost:$PORT"
  exit 0
fi

(sleep 2 && open "http://localhost:$PORT") &
npm start
