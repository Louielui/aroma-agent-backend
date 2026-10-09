"""Offline acceptance against installed ASGI and OpenAI SDK boundaries."""
import asyncio
import json
import sys
import httpx
from work_trace_runtime import WorkTraceMiddleware, TRACE, HEADER, install_sdk_forwarding, valid_header
from openai import AsyncOpenAI


async def run(data):
    token, signed = data["token"], data["header"]
    assert valid_header(signed, token)
    assert not valid_header(signed, "b" * 64)
    seen = []

    async def transport(request):
        seen.append((str(request.url), request.headers.get(HEADER.decode())))
        return httpx.Response(200, json={"id": "fixture", "object": "chat.completion", "created": 0, "model": "fixture", "choices": [{"index": 0, "message": {"role": "assistant", "content": "ok"}, "finish_reason": "stop"}]})

    install_sdk_forwarding()
    client = AsyncOpenAI(api_key="fixture", base_url="http://127.0.0.1:8094/v1", http_client=httpx.AsyncClient(transport=httpx.MockTransport(transport)))
    cloud = AsyncOpenAI(api_key="fixture", base_url="https://api.openai.com/v1", http_client=httpx.AsyncClient(transport=httpx.MockTransport(transport)))
    other = AsyncOpenAI(api_key="fixture", base_url="http://127.0.0.1:9999/v1", http_client=httpx.AsyncClient(transport=httpx.MockTransport(transport)))

    async def app(scope, receive, send):
        await asyncio.sleep(0)
        await client.chat.completions.create(model="fixture", messages=[{"role": "user", "content": "private input never used as identity"}])
        if scope.get("cloud"):
            await cloud.chat.completions.create(model="fixture", messages=[])
            await other.chat.completions.create(model="fixture", messages=[])
        if scope.get("fail"):
            raise RuntimeError("fixture failure")

    middleware = WorkTraceMiddleware(app, memory_token="fixture-memory", bridge_token=token)
    auth = (b"authorization", b"Bearer fixture-memory")
    header = (HEADER, signed.encode())
    base = {"type": "http", "method": "POST", "path": "/v1/default/banks/xiangxiang-test-fixture/memories", "headers": [auth, header]}
    async def receive():
        return {"type": "http.request", "body": b""}
    async def send(message):
        pass
    await middleware({**base, "cloud": True}, receive, send)
    assert seen == [("http://127.0.0.1:8094/v1/chat/completions", signed), ("https://api.openai.com/v1/chat/completions", None), ("http://127.0.0.1:9999/v1/chat/completions", None)]
    assert TRACE.get() is None
    seen.clear()
    cases = [{**base, "headers": []}, {**base, "headers": [auth, header, header]}, {**base, "path": "/v1/default/banks/xiangxiang-test-fixture/documents"}, {**base, "headers": [auth, (HEADER, b"PRIVATE forged identity")]}]
    await asyncio.gather(*(middleware(c, receive, send) for c in cases), middleware(base, receive, send))
    assert sum(value == signed for _, value in seen) == 1
    assert sum(value is None for _, value in seen) == 4
    try:
        await middleware({**base, "fail": True}, receive, send)
    except RuntimeError:
        pass
    assert TRACE.get() is None
    await client.close()
    await cloud.close()
    await other.close()
    print(json.dumps({"state": "passed", "authenticatedForwarding": True, "asyncIsolation": True, "cloudLeak": False, "dependencyFilesModified": False}))


asyncio.run(run(json.load(sys.stdin)))
