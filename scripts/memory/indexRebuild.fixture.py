"""Injected transaction tests. No private config, asyncpg, sockets or model calls."""
import asyncio
import copy
import json
from indexRebuild import queue_index


class Transaction:
    def __init__(self, db):
        self.db = db

    async def __aenter__(self):
        self.saved = copy.deepcopy((self.db.rows, self.db.events))

    async def __aexit__(self, kind, value, trace):
        if kind:
            self.db.rows, self.db.events = self.saved


class Database:
    def __init__(self, rows):
        self.rows = copy.deepcopy(rows)
        self.events = []
        self.fail = False

    def transaction(self):
        return Transaction(self)

    async def fetch(self, sql, scope):
        assert "WHERE body->>'status'='active'" in sql
        assert "FOR UPDATE" in sql
        assert "$1::text" in sql
        return [{"body": json.dumps(r)} for r in self.rows.values() if r["status"] == "active" and (not scope or r["scope"] == scope)]

    async def fetchval(self, sql, record_id):
        assert "memory.audit" in sql
        return "prior-hash"

    async def execute(self, sql, *args):
        if sql.startswith("SELECT pg_advisory_xact_lock"):
            return
        if sql.startswith("UPDATE memory.records"):
            self.rows[args[0]] = json.loads(args[2])
        elif sql.startswith("INSERT INTO memory.audit"):
            if self.fail:
                raise RuntimeError("injected_transaction_failure")
            self.events.append({"body": json.loads(args[1]), "previous": args[2], "hash": args[3]})
        else:
            raise AssertionError("unexpected_sql")


async def main():
    at = "2026-10-01T07:17:00.000Z"
    row = {"id": "xx-test", "status": "active", "scope": "private:owner", "source": {"kind": "conversation"},
           "text": "保留中文原文及已確認決定。", "version": 3, "approval": {"kind": "owner", "actor": "owner"},
           "index": {"state": "saved", "facts": 3}, "expiresAt": None}
    rows = {"xx-test": row}
    for key, changes in [
        ("mail", {"source": {"kind": "admin_mail_message"}}), ("expired", {"expiresAt": "2020-01-01T00:00:00.000Z"}),
        ("candidate", {"status": "candidate"}), ("archived", {"status": "archived"}), ("other-scope", {"scope": "domain:hr"}),
        ("short", {"text": "好"}), ("astral", {"text": "😀" * 17000})
    ]:
        rows[key] = {**copy.deepcopy(row), "id": key, **changes}
    request = {"op": "queue_index", "id": "12345678-1234-4234-8234-123456789012", "at": at, "scope": "private:owner"}
    db = Database(rows)
    result = await queue_index(db, request)
    assert result["queued"] == 1 and result["sourceOnly"] == 2
    assert db.rows["xx-test"]["text"] == row["text"] and db.rows["xx-test"]["approval"] == row["approval"]
    assert db.rows["xx-test"]["version"] == 4 and db.rows["xx-test"]["index"]["state"] == "pending"
    assert db.rows["short"]["index"]["reason"] == "text_too_short"
    assert db.rows["astral"]["index"]["reason"] == "text_too_long"
    for key in ["mail", "expired", "candidate", "archived", "other-scope"]:
        assert db.rows[key] == rows[key]
    assert len(db.events) == 3
    for event in db.events:
        assert event["body"]["actor"] == "owner" and event["body"]["at"] == at
        assert event["previous"] == "prior-hash" and len(event["hash"]) == 64
    failing = Database(rows)
    failing.fail = True
    try:
        await queue_index(failing, request)
    except RuntimeError:
        pass
    else:
        raise AssertionError("failure_not_injected")
    assert failing.rows == rows and failing.events == []
    for bad in [{**request, "actor": "agent"}, {**request, "at": "invented"}, {**request, "scope": "scope'; DROP DATABASE"}]:
        try:
            await queue_index(db, bad)
        except ValueError:
            pass
        else:
            raise AssertionError("invalid_request_accepted")
    print(json.dumps({"passed": True, "queued": result["queued"], "sourceOnly": result["sourceOnly"], "unicode": db.rows["xx-test"]["text"]}, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
