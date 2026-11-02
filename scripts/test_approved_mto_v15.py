#!/usr/bin/env python3
"""Two explicit approvals: isolated fresh boot, cart, replay and owner edits."""
import json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
root=Path(__file__).resolve().parent.parent
items=json.loads((root/'seed/approved_made_to_order_v15.json').read_text())['items']
assert len(items)==2 and len({x['product_id'] for x in items})==2
with tempfile.TemporaryDirectory(prefix='mto-v15-') as td:
 db=str(Path(td)/'fresh.sqlite');s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1];s.close()
 env={**os.environ,'LEGACY_REFERENCES_AUTOSTART':'0','OWNER_REFERENCE_V3_AUTOSTART':'0','GENERIC_SCENTS_V2_AUTOSTART':'0','OWNER_REFERENCE_V2_AUTOSTART':'0','OWNER_REFERENCE_AUTOSTART':'0','GENERIC_SCENTS_AUTOSTART':'0','DB_PATH':db,'BACKUP_DISABLED':'1','PORT':str(port)}
 for k in ['APPROVED_MTO_AUTOSTART']+[f'APPROVED_MTO_V{i}_AUTOSTART' for i in range(2,16)]:env.pop(k,None)
 env['APPROVED_MTO_V16_AUTOSTART']='0';env['APPROVED_MTO_V17_AUTOSTART']='0'
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
  con=sqlite3.connect(db);log=json.loads(con.execute("select value from settings where key='approved_made_to_order_2026_11_v15'").fetchone()[0]);assert log['activated']==2 and not log['skipped']
  assert con.execute("select count(*) from products where supply_mode='MADE_TO_ORDER'").fetchone()[0]==238
  for item in items:
   pid=item['product_id'];assert con.execute('select supply_mode from products where id=?',(pid,)).fetchone()[0]=='MADE_TO_ORDER'
   sku,stock=con.execute("select sku,stock from variants where product_id=? and type='EDP' and volume_ml=10",(pid,)).fetchone();assert stock==0
   assert post(sku,1)==200 and post(sku,6)==400
  con.execute("update products set supply_mode='UNAVAILABLE' where id=?",(items[0]['product_id'],));con.commit();con.close()
 finally:
  server.terminate()
  try:server.wait(timeout=5)
  except subprocess.TimeoutExpired:server.kill();server.wait()
 subprocess.run(['node','-e',"const {db}=require('./src/db');db.close()"],cwd=root,env=env,check=True,stdout=subprocess.DEVNULL,timeout=120)
 con=sqlite3.connect(db);assert con.execute('select supply_mode from products where id=?',(items[0]['product_id'],)).fetchone()[0]=='UNAVAILABLE';con.close()
 # Previous store: no implicit approval, then manual edits prevent activation.
 guard=str(Path(td)/'guard.sqlite');genv={**env,'DB_PATH':guard,'APPROVED_MTO_AUTOSTART':'0'}
 subprocess.run(['node','-e',"const {db}=require('./src/db');db.close()"],cwd=root,env=genv,check=True,stdout=subprocess.DEVNULL,timeout=120)
 con=sqlite3.connect(guard);con.execute('update products set name_en=? where id=?',('owner edit',items[0]['product_id']));con.execute("update variants set price_toman=price_toman+1000 where product_id=? and type='EDP' and volume_ml=10",(items[1]['product_id'],));con.commit();con.close()
 subprocess.run(['node','-e',"const {db}=require('./src/db');const r=require('./src/approved-made-to-order-v15').applyApprovedMadeToOrder(db,'./seed/approved_made_to_order_v15.json');if(r.activated!==0||r.skipped.length!==2)throw Error(JSON.stringify(r));db.close()"],cwd=root,env=genv,check=True,stdout=subprocess.DEVNULL,timeout=120)
 con=sqlite3.connect(guard);assert con.execute('select supply_mode from products where id=?',(items[0]['product_id'],)).fetchone()[0]=='UNAVAILABLE';con.close()
print('PASS two approved, HTTP purchase cap, zero stock, replay and owner edit guards')
