#!/usr/bin/env python3
"""Fresh activation, explicit migration, collision, replay and HTTP cart checks."""
import json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
root=Path(__file__).resolve().parent.parent
items=json.loads((root/'seed/generic_scent_owner_approved_v1.json').read_text())['items']
with tempfile.TemporaryDirectory(prefix='generic-scent-') as td:
 db=str(Path(td)/'fresh.sqlite');sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
 env={**os.environ,'OWNER_REFERENCE_V2_AUTOSTART':'0','OWNER_REFERENCE_AUTOSTART':'0','DB_PATH':db,'BACKUP_DISABLED':'1','PORT':str(port)}
 env.pop('APPROVED_MTO_AUTOSTART',None);env.pop('GENERIC_SCENTS_AUTOSTART',None)
 for i in range(2,18):env.pop(f'APPROVED_MTO_V{i}_AUTOSTART',None)
 proc=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 try:
  for _ in range(200):
   if proc.poll() is not None:raise RuntimeError(proc.stderr.read().decode())
   try:
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/products',timeout=1): break
   except Exception:time.sleep(.1)
  else:raise RuntimeError('server startup timeout')
  c=sqlite3.connect(db)
  assert c.execute("select count(*) from products where supply_mode='MADE_TO_ORDER'").fetchone()[0]==250
  for x in items:
   row=c.execute('select name_fa,brand_fa,brand_en,supply_mode,essence_usd_per_kg,transparency_notice from products where id=?',(x['product_id'],)).fetchone()
   assert row[:5]==(x['name_fa'],None,None,'MADE_TO_ORDER',x['usd_per_kg']) and 'عمومی' in row[5]
   variants=c.execute('select sku,type,volume_ml,stock,price_toman from variants where product_id=?',(x['product_id'],)).fetchall()
   assert len(variants)==6 and all(v[3]==0 and v[4]>0 for v in variants)
   sku=variants[0][0]
   def request(n):
    req=urllib.request.Request(f'http://127.0.0.1:{port}/api/cart/calculate',data=json.dumps({'items':[{'sku':sku,'quantity':n}]}).encode(),headers={'Content-Type':'application/json'},method='POST')
    try:
     with urllib.request.urlopen(req,timeout=3) as r:return r.status
    except urllib.error.HTTPError as e:return e.code
   assert request(1)==200 and request(6)!=200
  c.execute("update products set supply_mode='UNAVAILABLE' where id=?",(items[0]['product_id'],));c.commit();c.close()
  out=subprocess.check_output(['node','scripts/apply_generic_scents.js',db],cwd=root,text=True);assert json.loads(out)['reason']=='already_applied'
  c=sqlite3.connect(db);assert c.execute('select supply_mode from products where id=?',(items[0]['product_id'],)).fetchone()[0]=='UNAVAILABLE';c.close()
 finally:
  proc.terminate();proc.wait(timeout=10)
 # A collision must leave all six absent and no marker; use a fresh baseline with approval disabled.
 collision=str(Path(td)/'collision.sqlite');e={**env,'DB_PATH':collision,'APPROVED_MTO_AUTOSTART':'0'}
 subprocess.run(['node','-e',"require('./src/db').db.close()"],cwd=root,env=e,check=True,stdout=subprocess.DEVNULL)
 c=sqlite3.connect(collision);c.execute("insert into products(id,slug,name_fa,name_en) values('collision',?,'x','x')",(items[1]['slug'],));c.commit();c.close()
 p=subprocess.run(['node','scripts/apply_generic_scents.js',collision],cwd=root,capture_output=True);assert p.returncode!=0
 c=sqlite3.connect(collision);assert not c.execute("select 1 from products where id like 'GEN-SCENT-%'").fetchone();assert not c.execute("select 1 from settings where key='generic_scent_owner_approved_2026_11_v1'").fetchone();c.close()
print('PASS: generic fresh deployment, six prices and cart caps, replay, owner edit, atomic collision')
