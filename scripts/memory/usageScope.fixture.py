"""Offline installed SDK forwarding; no external provider or real model."""
import asyncio
import json
import sys
import httpx
from openai import AsyncOpenAI
from work_trace_runtime import WorkTraceMiddleware, USAGE_HEADER, USAGE, valid_usage, install_sdk_forwarding


async def run(data):
    token, signed = data["token"], data["header"]
    assert valid_usage(signed, token)
    assert not valid_usage(signed + "0", token)
    assert not valid_usage(signed, "b" * 64)
    seen = []
    async def transport(request):
        seen.append((str(request.url), request.headers.get(USAGE_HEADER.decode())))
        return httpx.Response(200, json={"id":"offline", "object":"chat.completion", "created":0, "model":"fixture", "choices":[{"index":0,"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}]})
    install_sdk_forwarding()
    def client(url):
        return AsyncOpenAI(api_key="fixture", base_url=url, default_headers={USAGE_HEADER.decode(): signed}, http_client=httpx.AsyncClient(transport=httpx.MockTransport(transport)))
    local, cloud, other = client("http://127.0.0.1:8094/v1"), client("https://api.openai.com/v1"), client("http://127.0.0.1:9999/v1")
    async def app(scope, receive, send):
        await asyncio.sleep(0)
        await local.chat.completions.create(model="fixture", messages=[])
        if scope.get("destinations"):
            await cloud.chat.completions.create(model="fixture", messages=[])
            await other.chat.completions.create(model="fixture", messages=[])
        if scope.get("fail"):
            raise RuntimeError("offline_failure")
    middleware = WorkTraceMiddleware(app, "fixture-memory", token)
    auth = (b"authorization", b"Bearer fixture-memory")
    header = (USAGE_HEADER, signed.encode())
    base = {"type":"http", "method":"POST", "path":"/v1/default/banks/xiangxiang-test/reflect", "headers":[auth,header]}
    async def receive(): return {"type":"http.request", "body":b""}
    async def send(message): pass
    await middleware({**base,"destinations":True},receive,send)
    assert [v for _,v in seen] == [signed,None,None]
    seen.clear()
    cases = [{**base,"headers":[]},{**base,"headers":[auth,header,header]},{**base,"headers":[auth,(USAGE_HEADER,b"forged")]},{**base,"path":"/v1/default/banks/xiangxiang-test/documents"}]
    await asyncio.gather(*(middleware(c,receive,send) for c in cases), middleware(base,receive,send))
    assert sum(v == signed for _,v in seen) == 1
    assert sum(v is None for _,v in seen) == 4
    try: await middleware({**base,"fail":True},receive,send)
    except RuntimeError: pass
    assert USAGE.get() is None
    for c in [local,cloud,other]: await c.close()
    print(json.dumps({"state":"passed","authenticatedForwarding":True,"asyncIsolation":True,"cloudLeak":False}))


asyncio.run(run(json.load(sys.stdin)))
