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
        assert "sequence > $3 AND sequence <= $4" in sql
        limit = 10000 if 'jsonb_build_object' in sql else 2000
        assert 'LIMIT ' + str(limit) in sql
        self.calls.append((account,copy.deepcopy(kinds),after,cutoff))
        rows = [r for r in self.rows if after < r["sequence"] <= cutoff and
          json.loads(r["body"])["details"]["mailbox"] == account and json.loads(r["body"])["source"]["kind"] in kinds][:limit]
        if 'jsonb_build_object' not in sql:
            return rows
        assert "'text'" not in sql and "'{details,body}'" not in sql
        projected = []
        for r in rows:
            body = json.loads(r['body'])
            value = {k:body.get(k) for k in ['id','version','status','createdAt','expiresAt','supersededBy']}
            value['source'] = {k:body['source'].get(k) for k in ['kind','id']}
            value['index'] = {k:(body.get('index') or {}).get(k) for k in ['state','contentHash','attempts','reason','nextRetryAt']}
            value['details'] = {k:body['details'].get(k) for k in ['mailbox','hash','threadId']}
            projected.append({'sequence':r['sequence'],'body':json.dumps(value)})
        return projected

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
    metadata = await mail_page(db,{**request,'op':'mail_index_page'})
    assert len(metadata['items']) == 10
    assert all('text' not in r and 'body' not in r['details'] for r in metadata['items'])
    assert not (await mail_page(db,{**request,'op':'mail_index_page','mailbox':'ivy@example.test'}))['items']
    try:
        await mail_page(db,request,max_bytes=513)
    except ValueError:
        pass
    else:
        raise AssertionError("oversized_row_silently_dropped")
    print(json.dumps({"passed":True,"sourceIsolation":True,"fixedSnapshot":True,"byteBound":True,"unicode":True}))

asyncio.run(main())
