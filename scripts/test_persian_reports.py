#!/usr/bin/env python3
"""Sales/traffic local-day aggregation and Persian CSV dates on disposable DB."""
import csv,datetime,io,json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
from zoneinfo import ZoneInfo
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='persian-reports-') as td:
 db=str(Path(td)/'db.sqlite');sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close();base=f'http://127.0.0.1:{port}'
 env={**os.environ,'DB_PATH':db,'BACKUP_DISABLED':'1','NODE_ENV':'test','PORT':str(port),'ADMIN_USERNAME':'owner','ADMIN_PASSWORD':'Reports-Day-Owner-982'}
 p=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 def call(path,token=None,body=None):
  h={'Content-Type':'application/json'}
  if token:h['Authorization']='Bearer '+token
  req=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,headers=h,method='POST' if body is not None else 'GET')
  try:
   with urllib.request.urlopen(req,timeout=10) as r:return r.status,r.read()
  except urllib.error.HTTPError as e:return e.code,e.read()
 try:
  for _ in range(240):
   if p.poll() is not None:raise RuntimeError(p.stderr.read().decode())
   try:
    with urllib.request.urlopen(base+'/api/health',timeout=1):break
   except OSError:time.sleep(.05)
  else:raise RuntimeError('server not ready')
  yesterday=datetime.datetime.now(datetime.timezone.utc).date()-datetime.timedelta(days=1)
  before=datetime.datetime.combine(yesterday,datetime.time(20,29,59),datetime.timezone.utc)
  after=datetime.datetime.combine(yesterday,datetime.time(20,30,1),datetime.timezone.utc)
  key1=before.astimezone(ZoneInfo('Asia/Tehran')).date().isoformat();key2=after.astimezone(ZoneInfo('Asia/Tehran')).date().isoformat();assert key1!=key2
  with sqlite3.connect(db) as c:
   for oid,when,amount in [('DAY-BEFORE',before,111),('DAY-AFTER',after,222)]:
    c.execute("insert into orders(order_id,created_at,customer_name,mobile,subtotal,shipping_fee,total_paid,status) values(?,?,'Test','09120001111',?,0,?,'PAID')",(oid,when.isoformat(),amount,amount))
    c.execute("insert into events(kind,target,visitor,at) values('view','product',?,?)",(oid,when.isoformat()))
   c.commit()
  st,b=call('/api/admin/login',body={'username':'owner','password':'Reports-Day-Owner-982'});assert st==200;token=json.loads(b)['token']
  st,b=call('/api/admin/reports?days=3',token=token);assert st==200;report=json.loads(b);daily={x['d']:x for x in report['daily']}
  assert daily[key1]['revenue']==111 and daily[key2]['revenue']==222,(key1,key2,daily)
  st,b=call('/api/admin/analytics?days=3',token=token);assert st==200;traffic={x['day']:x for x in json.loads(b)['daily']};assert traffic[key1]['views']==1 and traffic[key2]['views']==1
  expected=json.loads(subprocess.check_output(['node','-e',"let d=require('./public/assets/persian-date');console.log(JSON.stringify(process.argv.slice(1).map(x=>d.formatDate(x))))",key1,key2],cwd=root,env=env,text=True))
  st,b=call('/api/admin/reports/csv?days=3',token=token);assert st==200
  rows=list(csv.reader(io.StringIO(b.decode('utf-8-sig'),newline='')));assert any(r[:3]==[expected[0],'1','111'] for r in rows) and any(r[:3]==[expected[1],'1','222'] for r in rows),rows
  print('PASS sales and traffic grouped at shop midnight, report CSV dates in Persian')
 finally:
  p.terminate()
  try:p.wait(timeout=5)
  except subprocess.TimeoutExpired:p.kill();p.wait()
