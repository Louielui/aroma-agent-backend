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

DIRECTORIES = ("memory-outbox", "memory-capture", "memory-consolidation", "conversations")
FILES = ("company-access.json",)
MAX_BYTES = 512 * 1024 * 1024


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def at():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


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
    for name in DIRECTORIES + FILES:
        source = data / name
        manifest["components"][name] = "captured" if source.exists() else "absent"
        if not source.exists():
            continue
        paths = sorted(source.rglob("*.json")) if name in DIRECTORIES else [source]
        for file in paths:
            # Junctions and symlinks are not followed into other directories or credentials.
            relative = file.relative_to(data).as_posix()
            asset_path(relative)
            if file.is_symlink() or file.resolve() != data.joinpath(*pathlib.PurePosixPath(relative).parts):
                raise ValueError("recovery_source_outside_scope")
            before = file.stat()
            content = file.read_bytes()
            after = file.stat()
            if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
                raise ValueError("recovery_source_changed_retry")
            json.loads(content.decode("utf-8"))
            total += len(content)
            if total > MAX_BYTES:
                raise ValueError("recovery_size_limit")
            digest = hashlib.sha256(content).hexdigest()
            object_file = objects / digest
            if not object_file.exists():
                write_new(object_file, content)
            manifest["files"].append({"path": relative, "sha256": digest, "bytes": len(content)})
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
    write_new(target / "manifest.json", encode(sealed).encode("utf-8"))
    proof = verify_recovery(target)
    return {"state": "saved", "path": str(target), "manifestHash": sealed["sha256"], **proof}


def verify_recovery(source):
    target = pathlib.Path(source).resolve()
    sealed = json.loads((target / "manifest.json").read_text(encoding="utf-8"))
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
    for item in manifest["files"]:
        asset_path(item["path"])
        if item["path"] in seen or not re.fullmatch(r"[0-9a-f]{64}", item["sha256"]):
            raise ValueError("invalid_recovery_path")
        seen.add(item["path"])
        content = (target / "objects" / item["sha256"]).read_bytes()
        if len(content) != item["bytes"] or hashlib.sha256(content).hexdigest() != item["sha256"]:
            raise ValueError("recovery_hash_mismatch")
    return {"state": "verified", "files": len(manifest["files"]), "tables": manifest["canonical"]["tables"],
            "credentials": manifest["credentials"], "hindsight": manifest["hindsight"]}


def restore_files(source, destination):
    target = pathlib.Path(destination).resolve()
    proof = verify_recovery(source)
    private_directory(target)
    bundle = pathlib.Path(source).resolve()
    manifest = json.loads((bundle / "manifest.json").read_text(encoding="utf-8"))["manifest"]
    for item in manifest["files"]:
        file = target / "data" / pathlib.Path(*asset_path(item["path"]).parts)
        file.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        write_new(file, (bundle / "objects" / item["sha256"]).read_bytes())
    write_new(target / "canonical.json", (bundle / "canonical.json").read_bytes())
    for item in manifest["files"]:
        file = target / "data" / pathlib.Path(*asset_path(item["path"]).parts)
        if hashlib.sha256(file.read_bytes()).hexdigest() != item["sha256"]:
            raise ValueError("recovery_restore_unconfirmed")
    if hashlib.sha256((target / "canonical.json").read_bytes()).hexdigest() != manifest["canonical"]["sha256"]:
        raise ValueError("recovery_restore_unconfirmed")
    return {**proof, "state": "isolated_files_restored", "path": str(target)}
