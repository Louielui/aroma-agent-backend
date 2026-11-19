"""Synthetic source I/O regression; no real data, database or backup endpoint."""
import json
import pathlib
import sys
import threading
import time
import backupRecovery as b

root=pathlib.Path(sys.argv[1])
data=root/'data'
(data/'local-brain').mkdir(parents=True)
for i in range(32):
    (data/'local-brain'/('%03d.json'%i)).write_text(json.dumps({'synthetic':i}),encoding='utf-8')
original=pathlib.Path.read_bytes
lock=threading.Lock()
active=peak=reads=0
def measured(path):
    global active,peak,reads
    if not path.is_relative_to(data):
        return original(path)
    with lock:
        active+=1;reads+=1;peak=max(peak,active)
    try:
        time.sleep(.01)
        return original(path)
    finally:
        with lock: active-=1
pathlib.Path.read_bytes=measured
staged=b.stage_recovery(root/'bundle',data)
pathlib.Path.read_bytes=original
assert 1<peak<=8,('source_capture_serial_or_unbounded',peak)
assert active==0 and reads==32
assert [v['path'] for v in staged['manifest']['files']]==['local-brain/%03d.json'%i for i in range(32)]
for item in staged['manifest']['files']:
    b.verify_file(root/'bundle'/'objects'/item['sha256'],item['sha256'],item['bytes'],'unverified_object')
print(json.dumps({'files':32,'sourceParallel':True,'allHashes':True,'orderedManifest':True,'workersStopped':True}))
