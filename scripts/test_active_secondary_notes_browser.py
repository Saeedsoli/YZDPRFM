#!/usr/bin/env python3
"""Fresh install independent notes and simple display in isolated Chromium."""
import json,os,socket,subprocess,tempfile,time,urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parent.parent
batch=os.environ.get('NOTE_TEST_BATCH','1');assert batch in ('1','2')
manifest=json.loads((root/f'seed/active_secondary_note_additions_v{batch}.json').read_text())
with tempfile.TemporaryDirectory(prefix='secondary-notes-browser-') as td:
 s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1];s.close();base=f'http://127.0.0.1:{port}'
 env={**os.environ,'DB_PATH':str(Path(td)/'db.sqlite'),'BACKUP_DISABLED':'1','NODE_ENV':'test','PORT':str(port)}
 p=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 try:
  for _ in range(240):
   if p.poll() is not None:raise RuntimeError(p.stderr.read().decode())
   try:
    with urllib.request.urlopen(base+'/api/health',timeout=1):break
   except OSError:time.sleep(.05)
  else:raise RuntimeError('server did not start')
  with sync_playwright() as pw:
   browser=pw.chromium.launch(executable_path=os.environ.get('CHROME_EXECUTABLE') or None,headless=True,args=['--no-sandbox'])
   for width in (390,1440):
    context=browser.new_context(viewport={'width':width,'height':844},service_workers='block');page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.route('**/*',lambda route:route.continue_() if route.request.url.startswith(base) else route.abort())
    for x in manifest['items']:
     page.goto(base+'/perfume/'+x['slug'],wait_until='domcontentloaded');expect(page.locator('#content')).to_be_visible()
     assert page.locator('#pyramid .layer').count()==3,x['slug']
     for note in x['notes']['top']:expect(page.locator('#pyramid')).to_contain_text(note)
     assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'),(x['slug'],width)
    assert not errors,errors;context.close()
   browser.close()
  print(f"PASS {len(manifest['items'])} note pyramids and mobile/desktop layouts on fresh isolated store")
 finally:
  p.terminate()
  try:p.wait(timeout=5)
  except subprocess.TimeoutExpired:p.kill();p.wait()
