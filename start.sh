#!/bin/sh
# Serves the app on this computer and opens it in the browser.
cd "$(dirname "$0")" || exit 1
exec python3 tools/serve.py
