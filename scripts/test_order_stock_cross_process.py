#!/usr/bin/env python3
"""Two Node processes share a SQLite DB; the last physical unit sells once."""
import concurrent.futures,json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
root=Path(__file__).resolve().parent.parent
def port():
 s=socket.socket();s.bind(('127.0.0.1',0));p=s.getsockname()[1];s.close();return p
with tempfile.TemporaryDirectory(prefix='stock-cross-process-') as td:
 db=str(Path(td)/'db.sqlite');ports=[port(),port()];base={**os.environ,'DB_PATH':db,'BACKUP_DISABLED':'1','TRUSTED_PROXY_CIDRS':'127.0.0.1/32','NODE_ENV':'test','ADMIN_PASSWORD':'Cross-Process-Owner-935'};servers=[]
 def boot(p):
  proc=subprocess.Popen(['node','src/server.js'],cwd=root,env={**base,'PORT':str(p)},stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
  for _ in range(200):
   if proc.poll() is not None:raise RuntimeError(proc.stderr.read().decode())
   try:
    with urllib.request.urlopen(f'http://127.0.0.1:{p}/api/health',timeout=1):return proc
   except Exception:time.sleep(.1)
  proc.terminate();raise RuntimeError('server timeout')
 def post(p,route,data,ip):
  req=urllib.request.Request(f'http://127.0.0.1:{p}'+route,data=json.dumps(data).encode(),headers={'Content-Type':'application/json','X-Forwarded-For':ip},method='POST')
  try:
   with urllib.request.urlopen(req,timeout=8) as r:return r.status,json.load(r)
  except urllib.error.HTTPError as e:return e.code,json.load(e)
 try:
  servers.append(boot(ports[0]));servers.append(boot(ports[1]));c=sqlite3.connect(db)
  pid,sku=c.execute("select p.id,v.sku from products p join variants v on v.product_id=p.id where p.supply_mode='MADE_TO_ORDER' and v.type='EDP' and v.volume_ml=10 and v.price_toman>0 limit 1").fetchone()
  c.execute("update products set supply_mode='IN_STOCK' where id=?",(pid,));c.execute('update variants set stock=1 where sku=?',(sku,));c.commit();c.close()
  for turn in range(5):
   def attempt(i):return post(ports[i],'/api/orders',{'customer_name':'Test','mobile':'09120000000','items':[{'sku':sku,'quantity':1}]},f'192.0.2.{turn*2+i+1}')
   with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(attempt,[0,1]))
   winners=[x for x in results if x[0]==201];assert len(winners)==1 and all(x[0] in [201,400,409] for x in results),results
   oid=winners[0][1]['order_id'];c=sqlite3.connect(db);assert c.execute('select stock from variants where sku=?',(sku,)).fetchone()[0]==0
   assert c.execute('select r.reserved_qty from order_items i join order_stock_reservations r on r.item_id=i.id where i.order_id=?',(oid,)).fetchone()[0]==1;c.close()
   assert post(ports[0],'/api/payment/verify',{'order_id':oid,'result':'cancel'},f'198.51.100.{turn+1}')[0]==200
   c=sqlite3.connect(db);assert c.execute('select stock from variants where sku=?',(sku,)).fetchone()[0]==1;c.close()
  print('PASS concurrent checkout across two Node processes never oversells and restores only reserved stock')
 finally:
  for p in servers:p.terminate()
  for p in servers:p.wait(timeout=10)
