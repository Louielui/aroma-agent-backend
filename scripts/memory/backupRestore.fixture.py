"""Synthetic restore performance and evidence regressions."""
import hashlib
import json
import pathlib
import sys
import threading
import time
from collections import Counter

import backupRecovery as recovery

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
_, verified = recovery.finish_recovery_for_restore(staged, snapshot_file)
manifest_path = bundle / "manifest.json"
original_manifest = manifest_path.read_bytes()
entries = staged["manifest"]["files"]
assert len(entries) == 40

original_read = pathlib.Path.read_bytes
original_mkdir = pathlib.Path.mkdir
original_private = recovery.private_directory
original_write = recovery.write_new
dest = root / "restored"
copies = 0
archive_reads = 0
active = 0
peak = 0
readback = Counter()
parents = Counter()
mutex = threading.Lock()


def measured_read(file):
    global active, peak, copies, archive_reads
    if file.is_relative_to(dest / "data"):
        with mutex:
            readback[file.relative_to(dest / "data").as_posix()] += 1
    if file.parent != bundle / "objects":
        return original_read(file)
    with mutex:
        archive_reads += 1
    if not dest.exists():
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
    result = recovery.restore_verified_files(verified, dest)
finally:
    pathlib.Path.read_bytes = original_read
    pathlib.Path.mkdir = original_mkdir
assert 1 < peak <= 8 and active == 0, ("serialized_source_reads", peak)
assert copies == len(entries)
assert archive_reads == len(entries), ("redundant_source_pass", archive_reads, len(entries))
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
    recovery.restore_verified_files(verified, root / "object-drift")
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
    recovery.restore_verified_files(verified, root / "manifest-drift")
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
    recovery.restore_verified_files(verified, late_dest)
except ValueError as error:
    assert str(error) == "recovery_restore_unconfirmed"
else:
    raise AssertionError("late destination change received a successful receipt")
finally:
    recovery.write_new = original_write

before_copy = root / "pre-copy-manifest-drift"
manifest_path.write_bytes(original_manifest + b" ")
try:
    recovery.restore_verified_files(verified, before_copy)
except ValueError as error:
    assert str(error) == "recovery_manifest_invalid" and not before_copy.exists()
else:
    raise AssertionError("changed manifest accepted before copying")
finally:
    manifest_path.write_bytes(original_manifest)

integrated = root / "integrated-bundle"
integrated_dest = root / "integrated-destination"
integrated_stage = recovery.stage_recovery(integrated, data)
integrated_reads = Counter()
integrated_dest_reads = Counter()

def measured_integrated_read(file):
    with mutex:
        if file.parent == integrated / "objects":
            integrated_reads[file.name] += 1
        if file.is_relative_to(integrated_dest / "data"):
            integrated_dest_reads[file.relative_to(integrated_dest / "data").as_posix()] += 1
    return original_read(file)

original_pool = recovery.ThreadPoolExecutor
restore_submissions = []
restore_workers = []


class MeasuringPool(original_pool):
    def __init__(self, max_workers):
        restore_workers.append(max_workers)
        super().__init__(max_workers=max_workers)

    def submit(self, fn, *args, **kwargs):
        restore_submissions.append(fn)
        return super().submit(fn, *args, **kwargs)


pathlib.Path.read_bytes = measured_integrated_read
recovery.ThreadPoolExecutor = MeasuringPool
try:
    prepared = recovery.seal_recovery(integrated_stage, snapshot_file)
    assert "state" not in prepared.proof
    saved, restored = recovery.restore_sealed_recovery(prepared, integrated_dest)
finally:
    pathlib.Path.read_bytes = original_read
    recovery.ThreadPoolExecutor = original_pool
assert saved["state"] == "verified" and restored["state"] == "isolated_files_restored"
assert integrated_reads == Counter(row["sha256"] for row in entries), ("repeated_archive_scan", sum(integrated_reads.values()))
assert integrated_dest_reads == {row["path"]: 1 for row in entries}
assert restore_workers == [16, 16], ("combined_restore_worker_bounds", restore_workers)
assert len(restore_submissions) == 4, ("combined_restore_dispatches_one_future_per_file", len(restore_submissions))

late = integrated / "objects" / entries[-1]["sha256"]
late_content = late.read_bytes()
late.write_bytes(bytes(len(late_content)))
try:
    recovery.restore_sealed_recovery(prepared, root / "integrated-object-drift")
except ValueError as error:
    assert str(error) == "recovery_hash_mismatch"
else:
    raise AssertionError("corrupt archive object accepted in combined worker")
finally:
    late.write_bytes(late_content)

false_trace = root / "false-trace-source" / "local-brain" / "969d7ddd-4b06-40cd-85a9-cc4b66c06d02.json"
false_trace.parent.mkdir(parents=True)
false_trace.write_bytes(b'{"value":"valid JSON"}')
false_stage = recovery.stage_recovery(root / "false-trace-bundle", false_trace.parents[1])
false_stage["manifest"]["files"][0]["contentState"] = "zero_filled_trace"
false_prepared = recovery.seal_recovery(false_stage, snapshot_file)
try:
    recovery.restore_sealed_recovery(false_prepared, root / "false-trace-destination")
except ValueError as error:
    assert str(error) == "recovery_trace_marker_invalid"
else:
    raise AssertionError("false trace marker accepted in combined worker")

print(json.dumps({"files": result["files"], "sourceReadsParallel": True, "parentDirectoriesReused": True,
                  "everyDestinationReadBack": True, "objectDriftRejected": True, "manifestDriftRejected": True,
                  "lateDestinationDriftRejected": True}))
