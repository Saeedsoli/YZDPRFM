#!/usr/bin/env python3
"""Old reset/restore commands cannot erase orders; new-file restore is exclusive."""
import hashlib,os,sqlite3,subprocess,tempfile
from pathlib import Path
root=Path(__file__).resolve().parent.parent
def digest(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
with tempfile.TemporaryDirectory(prefix='safe-restore-') as td:
 td=Path(td);live=td/'live.sqlite';backup=td/'snapshot.db'
 c=sqlite3.connect(live)
 for table in ['products','variants','orders','order_items','coupons','reviews','articles','settings','customers']:
  c.execute(f'create table {table}(id text primary key)')
 c.execute("insert into orders values('O-1')");c.execute("insert into customers values('C-1')");c.commit()
 out=sqlite3.connect(backup);c.backup(out);out.close();c.execute("insert into orders values('O-2')");c.commit();c.close()
 env={**os.environ,'DB_PATH':str(live)};baseline=digest(live)
 def run(script,*args):return subprocess.run(['node',f'scripts/{script}',*map(str,args)],cwd=root,env=env,capture_output=True,text=True,timeout=30)
 assert run('reset_for_launch.js','--dry-run').returncode==0
 for args in [('--yes',),('--yes','--dry-run'),('--keep-staff','--yes'),('--help','--yes')]:
  assert run('reset_for_launch.js',*args).returncode!=0 and digest(live)==baseline
 # Old destructive syntax must fail, even with --yes; live and sidecars remain.
 assert run('restore_backup.js',backup,'--yes').returncode!=0 and digest(live)==baseline
 target=td/'restored.sqlite';good=run('restore_backup.js','--to-new',backup,target)
 assert good.returncode==0,good.stderr
 assert digest(target)==digest(backup) and digest(live)==baseline and (target.stat().st_mode&0o777)==0o600
 c=sqlite3.connect(target);assert c.execute('select count(*) from orders').fetchone()[0]==1;c.close()
 assert run('restore_backup.js','--to-new',backup,target).returncode!=0
 assert run('restore_backup.js','--to-new',backup,live).returncode!=0
 assert run('restore_backup.js','--to-new',backup,str(live)+'-wal').returncode!=0
 # Guard both the configured symlink and its actual DB/sidecar locations.
 live_alias=td/'live-alias.sqlite';live_alias.symlink_to(live)
 alias_env={**env,'DB_PATH':str(live_alias)}
 alias_attempt=subprocess.run(['node','scripts/restore_backup.js','--to-new',str(backup),str(live)+'-shm'],cwd=root,env=alias_env,capture_output=True,timeout=30)
 assert alias_attempt.returncode!=0 and not Path(str(live)+'-shm').exists()
 assert run('restore_backup.js','--to-new',live,td/'livecopy.sqlite').returncode!=0
 alias=td/'hardlink.db';os.link(live,alias);assert run('restore_backup.js','--to-new',alias,td/'hardcopy.sqlite').returncode!=0
 sym=td/'link.db';sym.symlink_to(backup);assert run('restore_backup.js','--to-new',sym,td/'symcopy.sqlite').returncode!=0
 (td/'snapshot.db-wal').write_bytes(b'incomplete');assert run('restore_backup.js','--to-new',backup,td/'walcopy.sqlite').returncode!=0;(td/'snapshot.db-wal').unlink()
 broken=td/'bad.db';broken.write_bytes(b'not sqlite');assert run('restore_backup.js','--to-new',broken,td/'badcopy.sqlite').returncode!=0 and not (td/'badcopy.sqlite').exists()
 race=td/'race.sqlite';cmd=['node','scripts/restore_backup.js','--to-new',str(backup),str(race)]
 a=subprocess.Popen(cmd,cwd=root,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE);b=subprocess.Popen(cmd,cwd=root,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 a.communicate(timeout=30);b.communicate(timeout=30);assert sorted([a.returncode,b.returncode])==[0,1] and digest(race)==digest(backup)
 assert digest(live)==baseline
 print('PASS reset disabled, no live restore/WAL overwrite, verified exclusive new-file recovery and safety guards')
