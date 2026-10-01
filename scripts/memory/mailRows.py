"""Source-bound, byte-bounded keyset reads. No caller-supplied SQL or mutations."""
import json
import re

KINDS = {"admin_mail_message", "admin_mail_thread"}
MAX_SAFE = 9007199254740991

async def mail_page(db, req, max_bytes=8 * 1024 * 1024):
    if set(req) != {"op", "mailbox", "kinds", "after", "snapshotSequence"} or req["op"] != "mail_page":
        raise ValueError("invalid_operation")
    account, kinds = req["mailbox"], req["kinds"]
    if not isinstance(account, str) or len(account) > 254 or not re.fullmatch(r"[a-z0-9.!#$%&'*+_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}", account, re.I):
        raise ValueError("invalid_operation")
    if not isinstance(kinds, list) or not kinds or any(not isinstance(k, str) or k not in KINDS for k in kinds) or len(set(kinds)) != len(kinds):
        raise ValueError("invalid_operation")
    after, cutoff = req["after"], req["snapshotSequence"]
    valid = lambda n: isinstance(n, int) and not isinstance(n, bool) and 0 <= n <= MAX_SAFE
    if not valid(after) or (cutoff is not None and (not valid(cutoff) or cutoff < after)):
        raise ValueError("invalid_operation")
    if cutoff is None:
        if after:
            raise ValueError("invalid_operation")
        cutoff = await db.fetchval("SELECT COALESCE(MAX(sequence),0) FROM memory.records")
    rows = await db.fetch("""SELECT sequence,body FROM memory.records
      WHERE body#>>'{details,mailbox}'=$1 AND body#>>'{source,kind}'=ANY($2::text[])
        AND sequence > $3 AND sequence <= $4 ORDER BY sequence LIMIT 2000""", account, kinds, after, cutoff)
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
