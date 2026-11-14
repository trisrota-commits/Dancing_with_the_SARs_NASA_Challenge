#!/bin/sh
# macOS launcher: double-click to serve the app on this computer and open
# it in the browser. Close this window to stop.
cd "$(dirname "$0")" || exit 1
PORT=8765

# The python3 that ships with macOS is only a stub until Apple's developer
# tools are installed, so check before using it.
has_python() {
  p=$(command -v python3) || return 1
  [ "$p" != /usr/bin/python3 ] || xcode-select -p >/dev/null 2>&1
}

if has_python; then
  # Opens the browser itself, on the port it really got, and tells the
  # browser never to keep old copies of the app's files.
  exec python3 tools/serve.py "$PORT"
elif ruby -e 'require "webrick"' >/dev/null 2>&1; then
  echo "Dancing with the SARs is starting on http://localhost:$PORT"
  echo "Keep this window open while you use it. Close it (or press Ctrl+C) to stop."
  (sleep 1; open "http://localhost:$PORT") &
  exec ruby -run -e httpd . -p "$PORT"
fi

echo
echo "No web server found. Install Python from https://www.python.org/downloads/"
echo "and double-click this file again."
read -r _
