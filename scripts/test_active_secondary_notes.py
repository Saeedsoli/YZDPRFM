#!/usr/bin/env python3
"""Fresh and backup-first existing-store note additions; disposable DB only."""
import json,os,sqlite3,subprocess,tempfile
from pathlib import Path
root=Path(__file__).resolve().parent.parent
manifest=json.loads((root/'seed/active_secondary_note_additions_v1.json').read_text());ids={x['product_id'] for x in manifest['items']}
with tempfile.TemporaryDirectory(prefix='secondary-active-notes-') as td:
 td=Path(td);base=td/'baseline.sqlite'
 env={**os.environ,'DB_PATH':str(base),'BACKUP_DISABLED':'1','NODE_ENV':'test','ACTIVE_SECONDARY_NOTES_AUTOSTART':'0'}
 r=subprocess.run(['node','-e',"require('./src/db').db.close()"],cwd=root,env=env,capture_output=True,text=True,timeout=120);assert r.returncode==0,r.stderr
 # Normalization in the standalone offline tool must match the live search.
 probe="const d=require('./src/db'),a=require('./src/active-secondary-notes');const xs=['اُود‌ ي','چوب‌های خشک','۱۲٣'];for(const x of xs)if(d.normalizeFa(x)!==a.normalizeFa(x))process.exit(1);d.db.close()"
 r=subprocess.run(['node','-e',probe],cwd=root,env=env,capture_output=True,text=True,timeout=60);assert r.returncode==0,r.stderr
 def dump(path):
  with sqlite3.connect(path) as c:
   assert c.execute('pragma integrity_check').fetchone()[0]=='ok'
   return {n:sorted(c.execute('select * from "'+n.replace('"','""')+'"').fetchall(),key=repr) for (n,) in c.execute("select name from sqlite_master where type='table' order by name").fetchall()}
 def apply(path,backup):
  r=subprocess.run(['node','src/active-secondary-notes-cli.js','--db',str(path),'--backup',str(backup),'--offline-confirmed'],cwd=root,env=env,capture_output=True,text=True,timeout=120)
  assert r.returncode==0,(r.stdout,r.stderr);return json.loads(r.stdout)
 before=dump(base);saved=td/'before.sqlite';r=apply(base,saved);assert set(r['result']['updated_ids'])==ids and not r['result']['skipped_ids'];assert dump(saved)==before
 after=dump(base)
 for name in before:
  if name not in ('products','product_notes','settings'):assert before[name]==after[name],name
 with sqlite3.connect(base) as c:
  cols=[x[1] for x in c.execute('pragma table_info(products)')];before_p={r[0]:r for r in before['products']};after_p={r[0]:r for r in after['products']}
  mutable={cols.index(x) for x in ('notes_top','notes_middle','notes_base','search_blob')}
  for pid in ids:
   old,new=before_p[pid],after_p[pid];assert all(old[i]==new[i] for i in range(len(cols)) if i not in mutable),pid
   x=next(x for x in manifest['items'] if x['product_id']==pid)
   for pos in ('top','middle','base'):
    assert json.loads(new[cols.index('notes_'+pos)])==x['notes'][pos]
    assert c.execute('select count(*) from product_notes where product_id=? and position=?',(pid,pos)).fetchone()[0]==len(x['notes'][pos])
   assert new[cols.index('search_blob')]!=old[cols.index('search_blob')]
  for pid in set(before_p)-ids:assert before_p[pid]==after_p[pid]
 # One-time marker; re-running cannot modify note data.
 rr=apply(base,td/'before-replay.sqlite');assert rr['result']['reason']=='already_applied';assert dump(base)==after
 # Owner-edited notes and price are skipped, never overwritten.
 edited=td/'edited.sqlite';edited.write_bytes(saved.read_bytes())
 with sqlite3.connect(edited) as c:
  c.execute("update products set notes_top='[\"مدیر\"]' where id=?",(manifest['items'][0]['product_id'],))
  c.execute("update products set essence_usd_per_kg='9999' where id=?",(manifest['items'][1]['product_id'],))
 r=apply(edited,td/'before-edited.sqlite')['result'];assert len(r['updated_ids'])==2 and set(r['skipped_ids'])=={manifest['items'][0]['product_id'],manifest['items'][1]['product_id']}
 with sqlite3.connect(edited) as c:
  assert json.loads(c.execute('select notes_top from products where id=?',(manifest['items'][0]['product_id'],)).fetchone()[0])==['مدیر']
  assert c.execute('select essence_usd_per_kg from products where id=?',(manifest['items'][1]['product_id'],)).fetchone()[0]=='9999'
 # Fresh installs automatically receive the scoped data and indexes.
 fresh=td/'fresh.sqlite';fenv={**env,'DB_PATH':str(fresh),'ACTIVE_SECONDARY_NOTES_AUTOSTART':'1'}
 r=subprocess.run(['node','-e',"require('./src/db').db.close()"],cwd=root,env=fenv,capture_output=True,text=True,timeout=120);assert r.returncode==0,r.stderr
 with sqlite3.connect(fresh) as c:
  for x in manifest['items']:
   p=c.execute('select notes_top from products where id=?',(x['product_id'],)).fetchone();assert json.loads(p[0])==x['notes']['top'],x['product_id']
   assert c.execute('select count(*) from product_notes where product_id=?',(x['product_id'],)).fetchone()[0]>0
 print('PASS scoped independent notes, fresh install, backup, indexes, replay, owner-edit guards and historical table preservation')
