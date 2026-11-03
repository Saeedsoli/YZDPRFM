#!/usr/bin/env python3
"""Malformed request paths must not terminate the server (disposable DB)."""
import concurrent.futures,http.client,json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request
from pathlib import Path
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='bad-path-test-') as td:
 db=str(Path(td)/'db.sqlite');s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1];s.close()
 env={**os.environ,'DB_PATH':db,'BACKUP_DISABLED':'1','NODE_ENV':'test','PORT':str(port)}
 p=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 def call(path,method='GET'):
  conn=http.client.HTTPConnection('127.0.0.1',port,timeout=10)
  try:
   conn.request(method,path);r=conn.getresponse();body=r.read();return r.status,body,dict(r.getheaders())
  finally:conn.close()
 try:
  for _ in range(240):
   if p.poll() is not None:raise RuntimeError(p.stderr.read().decode())
   try:
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health',timeout=1):break
   except OSError:time.sleep(.05)
  else:raise RuntimeError('server did not start')
  cases=['/%','/%ZZ','/%E0%A4%A','/%C0%AF','/api/%F0%28%8C%28','/api/%00','/api/%0a']
  for path in cases:
   status,body,h=call(path);assert status==400,(path,status,body);assert h.get('Cache-Control')=='no-store';assert json.loads(body)['error']
   assert p.poll() is None and call('/api/health')[0]==200
  status,body,_=call('/%','HEAD');assert status==400 and body==b''
  with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
   results=list(pool.map(call,[cases[i%len(cases)] for i in range(60)]))
  assert all(x[0]==400 for x in results) and p.poll() is None
  assert call('/api/health')[0]==200
  # A literal percent entering a legacy second decoder is still a client
  # error, never an internal-error leak or a process crash.
  assert call('/api/reviews/%25')[0]==400
  # A valid UTF-8 encoded path is handled normally, not treated as malformed.
  assert call('/%D8%B9%D8%B7%D8%B1')[0] in (200,404)
  with sqlite3.connect(db) as c:assert c.execute('pragma integrity_check').fetchone()[0]=='ok' and c.execute('select count(*) from orders').fetchone()[0]==0
  print('PASS malformed URL requests return 400 and server stays healthy, including concurrent traffic and HEAD')
 finally:
  if p.poll() is None:p.terminate()
  try:p.wait(timeout=5)
  except subprocess.TimeoutExpired:p.kill();p.wait()
