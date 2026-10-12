"""Atomic metadata-only rebuild queue. Never deletes index or canonical source data."""
import hashlib
import json
import re


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


async def queue_index(db, request):
    if set(request) != {"op", "id", "at", "scope"}:
        raise ValueError("invalid_operation")
    job = request["id"]
    at = request["at"]
    scope = request["scope"]
    if not isinstance(job, str) or not re.fullmatch(r"[a-f0-9-]{36}", job):
        raise ValueError("invalid_operation")
    if not isinstance(at, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", at):
        raise ValueError("invalid_operation")
    if scope is not None and (not isinstance(scope, str) or not re.fullmatch(r"(?:global|company|domain|agent|private):[a-z0-9-]{1,50}", scope)):
        raise ValueError("invalid_operation")
    queued = 0
    source_only = 0
    async with db.transaction():
        await db.execute("SELECT pg_advisory_xact_lock(61920260929)")
        records = await db.fetch("SELECT body FROM memory.records WHERE body->>'status'='active' AND ($1::text IS NULL OR body->>'scope'=$1) ORDER BY sequence FOR UPDATE", scope)
        for record in records:
            row = json.loads(record["body"])
            if row["source"]["kind"].startswith("admin_mail_") or (row.get("expiresAt") and row["expiresAt"] <= at):
                continue
            value = row["text"]
            length = len(value.encode("utf-16-le")) // 2
            reason = "text_too_short" if len(value.strip().encode("utf-16-le")) // 2 <= 1 else "text_too_long" if length > 32000 else None
            row["index"] = {"state": "source_only" if reason else "pending", "attempts": 0, "facts": None, "reason": reason,
                            "checkedAt": at if reason else None, "nextRetryAt": None, "rebuildId": job, "queuedAt": at}
            row["version"] += 1
            row["updatedAt"] = at
            await db.execute("UPDATE memory.records SET version=$2,body=$3::jsonb WHERE id=$1", row["id"], row["version"], encode(row))
            previous = await db.fetchval("SELECT hash FROM memory.audit WHERE record_id=$1 ORDER BY sequence DESC LIMIT 1", row["id"])
            event = {"op": "index_rebuild_queued", "actor": "owner", "at": at, "rebuildId": job,
                     "recordId": row["id"], "version": row["version"], "snapshot": row}
            digest = hashlib.sha256(((previous or "") + encode(event)).encode()).hexdigest()
            await db.execute("INSERT INTO memory.audit(record_id,body,previous_hash,hash) VALUES($1,$2::jsonb,$3,$4)", row["id"], encode(event), previous, digest)
            if reason:
                source_only += 1
            else:
                queued += 1
    return {"id": job, "queued": queued, "sourceOnly": source_only, "scope": scope}
