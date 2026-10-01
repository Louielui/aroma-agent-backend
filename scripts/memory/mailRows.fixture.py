"""Injected source paging tests: no private config, sockets, writes or models."""
import asyncio
import copy
import json
from mailRows import mail_page

class Database:
    def __init__(self):
        self.rows = [{"sequence":n,"body":json.dumps({"id":str(n),"text":"原文 😀 " * 12,
          "source":{"kind":"admin_mail_message"},"details":{"mailbox":"adm@example.test"}},ensure_ascii=False)} for n in range(1,10)]
        self.calls = []
    async def fetchval(self, sql):
        assert sql == "SELECT COALESCE(MAX(sequence),0) FROM memory.records"
        return max(r["sequence"] for r in self.rows)
    async def fetch(self, sql, account, kinds, after, cutoff):
        assert "body#>>'{details,mailbox}'=$1" in sql and "=ANY($2::text[])" in sql
        assert "sequence > $3 AND sequence <= $4" in sql and "LIMIT 2000" in sql
        self.calls.append((account,copy.deepcopy(kinds),after,cutoff))
        return [r for r in self.rows if after < r["sequence"] <= cutoff and
          json.loads(r["body"])["details"]["mailbox"] == account and json.loads(r["body"])["source"]["kind"] in kinds][:2000]

async def main():
    db=Database()
    request={"op":"mail_page","mailbox":"adm@example.test","kinds":["admin_mail_message","admin_mail_thread"],"after":0,"snapshotSequence":None}
    first=await mail_page(db,request,max_bytes=1800)
    assert first["hasMore"] and first["snapshotSequence"] == 9
    db.rows.append({"sequence":10,"body":db.rows[0]["body"].replace('"1"','"new"')})
    results=first["items"]
    page=first
    while page["hasMore"]:
        page=await mail_page(db,{**request,"after":page["nextSequence"],"snapshotSequence":page["snapshotSequence"]},max_bytes=1800)
        assert len(json.dumps(page,ensure_ascii=False,separators=(",", ":")).encode()) <= 1800
        results += page["items"]
    assert [r["id"] for r in results] == [str(n) for n in range(1,10)]
    assert all(r["text"] == "原文 😀 " * 12 for r in results)
    assert not (await mail_page(db,{**request,"mailbox":"ivy@example.test"}))["items"]
    assert not (await mail_page(db,{**request,"kinds":["admin_mail_thread"]}))["items"]
    before=len(db.calls)
    for bad in [{**request,"kinds":["conversation"]},{**request,"after":True},{**request,"after":1},
      {**request,"snapshotSequence":-1},{**request,"mailbox":"bad' OR 1=1"},{**request,"limit":999999}]:
        try:
            await mail_page(db,bad)
        except ValueError:
            pass
        else:
            raise AssertionError("invalid_request_accepted")
    assert len(db.calls) == before
    try:
        await mail_page(db,request,max_bytes=513)
    except ValueError:
        pass
    else:
        raise AssertionError("oversized_row_silently_dropped")
    print(json.dumps({"passed":True,"sourceIsolation":True,"fixedSnapshot":True,"byteBound":True,"unicode":True}))

asyncio.run(main())
