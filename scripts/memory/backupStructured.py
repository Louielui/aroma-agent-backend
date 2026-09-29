"""Consistent logical backup plus isolated restore verification. Never restores over live data."""
import asyncio
import hashlib
import json
import pathlib
import sys
import asyncpg
from structured import connect, encode

TABLES = ("records", "audit", "principals", "access_audit")


async def backup(destination):
    db = await connect()
    try:
        async with db.transaction(isolation="repeatable_read", readonly=True):
            data = {t: [dict(r) for r in await db.fetch("SELECT * FROM memory." + t + " ORDER BY " + ("id" if t == "principals" else "sequence"))] for t in TABLES}
        snapshot = {"format": 1, "database": "xiangxiang_memory_core", "tables": data}
        envelope = {"sha256": hashlib.sha256(encode(snapshot).encode()).hexdigest(), "snapshot": snapshot}
        target = pathlib.Path(destination).resolve()
        if target.exists():
            raise ValueError("destination_exists")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(encode(envelope), encoding="utf-8")
        return {"state": "saved", "sha256": envelope["sha256"], "counts": {t: len(data[t]) for t in TABLES}}
    finally:
        await db.close()


async def verify_restore(source):
    envelope = json.loads(pathlib.Path(source).read_text(encoding="utf-8"))
    snapshot = envelope["snapshot"]
    assert snapshot["format"] == 1 and snapshot["database"] == "xiangxiang_memory_core"
    assert hashlib.sha256(encode(snapshot).encode()).hexdigest() == envelope["sha256"]
    root = pathlib.Path("C:/Aroma/hindsight-runtime")
    private = json.loads((root / "local-config.json").read_text())
    meta = json.loads(pathlib.Path("C:/Users/louis/.pg0/instances/xiangxiang-memory/instance.json").read_text())
    options = dict(host="127.0.0.1", port=int(meta["port"]), user="hindsight", password=private["dbPassword"])
    name = "xiangxiang_restore_" + envelope["sha256"][:12]
    admin = await asyncpg.connect(database="hindsight", **options)
    try:
        # Existing verification databases are reused read-only, never dropped.
        exists = await admin.fetchval("SELECT 1 FROM pg_database WHERE datname=$1", name)
        if not exists:
            await admin.execute('CREATE DATABASE "' + name + '"')
        db = await asyncpg.connect(database=name, **options)
        try:
            if not exists:
                async with db.transaction():
                    await db.execute("CREATE SCHEMA memory")
                    await db.execute("""
                      CREATE TABLE memory.records(sequence bigserial UNIQUE,id text PRIMARY KEY,version integer NOT NULL,body jsonb NOT NULL);
                      CREATE TABLE memory.audit(sequence bigserial PRIMARY KEY,record_id text NOT NULL,body jsonb NOT NULL,previous_hash text,hash text NOT NULL);
                      CREATE TABLE memory.principals(id text PRIMARY KEY,body jsonb NOT NULL);
                      CREATE TABLE memory.access_audit(sequence bigserial PRIMARY KEY,body jsonb NOT NULL);
                      CREATE UNIQUE INDEX active_decision ON memory.records((body->>'scope'),(body->>'subject'))
                        WHERE body->>'type'='decision' AND body->>'status'='active';
                    """)
                    columns = {"records": ["sequence", "id", "version", "body"], "audit": ["sequence", "record_id", "body", "previous_hash", "hash"],
                               "principals": ["id", "body"], "access_audit": ["sequence", "body"]}
                    for table in TABLES:
                        names = columns[table]
                        for row in snapshot["tables"][table]:
                            await db.execute("INSERT INTO memory." + table + "(" + ",".join(names) + ") VALUES(" + ",".join("$" + str(i+1) for i in range(len(names))) + ")", *[row[n] for n in names])
                        if table != "principals":
                            await db.execute("SELECT setval(pg_get_serial_sequence('memory." + table + "','sequence'),COALESCE(MAX(sequence),1),MAX(sequence) IS NOT NULL) FROM memory." + table)
            for table in TABLES:
                restored = [dict(r) for r in await db.fetch("SELECT * FROM memory." + table + " ORDER BY " + ("id" if table == "principals" else "sequence"))]
                assert restored == snapshot["tables"][table]
            return {"state": "verified", "database": name, "sha256": envelope["sha256"], "tables": len(TABLES)}
        finally:
            await db.close()
    finally:
        await admin.close()


async def backup_and_verify(destination):
    saved = await backup(destination)
    proof = await verify_restore(destination)
    return {"saved": saved, "restored": proof, "path": str(pathlib.Path(destination).resolve())}


if __name__ == "__main__":
    try:
        if len(sys.argv) != 3 or sys.argv[1] not in ("backup", "verify-restore", "backup-and-verify"):
            raise ValueError("invalid_command")
        command = {"backup": backup, "verify-restore": verify_restore, "backup-and-verify": backup_and_verify}[sys.argv[1]]
        print(encode(asyncio.run(command(sys.argv[2]))))
    except Exception:
        print(encode({"error": "backup_or_restore_unconfirmed"}))
        sys.exit(1)
