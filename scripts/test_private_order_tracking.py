#!/usr/bin/env python3
"""Guest tracking requires BOTH identifiers and returns no address or internal data."""
import concurrent.futures,json,os,re,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='private-tracking-') as td:
 db=str(Path(td)/'db.sqlite');sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
 env={**os.environ,'DB_PATH':db,'BACKUP_DISABLED':'1','TRUSTED_PROXY_CIDRS':'127.0.0.1/32','NODE_ENV':'test','PORT':str(port),'ADMIN_PASSWORD':'Tracking-Owner-9348'}
 proc=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 def api(method,path,data=None,ip='192.0.2.1'):
  headers={'Content-Type':'application/json','X-Forwarded-For':ip}
  req=urllib.request.Request(f'http://127.0.0.1:{port}'+path,data=None if data is None else json.dumps(data).encode(),headers=headers,method=method)
  try:
   with urllib.request.urlopen(req,timeout=5) as r:return r.status,json.load(r),dict(r.headers)
  except urllib.error.HTTPError as e:return e.code,json.load(e),dict(e.headers)
 try:
  for _ in range(200):
   if proc.poll() is not None:raise RuntimeError(proc.stderr.read().decode())
   try:
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health',timeout=1):break
   except OSError:time.sleep(.1)
  else:raise RuntimeError('server timeout')
  c=sqlite3.connect(db);sku=c.execute("select v.sku from variants v join products p on p.id=v.product_id where p.supply_mode='MADE_TO_ORDER' and v.type='EDP' and v.volume_ml=10 and v.price_toman>0 limit 1").fetchone()[0];c.close()
  body={'customer_name':'Private Name','mobile':'09120001111','province':'Private Province','city':'Private City','address':'Private Address 278','postal_code':'1234567890','customer_note':'Private customer note','items':[{'sku':sku,'quantity':1}]}
  code,a,_=api('POST','/api/orders',body);assert code==201,a;oid=a['order_id'];assert re.fullmatch(r'YZD-[A-Z0-9]+-[A-F0-9]{24}',oid),oid
  body['mobile']='09120002222';code,b,_=api('POST','/api/orders',body,ip='192.0.2.2');assert code==201 and b['order_id']!=oid
  assert api('GET','/api/orders/track?mobile=09120001111')[0]==400
  assert api('POST','/api/orders/track',{'mobile':'09120001111'})[0]==400
  assert api('POST','/api/orders/track',{'order_id':oid})[0]==400
  assert api('POST','/api/orders/track',{'mobile':'09120002222','order_id':oid})[1]['orders']==[]
  code,o,h=api('POST','/api/orders/track',{'mobile':'09120001111','order_id':oid});assert code==200 and o['total']==1 and h.get('Cache-Control')=='no-store'
  rec=o['orders'][0];assert set(rec)=={'order_id','created_at','status','total_paid','tracking_code','carrier','items'}
  raw=json.dumps(rec);assert all(x not in raw for x in ['Private Name','Private Address','Private City','1234567890','Private customer note'])
  code,get,h=api('GET',f'/api/orders/track?mobile=09120001111&order_id={oid}',ip='192.0.2.3');assert code==200 and get['orders'][0]['order_id']==oid and h.get('Cache-Control')=='no-store'
  # Existing short IDs stay valid and have no address in the response.
  c=sqlite3.connect(db);c.execute("insert into orders(order_id,created_at,customer_name,mobile,address,subtotal,shipping_fee,total_paid,status) values('YZD-OLD-ABCD',?,'Legacy','09120001111','Legacy private',1000,0,1000,'PENDING')",(time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),));c.commit();c.close()
  code,old,_=api('POST','/api/orders/track',{'mobile':'09120001111','order_id':'yzd-old-abcd'},ip='192.0.2.4');assert code==200 and old['total']==1 and 'address' not in old['orders'][0]
  # Per-order throttling survives rotating both client IP and guessed phone.
  for i in range(10):
   code,_,_=api('POST','/api/orders/track',{'mobile':f'0913{1000000+i:07d}','order_id':'YZD-TARGET-UNIQUE'},ip=f'198.51.100.{i+1}');assert code==200,(i,code)
  code,_,_=api('POST','/api/orders/track',{'mobile':'09139999999','order_id':'YZD-TARGET-UNIQUE'},ip='203.0.113.50');assert code==429
  print('PASS mandatory mobile+order, narrow no-store response, legacy IDs, strong new IDs and per-order rate limit')
 finally:proc.terminate();proc.wait(timeout=10)
