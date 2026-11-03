#!/usr/bin/env python3
"""Verify current-tree and deploy exclusions; this does not audit Git history."""
import os,subprocess
from pathlib import Path
root=Path(__file__).resolve().parent.parent
for f in ('.gitignore','.dockerignore'):
 lines=[x.strip() for x in (root/f).read_text().splitlines() if x.strip() and not x.lstrip().startswith('#')]
 assert '.ssh/' in lines,f'{f} must exclude SSH directory'
if (root/'.git').exists():
 tracked=subprocess.check_output(['git','ls-files','--','.ssh'],cwd=root,text=True).splitlines()
 assert not tracked,'SSH files must not be tracked in current tree'
 check=subprocess.run(['git','check-ignore','--no-index','-q','--','.ssh/id_ed25519'],cwd=root)
 assert check.returncode==0,'SSH private key must be ignored'
else:
 assert not (root/'.ssh').exists(),'isolated build fixture must not contain SSH files'
print('PASS SSH excluded from current Git tree and deployment configuration; historical leaks require revocation')
