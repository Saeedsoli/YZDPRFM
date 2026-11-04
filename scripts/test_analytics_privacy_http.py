#!/usr/bin/env python3
"""Real API rejects forged purchases and avoids persisting arbitrary contact data."""
import json,os,socket,sqlite3,subprocess,tempfile,time,urllib.parse,urllib.request,urllib.error
from pathlib import Path
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='analytics-privacy-') as td:
 db=str(Path(td)/'db.sqlite');s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1];s.close();base=f'http://127.0.0.1:{port}'
 env={**os.environ,'DB_PATH':db,'BACKUP_DISABLED':'1','NODE_ENV':'test','PORT':str(port),'PAYMENT_GATEWAY':'sandbox'}
 p=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 def call(method,path,body=None):
  req=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json'},method=method)
  try:
   with urllib.request.urlopen(req,timeout=10) as r:return r.status,json.load(r)
  except urllib.error.HTTPError as e:return e.code,json.load(e)
 try:
  for _ in range(240):
   if p.poll() is not None:raise RuntimeError(p.stderr.read().decode())
   try:
    with urllib.request.urlopen(base+'/api/health',timeout=1):break
   except OSError:time.sleep(.05)
  else:raise RuntimeError('server not ready')
  with sqlite3.connect(db) as c:sku=c.execute("select v.sku from variants v join products p on p.id=v.product_id where p.supply_mode='MADE_TO_ORDER' and v.type='EDP' and v.volume_ml=30 and v.price_toman>0 limit 1").fetchone()[0]
  st,r=call('POST','/api/track',{'kind':'purchase','target':'fake','meta':{'qty':1}});assert st==200 and r['ok'] is False
  st,r=call('POST','/api/track',{'kind':'add_cart','target':'SKU-SAFE','meta':{'qty':1,'mobile':'09120001111','email':'a@example.test','order':'PRIVATE-ORDER'}});assert st==200 and r['ok'] is True
  st,r=call('POST','/api/track',{'kind':'search','target':'۰۹۱۲ ۰۰۰ ۱۱۱۱','meta':{'results':0}});assert st==200 and r['ok'] is False
  st,r=call('GET','/api/products?q='+urllib.parse.quote('۰۹۱۲ ۰۰۰ ۱۱۱۱'));assert st==200
  with sqlite3.connect(db) as c:
   row=c.execute("select meta from events where kind='add_cart' and target='SKU-SAFE'").fetchone();assert json.loads(row[0])=={'qty':1}
   assert c.execute("select count(*) from events where kind='purchase'").fetchone()[0]==0
   assert c.execute("select count(*) from events where kind='search' and target like '%۰۹۱۲%'").fetchone()[0]==0
  st,order=call('POST','/api/orders',{'customer_name':'Test','mobile':'09120002222','items':[{'sku':sku,'quantity':1}]});assert st==201,order
  st,paid=call('POST','/api/payment/verify',{'order_id':order['order_id'],'result':'success'});assert st==200,paid
  with sqlite3.connect(db) as c:
   events=c.execute("select target,meta from events where kind='purchase'").fetchall();assert len(events)==1 and json.loads(events[0][1])=={'qty':1} and order['order_id'] not in str(events)
   assert c.execute('pragma integrity_check').fetchone()[0]=='ok'
  print('PASS forged purchase rejected, contact search dropped, metadata minimized, verified sandbox purchase recorded')
 finally:
  p.terminate()
  try:p.wait(timeout=5)
  except subprocess.TimeoutExpired:p.kill();p.wait()
