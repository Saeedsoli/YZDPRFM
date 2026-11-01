#!/usr/bin/env python3
"""One explicit approval: isolated fresh boot, cart, replay and owner-edit guards."""
import json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error,urllib.parse
from pathlib import Path
root=Path(__file__).resolve().parent.parent
items=json.loads((root/'seed/approved_made_to_order_v9.json').read_text())['items'];assert len(items)==1
with tempfile.TemporaryDirectory(prefix='mto-v9-') as td:
 db=str(Path(td)/'fresh.sqlite');s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1];s.close()
 env={**os.environ,'DB_PATH':db,'BACKUP_DISABLED':'1','PORT':str(port)}
 for k in ['APPROVED_MTO_AUTOSTART','APPROVED_MTO_V2_AUTOSTART','APPROVED_MTO_V3_AUTOSTART','APPROVED_MTO_V4_AUTOSTART','APPROVED_MTO_V5_AUTOSTART','APPROVED_MTO_V6_AUTOSTART','APPROVED_MTO_V7_AUTOSTART','APPROVED_MTO_V8_AUTOSTART','APPROVED_MTO_V9_AUTOSTART']:env.pop(k,None)
 env['APPROVED_MTO_V10_AUTOSTART']='0';env['APPROVED_MTO_V11_AUTOSTART']='0';env['APPROVED_MTO_V12_AUTOSTART']='0';env['APPROVED_MTO_V13_AUTOSTART']='0';env['APPROVED_MTO_V14_AUTOSTART']='0';env['APPROVED_MTO_V15_AUTOSTART']='0'
 server=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 def post(sku,n):
  req=urllib.request.Request(f'http://127.0.0.1:{port}/api/cart/calculate',data=json.dumps({'items':[{'sku':sku,'quantity':n}]}).encode(),headers={'Content-Type':'application/json'},method='POST')
  try:
   with urllib.request.urlopen(req,timeout=3) as r:return r.status
  except urllib.error.HTTPError as e:return e.code
 try:
  for _ in range(200):
   if server.poll() is not None:raise RuntimeError(server.stderr.read().decode())
   try:
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health',timeout=2):break
   except OSError:time.sleep(.1)
  else:raise RuntimeError('server not ready')
  with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/products?limit=100&q='+urllib.parse.quote('ایترنتی'),timeout=3) as res:data=json.load(res)
  assert any(x['id']=='SUP-CK-900001' for x in data['products'])
  con=sqlite3.connect(db);log=json.loads(con.execute("select value from settings where key='approved_made_to_order_2026_11_v9'").fetchone()[0]);assert log['activated']==1 and not log['skipped']
  assert con.execute("select count(*) from products where supply_mode='MADE_TO_ORDER'").fetchone()[0]==215
  pid=items[0]['product_id'];sku,stock=con.execute("select sku,stock from variants where product_id=? and type='EDP' and volume_ml=10",(pid,)).fetchone();assert stock==0
  assert post(sku,1)==200 and post(sku,6)==400
  con.execute("update products set supply_mode='UNAVAILABLE' where id=?",(pid,));con.commit();con.close()
 finally:
  server.terminate()
  try:server.wait(timeout=5)
  except subprocess.TimeoutExpired:server.kill();server.wait()
 subprocess.run(['node','-e',"const {db}=require('./src/db');db.close()"],cwd=root,env=env,check=True,stdout=subprocess.DEVNULL,timeout=120)
 con=sqlite3.connect(db);assert con.execute('select supply_mode from products where id=?',(pid,)).fetchone()[0]=='UNAVAILABLE';con.close()
 guard=str(Path(td)/'guard.sqlite');genv={**env,'DB_PATH':guard,'APPROVED_MTO_AUTOSTART':'0'}
 subprocess.run(['node','-e',"const {db}=require('./src/db');db.close()"],cwd=root,env=genv,check=True,stdout=subprocess.DEVNULL,timeout=120)
 con=sqlite3.connect(guard);con.execute("update variants set price_toman=price_toman+1000 where product_id=? and type='EDP' and volume_ml=10",(pid,));con.commit();con.close()
 subprocess.run(['node','-e',"const {db}=require('./src/db');const r=require('./src/approved-made-to-order-v9').applyApprovedMadeToOrder(db,'./seed/approved_made_to_order_v9.json');if(r.activated!==0||r.skipped.length!==1)throw Error(JSON.stringify(r));db.close()"],cwd=root,env=genv,check=True,stdout=subprocess.DEVNULL,timeout=120)
 con=sqlite3.connect(guard);assert con.execute('select supply_mode from products where id=?',(pid,)).fetchone()[0]=='UNAVAILABLE';con.close()
print('PASS one approved, HTTP purchase cap, zero stock, replay and owner edit guard')
