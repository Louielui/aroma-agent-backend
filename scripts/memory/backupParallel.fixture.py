"""Synthetic durable-write concurrency regression. No database or real data."""
import hashlib
import json
import pathlib
import sys
import threading
import time
import backupRecovery as b

root = pathlib.Path(sys.argv[1])
data = root / "data"
(data / "local-brain").mkdir(parents=True)
for i in range(25):
    (data / "local-brain" / (str(i) + ".json")).write_text(json.dumps({"value": i % 24}), encoding="utf-8")
original = b.write_new
lock = threading.Lock()
active = peak = writes = 0


def measured(path, content):
    global active, peak, writes
    with lock:
        active += 1
        peak = max(peak, active)
        writes += 1
    try:
        time.sleep(0.01)
        return original(path, content)
    finally:
        with lock:
            active -= 1


b.write_new = measured
staged = b.stage_recovery(root / "bundle", data)
assert 1 < peak <= 8, ("serial_or_unbounded_stage", peak)
assert writes == 24 and len(staged["manifest"]["files"]) == 25
snapshot = {"format": 1, "database": "xiangxiang_memory_core", "tables": {"records": []}}
source = root / "snapshot.json"
source.write_text(b.encode({"sha256": hashlib.sha256(b.encode(snapshot).encode()).hexdigest(), "snapshot": snapshot}), encoding="utf-8")
b.finish_recovery(staged, source)
peak = 0
proof = b.restore_files(root / "bundle", root / "restored")
assert 1 < peak <= 8, ("serial_or_unbounded_restore", peak)
assert proof["files"] == 25
for item in staged["manifest"]["files"]:
    assert hashlib.sha256((root / "restored" / "data" / item["path"]).read_bytes()).hexdigest() == item["sha256"]
assert active == 0
original_read = pathlib.Path.read_bytes
read_active = read_peak = 0
def measured_read(path):
    global read_active, read_peak
    with lock:
        read_active += 1
        read_peak = max(read_peak, read_active)
    try:
        time.sleep(0.005)
        return original_read(path)
    finally:
        with lock:
            read_active -= 1
pathlib.Path.read_bytes = measured_read
assert b.verify_recovery(root / "bundle")["files"] == 25
assert 1 < read_peak <= 8 and read_active == 0
pathlib.Path.read_bytes = original_read

# A failure in a future must reach the caller before any successful receipt.
def failed_write(path, content):
    raise OSError("synthetic_write_failure")
b.write_new = failed_write
try:
    b.stage_recovery(root / "failed-bundle", data)
except OSError:
    pass
else:
    raise AssertionError("parallel_write_failure_lost")
assert not (root / "failed-bundle" / "manifest.json").exists()
b.write_new = original
# Every restored object is still checked, including a late damaged object.
last = staged["manifest"]["files"][-2]
(root / "bundle" / "objects" / last["sha256"]).write_bytes(b"damaged")
try:
    b.verify_recovery(root / "bundle")
except ValueError as error:
    assert str(error) == "recovery_hash_mismatch"
else:
    raise AssertionError("late_damage_unseen")
print(json.dumps({"files": 25, "uniqueObjects": 24, "boundedParallelDurableWrites": True, "allRestoredHashes": True}))
