#!/usr/bin/env python3
"""Dev server that refuses to let the browser cache anything.

python -m http.server sends Last-Modified, and Chrome will happily reuse a
cached ES module across reloads -- which silently hides every edit you make.
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def send_header(self, keyword, value):
        if keyword.lower() in ('last-modified', 'etag'):
            return
        super().send_header(keyword, value)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f'serving {__file__.rsplit("/", 1)[0]} on http://localhost:{port} (no-cache)')
    ThreadingHTTPServer(('127.0.0.1', port), NoCacheHandler).serve_forever()
