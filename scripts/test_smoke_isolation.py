#!/usr/bin/env python3
"""Exercise fail-closed smoke isolation without touching store data or network."""
import glob
import hashlib
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time

root = Path(__file__).resolve().parent.parent
assert (root / 'node_modules').is_dir(), 'node_modules required'
with tempfile.TemporaryDirectory(prefix='yazd-smoke-sentinel-') as td:
    sentinel = Path(td) / 'production-sentinel.db'
    sentinel.write_bytes(b'do not touch store data')
    digest = hashlib.sha256(sentinel.read_bytes()).digest()
    before = set(glob.glob('/tmp/yazd-smoke-????????'))
    guard = socket.socket()
    guard.bind(('127.0.0.1', 3000))
    guard.listen()
    other = subprocess.Popen(['node', '-e', 'setInterval(()=>{},1000)'])
    try:
        env = {**os.environ, 'DB_PATH': str(sentinel)}
        env.pop('YAZD_SMOKE_STAGE', None)
        result = subprocess.run(['bash', 'scripts/smoke_test.sh'], cwd=root, env=env,
                                capture_output=True, text=True, timeout=90)
        assert result.returncode == 2, (result.returncode, result.stdout, result.stderr)
        assert 'Port 3000 is occupied' in result.stderr, result.stderr
        assert other.poll() is None, 'unrelated process was killed'
        assert hashlib.sha256(sentinel.read_bytes()).digest() == digest
        assert set(glob.glob('/tmp/yazd-smoke-????????')) == before, 'temporary stage was left behind'
        forbidden = subprocess.run(['bash', 'scripts/smoke_test.sh'], cwd=root,
                                   env={**env, 'YAZD_SMOKE_STAGE': '1'},
                                   capture_output=True, text=True, timeout=5)
        assert forbidden.returncode == 2 and 'Unsafe smoke stage' in forbidden.stderr
    finally:
        other.terminate()
        other.wait(timeout=5)
        guard.close()
# An interrupted run must also terminate the owned server process group.
before = set(glob.glob('/tmp/yazd-smoke-????????'))
run = subprocess.Popen(['bash', 'scripts/smoke_test.sh'], cwd=root,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    stage = None
    for _ in range(80):
        candidates = set(glob.glob('/tmp/yazd-smoke-????????')) - before
        if candidates and (Path(next(iter(candidates))) / 'data' / 'yazd.db').exists():
            stage = next(iter(candidates))
            break
        time.sleep(.1)
    assert stage, 'isolated run did not initialise its own DB'
    time.sleep(1)
finally:
    run.terminate()
    run.wait(timeout=15)
if stage:
    for _ in range(30):
        if not Path(stage).exists():
            break
        time.sleep(.1)
    assert not Path(stage).exists(), 'interrupted stage not cleaned'
    time.sleep(.5)
    for proc in Path('/proc').glob('[0-9]*/environ'):
        try:
            assert (f'DB_PATH={stage}/data/yazd.db'.encode() not in proc.read_bytes()), f'stage process survived: {proc}'
        except (FileNotFoundError, PermissionError, ProcessLookupError):
            pass
print('PASS: isolated stage rejects unsafe invocation and occupied ports, preserves unrelated processes and data, and cleans up on interruption')
