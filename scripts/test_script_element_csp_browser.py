#!/usr/bin/env python3
"""CSP3: trusted template scripts run; arbitrary inserted script tags do not."""
import os,socket,sqlite3,subprocess,tempfile,time,urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='script-csp-') as td:
 db=str(Path(td)/'db.sqlite');sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close();base=f'http://127.0.0.1:{port}'
 env={**os.environ,'DB_PATH':db,'BACKUP_DISABLED':'1','NODE_ENV':'test','PORT':str(port)}
 p=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 try:
  for _ in range(240):
   if p.poll() is not None:raise RuntimeError(p.stderr.read().decode())
   try:
    with urllib.request.urlopen(base+'/api/health',timeout=1):break
   except OSError:time.sleep(.05)
  else:raise RuntimeError('server did not start')
  with sqlite3.connect(db) as c:
   slug=c.execute("select slug from products where supply_mode!='UNAVAILABLE' limit 1").fetchone()[0]
   article=c.execute('select slug from articles limit 1').fetchone()[0]
  paths=['/','/admin','/journal','/quiz','/login','/wishlist','/invoice','/label','/payment/result','/cart','/checkout','/track','/brands','/essences','/why-us','/samples','/check','/terms','/privacy','/contact','/offline','/payment/sandbox','/review/'+'a'*32,'/perfume/'+slug,'/journal/'+article,'/not-found-csp-test']
  with sync_playwright() as pw:
   browser=pw.chromium.launch(headless=True,args=['--no-sandbox'])
   for width in (390,1440):
    context=browser.new_context(viewport={'width':width,'height':844},service_workers='block');page=context.new_page()
    for path in paths:
     violations=[]
     def console(msg):
      if msg.type=='error' and 'script-src-elem' in msg.text:violations.append(msg.text)
     page.on('console',console)
     response=page.goto(base+path,wait_until='domcontentloaded',timeout=15000);assert response and response.status in (200,404),(path,response and response.status)
     policy=response.headers.get('content-security-policy','');elem=next((v.strip() for v in policy.split(';') if v.strip().startswith('script-src-elem ')),'')
     assert "'sha256-" in elem and "'unsafe-inline'" not in elem,(path,elem)
     assert ("script-src-attr 'none'" if path in ('/login','/checkout') else "script-src-attr 'unsafe-inline'") in policy # other pages remain a risk
     page.wait_for_timeout(100)
     assert not violations,(path,violations)
     page.remove_listener('console',console)
    # Script element insertion should be blocked in Chromium. Event-handler
    # attributes intentionally remain enabled and are NOT claimed protected.
    page.goto(base+'/contact',wait_until='domcontentloaded')
    result=page.evaluate('''() => new Promise(resolve => {
      let blocked=false;document.addEventListener('securitypolicyviolation',e=>{if(e.effectiveDirective==='script-src-elem')blocked=true});
      const s=document.createElement('script');s.textContent='window.__cspInjected=1';document.head.appendChild(s);
      const b=document.createElement('button');b.setAttribute('onclick','window.__cspInlineHandler=1');document.body.appendChild(b);b.click();
      setTimeout(()=>resolve({blocked,script:window.__cspInjected||0,handler:window.__cspInlineHandler||0}),200);
    })''')
    assert result=={'blocked':True,'script':0,'handler':1},result
    context.close()
   browser.close()
  print('PASS CSP template script hashes on 26 routes, arbitrary injected script blocked; inline-event risk remains, mobile/desktop Chromium')
 finally:
  p.terminate()
  try:p.wait(timeout=5)
  except subprocess.TimeoutExpired:p.kill();p.wait()
