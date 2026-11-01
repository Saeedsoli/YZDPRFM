#!/usr/bin/env python3
"""Isolated backup/restore test; no live DB is modified."""
import gzip,hashlib,io,json,lzma,os,shutil,sqlite3,sys,tarfile,tempfile,zipfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from sqlite_delta_backup import create,restore,sha,HISTORICAL_BUNDLE
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
 # Different compression of the exact same base bytes must be interchangeable.
 xzbase=p/'base.sqlite.xz'
 with open(base_raw,'rb') as f,lzma.open(xzbase,'wb',preset=9) as z:shutil.copyfileobj(f,z)
 xzrestored=p/'xz-restored.sqlite';assert restore(xzbase,delta,xzrestored)['target_sha256']==sha(expected);assert sha(xzrestored)==sha(expected)
 xzdelta=p/'xz-backup.zip';assert create(live,xzbase,xzdelta)['verified'];xzround=p/'xz-round.sqlite';restore(base,xzdelta,xzround);assert sha(xzround)==sha(expected)
 bogus=p/'not-compressed';bogus.write_bytes(b'not a compressed base')
 try:restore(bogus,delta,p/'bad-base-output.sqlite');raise AssertionError('unknown base accepted')
 except ValueError:pass
 assert not (p/'bad-base-output.sqlite').exists()
 check=sqlite3.connect(restored);assert check.execute('pragma integrity_check').fetchone()[0]=='ok';assert check.execute('select amount from customers where id=5').fetchone()[0]==9876;assert check.execute('select count(*) from customers where id=8').fetchone()[0]==0;assert check.execute("select amount from customers where name='new'").fetchone()[0]==54321;check.close()
 # Repacking the exact manifest and page records with ZIP-LZMA must retain
 # a bit-identical restored database and all integrity guards.
 compact=p/'compact-lzma.zip'
 with zipfile.ZipFile(delta) as src,zipfile.ZipFile(compact,'w',compression=zipfile.ZIP_LZMA) as dst:
  for name in src.namelist():dst.writestr(name,src.read(name))
 compact_out=p/'compact-restored.sqlite';compact_info=restore(base,compact,compact_out)
 assert compact_info['target_sha256']==sha(expected) and sha(compact_out)==sha(expected)
 # Old ZIP paths transparently restore from the compact shared archive.
 history_dir=p/'history';history_dir.mkdir();history=history_dir/HISTORICAL_BUNDLE
 with zipfile.ZipFile(delta) as source,tarfile.open(history,'w:xz') as bundle:
  for leaf in ('manifest.json','pages.bin'):
   b=source.read(leaf);entry=tarfile.TarInfo('archived.zip/'+leaf);entry.size=len(b);bundle.addfile(entry,io.BytesIO(b))
 historical_output=p/'historical.sqlite';restore(xzbase,history_dir/'archived.zip',historical_output);assert sha(historical_output)==sha(expected)
 try:restore(xzbase,history_dir/'missing.zip',p/'missing-output.sqlite');raise AssertionError('missing archived delta accepted')
 except ValueError:pass
 assert not (p/'missing-output.sqlite').exists()
 bad_dir=p/'bad-history';bad_dir.mkdir()
 with zipfile.ZipFile(delta) as source,tarfile.open(bad_dir/HISTORICAL_BUNDLE,'w:xz') as bundle:
  for leaf in ('manifest.json','pages.bin'):
   b=bytearray(source.read(leaf))
   if leaf=='pages.bin':b[-1]^=1
   entry=tarfile.TarInfo('bad.zip/'+leaf);entry.size=len(b);bundle.addfile(entry,io.BytesIO(b))
 try:restore(base,bad_dir/'bad.zip',p/'bad-history-output.sqlite');raise AssertionError('tampered historical delta accepted')
 except (ValueError,sqlite3.DatabaseError):pass
 assert not (p/'bad-history-output.sqlite').exists()
 with zipfile.ZipFile(compact) as z:
  man=z.read('manifest.json');pages=bytearray(z.read('pages.bin'));pages[-1]^=1
 bad_lzma=p/'bad-lzma.zip'
 with zipfile.ZipFile(bad_lzma,'w',compression=zipfile.ZIP_LZMA) as z:z.writestr('manifest.json',man);z.writestr('pages.bin',pages)
 try:restore(base,bad_lzma,p/'bad-lzma-output.sqlite');raise AssertionError('tampered LZMA delta accepted')
 except (ValueError,sqlite3.DatabaseError):pass
 assert not (p/'bad-lzma-output.sqlite').exists()
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
 print('PASS: WAL snapshot, gzip/XZ bases, archived and ZIP delta restore, integrity and safety guards')
