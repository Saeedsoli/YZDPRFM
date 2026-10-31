#!/usr/bin/env python3
"""Verified page-delta SQLite backups. A matching gzip or XZ full base is required.

Neither create nor restore ever overwrites an existing file. Backups may contain
private customer data and must remain outside Git. Restore writes a NEW database;
never point it at a running database. Python standard library only.
"""
import argparse, gzip, hashlib, json, lzma, os, shutil, sqlite3, struct, tempfile, zipfile
from pathlib import Path
VERSION='yazd-sqlite-page-delta-v1'
MAX_BYTES=1024*1024*1024

def sha(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        while chunk:=f.read(1024*1024): h.update(chunk)
    return h.hexdigest()

def validate_sqlite(path):
    with open(path,'rb') as f: head=f.read(100)
    if len(head)<100 or head[:16]!=b'SQLite format 3\x00': raise ValueError('Not a SQLite database')
    page=int.from_bytes(head[16:18],'big');page=65536 if page==1 else page
    size=os.path.getsize(path)
    if page<512 or page>65536 or page&(page-1) or size%page or size>MAX_BYTES: raise ValueError('Invalid SQLite size/page size')
    c=sqlite3.connect(Path(path).resolve().as_uri()+'?mode=ro&immutable=1',uri=True)
    try:
        if c.execute('PRAGMA integrity_check').fetchone()[0]!='ok': raise ValueError('SQLite integrity check failed')
    finally: c.close()
    return page,size

def expand_base(base,out):
    with open(base,'rb') as f: magic=f.read(6)
    if magic.startswith(b'\x1f\x8b'): opener=gzip.open
    elif magic==b'\xfd7zXZ\x00': opener=lzma.open
    else: raise ValueError('Unsupported base compression')
    with opener(base,'rb') as src,open(out,'wb') as dst:
        total=0
        while chunk:=src.read(1024*1024):
            total+=len(chunk)
            if total>MAX_BYTES: raise ValueError('Base exceeds size limit')
            dst.write(chunk)

def atomic_publish(temp,output):
    # Hard-link is atomic and cannot overwrite an existing file/symlink.
    with open(temp,'rb') as f: os.fsync(f.fileno())
    os.link(temp,output);os.unlink(temp)

def restore(base,delta,output):
    out=Path(output).absolute();out.parent.mkdir(parents=True,exist_ok=True)
    if out.exists() or out.is_symlink(): raise FileExistsError('Restore output already exists')
    fd,work=tempfile.mkstemp(prefix='.restore-',dir=out.parent);os.close(fd)
    try:
        expand_base(base,work);base_page,base_size=validate_sqlite(work)
        with zipfile.ZipFile(delta,'r') as z:
            if sorted(z.namelist())!=['manifest.json','pages.bin']: raise ValueError('Unexpected archive contents')
            if z.getinfo('manifest.json').file_size>8192: raise ValueError('Manifest too large')
            m=json.loads(z.read('manifest.json'))
            fields=['page_size','base_size','target_size','changed_pages']
            if m.get('version')!=VERSION or not all(type(m.get(k)) is int for k in fields): raise ValueError('Invalid manifest')
            page=m['page_size'];target_size=m['target_size'];count=m['changed_pages']
            if page!=base_page or base_size!=m['base_size'] or sha(work)!=m.get('base_sha256'): raise ValueError('Wrong base backup')
            if target_size<=0 or target_size>MAX_BYTES or target_size%page or count<0 or count>target_size//page: raise ValueError('Invalid target size')
            if z.getinfo('pages.bin').file_size!=count*(4+page): raise ValueError('Invalid delta length')
            with open(work,'r+b') as dst,z.open('pages.bin','r') as src:
                dst.truncate(target_size);last=-1
                for _ in range(count):
                    rec=src.read(4+page)
                    if len(rec)!=4+page: raise ValueError('Truncated delta')
                    idx=struct.unpack('>I',rec[:4])[0]
                    if idx<=last or idx>=target_size//page: raise ValueError('Invalid page index')
                    dst.seek(idx*page);dst.write(rec[4:]);last=idx
                if src.read(1): raise ValueError('Unexpected delta bytes')
            if sha(work)!=m.get('target_sha256'): raise ValueError('Restored checksum mismatch')
        validate_sqlite(work);atomic_publish(work,str(out));work=None
        return {'target_sha256':m['target_sha256'],'size':target_size,'changed_pages':count}
    finally:
        if work and os.path.exists(work):os.unlink(work)

def create(db,base,output):
    out=Path(output).absolute();out.parent.mkdir(parents=True,exist_ok=True)
    if out.exists() or out.is_symlink(): raise FileExistsError('Backup output already exists')
    fd,tempzip=tempfile.mkstemp(prefix='.delta-',dir=out.parent);os.close(fd)
    try:
        with tempfile.TemporaryDirectory(prefix='yazd-delta-') as tmp:
            b=os.path.join(tmp,'base.sqlite');t=os.path.join(tmp,'target.sqlite');patch=os.path.join(tmp,'pages.bin')
            expand_base(base,b);bp,bs=validate_sqlite(b)
            src=sqlite3.connect(Path(db).resolve().as_uri()+'?mode=ro',uri=True,timeout=10);dst=sqlite3.connect(t)
            try:src.backup(dst)
            finally:dst.close();src.close()
            tp,ts=validate_sqlite(t)
            if tp!=bp:raise ValueError('Page size differs from base')
            changed=0
            with open(b,'rb') as bf,open(t,'rb') as tf,open(patch,'wb') as pf:
                for idx in range(ts//tp):
                    new=tf.read(tp);old=bf.read(tp)
                    if new!=old:pf.write(struct.pack('>I',idx));pf.write(new);changed+=1
            manifest={'version':VERSION,'base_filename':Path(base).name,'base_sha256':sha(b),'target_sha256':sha(t),'page_size':tp,'base_size':bs,'target_size':ts,'changed_pages':changed}
            with zipfile.ZipFile(tempzip,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
                z.writestr('manifest.json',json.dumps(manifest,separators=(',',':')));z.write(patch,'pages.bin')
            # Test full restoration and byte-for-byte checksum before publishing.
            check=os.path.join(tmp,'restore-check.sqlite');restore(base,tempzip,check)
            if sha(check)!=manifest['target_sha256']:raise ValueError('Restore verification failed')
            atomic_publish(tempzip,str(out));tempzip=None
            return {**manifest,'delta_bytes':out.stat().st_size,'verified':True}
    finally:
        if tempzip and os.path.exists(tempzip):os.unlink(tempzip)

def main():
    p=argparse.ArgumentParser();s=p.add_subparsers(dest='command',required=True)
    a=s.add_parser('create');a.add_argument('--db',required=True);a.add_argument('--base',required=True);a.add_argument('--output',required=True)
    b=s.add_parser('restore');b.add_argument('--base',required=True);b.add_argument('--delta',required=True);b.add_argument('--output',required=True)
    o=p.parse_args()
    try:
        result=create(o.db,o.base,o.output) if o.command=='create' else restore(o.base,o.delta,o.output)
        print(json.dumps(result,ensure_ascii=False))
    except Exception as e:
        p.exit(1,f'Backup error: {e}\n')
if __name__=='__main__':main()
