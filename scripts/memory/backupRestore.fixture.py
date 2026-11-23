"""Synthetic restore performance and evidence regressions."""
import asyncio
import hashlib
import json
import pathlib
import sys
import threading
import time
from collections import Counter

import backupRecovery as recovery
from backupStructured import TABLES, insert_restore_rows

root = pathlib.Path(sys.argv[1])
data = root / "source"
for directory in ("local-brain", "conversations"):
    (data / directory).mkdir(parents=True, exist_ok=True)
    for index in range(20):
        (data / directory / f"{index}.json").write_text(recovery.encode({"value": index}), encoding="utf-8")
snapshot = {"format": 1, "database": "xiangxiang_memory_core",
            "tables": {name: [] for name in ("records", "audit", "principals", "access_audit")}}
snapshot_file = root / "snapshot.json"
snapshot_file.write_text(recovery.encode({"snapshot": snapshot, "sha256": hashlib.sha256(
    recovery.encode(snapshot).encode()).hexdigest()}), encoding="utf-8")
bundle = root / "bundle"
staged = recovery.stage_recovery(bundle, data)
sealed = recovery.finish_recovery(staged, snapshot_file)
manifest_path = bundle / "manifest.json"
original_manifest = manifest_path.read_bytes()
assert sealed["manifestFileSha256"] == hashlib.sha256(original_manifest).hexdigest()
entries = staged["manifest"]["files"]
assert len(entries) == 40

original_read = pathlib.Path.read_bytes
original_mkdir = pathlib.Path.mkdir
original_private = recovery.private_directory
original_write = recovery.write_new
dest = root / "restored"
copies = 0
active = 0
peak = 0
readback = Counter()
parents = Counter()
mutex = threading.Lock()


def measured_read(file):
    global active, peak, copies
    if file.is_relative_to(dest / "data"):
        with mutex:
            readback[file.relative_to(dest / "data").as_posix()] += 1
    if file.parent != bundle / "objects" or not dest.exists():
        return original_read(file)
    with mutex:
        active += 1
        peak = max(peak, active)
        copies += 1
    try:
        time.sleep(0.004)
        return original_read(file)
    finally:
        with mutex:
            active -= 1


def measured_mkdir(file, *args, **kwargs):
    if file.is_relative_to(dest / "data"):
        parents[file.relative_to(dest).as_posix()] += 1
    return original_mkdir(file, *args, **kwargs)


pathlib.Path.read_bytes = measured_read
pathlib.Path.mkdir = measured_mkdir
try:
    result = recovery.restore_files(bundle, dest)
finally:
    pathlib.Path.read_bytes = original_read
    pathlib.Path.mkdir = original_mkdir
assert 1 < peak <= 8 and active == 0, ("serialized_source_reads", peak)
assert copies == len(entries)
assert readback == {row["path"]: 1 for row in entries}
assert parents == {"data": 1, "data/local-brain": 1, "data/conversations": 1}
assert result["state"] == "isolated_files_restored" and result["files"] == len(entries)
assert (dest / "canonical.json").read_bytes() == (bundle / "canonical.json").read_bytes()
for row in entries:
    content = (dest / "data" / row["path"]).read_bytes()
    assert len(content) == row["bytes"] and hashlib.sha256(content).hexdigest() == row["sha256"]

# Change an archived object after initial verification, while the restore
# root is being created. The archive must be checked at copy time as well.
first = bundle / "objects" / entries[0]["sha256"]
original_object = first.read_bytes()


def change_object(directory):
    original_private(directory)
    first.write_bytes(b"changed after verification")


recovery.private_directory = change_object
try:
    recovery.restore_files(bundle, root / "object-drift")
except ValueError as error:
    assert str(error) == "recovery_hash_mismatch"
else:
    raise AssertionError("changed source received a successful receipt")
finally:
    first.write_bytes(original_object)
    recovery.private_directory = original_private


def change_manifest(directory):
    original_private(directory)
    manifest_path.write_bytes(original_manifest + b" ")


recovery.private_directory = change_manifest
try:
    recovery.restore_files(bundle, root / "manifest-drift")
except ValueError as error:
    assert str(error) == "recovery_manifest_invalid"
else:
    raise AssertionError("changed manifest received a successful receipt")
finally:
    manifest_path.write_bytes(original_manifest)
    recovery.private_directory = original_private

late_dest = root / "late-destination-drift"


def damage_after_copy(file, content):
    if file == late_dest / "canonical.json":
        (late_dest / "data" / entries[0]["path"]).write_bytes(b"changed after copying")
    original_write(file, content)


recovery.write_new = damage_after_copy
try:
    recovery.restore_files(bundle, late_dest)
except ValueError as error:
    assert str(error) == "recovery_restore_unconfirmed"
else:
    raise AssertionError("late destination change received a successful receipt")
finally:
    recovery.write_new = original_write


restore_reads = Counter()
sealed_destination = root / "same-run"


def observe_sealed_restore(file):
    if file.parent == bundle / "objects":
        assert sealed_destination.exists(), "already_verified_archive_rescanned"
        restore_reads["archive"] += 1
    elif file.is_relative_to(sealed_destination / "data"):
        restore_reads["destination"] += 1
    return original_read(file)


pathlib.Path.read_bytes = observe_sealed_restore
try:
    same_run = recovery.restore_files(bundle, sealed_destination, verified_manifest_hash=sealed["manifestFileSha256"])
finally:
    pathlib.Path.read_bytes = original_read
assert same_run["files"] == len(entries)
assert restore_reads == {"archive": len(entries), "destination": len(entries)}


def reject_sealed_drift(hash_value, directory, expected):
    try:
        recovery.restore_files(bundle, directory, verified_manifest_hash=hash_value)
    except ValueError as error:
        assert str(error) == expected
    else:
        raise AssertionError("drift received a successful receipt")


bad_manifest_dest = root / "manifest-replaced"
manifest_value = json.loads(original_manifest)
manifest_value["manifest"]["components"]["conversations"] = "changed"
manifest_value["sha256"] = hashlib.sha256(recovery.encode(manifest_value["manifest"]).encode()).hexdigest()
manifest_path.write_text(recovery.encode(manifest_value), encoding="utf-8")
try:
    reject_sealed_drift(sealed["manifestFileSha256"], bad_manifest_dest, "recovery_manifest_invalid")
    assert not bad_manifest_dest.exists()
finally:
    manifest_path.write_bytes(original_manifest)
manifest_path.write_bytes(original_manifest + b" ")
try:
    reject_sealed_drift(sealed["manifestFileSha256"], root / "manifest-bytes-drift", "recovery_manifest_invalid")
finally:
    manifest_path.write_bytes(original_manifest)
first.write_bytes(b"changed after bundle seal")
try:
    reject_sealed_drift(sealed["manifestFileSha256"], root / "same-run-object-drift", "recovery_hash_mismatch")
finally:
    first.write_bytes(original_object)
recovery.write_new = damage_after_copy
late_dest = root / "same-run-late-drift"
try:
    reject_sealed_drift(sealed["manifestFileSha256"], late_dest, "recovery_restore_unconfirmed")
finally:
    recovery.write_new = original_write


class CapturedRestore:
    def __init__(self):
        self.calls = []

    async def executemany(self, statement, values):
        self.calls.append((statement, list(values)))


async def compare_database_batches():
    db = CapturedRestore()
    for table in TABLES:
        rows = [{"sequence": index + 1, "body": json.dumps({"value": index})} for index in range(550)]
        await insert_restore_rows(db, table, ("sequence", "body"), rows)
        batches = db.calls[-3:]
        assert [len(values) for _, values in batches] == [256, 256, 38]
        assert all(sql == f"INSERT INTO memory.{table}(sequence,body) VALUES($1,$2)" for sql, _ in batches)
        assert [value for _, values in batches for value in values] == [(r["sequence"], r["body"]) for r in rows]
    count = len(db.calls)
    await insert_restore_rows(db, "principals", ("id", "body"), [])
    assert len(db.calls) == count


async def reject_batch_failure():
    class FailingRestore(CapturedRestore):
        async def executemany(self, statement, values):
            if self.calls:
                raise ConnectionError("synthetic_restore_batch_failed")
            await super().executemany(statement, values)

    db = FailingRestore()
    try:
        await insert_restore_rows(db, "records", ("sequence",), [{"sequence": i} for i in range(600)])
    except ConnectionError as error:
        assert str(error) == "synthetic_restore_batch_failed"
        assert len(db.calls) == 1
    else:
        raise AssertionError("batch failure was lost")


asyncio.run(compare_database_batches())
asyncio.run(reject_batch_failure())

print(json.dumps({"files": result["files"], "sourceReadsParallel": True, "parentDirectoriesReused": True,
                  "everyDestinationReadBack": True, "objectDriftRejected": True, "manifestDriftRejected": True,
                  "lateDestinationDriftRejected": True}))
