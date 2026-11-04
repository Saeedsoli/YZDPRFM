#!/usr/bin/env python3
"""Copy only the known, hash-verified price fixture to an isolated test stage.

The uploads directory can contain private attachments. Never copy it wholesale
or follow a symlink. No fixture contents or credentials are printed.
"""
import hashlib,os,stat,sys
from pathlib import Path
NAME='لیست_قیمت_عمده.md'
SHA256='bbe8f40610bc765bda0a7d2da9dbe78f4e397458a6991239c3c18d0853f33f5c'
LIMIT=2*1024*1024
if len(sys.argv)!=3:
 print('Usage: copy_supplier_fixture.py <source-root> <empty-stage-root>',file=sys.stderr);sys.exit(2)
source=Path(sys.argv[1])/'uploads'/NAME; stage=Path(sys.argv[2]);target=stage/'uploads'/NAME
try:
 flags=os.O_RDONLY|getattr(os,'O_NOFOLLOW',0)
 if not getattr(os,'O_NOFOLLOW',0):raise RuntimeError('Safe source opening unavailable')
 fd=os.open(source,flags)
 try:
  st=os.fstat(fd)
  if not stat.S_ISREG(st.st_mode) or st.st_nlink!=1 or st.st_size>LIMIT:raise RuntimeError('Unsafe fixture source')
  with os.fdopen(fd,'rb',closefd=False) as f:data=f.read(LIMIT+1)
 finally:os.close(fd)
 if len(data)>LIMIT or hashlib.sha256(data).hexdigest()!=SHA256:raise RuntimeError('Fixture hash mismatch')
 target.parent.mkdir(parents=True,exist_ok=True)
 if target.parent.is_symlink():raise RuntimeError('Unsafe stage directory')
 fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 try:
  with os.fdopen(fd,'wb',closefd=False) as f:f.write(data);f.flush()
 finally:os.close(fd)
except (OSError,RuntimeError) as e:
 print('Fixture staging failed: '+str(e),file=sys.stderr);sys.exit(1)
