"""Idempotent local-only provisioning. Reuses pg0, never the restaurant database."""
import asyncio
import json
import pathlib
import secrets
import asyncpg


async def main():
    root = pathlib.Path("C:/Aroma/hindsight-runtime")
    private = json.loads((root / "local-config.json").read_text())
    meta = json.loads(pathlib.Path("C:/Users/louis/.pg0/instances/xiangxiang-memory/instance.json").read_text())
    assert meta["database"] == "hindsight"
    cfg_path = root / "gateway-config.json"
    if cfg_path.exists():
        cfg = json.loads(cfg_path.read_text())
    else:
        cfg = {"password": secrets.token_hex(32)}
        with cfg_path.open("x", encoding="utf-8") as file:
            json.dump(cfg, file)
    assert len(cfg["password"]) == 64 and all(c in "0123456789abcdef" for c in cfg["password"])
    options = dict(host="127.0.0.1", port=int(meta["port"]), user="hindsight", password=private["dbPassword"])
    db = await asyncpg.connect(database="hindsight", **options)
    try:
        if not await db.fetchval("SELECT 1 FROM pg_roles WHERE rolname='xiangxiang_gateway'"):
            await db.execute("CREATE ROLE xiangxiang_gateway LOGIN PASSWORD '" + cfg["password"] + "' NOSUPERUSER NOCREATEDB NOCREATEROLE")
        if not await db.fetchval("SELECT 1 FROM pg_database WHERE datname='xiangxiang_memory_core'"):
            await db.execute("CREATE DATABASE xiangxiang_memory_core OWNER xiangxiang_gateway")
    finally:
        await db.close()
    db = await asyncpg.connect(database="xiangxiang_memory_core", **options)
    try:
        await db.execute("""
          CREATE EXTENSION IF NOT EXISTS vector;
          CREATE SCHEMA IF NOT EXISTS memory AUTHORIZATION xiangxiang_gateway;
          SET ROLE xiangxiang_gateway;
          CREATE TABLE IF NOT EXISTS memory.records(
            sequence bigserial UNIQUE, id text PRIMARY KEY, version integer NOT NULL CHECK(version>0), body jsonb NOT NULL);
          CREATE UNIQUE INDEX IF NOT EXISTS active_decision ON memory.records((body->>'scope'),(body->>'subject'))
            WHERE body->>'type'='decision' AND body->>'status'='active';
          CREATE INDEX IF NOT EXISTS memory_scope ON memory.records((body->>'scope'));
          CREATE INDEX IF NOT EXISTS memory_text ON memory.records USING gin(to_tsvector('simple',body->>'text'));
          CREATE TABLE IF NOT EXISTS memory.audit(
            sequence bigserial PRIMARY KEY, record_id text NOT NULL, body jsonb NOT NULL, previous_hash text, hash text NOT NULL);
          CREATE TABLE IF NOT EXISTS memory.principals(id text PRIMARY KEY, body jsonb NOT NULL);
          CREATE TABLE IF NOT EXISTS memory.access_audit(sequence bigserial PRIMARY KEY, body jsonb NOT NULL);
        """)
        print(json.dumps({"database": "xiangxiang_memory_core", "state": "ready", "role": "xiangxiang_gateway"}))
    finally:
        await db.close()


if __name__ == "__main__":
    asyncio.run(main())
