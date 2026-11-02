#!/usr/bin/env python3
"""Real cross-process race for SQLite rate buckets, on a disposable database."""
import json,os,sqlite3,subprocess,tempfile,time
from pathlib import Path
root=Path(__file__).resolve().parent.parent
worker=r'''const fs=require('fs');const d=require('./src/db');fs.writeFileSync(process.env.READY,'ready');
(async()=>{while(!fs.existsSync(process.env.GO))await new Promise(r=>setTimeout(r,5));const r=d.rateLimit('race-account',3,60000,60000);console.log('RESULT '+JSON.stringify(r));d.db.close()})().catch(e=>{console.error(e);process.exit(1)});'''
with tempfile.TemporaryDirectory(prefix='rate-race-') as tmp:
 p=Path(tmp);db=p/'db.sqlite';env={**os.environ,'DB_PATH':str(db),'BACKUP_DISABLED':'1','NODE_ENV':'test'}
 r=subprocess.run(['node','-e',"require('./src/db').db.close()"],cwd=root,env=env,capture_output=True,text=True,timeout=120);assert r.returncode==0,r.stderr
 procs=[]
 try:
  # Initialize one at a time; the race under test starts only at the barrier.
  for i in range(8):
   e={**env,'READY':str(p/f'ready{i}'),'GO':str(p/'go')};child=subprocess.Popen(['node','-e',worker],cwd=root,env=e,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);procs.append(child)
   for _ in range(600):
    if (p/f'ready{i}').exists():break
    if child.poll() is not None:
     out,err=child.communicate();raise AssertionError(f'worker startup failed: {out} {err}')
    time.sleep(.05)
   else:raise AssertionError('worker did not initialize')
  (p/'go').touch();results=[]
  for proc in procs:
   out,err=proc.communicate(timeout=30);assert proc.returncode==0,(out,err);results.append(json.loads(next(x[7:] for x in out.splitlines() if x.startswith('RESULT '))))
  assert sum(x['ok'] for x in results)==3,results
  assert all(x.get('retry_after',0)>0 for x in results if not x['ok'])
  with sqlite3.connect(db) as c:
   count,blocked=c.execute("select count,blocked_until from rate_limits where bucket='race-account'").fetchone()
   assert count==3 and blocked>int(time.time()*1000)
 finally:
  for proc in procs:
   if proc.poll() is None:proc.kill();proc.communicate()
print('PASS rate bucket permits exactly 3 of 8 simultaneous processes and persists block (isolated DB)')
