#!/usr/bin/env python3
"""Recovery enumeration and shared SMS limits using a fake provider and DB."""
import json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='forgot-abuse-') as td:
 td=Path(td);db=td/'db.sqlite';log=td/'fake-sms.log';mock=td/'fake-sms.js'
 mock.write_text("const fs=require('fs'),sms=require("+json.dumps(str(root/'src/sms.js'))+");sms.sendOtp=async()=>{fs.appendFileSync(process.env.FAKE_SMS_LOG,'sent\\n');await new Promise(r=>setTimeout(r,25));return {ok:true}};")
 sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close();base=f'http://127.0.0.1:{port}'
 env={**os.environ,'DB_PATH':str(db),'BACKUP_DISABLED':'1','NODE_ENV':'test','PORT':str(port),'NODE_OPTIONS':'--require='+str(mock),'FAKE_SMS_LOG':str(log)}
 p=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 def post(path,mobile):
  req=urllib.request.Request(base+path,data=json.dumps({'mobile':mobile}).encode(),headers={'Content-Type':'application/json'},method='POST')
  try:
   with urllib.request.urlopen(req,timeout=5) as r:return r.status,json.load(r)
  except urllib.error.HTTPError as e:return e.code,json.load(e)
 def reset_limits():
  with sqlite3.connect(db) as c:c.execute('delete from rate_limits');c.execute('delete from otp_codes')
 try:
  for _ in range(240):
   if p.poll() is not None:raise RuntimeError(p.stderr.read().decode())
   try:
    with urllib.request.urlopen(base+'/api/health',timeout=1):break
   except OSError:time.sleep(.1)
  else:raise RuntimeError('server did not start')
  known='09120000001';unknown='09120000002'
  with sqlite3.connect(db) as c:c.execute("insert into customers(mobile,first_name) values(?,'Test')",(known,))
  a=post('/api/auth/forgot-password',known);b=post('/api/auth/forgot-password',unknown)
  assert a==b and a[0]==200,(a,b)
  assert log.read_text().splitlines()==['sent','sent']
  with sqlite3.connect(db) as c:
   rows=c.execute('select mobile,code from otp_codes where mobile in (?,?) order by mobile',(known,unknown)).fetchall()
   assert len(rows)==2 and all(len(code)==5 and code.isdigit() for _,code in rows)
  # Known and unknown requests consume the same shared counter as request-code.
  reset_limits();mobile='09120000003'
  for _ in range(3):post('/api/auth/request-code',mobile)
  for _ in range(2):assert post('/api/auth/forgot-password',mobile)[0]==200
  assert post('/api/auth/forgot-password',mobile)[0]==429
  with sqlite3.connect(db) as c:assert c.execute('select count from rate_limits where bucket=?',('otp-ph:'+mobile,)).fetchone()[0]==5
  # Different telephone numbers cannot evade the shared IP send cap.
  reset_limits()
  for i in range(12):assert post('/api/auth/forgot-password',f'0913{i:07d}')[0]==200
  assert post('/api/auth/forgot-password','09139999999')[0]==429
  print('PASS recovery privacy and shared per-phone/IP SMS limits; fake provider only')
 finally:
  p.terminate()
  try:p.wait(timeout=5)
  except subprocess.TimeoutExpired:p.kill();p.wait()
