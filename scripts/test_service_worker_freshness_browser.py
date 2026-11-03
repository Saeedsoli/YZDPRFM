#!/usr/bin/env python3
"""Real browser: service-worker upgrades, mutable assets and sensitive URL privacy."""
import os,shutil,socket,subprocess,tempfile,time,urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='sw-freshness-') as td:
 t=Path(td);stage=t/'site';stage.mkdir()
 for name in ('src','seed','public'):shutil.copytree(root/name,stage/name)
 (stage/'node_modules').symlink_to(root/'node_modules',target_is_directory=True)
 sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close();base=f'http://127.0.0.1:{port}'
 env={**os.environ,'DB_PATH':str(t/'db.sqlite'),'BACKUP_DISABLED':'1','NODE_ENV':'test','PORT':str(port)}
 p=subprocess.Popen(['node','src/server.js'],cwd=stage,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 try:
  for _ in range(240):
   if p.poll() is not None:raise RuntimeError(p.stderr.read().decode())
   try:
    with urllib.request.urlopen(base+'/api/health',timeout=1):break
   except OSError:time.sleep(.05)
  else:raise RuntimeError('server did not start')
  with sync_playwright() as pw:
   browser=pw.chromium.launch(headless=True,args=['--no-sandbox'])
   for width in (390,1440):
    context=browser.new_context(viewport={'width':width,'height':844},service_workers='allow');page=context.new_page()
    page.goto(base+'/offline',wait_until='load')
    page.evaluate("""async()=>{let c=await caches.open('yazd-v5-pages'); await c.put('/review/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',new Response('old')); await c.put('/track?order=private',new Response('old'));}""")
    page.evaluate("navigator.serviceWorker.register('/sw.js')")
    page.wait_for_function("() => navigator.serviceWorker.controller !== null",timeout=30000)
    page.wait_for_function("() => caches.keys().then(x=>!x.includes('yazd-v5-pages'))",timeout=30000)
    for path in ['/review/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','/track?order=SECRETORDER','/account','/invoice?order=SECRETORDER','/checkout','/wishlist']:
     result=page.evaluate("""async p=>{const r=await fetch(p,{headers:{accept:'text/html'}});return {status:r.status,cache:r.headers.get('cache-control')}}""",path)
     assert result['status']==200 and result['cache']=='no-store',(path,result)
    token=page.evaluate("""async()=>{let a=[];for(const n of await caches.keys()){const c=await caches.open(n);for(const r of await c.keys())a.push(r.url)}return a;}""")
    assert not any('/review/' in u or '/track?' in u or '/account' in u or '/invoice?' in u or '/wishlist' in u for u in token),token
    probe=f'/assets/app.js?freshness={width}'
    before=page.evaluate("async p=>(await fetch(p)).text()",probe)
    marker='SW_FRESHNESS_'+str(width)
    with open(stage/'public/assets/app.js','a') as f:f.write('\n/* '+marker+' */\n')
    after=page.evaluate("async p=>(await fetch(p)).text()",probe)
    assert marker not in before and marker in after,'online asset remained stale'
    # Playwright's offline emulation may not block service-worker network
    # traffic. Stop the actual origin before claiming an offline cache hit.
    p.terminate();p.wait(timeout=10);context.set_offline(True)
    offline=page.evaluate("async p=>(await fetch(p)).text()",probe)
    assert marker in offline,'offline fallback did not retain latest version'
    failure=page.evaluate("async()=>{try{await fetch('/api/health');return false}catch{return true}}")
    assert failure,'API served from cache offline'
    page.goto(base+'/terms?unseen='+str(width),wait_until='domcontentloaded',timeout=12000)
    assert 'اتصال اینترنت برقرار نیست' in page.locator('body').inner_text()
    context.set_offline(False);context.close()
    p=subprocess.Popen(['node','src/server.js'],cwd=stage,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    for _ in range(240):
     if p.poll() is not None:raise RuntimeError(p.stderr.read().decode())
     try:
      with urllib.request.urlopen(base+'/api/health',timeout=1):break
     except OSError:time.sleep(.05)
    else:raise RuntimeError('server restart failed')
   browser.close()
  print('PASS real service worker upgrade clears old caches, sensitive URLs excluded, online assets refresh and offline fallback works on mobile/desktop')
 finally:
  if p.poll() is None:p.terminate()
  try:p.wait(timeout=5)
  except subprocess.TimeoutExpired:p.kill();p.wait()
