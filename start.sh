#!/bin/sh
# Serves the app on http://localhost:8765 and opens it in the browser.
cd "$(dirname "$0")" || exit 1
echo "Dancing with the SARs is starting on http://localhost:8765 (Ctrl+C to stop)"
(sleep 1; (open http://localhost:8765 || xdg-open http://localhost:8765) >/dev/null 2>&1) &
python3 -m http.server 8765
