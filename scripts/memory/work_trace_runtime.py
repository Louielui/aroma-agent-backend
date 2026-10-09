"""Xiangxiang's repository-owned Hindsight launcher.

Carries a signed host trace across ASGI -> OpenAI-compatible callback. Never
parses mail/prompts to infer identity and never edits third-party packages.
Only authenticated synchronous memory requests and fixed local callbacks carry
context; uninstrumented or detached work remains unlinked.
"""
import contextvars
import hashlib
import hmac
import json
import os
import re
from urllib.parse import urlsplit

HEADER = b"x-xiangxiang-work-trace"
TRACE = contextvars.ContextVar("xiangxiang_work_trace", default=None)


def valid_header(value, token):
    if not isinstance(value, str) or len(value) > 700 or not re.fullmatch(r"[A-Za-z0-9_-]+\.[a-f0-9]{64}", value):
        return False
    if not re.fullmatch(r"[a-f0-9]{64}", token or ""):
        return False
    payload, signature = value.split(".")
    expected = hmac.new(token.encode(), ("xiangxiang-work-v1:" + payload).encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        return False
    import base64
    try:
        trace = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        return (isinstance(trace, dict) and set(trace) == {"workId", "runId", "kind", "phase", "attempt", "recordId"}
                and isinstance(trace["workId"], str) and re.fullmatch(r"work:[a-f0-9]{64}", trace["workId"]) is not None
                and isinstance(trace["runId"], str) and re.fullmatch(r"[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}", trace["runId"]) is not None
                and trace["kind"] in {"mail_analysis", "mail_index", "memory_index", "memory_consolidation"}
                and trace["phase"] in {"analysis", "extraction", "consolidation"}
                and type(trace["attempt"]) is int and 1 <= trace["attempt"] <= 9007199254740991
                and (trace["recordId"] is None or isinstance(trace["recordId"], str) and re.fullmatch(r"xx-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}", trace["recordId"]) is not None))
    except (ValueError, TypeError, KeyError):
        return False


class WorkTraceMiddleware:
    def __init__(self, app, memory_token, bridge_token):
        self.app, self.memory_token, self.bridge_token = app, memory_token, bridge_token

    async def __call__(self, scope, receive, send):
        trace = None
        if scope["type"] == "http" and scope.get("method") == "POST" and re.fullmatch(r"/v1/default/banks/[a-z0-9-]+/(memories|reflect)", scope.get("path", "")):
            headers = scope.get("headers", [])
            values = [v for k, v in headers if k.lower() == HEADER]
            auth = [v for k, v in headers if k.lower() == b"authorization"]
            if self.memory_token and len(auth) == 1 and hmac.compare_digest(auth[0], ("Bearer " + self.memory_token).encode()) and len(values) == 1:
                candidate = values[0].decode("ascii", errors="replace")
                if valid_header(candidate, self.bridge_token):
                    trace = candidate
        handle = TRACE.set(trace)
        try:
            await self.app(scope, receive, send)
        finally:
            TRACE.reset(handle)


def install_sdk_forwarding():
    # Inspect the actual SDK-built URL. The trace cannot reach a cloud provider,
    # different path, redirect, or unrelated OpenAI client request.
    from openai._base_client import BaseClient
    original = BaseClient._build_request
    if getattr(original, "_xiangxiang_trace", False):
        return

    def build(self, *args, **kwargs):
        request = original(self, *args, **kwargs)
        url = urlsplit(str(request.url))
        if url.scheme == "http" and url.hostname == "127.0.0.1" and url.port in {8091, 8094} and url.path == "/v1/chat/completions" and not url.query and not url.username:
            request.headers.pop(HEADER.decode(), None)
            if TRACE.get():
                request.headers[HEADER.decode()] = TRACE.get()
        return request
    build._xiangxiang_trace = True
    BaseClient._build_request = build


def main():
    import hindsight_api.main as runtime
    install_sdk_forwarding()
    original = runtime.create_app

    def create_app(*args, **kwargs):
        app = original(*args, **kwargs)
        app.add_middleware(WorkTraceMiddleware, memory_token=os.environ.get("HINDSIGHT_API_TENANT_API_KEY", ""), bridge_token=os.environ.get("HINDSIGHT_API_LLM_API_KEY", ""))
        return app
    runtime.create_app = create_app
    runtime.main()


if __name__ == "__main__":
    main()
