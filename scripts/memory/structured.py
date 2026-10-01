"""Private local PostgreSQL transport. JSON stdin/stdout; no SQL supplied by callers."""
import asyncio
import hashlib
import json
import pathlib
import sys
import asyncpg

ROOT = pathlib.Path("C:/Aroma/hindsight-runtime")
DB = "xiangxiang_memory_core"
ROLE = "xiangxiang_gateway"
CONFIG = ROOT / "gateway-config.json"


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


async def connect():
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    meta = json.loads(pathlib.Path("C:/Users/louis/.pg0/instances/xiangxiang-memory/instance.json").read_text())
    return await asyncpg.connect(host="127.0.0.1", port=int(meta["port"]), database=DB,
                                user=ROLE, password=cfg["password"], timeout=5)


async def main(req):
    db = await connect()
    try:
        op = req.get("op")
        if op == "health":
            version = await db.fetchval("SELECT extversion FROM pg_extension WHERE extname='vector'")
            return {"state": "connected", "database": DB, "vector": bool(version)}
        if op == "queue_index":
            from indexRebuild import queue_index
            return await queue_index(db, req)
        if op == "get":
            value = await db.fetchval("SELECT body FROM memory.records WHERE id=$1", req["id"])
            return json.loads(value) if value else None
        if op == "all":
            rows = await db.fetch("SELECT body FROM memory.records ORDER BY sequence LIMIT 200 OFFSET $1", max(0, int(req.get("offset", 0))))
            return [json.loads(r["body"]) for r in rows]
        if op == "audit":
            rows = await db.fetch("SELECT body, previous_hash, hash FROM memory.audit WHERE record_id=$1 ORDER BY sequence", req["id"])
            return [{**json.loads(r["body"]), "previousHash": r["previous_hash"], "hash": r["hash"]} for r in rows]
        if op == "grants":
            rows = await db.fetch("SELECT body FROM memory.principals ORDER BY id")
            return [json.loads(r["body"]) for r in rows]
        if op == "grant":
            g = req["value"]
            async with db.transaction():
                await db.execute("INSERT INTO memory.principals(id,body) VALUES($1,$2::jsonb) ON CONFLICT(id) DO UPDATE SET body=excluded.body", g["id"], encode(g))
                await db.execute("INSERT INTO memory.access_audit(body) VALUES($1::jsonb)", encode({"op": "grant", "id": g["id"], "scopes": g["scopes"], "writeScopes": g["writeScopes"], "at": g["updatedAt"], "actor": "owner"}))
            return g
        if op == "commit":
            async with db.transaction():
                # Serializes transactions across processes, including first revisions.
                await db.execute("SELECT pg_advisory_xact_lock(61920260929)")
                for c in req["changes"]:
                    old = await db.fetchval("SELECT version FROM memory.records WHERE id=$1", c["row"]["id"])
                    if (old or 0) != c["expected"]:
                        raise ValueError("revision_conflict")
                for c in req["changes"]:
                    row = c["row"]
                    await db.execute("INSERT INTO memory.records(id,version,body) VALUES($1,$2,$3::jsonb) ON CONFLICT(id) DO UPDATE SET version=excluded.version,body=excluded.body", row["id"], row["version"], encode(row))
                    previous = await db.fetchval("SELECT hash FROM memory.audit WHERE record_id=$1 ORDER BY sequence DESC LIMIT 1", row["id"])
                    event = {**req["event"], "recordId": row["id"], "version": row["version"], "snapshot": row}
                    digest = hashlib.sha256(((previous or "") + encode(event)).encode()).hexdigest()
                    await db.execute("INSERT INTO memory.audit(record_id,body,previous_hash,hash) VALUES($1,$2::jsonb,$3,$4)", row["id"], encode(event), previous, digest)
                # Under the transaction-wide lock, preferences have one current
                # value per subject just like decisions. A correction replaces it.
                duplicate = await db.fetchval("SELECT EXISTS (SELECT 1 FROM memory.records WHERE body->>'status'='active' AND body->>'type' IN ('decision','preference') GROUP BY body->>'type', body->>'scope', body->>'subject' HAVING COUNT(*) > 1)")
                if duplicate:
                    raise ValueError("decision_conflict")
            return [c["row"] for c in req["changes"]]
        raise ValueError("invalid_operation")
    finally:
        await db.close()


if __name__ == "__main__":
    try:
        request = json.loads(sys.stdin.buffer.read(4000000).decode("utf-8"))
        result = asyncio.run(main(request))
        print(encode({"result": result}))
    except (asyncpg.UniqueViolationError, asyncpg.CheckViolationError):
        print(encode({"error": "decision_conflict"}))
    except Exception as err:
        code = str(err) if isinstance(err, ValueError) and str(err) in ("revision_conflict", "invalid_operation", "decision_conflict") else "memory_database_unavailable"
        print(encode({"error": code}))
