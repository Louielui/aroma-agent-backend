"""Parallel capture boundaries, entirely synthetic and in a disposable root."""
import hashlib,json,pathlib,sqlite3,sys,threading,time
import backupRecovery as b
root=pathlib.Path(sys.argv[1]);original_limit=b.MAX_BYTES;original_read=pathlib.Path.read_bytes
def dataset(name,count=32):
    data=root/name/'data';(data/'local-brain').mkdir(parents=True)
    for i in range(count):(data/'local-brain'/('%03d.json'%i)).write_text(json.dumps({'i':i}),encoding='utf-8')
    return data
def refuses(name,data,reason):
    try:b.stage_recovery(root/name/'bundle',data)
    except (ValueError,OSError) as e:assert str(e)==reason,(name,str(e))
    else:raise AssertionError('capture_failure_lost:'+name)
    assert not (root/name/'bundle'/'manifest.json').exists()

# Source mutation in a worker remains a hard refusal; completed other writes
# never turn the stage into a successful receipt.
data=dataset('changed')
def changed(path):
    content=original_read(path)
    if path.is_relative_to(data) and path.name=='015.json':path.write_bytes(content+b' ')
    return content
pathlib.Path.read_bytes=changed
refuses('changed',data,'recovery_source_changed_retry');pathlib.Path.read_bytes=original_read

# Aggregate reservation is synchronized across workers before they allocate
# source content. File count and duplicate content still count toward the cap.
data=dataset('limit');b.MAX_BYTES=32
refuses('limit',data,'recovery_size_limit');b.MAX_BYTES=original_limit
data=dataset('json');(data/'local-brain'/'015.json').write_text('{bad',encoding='utf-8')
try:b.stage_recovery(root/'json'/'bundle',data)
except json.JSONDecodeError:pass
else:raise AssertionError('bad_json_accepted')

# Duplicate-source content schedules only one exclusive durable object write.
data=dataset('dedup',0)
for i in range(32):(data/'local-brain'/('%03d.json'%i)).write_text('{"same":true}')
original_write=b.write_new;writes=0;lock=threading.Lock()
def counted(path,content):
    global writes
    with lock:writes+=1
    time.sleep(.01);original_write(path,content)
b.write_new=counted
staged=b.stage_recovery(root/'dedup'/'bundle',data);b.write_new=original_write
assert writes==1 and len(staged['manifest']['files'])==32

# A worker's write failure propagates after all active tasks stop. No late
# background write can create a receipt after the call returns.
data=dataset('write');active=0
def failed(path,content):
    global active
    with lock:active+=1
    try:time.sleep(.005);raise OSError('synthetic_write_failed')
    finally:
        with lock:active-=1
b.write_new=failed;refuses('write',data,'synthetic_write_failed');b.write_new=original_write
assert active==0

# Read-only WAL snapshot keeps committed frames and original source bytes.
data=root/'sqlite'/'data';(data/'memory-local-index').mkdir(parents=True)
source=data/'memory-local-index'/'memory.sqlite'
writer=sqlite3.connect(source)
writer.execute('PRAGMA journal_mode=WAL');writer.execute('CREATE TABLE notes(value text)');writer.commit()
writer.execute("INSERT INTO notes VALUES('synthetic committed WAL')");writer.commit()
wal=pathlib.Path(str(source)+'-wal');before=[hashlib.sha256(f.read_bytes()).hexdigest() for f in (source,wal)]
staged=b.stage_recovery(root/'sqlite'/'bundle',data)
assert [hashlib.sha256(f.read_bytes()).hexdigest() for f in (source,wal)]==before
item=staged['manifest']['files'][0];assert item['path']=='memory-local-index/memory.sqlite'
snapshot_path=root/'sqlite'/'bundle'/'objects'/item['sha256']
snapshot=sqlite3.connect(snapshot_path.as_uri()+'?mode=ro&immutable=1',uri=True)
assert snapshot.execute('SELECT value FROM notes').fetchall()==[('synthetic committed WAL',)]
assert snapshot.execute('PRAGMA integrity_check').fetchone()[0]=='ok';snapshot.close();writer.close()

# The ordered collector surfaces callback and future failures, bounds pending
# tasks at16 and leaves no active future after exiting.
peak_pending=0
with b.RecoveryIO() as pool:
    for i in range(100):
        pool.submit(lambda:time.sleep(.001));peak_pending=max(peak_pending,len(pool.pending))
assert peak_pending<=16 and not pool.pending

# A zero-filled telemetry file still has recoverable bytes, even though its
# former JSON cannot be recovered. No other malformed input is admitted.
import copy
trace_name = '06974bbc-6f4f-4aff-8468-693191485b8f.json'
trace_path = 'local-brain/' + trace_name
zeros = bytes(96)
data = dataset('zero-trace', 1)
source_file = data / trace_path
source_file.write_bytes(zeros)
bundle = root / 'zero-trace' / 'bundle'
staged = b.stage_recovery(bundle, data)
normal, broken = staged['manifest']['files']
assert 'contentState' not in normal
assert broken == {'path': trace_path, 'sha256': hashlib.sha256(zeros).hexdigest(),
                  'bytes': 96, 'contentState': 'zero_filled_trace'}
tables = {name: [{'synthetic': name}] for name in ('access_audit', 'audit', 'principals', 'records')}
snapshot = {'format': 1, 'database': 'xiangxiang_memory_core', 'tables': tables}
canonical = bundle / 'snapshot.json'
canonical.write_text(b.encode({'snapshot': snapshot, 'sha256': hashlib.sha256(b.encode(snapshot).encode()).hexdigest()}), encoding='utf-8')
proof = b.finish_recovery(staged, canonical)
target = root / 'zero-trace' / 'isolated'
restored = b.restore_files(bundle, target)
assert proof['files'] == restored['files'] == 2
assert proof['zeroFilledTraceFiles'] == restored['zeroFilledTraceFiles'] == 1
assert proof['tables'] == restored['tables'] == dict.fromkeys(tables, 1)
assert (target / 'data' / trace_path).read_bytes() == source_file.read_bytes() == zeros
assert (target / 'data' / normal['path']).read_bytes() == (data / normal['path']).read_bytes()
assert (target / 'canonical.json').read_bytes() == canonical.read_bytes()

manifest_file = bundle / 'manifest.json'
seal = json.loads(manifest_file.read_bytes())
false_mark = copy.deepcopy(seal['manifest'])
assert false_mark['files'][0]['path'] == normal['path']
false_mark['files'][0]['contentState'] = 'zero_filled_trace'
manifest_file.write_text(b.encode({'manifest': false_mark, 'sha256': hashlib.sha256(b.encode(false_mark).encode()).hexdigest()}), encoding='utf-8')
try:
    b.verify_recovery(bundle)
except ValueError as error:
    assert str(error) == 'recovery_trace_marker_invalid'
else:
    raise AssertionError('false_trace_marker_accepted')

for case, relative, content in (
        ('zero-memory', 'memory-capture/' + trace_name, zeros),
        ('zero-other-name', 'local-brain/arbitrary.json', zeros),
        ('zero-nested', 'local-brain/nested/' + trace_name, zeros),
        ('empty-trace', trace_path, b''),
        ('mixed-bytes-trace', trace_path, b'\x00x')):
    data = dataset(case, 0)
    source_file = data / relative
    source_file.parent.mkdir(parents=True, exist_ok=True)
    source_file.write_bytes(content)
    try:
        b.stage_recovery(root / case / 'bundle', data)
    except json.JSONDecodeError:
        pass
    else:
        raise AssertionError('malformed_asset_accepted:' + case)
print(json.dumps({'sourceMutation':'rejected','aggregateLimit':'rejected','invalidJson':'rejected','dedupWrites':1,'workerFailure':'propagated','activeAfterFailure':active,'pendingBound':peak_pending,'walSnapshot':'verified_source_unchanged','zeroFilledTrace':'restored_exact_bytes','otherMalformedFiles':'rejected','falseMarker':'rejected'}))
