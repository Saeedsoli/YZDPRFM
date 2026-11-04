#!/usr/bin/env python3
"""Uploaded attachments must stay out of Git, deploy and isolated test stages."""
import os,shutil,subprocess,tempfile
from pathlib import Path
root=Path(__file__).resolve().parent.parent
name='لیست_قیمت_عمده.md'
def lines(p):return [x.strip() for x in (root/p).read_text().splitlines() if x.strip() and not x.lstrip().startswith('#')]
gitignore=lines('.gitignore');docker=lines('.dockerignore')
assert '/uploads/*' in gitignore and '!/uploads/'+name in gitignore
assert 'uploads/' in docker and not any(x.startswith('!') and 'uploads' in x for x in docker)
if (root/'.git').exists():
 tracked=subprocess.check_output(['git','ls-files','-z','--','uploads'],cwd=root).decode().split('\0')
 assert [x for x in tracked if x]==['uploads/'+name], 'Unexpected tracked upload; review before publication'
 for path in ['uploads/private-attachment.txt','uploads/future-secret.json']:
  assert subprocess.run(['git','check-ignore','--no-index','-q','--',path],cwd=root).returncode==0
 assert subprocess.run(['git','check-ignore','--no-index','-q','--','uploads/'+name],cwd=root).returncode==1
else:
 assert sorted(x.name for x in (root/'uploads').iterdir())==[name], 'Isolated stage contains extra uploaded files'
for p in ('scripts/smoke_test.sh','scripts/test_node22_integration.sh'):
 s=(root/p).read_text();assert "--exclude='./uploads'" in s and 'copy_supplier_fixture.py' in s
 assert "--exclude='./.env'" in s and "--exclude='./.env.*'" in s
with tempfile.TemporaryDirectory(prefix='attachment-fixture-test-') as td:
 t=Path(td);source=t/'source';stage=t/'stage';(source/'uploads').mkdir(parents=True);stage.mkdir()
 shutil.copyfile(root/'uploads'/name,source/'uploads'/name)
 (source/'uploads'/'private-attachment.txt').write_text('SYNTHETIC-PRIVATE-DATA')
 helper=root/'scripts/copy_supplier_fixture.py'
 r=subprocess.run(['python3',str(helper),str(source),str(stage)],capture_output=True,text=True)
 assert r.returncode==0,r.stderr
 assert sorted(x.name for x in (stage/'uploads').iterdir())==[name]
 assert (stage/'uploads'/name).read_bytes()==(root/'uploads'/name).read_bytes()
 assert not (stage/'uploads'/'private-attachment.txt').exists()
 # Unknown contents and symlinks cannot be used to sneak another attachment in.
 (source/'uploads'/name).write_text('SYNTHETIC-PRIVATE-DATA');stage2=t/'stage2';stage2.mkdir()
 r=subprocess.run(['python3',str(helper),str(source),str(stage2)],capture_output=True,text=True);assert r.returncode!=0 and not (stage2/'uploads'/name).exists()
 (source/'uploads'/name).unlink();(source/'uploads'/name).symlink_to(root/'uploads'/name);stage3=t/'stage3';stage3.mkdir()
 r=subprocess.run(['python3',str(helper),str(source),str(stage3)],capture_output=True,text=True);assert r.returncode!=0 and not (stage3/'uploads'/name).exists()
print('PASS attachment Git/deploy exclusion, env exclusion, fixture-only staging and symlink/hash rejection')
