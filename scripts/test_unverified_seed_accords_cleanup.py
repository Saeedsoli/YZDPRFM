#!/usr/bin/env python3
"""Guarded cleanup of fixed unverified seed accord drafts; no data loss outside scope."""
import hashlib,json,os,sqlite3,subprocess,tempfile
from pathlib import Path
root=Path(__file__).resolve().parent.parent
m=json.loads((root/'seed/unverified_seed_accords_cleanup_v1.json').read_text());items=m['items']
raw=(root/'seed/perfumes_catalogue_seed.json').read_bytes();assert hashlib.sha256(raw).hexdigest()==m['seed_sha256']
seed={x['id']:x for x in json.loads(raw)}
assert len(items)==31 and len({x['product_id'] for x in items})==31
for x in items:assert seed[x['product_id']]['accords']==x['expected_accords']
def node(code,env):subprocess.run(['node','-e',code],cwd=root,env=env,check=True,stdout=subprocess.DEVNULL,timeout=120)
with tempfile.TemporaryDirectory(prefix='accord-cleanup-') as td:
 # Isolate this historical cleanup milestone from later independent note batches.
 fresh=str(Path(td)/'fresh.sqlite');env={**os.environ,'DB_PATH':fresh,'BACKUP_DISABLED':'1','ACTIVE_SECONDARY_NOTES_AUTOSTART':'0'}
 for k in ['UNVERIFIED_ACCORD_CLEANUP_AUTOSTART','APPROVED_MTO_AUTOSTART']:env.pop(k,None)
 node("require('./src/db').db.close()",env)
 c=sqlite3.connect(fresh);log=json.loads(c.execute('select value from settings where key=?',(m['version'],)).fetchone()[0]);assert log['updated']==31 and log['skipped']==0
 for x in items:
  p=c.execute('select accords,notes_top,notes_middle,notes_base from products where id=?',(x['product_id'],)).fetchone();assert json.loads(p[0])==[] and [json.loads(v) for v in p[1:]]==[x['expected_notes'][k] for k in ('top','middle','base')]
  assert c.execute("select count(*) from product_notes where product_id=? and position='accord'",(x['product_id'],)).fetchone()[0]==0
 c.close()
 old=str(Path(td)/'previous.sqlite');env['DB_PATH']=old;env['UNVERIFIED_ACCORD_CLEANUP_AUTOSTART']='0';node("require('./src/db').db.close()",env)
 c=sqlite3.connect(old)
 c.execute('update products set accords=? where id=?',(json.dumps(['یادداشت مدیر'],ensure_ascii=False),items[0]['product_id']))
 c.execute('update products set notes_top=? where id=?',(json.dumps(['نت مدیر'],ensure_ascii=False),items[1]['product_id']))
 c.execute("update products set supply_mode='UNAVAILABLE' where id=?",(items[2]['product_id'],))
 c.execute("update products set essence_usd_per_kg='999' where id=?",(items[3]['product_id'],));c.commit()
 ids=[x['product_id'] for x in items];ph=','.join('?'*len(ids))
 before={t:c.execute(f'select * from {t} order by rowid').fetchall() for t in ['variants','orders','order_items','customers','wishlist','staff','stock_alerts','supplier_price_evidence','official_identity_evidence','secondary_reference_evidence']}
 before_products=set(c.execute(f'select * from products where id not in ({ph})',ids).fetchall())
 before_notes=set(c.execute(f'select * from product_notes where product_id not in ({ph})',ids).fetchall());c.close()
 out=subprocess.check_output(['node','scripts/apply_unverified_seed_accords.js',old],cwd=root,text=True);result=json.loads(out.strip().splitlines()[-1]);assert result['updated']==27 and result['skipped']==4 and set(result['skipped_ids'])==set(ids[:4])
 c=sqlite3.connect(old)
 for t,rows in before.items():assert c.execute(f'select * from {t} order by rowid').fetchall()==rows,t
 assert set(c.execute(f'select * from products where id not in ({ph})',ids).fetchall())==before_products
 assert set(c.execute(f'select * from product_notes where product_id not in ({ph})',ids).fetchall())==before_notes
 assert json.loads(c.execute('select accords from products where id=?',(ids[0],)).fetchone()[0])==['یادداشت مدیر']
 assert json.loads(c.execute('select notes_top from products where id=?',(ids[1],)).fetchone()[0])==['نت مدیر']
 assert c.execute("select count(*) from product_notes where product_id=? and position='accord'",(ids[4],)).fetchone()[0]==0
 c.execute('update products set accords=? where id=?',(json.dumps(['تغییر بعدی مدیر'],ensure_ascii=False),ids[4]));c.commit();c.close()
 out=subprocess.check_output(['node','scripts/apply_unverified_seed_accords.js',old],cwd=root,text=True);assert json.loads(out.strip().splitlines()[-1])['reason']=='already_applied'
 c=sqlite3.connect(old);assert json.loads(c.execute('select accords from products where id=?',(ids[4],)).fetchone()[0])==['تغییر بعدی مدیر'];assert c.execute('pragma integrity_check').fetchone()[0]=='ok';c.close()
print('PASS 31 seeded drafts, scoped reindex, owner edits, stock/order and replay guards')
