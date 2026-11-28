import datetime
import json
import pathlib
import sys
import time

import psutil

stage = pathlib.Path(sys.argv[1])
lock = json.loads((stage / "engine-owner.lock").read_text(encoding="utf-8"))
pid = psutil.Process(lock["pid"])
destination = pathlib.Path(lock["root"]) / "process-network.jsonl"
with destination.open("a", encoding="utf-8") as log:
    while pid.is_running() and (stage / "engine-owner.lock").exists():
        rows, errors = [], []
        for proc in [pid, *pid.children(recursive=True)]:
            try:
                rows.append({"pid": proc.pid, "name": proc.name(), "rssBytes": proc.memory_info().rss,
                             "peers": [{"host": connection.raddr.ip, "port": connection.raddr.port}
                                       for connection in proc.net_connections(kind="inet") if connection.raddr]})
            except psutil.Error as error:
                errors.append({"pid": proc.pid, "code": type(error).__name__})
        log.write(json.dumps({"at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                              "processes": rows, "errors": errors}) + "\n")
        log.flush()
        time.sleep(1)
