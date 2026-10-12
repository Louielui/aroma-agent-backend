"""Injected read-only tests. No private config, sockets, mutations or models."""
import asyncio
import json
from generalRows import general_page

class Database:
    def __init__(self):
        self.rows = [{"sequence": n, "body": json.dumps({"id": str(n), "text": "原文 😀 " * 12,
            "source": {"kind": "conversation" if n % 2 else "admin_mail_message"}}, ensure_ascii=False)} for n in range(1, 10)]
        self.calls = []
    async def fetchval(self, sql):
        assert sql == "SELECT COALESCE(MAX(sequence),0) FROM memory.records"
        return max(r["sequence"] for r in self.rows)
    async def fetch(self, sql, after, cutoff):
        assert "LEFT(COALESCE(body#>>'{source,kind}',''),11) <> 'admin_mail_'" in sql
        assert "sequence > $1 AND sequence <= $2" in sql and "LIMIT 2000" in sql
        self.calls.append((after, cutoff))
        return [r for r in self.rows if after < r["sequence"] <= cutoff and
            not json.loads(r["body"])["source"]["kind"].startswith("admin_mail_")][:2000]

async def main():
    db = Database()
    request = {"op": "general_page", "after": 0, "snapshotSequence": None}
    first = await general_page(db, request, max_bytes=1000)
    assert first["hasMore"] and first["snapshotSequence"] == 9
    db.rows.append({"sequence": 10, "body": db.rows[0]["body"].replace('"1"', '"new"')})
    rows, page = first["items"], first
    while page["hasMore"]:
        page = await general_page(db, {**request, "after": page["nextSequence"], "snapshotSequence": page["snapshotSequence"]}, max_bytes=1000)
        assert len(json.dumps(page, ensure_ascii=False, separators=(",", ":")).encode()) <= 1000
        rows += page["items"]
    assert [r["id"] for r in rows] == ["1", "3", "5", "7", "9"]
    assert all(r["text"] == "原文 😀 " * 12 for r in rows)
    calls = len(db.calls)
    for bad in [{**request, "after": True}, {**request, "after": 1}, {**request, "snapshotSequence": -1},
                {**request, "mailbox": "adm@example.test"}, {**request, "sql": "DELETE"}, {**request, "limit": 999999}]:
        try:
            await general_page(db, bad)
        except ValueError:
            pass
        else:
            raise AssertionError("invalid_request_accepted")
    assert len(db.calls) == calls
    try:
        await general_page(db, request, max_bytes=513)
    except ValueError:
        pass
    else:
        raise AssertionError("oversized_row_silently_dropped")
    print(json.dumps({"passed": True, "sourceIsolation": True, "fixedSnapshot": True, "byteBound": True, "unicode": True}))

asyncio.run(main())
