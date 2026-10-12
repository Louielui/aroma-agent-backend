"""General-memory keyset reads excluding mail before transport. Read-only SQL."""
import json

MAX_SAFE = 9007199254740991

async def general_page(db, req, max_bytes=8 * 1024 * 1024):
    if not isinstance(req, dict) or set(req) != {"op", "after", "snapshotSequence"} or req["op"] != "general_page":
        raise ValueError("invalid_operation")
    after, cutoff = req["after"], req["snapshotSequence"]
    valid = lambda n: isinstance(n, int) and not isinstance(n, bool) and 0 <= n <= MAX_SAFE
    if not valid(after) or (cutoff is not None and (not valid(cutoff) or cutoff < after)) or (cutoff is None and after):
        raise ValueError("invalid_operation")
    if cutoff is None:
        cutoff = await db.fetchval("SELECT COALESCE(MAX(sequence),0) FROM memory.records")
    rows = await db.fetch("""SELECT sequence,body FROM memory.records
      WHERE LEFT(COALESCE(body#>>'{source,kind}',''),11) <> 'admin_mail_'
        AND sequence > $1 AND sequence <= $2 ORDER BY sequence LIMIT 2000""", after, cutoff)
    items, used, cursor = [], 512, after
    for row in rows:
        value = json.loads(row["body"])
        size = len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) + 1
        if used + size > max_bytes:
            if not items:
                raise ValueError("source_row_too_large")
            break
        items.append(value)
        used += size
        cursor = row["sequence"]
    return {"items": items, "nextSequence": cursor, "snapshotSequence": cutoff,
            "hasMore": len(items) < len(rows) or len(rows) == 2000}
