"""Disposable Discord-shaped webhook receiver for the Docker smoke test only."""

import json
from http.server import BaseHTTPRequestHandler, HTTPServer

EVENTS = []


class Receiver(BaseHTTPRequestHandler):
    def do_POST(self):
        EVENTS.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        body = json.dumps(EVENTS).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    HTTPServer(("0.0.0.0", 8080), Receiver).serve_forever()
