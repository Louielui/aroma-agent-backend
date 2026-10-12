"""Pure snapshot policy checks. Restoration rejection must happen before any DB connection."""
import asyncio
import hashlib
import json
import pathlib
import sys
import backupStructured as backup


def fixture(values):
    records = []
    audit = []
    for sequence, value in enumerate(values, 1):
        body = {"id": "synthetic-" + str(sequence), "version": 1, **value}
        records.append({"sequence": sequence, "id": body["id"], "version": 1, "body": backup.encode(body)})
        event = {"recordId": body["id"], "version": 1, "snapshot": body}
        audit.append({"sequence": sequence, "record_id": body["id"], "body": backup.encode(event), "previous_hash": None,
                      "hash": hashlib.sha256(backup.encode(event).encode()).hexdigest()})
    return {"format": 1, "database": "xiangxiang_memory_core", "tables": {"records": records, "audit": audit, "principals": [], "access_audit": []}}


def record(kind="preference", status="active", scope="private:owner", subject="Synthetic current subject"):
    return {"type": kind, "status": status, "scope": scope, "subject": subject, "text": "Synthetic non-business acceptance only"}


def reject(snapshot):
    try:
        backup.validate_snapshot(snapshot)
    except ValueError as error:
        assert str(error) == "backup_snapshot_invalid"
    else:
        raise AssertionError("contradictory_current_memories_accepted")


for kind in ("decision", "preference"):
    reject(fixture([record(kind), record(kind)]))

invalid_snapshots = [fixture([record(), record()])]
missing = object()
malformed_keys = 0
for kind in ("decision", "preference"):
    for key in ("scope", "subject"):
        for value in (missing, None, 1, 1.5, True, [], {}, "", "   ", "\n\t"):
            item = record(kind)
            if value is missing:
                item.pop(key)
            else:
                item[key] = value
            snapshot = fixture([item])
            reject(snapshot)
            invalid_snapshots.append(snapshot)
            malformed_keys += 1
            # Historical records retain their original fields without promotion.
            item["status"] = "archived"
            backup.validate_snapshot(fixture([item]))

# Valid original strings remain distinct exactly as PostgreSQL ->> sees them.
original_strings = fixture([record(scope="1"), record(scope=" 1 "), record(subject=" subject "), record(subject="subject")])
assert backup.validate_snapshot(original_strings) is original_strings

allowed = fixture([record(), record(status="candidate"), record(status="superseded"), record(status="archived"),
                   record(scope="domain:development"), record(subject="Synthetic different subject"), record(kind="decision"),
                   record(kind="episodic"), record(kind="episodic")])
backup.validate_snapshot(allowed)

source = pathlib.Path(sys.argv[1])
connections = 0


async def forbidden_connection(*args, **kwargs):
    global connections
    connections += 1
    raise AssertionError("invalid_snapshot_reached_database")


backup.asyncpg.connect = forbidden_connection
for snapshot in invalid_snapshots:
    source.write_text(backup.encode({"snapshot": snapshot, "sha256": hashlib.sha256(backup.encode(snapshot).encode()).hexdigest()}), encoding="utf-8")
    try:
        asyncio.run(backup.verify_restore(source))
    except ValueError as error:
        assert str(error) == "backup_snapshot_invalid"
    else:
        raise AssertionError("invalid_snapshot_restored")
assert connections == 0
print(json.dumps({"duplicateDecision": "rejected", "duplicatePreference": "rejected", "distinctCurrentAndHistory": "accepted", "malformedActiveKeys": malformed_keys, "restoreConnections": connections}))
