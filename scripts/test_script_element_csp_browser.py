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
     assert "script-src 'self' 'unsafe-inline'" not in policy,(path,policy)
     assert "script-src-attr 'none'" in policy,(path,policy)
     inline=None
     for _ in range(8):
      try:
       inline=page.evaluate("""() => [...document.querySelectorAll('*')].flatMap(e=>[...e.attributes].filter(a=>/^on[a-z][a-z0-9:_-]*$/i.test(a.name)).map(a=>e.tagName+'.'+a.name))""")
       break
      except Exception:
       page.wait_for_timeout(100)
     assert inline is not None,(path,'DOM kept navigating; event scan unavailable')
     assert not inline,(path,inline[:5])
     page.wait_for_timeout(100)
     assert not violations,(path,violations)
     page.remove_listener('console',console)
    page.goto(base+'/contact',wait_until='domcontentloaded')
    strict_result=page.evaluate('''() => new Promise(resolve => {
      const violations=[];document.addEventListener('securitypolicyviolation',e=>violations.push(e.effectiveDirective));
      const s=document.createElement('script');s.textContent='window.__cspInjected=1';document.head.appendChild(s);
      const b=document.createElement('button');b.setAttribute('onclick','window.__cspInlineHandler=1');document.body.appendChild(b);b.click();
      setTimeout(()=>resolve({violations,script:window.__cspInjected||0,handler:window.__cspInlineHandler||0}),200);
    })''')
    assert strict_result['script']==0 and strict_result['handler']==0,str(strict_result)
    assert 'script-src-elem' in strict_result['violations'] and 'script-src-attr' in strict_result['violations'],strict_result
    page.goto(base+'/',wait_until='domcontentloaded')
    loose_result=page.evaluate('''() => new Promise(resolve => {
      const s=document.createElement('script');s.textContent='window.__cspInjected=1';document.head.appendChild(s);
      const b=document.createElement('button');b.setAttribute('onclick','window.__cspInlineHandler=1');document.body.appendChild(b);b.click();
      setTimeout(()=>resolve({script:window.__cspInjected||0,handler:window.__cspInlineHandler||0}),150);
    })''')
    assert loose_result=={'script':0,'handler':0},loose_result
    context.close()
   browser.close()
  print('PASS CSP template hashes on 26 routes, unsafe inline scripts and event handlers blocked globally, mobile/desktop Chromium')
 finally:
  p.terminate()
  try:p.wait(timeout=5)
  except subprocess.TimeoutExpired:p.kill();p.wait()
