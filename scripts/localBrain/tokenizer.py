"""Loopback-only, offline tokenizer. No generation, model hub, credentials or writes."""
import json, os, hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
from tokenizers import Tokenizer

tokenizer_file = os.environ['LOCAL_TOKENIZER_FILE']
with open(tokenizer_file, 'rb') as source:
    if hashlib.sha256(source.read()).hexdigest() != 'aeb13307a71acd8fe81861d94ad54ab689df773318809eed3cbe794b4492dae4':
        raise RuntimeError('local_tokenizer_integrity_failed')
tokenizer = Tokenizer.from_file(tokenizer_file)

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path != '/health':
            self.send_error(404)
            return
        payload = b'{"ready":true,"model":"qwen3:8b"}'
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self):
        try:
            size = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            self.send_error(400)
            return
        if self.path != '/count' or not 0 < size <= 1048576:
            self.send_error(400)
            return
        try:
            data = json.loads(self.rfile.read(size))
            # Count each field independently, with a conservative template allowance.
            count = sum(len(tokenizer.encode(m['content'], add_special_tokens=False).ids)
                        + 32 for m in data['messages']) + 64
            payload = json.dumps({'tokens': count, 'model': 'qwen3:8b'}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        except (ValueError, KeyError, TypeError):
            self.send_error(400)

port = int(os.environ.get('LOCAL_TOKENIZER_PORT', '11436'))
if port not in (11436, 11437):
    raise RuntimeError('local_tokenizer_port_invalid')
HTTPServer(('127.0.0.1', port), Handler).serve_forever()
