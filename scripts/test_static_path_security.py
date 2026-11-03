#!/usr/bin/env python3
"""Exercise actual HTTP static serving against traversal and escaping symlinks."""
import http.client, os, socket, subprocess, tempfile, time
from pathlib import Path
root = Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='static-security-') as td:
    t = Path(td); secret = t / 'secret.txt'; secret.write_text('PRIVATE_STATIC_TEST')
    sibling = root / 'public-static-security-fixture'; sibling.mkdir()
    (sibling / 'secret.txt').write_text('PRIVATE_STATIC_TEST')
    link = root / 'public' / 'static-security-fixture.txt'
    jpg = root / 'public' / 'static-security-fixture.jpg'
    webp = root / 'public' / 'static-security-fixture.webp'
    link.symlink_to(secret); jpg.write_bytes(b'public-jpg'); webp.symlink_to(secret)
    sock = socket.socket(); sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]; sock.close()
    env = {**os.environ, 'DB_PATH': str(t / 'db.sqlite'), 'BACKUP_DISABLED':'1', 'NODE_ENV':'test', 'PORT':str(port)}
    p = subprocess.Popen(['node','src/server.js'], cwd=root, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    def get(path, headers={}):
        c = http.client.HTTPConnection('127.0.0.1', port, timeout=10)
        try:
            c.request('GET', path, headers=headers); r = c.getresponse(); return r.status, r.read()
        finally: c.close()
    try:
        for _ in range(240):
            if p.poll() is not None: raise RuntimeError(p.stderr.read().decode())
            try:
                if get('/api/health')[0] == 200: break
            except OSError: time.sleep(.05)
        else: raise RuntimeError('server did not start')
        for url in ['/../public-static-security-fixture/secret.txt', '/%2e%2e/public-static-security-fixture/secret.txt', '/static-security-fixture.txt']:
            status, body = get(url); assert status in (403,404) and b'PRIVATE_STATIC_TEST' not in body, (url,status)
        status, body = get('/static-security-fixture.jpg', {'Accept':'image/webp'})
        assert status == 200 and body == b'public-jpg'
        assert get('/assets/app.js')[0] == 200
        print('PASS: traversal, external symlink and WebP symlink blocked; ordinary assets work')
    finally:
        p.terminate()
        try: p.wait(timeout=5)
        except subprocess.TimeoutExpired: p.kill(); p.wait()
        for f in (link,jpg,webp): f.unlink(missing_ok=True)
        (sibling / 'secret.txt').unlink(); sibling.rmdir()
