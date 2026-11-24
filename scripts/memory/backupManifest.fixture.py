"""Exercise the manifest byte ceiling with small synthetic recovery folders."""
import hashlib
import json
import pathlib
import sys

import backupRecovery as recovery

root = pathlib.Path(sys.argv[1])
data = root / "source"
conversation = data / "conversations"
conversation.mkdir(parents=True)
for i in range(40):
    (conversation / f"synthetic-{i:03}.json").write_text(recovery.encode({"record": i}), encoding="utf-8")
trace = data / "local-brain" / "2c5821fb-e642-4722-8f28-206075836615.json"
trace.parent.mkdir()
trace.write_bytes(bytes(96))
snapshot = {"format": 1, "database": "xiangxiang_memory_core",
            "tables": {name: [] for name in ("records", "audit", "principals", "access_audit")}}
source = root / "snapshot.json"
source.write_text(recovery.encode({"snapshot": snapshot,
                                   "sha256": hashlib.sha256(recovery.encode(snapshot).encode()).hexdigest()}),
                  encoding="utf-8")

legacy = root / "legacy"
recovery.finish_recovery(recovery.stage_recovery(legacy, data), source)
legacy_manifest = legacy / "manifest.json"
legacy_bytes = legacy_manifest.stat().st_size
assert json.loads(legacy_manifest.read_bytes())["manifest"]["format"] == 1
assert recovery.verify_recovery(legacy)["files"] == 41

recovery.MAX_MANIFEST_BYTES = legacy_bytes - 500
compact = root / "compact"
saved, verified = recovery.finish_recovery_for_restore(recovery.stage_recovery(compact, data), source)
manifest = compact / "manifest.json"
raw = manifest.read_bytes()
assert len(raw) <= recovery.MAX_MANIFEST_BYTES < legacy_bytes
sealed = json.loads(raw)
assert sealed["manifest"]["format"] == 2
assert sum(len(item) == 4 and item[-1] == "zero_filled_trace" for item in sealed["manifest"]["files"]) == 1
isolated = root / "isolated"
restored = recovery.restore_verified_files(verified, isolated)
assert saved["files"] == restored["files"] == 41
assert saved["zeroFilledTraceFiles"] == restored["zeroFilledTraceFiles"] == 1
for item in recovery.manifest_file_entries(sealed["manifest"]):
    blob = (isolated / "data" / item["path"]).read_bytes()
    assert len(blob) == item["bytes"] and hashlib.sha256(blob).hexdigest() == item["sha256"]
assert (isolated / "canonical.json").read_bytes() == source.read_bytes()

last = sealed["manifest"]["files"][-1]
last.append("invalid")
manifest.write_text(recovery.encode({"manifest": sealed["manifest"],
                                     "sha256": hashlib.sha256(recovery.encode(sealed["manifest"]).encode()).hexdigest()}),
                    encoding="utf-8")
try:
    recovery.verify_recovery(compact)
except ValueError as error:
    assert str(error) == "recovery_manifest_invalid"
else:
    raise AssertionError("invalid_compact_marker_accepted")

recovery.MAX_MANIFEST_BYTES = len(raw) - 1
blocked = root / "over-limit"
try:
    recovery.finish_recovery(recovery.stage_recovery(blocked, data), source)
except ValueError as error:
    assert str(error) == "recovery_manifest_limit"
    assert not (blocked / "manifest.json").exists()
else:
    raise AssertionError("oversized_manifest_written")

print(json.dumps({"legacyRead": True, "compactFiles": 41, "tagPreserved": True,
                  "invalidRowRejected": True, "hardByteLimitHeld": True}))
