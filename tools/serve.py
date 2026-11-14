#!/usr/bin/env python3
"""Serves the app on this computer and opens it in the browser.

The launchers (start.bat, start.command, start.sh) run this. It does two
things a plain "python -m http.server" does not:

- It tells the browser never to keep the app's files. Without that, a
  browser goes on showing an old version after the files have changed.
- It checks that the port is really free. If an older copy of the app is
  still being served there (its window was left open), this one moves to
  the next free port and says so, and the browser opens the right one.

    python tools/serve.py            # port 8765, or the next free one
    python tools/serve.py 9000       # start looking at another port
    python tools/serve.py --no-open  # do not open the browser
"""

import functools
import http.server
import os
import socket
import sys
import threading
import webbrowser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Always the files as they are now, never a kept copy.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass  # one line per file would bury the message below


class Server(http.server.ThreadingHTTPServer):
    # On Windows "reuse" would let two servers share one port, and the
    # browser would reach whichever started first: the old one.
    allow_reuse_address = os.name != "nt"
    daemon_threads = True


def in_use(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.4):
            return True
    except OSError:
        return False


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    first = int(args[0]) if args else 8765
    server = None
    for port in range(first, first + 30):
        if in_use(port):
            continue
        try:
            server = Server(("", port), functools.partial(Handler, directory=ROOT))
            break
        except OSError:
            continue
    if server is None:
        sys.exit(f"No free port between {first} and {first + 29}.")

    url = f"http://localhost:{port}"
    print(f"Dancing with the SARs is running at {url}")
    if port != first:
        print(f"(Port {first} is taken, probably by an older copy that is still open.")
        print(" Close that window if you no longer need it.)")
    print("Keep this window open while you use it. Close it, or press Ctrl+C, to stop.")
    if "--no-open" not in sys.argv:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
