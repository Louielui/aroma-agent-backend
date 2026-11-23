"""Private recovery assets. Files restore only to a new isolated destination."""
import csv
import datetime
import hashlib
import io
import json
import os
import pathlib
import re
import subprocess
import sqlite3
import threading
from collections import deque
from concurrent.futures import ThreadPoolExecutor

DIRECTORIES = ("memory-outbox", "memory-capture", "memory-consolidation", "conversations", "local-brain")
FILES = ("company-access.json", "model-center-local.json", "memory-local-index/memory.sqlite")
MAX_BYTES = 512 * 1024 * 1024


class RecoveryIO:
    """Bound I/O concurrency; every file still completes its original checks."""
    def __init__(self, on_result=None):
        self.on_result = on_result

    def complete_one(self):
        result = self.pending.popleft().result()
        if self.on_result is not None:
            self.on_result(result)

    def __enter__(self):
        self.pool = ThreadPoolExecutor(max_workers=8)
        self.pending = deque()
        return self

    def submit(self, function, *args):
        if len(self.pending) >= 16:
            self.complete_one()
        self.pending.append(self.pool.submit(function, *args))

    def write(self, target, content):
        self.submit(write_new, target, content)

    def verify(self, target, digest, size=None, reason="recovery_hash_mismatch"):
        self.submit(verify_file, target, digest, size, reason)

    def __exit__(self, kind, value, trace):
        try:
            if kind is None:
                while self.pending:
                    self.complete_one()
        finally:
            self.pool.shutdown(wait=True, cancel_futures=True)


def verify_file(target, digest, size, reason):
    read_verified(target, digest, size, reason)


def read_verified(target, digest, size, reason):
    content = target.read_bytes()
    if (size is not None and len(content) != size) or hashlib.sha256(content).hexdigest() != digest:
        raise ValueError(reason)
    return content


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def at():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def local_index_snapshot(source):
    # SQLite backup includes committed WAL frames in one consistent snapshot.
    # Never copy a live main file and its WAL at separate instants.
    p = pathlib.Path(source).resolve()
    with sqlite3.connect(p.as_uri() + "?mode=ro", uri=True, timeout=5) as original:
        with sqlite3.connect(":memory:") as snapshot:
            original.backup(snapshot)
            if snapshot.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ValueError("local_index_backup_invalid")
            content = snapshot.serialize()
            if len(content) > MAX_BYTES:
                raise ValueError("recovery_size_limit")
            return content


def private_directory(target):
    if target.exists():
        raise ValueError("destination_exists")
    target.mkdir(parents=True, mode=0o700)
    if os.name == "nt":
        flags = {"creationflags": subprocess.CREATE_NO_WINDOW}
        identity = subprocess.run(["whoami", "/user", "/fo", "csv", "/nh"], capture_output=True, text=True, check=True, **flags)
        sid = next(csv.reader(io.StringIO(identity.stdout)))[1].strip()
        if not re.fullmatch(r"S-1-[0-9-]+", sid):
            raise ValueError("backup_acl_unconfirmed")
        # New backup directories keep only this principal, LocalService, SYSTEM and administrators.
        args = ["icacls", str(target), "/inheritance:r"]
        for principal in dict.fromkeys((sid, "S-1-5-19", "S-1-5-18", "S-1-5-32-544")):
            args += ["/grant:r", "*" + principal + ":(OI)(CI)F"]
        subprocess.run(args, capture_output=True, check=True, **flags)


def write_new(target, content):
    descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb") as handle:
        handle.write(content)
        handle.flush()
        os.fsync(handle.fileno())


def asset_path(value):
    if not isinstance(value, str) or "\\" in value:
        raise ValueError("invalid_recovery_path")
    p = pathlib.PurePosixPath(value)
    if p.is_absolute() or any(part in (".", "..") for part in p.parts):
        raise ValueError("invalid_recovery_path")
    if str(p) in FILES or (len(p.parts) >= 2 and p.parts[0] in DIRECTORIES and p.suffix == ".json"):
        return p
    raise ValueError("invalid_recovery_path")


def stage_recovery(destination, data_root):
    target = pathlib.Path(destination).resolve()
    data = pathlib.Path(data_root).resolve()
    private_directory(target)
    objects = target / "objects"
    objects.mkdir(mode=0o700)
    manifest = {"format": 1, "kind": "xiangxiang-memory-recovery", "startedAt": at(),
                "files": [], "components": {}, "credentials": "excluded_reauthorize_on_new_machine",
                "hindsight": "derived_index_rebuild_from_canonical_scoped_records",
                "consistency": "file_assets_captured_before_repeatable_read_database_snapshot"}
    total = 0
    scheduled = set()
    lock = threading.Lock()

    def capture(file):
        nonlocal total
        # Parallelize the complete source operation, not merely destination
        # fsync. The ordered parent collector drains every future before the
        # database snapshot or a successful stage receipt can be returned.
        relative = file.relative_to(data).as_posix()
        asset_path(relative)
        if file.is_symlink() or file.resolve() != data.joinpath(*pathlib.PurePosixPath(relative).parts):
            raise ValueError("recovery_source_outside_scope")
        before = file.stat()
        sqlite_asset = relative == "memory-local-index/memory.sqlite"
        if not sqlite_asset:
            # Reserve aggregate bytes BEFORE reading in parallel. A rejected
            # capture is never reused; no reservation is refunded or retried.
            with lock:
                total += before.st_size
                if total > MAX_BYTES:
                    raise ValueError("recovery_size_limit")
        content = local_index_snapshot(file) if sqlite_asset else file.read_bytes()
        after = file.stat()
        if not sqlite_asset and ((before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns) or len(content) != before.st_size):
            raise ValueError("recovery_source_changed_retry")
        if not sqlite_asset:
            json.loads(content.decode("utf-8"))
        digest = hashlib.sha256(content).hexdigest()
        with lock:
            if sqlite_asset:
                total += len(content)
                if total > MAX_BYTES:
                    raise ValueError("recovery_size_limit")
            unique = digest not in scheduled
            scheduled.add(digest)
        if unique:
            write_new(objects / digest, content)
        return {"path": relative, "sha256": digest, "bytes": len(content)}

    with RecoveryIO(on_result=manifest["files"].append) as captures:
        for name in DIRECTORIES + FILES:
            source = data / name
            manifest["components"][name] = "captured" if source.exists() else "absent"
            if not source.exists():
                continue
            paths = sorted(source.rglob("*.json")) if name in DIRECTORIES else [source]
            for file in paths:
                captures.submit(capture, file)
    return {"directory": str(target), "manifest": manifest}


def finish_recovery(staged, snapshot_path):
    target = pathlib.Path(staged["directory"])
    content = pathlib.Path(snapshot_path).read_bytes()
    envelope = json.loads(content.decode("utf-8"))
    snapshot = envelope.get("snapshot", {})
    if snapshot.get("format") != 1 or snapshot.get("database") != "xiangxiang_memory_core" or \
            hashlib.sha256(encode(snapshot).encode("utf-8")).hexdigest() != envelope.get("sha256"):
        raise ValueError("recovery_snapshot_invalid")
    write_new(target / "canonical.json", content)
    manifest = {**staged["manifest"], "completedAt": at(),
                "canonical": {"file": "canonical.json", "sha256": hashlib.sha256(content).hexdigest(),
                              "tables": {k: len(v) for k, v in snapshot["tables"].items()}}}
    sealed = {"sha256": hashlib.sha256(encode(manifest).encode("utf-8")).hexdigest(), "manifest": manifest}
    manifest_bytes = encode(sealed).encode("utf-8")
    write_new(target / "manifest.json", manifest_bytes)
    _, proof, file_hash = verified_bundle(target)
    if file_hash != hashlib.sha256(manifest_bytes).hexdigest():
        raise ValueError("recovery_manifest_invalid")
    return {"state": "saved", "path": str(target), "manifestHash": sealed["sha256"],
            "manifestFileSha256": file_hash, **proof}


def verified_bundle(target, verified_manifest_hash=None):
    manifest_bytes = (target / "manifest.json").read_bytes()
    file_hash = hashlib.sha256(manifest_bytes).hexdigest()
    if verified_manifest_hash is not None and file_hash != verified_manifest_hash:
        raise ValueError("recovery_manifest_invalid")
    sealed = json.loads(manifest_bytes.decode("utf-8"))
    manifest = sealed["manifest"]
    if manifest.get("format") != 1 or manifest.get("kind") != "xiangxiang-memory-recovery" or \
            hashlib.sha256(encode(manifest).encode("utf-8")).hexdigest() != sealed.get("sha256"):
        raise ValueError("recovery_manifest_invalid")
    if manifest["canonical"]["file"] != "canonical.json":
        raise ValueError("invalid_recovery_path")
    canonical = (target / "canonical.json").read_bytes()
    if hashlib.sha256(canonical).hexdigest() != manifest["canonical"]["sha256"]:
        raise ValueError("recovery_hash_mismatch")
    seen = set()
    with RecoveryIO() as checks:
        for item in manifest["files"]:
            asset_path(item["path"])
            if item["path"] in seen or not re.fullmatch(r"[0-9a-f]{64}", item["sha256"]):
                raise ValueError("invalid_recovery_path")
            seen.add(item["path"])
            if verified_manifest_hash is None:
                checks.verify(target / "objects" / item["sha256"], item["sha256"], item["bytes"])
    proof = {"state": "verified", "files": len(manifest["files"]), "tables": manifest["canonical"]["tables"],
             "credentials": manifest["credentials"], "hindsight": manifest["hindsight"]}
    return manifest, proof, file_hash


def verify_recovery(source):
    _, proof, _ = verified_bundle(pathlib.Path(source).resolve())
    return proof


def restore_asset(source, target, digest, size):
    # Check the exact bytes used for the copy, even if an archive object
    # changed after the separate bundle verification.
    content = read_verified(source, digest, size, "recovery_hash_mismatch")
    write_new(target, content)


def restore_files(source, destination, *, verified_manifest_hash=None):
    target = pathlib.Path(destination).resolve()
    bundle = pathlib.Path(source).resolve()
    # The scheduled run pins its just-verified manifest. Each copy still
    # verifies its own source bytes, followed by independent destination reads.
    manifest, proof, manifest_digest = verified_bundle(bundle, verified_manifest_hash)
    private_directory(target)
    data = target / "data"
    if manifest["files"]:
        data.mkdir(mode=0o700)
    parents = {data}
    destinations = []
    with RecoveryIO() as copies:
        for item in manifest["files"]:
            file = data / pathlib.Path(*asset_path(item["path"]).parts)
            parent = file.parent
            if parent not in parents:
                parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                parents.add(parent)
            digest, size = item["sha256"], item["bytes"]
            copies.submit(restore_asset, bundle / "objects" / digest, file, digest, size)
            destinations.append((file, digest, size))
    write_new(target / "canonical.json", (bundle / "canonical.json").read_bytes())
    # Read each destination after every output, including canonical.json, is
    # durable. A file damaged late in the copy phase must still fail restore.
    with RecoveryIO() as checks:
        for file, digest, size in destinations:
            checks.verify(file, digest, size, "recovery_restore_unconfirmed")
    verify_file(target / "canonical.json", manifest["canonical"]["sha256"], None, "recovery_restore_unconfirmed")
    verify_file(bundle / "manifest.json", manifest_digest, None, "recovery_manifest_invalid")
    return {**proof, "state": "isolated_files_restored", "path": str(target)}
