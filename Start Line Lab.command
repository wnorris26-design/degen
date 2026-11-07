#!/bin/bash
# Mac: double-click to launch Cascadia Line Lab
cd "$(dirname "$0")"
PORT=5173
URL="http://localhost:$PORT"
if command -v node >/dev/null 2>&1; then
  (sleep 1; open "$URL") &
  echo "🌲 Cascadia Line Lab running at $URL — close this window to stop."
  node server.js
elif command -v python3 >/dev/null 2>&1; then
  (sleep 1; open "$URL") &
  echo "🌲 Cascadia Line Lab running at $URL (Python) — close this window to stop."
  python3 -m http.server $PORT --bind 127.0.0.1
else
  echo "Node.js isn't installed. Get the LTS version from https://nodejs.org, then double-click this file again."
  open "https://nodejs.org"
  read -n 1 -s -r -p "Press any key to close..."
fi
