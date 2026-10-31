#!/usr/bin/env python3
"""Isolated backup/restore test; no live DB is modified."""
import gzip,hashlib,json,os,shutil,sqlite3,sys,tempfile,zipfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from sqlite_delta_backup import create,restore,sha
with tempfile.TemporaryDirectory(prefix='yazd-delta-test-') as td:
 p=Path(td);live=p/'live.sqlite';base_raw=p/'base.sqlite';base=p/'base.sqlite.gz';expected=p/'expected.sqlite';delta=p/'backup.zip';restored=p/'restored.sqlite'
 c=sqlite3.connect(live);c.execute('pragma journal_mode=WAL');c.execute('create table customers(id integer primary key, name text, amount integer)')
 c.executemany('insert into customers(name,amount) values(?,?)',[(f'user-{i}',i) for i in range(2000)]);c.commit()
 d=sqlite3.connect(base_raw);c.backup(d);d.close()
 with open(base_raw,'rb') as f,gzip.open(base,'wb') as g:shutil.copyfileobj(f,g)
 c.execute("update customers set amount=9876 where id=5");c.execute('delete from customers where id=8');c.execute("insert into customers(name,amount) values('new',54321)");c.commit()
 d=sqlite3.connect(expected);c.backup(d);d.close()
 info=create(live,base,delta);assert info['verified'] and info['changed_pages']>0 and info['target_sha256']==sha(expected)
 result=restore(base,delta,restored);assert result['target_sha256']==sha(expected) and sha(restored)==sha(expected)
 check=sqlite3.connect(restored);assert check.execute('pragma integrity_check').fetchone()[0]=='ok';assert check.execute('select amount from customers where id=5').fetchone()[0]==9876;assert check.execute('select count(*) from customers where id=8').fetchone()[0]==0;assert check.execute("select amount from customers where name='new'").fetchone()[0]==54321;check.close()
 try:restore(base,delta,restored);raise AssertionError('overwrite accepted')
 except FileExistsError:pass
 assert sha(restored)==sha(expected)
 wrong=p/'wrong.sqlite';w=sqlite3.connect(wrong);w.execute('create table different(x)');w.commit();w.close();wronggz=p/'wrong.gz'
 with open(wrong,'rb') as f,gzip.open(wronggz,'wb') as g:shutil.copyfileobj(f,g)
 try:restore(wronggz,delta,p/'wrong-output.sqlite');raise AssertionError('wrong base accepted')
 except ValueError:pass
 assert not (p/'wrong-output.sqlite').exists()
 bad=p/'tampered.zip'
 with zipfile.ZipFile(delta) as z:
  man=z.read('manifest.json');pages=bytearray(z.read('pages.bin'));pages[-1]^=1
 with zipfile.ZipFile(bad,'w',compression=zipfile.ZIP_DEFLATED) as z:z.writestr('manifest.json',man);z.writestr('pages.bin',pages)
 try:restore(base,bad,p/'tampered-output.sqlite');raise AssertionError('tampered delta accepted')
 except (ValueError,sqlite3.DatabaseError):pass
 assert not (p/'tampered-output.sqlite').exists();c.close()
 print('PASS: committed WAL snapshot, exact restore, SQLite integrity, wrong-base/tamper/overwrite rejection')
