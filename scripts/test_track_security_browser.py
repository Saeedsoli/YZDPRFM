#!/usr/bin/env python3
"""Real guest tracking, strict CSP, safe copy and in-flight request guard."""
import os,socket,sqlite3,subprocess,tempfile,time,urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parent.parent
payload='<img src=x onerror="window.__trackXss=true">'
with tempfile.TemporaryDirectory(prefix='track-csp-') as td:
 db=str(Path(td)/'db.sqlite');s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1];s.close();base=f'http://127.0.0.1:{port}'
 env={**os.environ,'DB_PATH':db,'BACKUP_DISABLED':'1','NODE_ENV':'test','PORT':str(port)}
 p=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 try:
  for _ in range(240):
   if p.poll() is not None:raise RuntimeError(p.stderr.read().decode())
   try:
    with urllib.request.urlopen(base+'/api/health',timeout=1):break
   except OSError:time.sleep(.05)
  else:raise RuntimeError('server not ready')
  with sqlite3.connect(db) as c:
   sku=c.execute('select sku from variants limit 1').fetchone()[0]
   for i in (1,2):
    oid=f'TRACK-{i}';phone=f'0912000111{i}'
    c.execute("insert into orders(order_id,created_at,customer_name,mobile,subtotal,shipping_fee,total_paid,status,tracking_code,carrier) values(?,'2026-01-01T00:00:00Z','Test',?,1000,0,1000,'SHIPPED',?,?)",(oid,phone,payload,payload))
    c.execute('insert into order_items(order_id,sku,product_name,unit_price,quantity,line_total) values(?,?,?,1000,1,1000)',(oid,sku,payload))
  with sync_playwright() as pw:
   browser=pw.chromium.launch(headless=True,args=['--no-sandbox'])
   for index,width in enumerate((390,1440),1):
    context=browser.new_context(viewport={'width':width,'height':844},service_workers='block');page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    response=page.goto(base+'/track',wait_until='domcontentloaded');policy=response.headers['content-security-policy'];assert "script-src-attr 'none'" in policy and response.headers['cache-control']=='no-store'
    fallback=next(x.strip() for x in policy.split(';') if x.strip().startswith('script-src '));assert "'unsafe-inline'" not in fallback
    oid=f'TRACK-{index}';phone=f'0912000111{index}';fa=phone.translate(str.maketrans('0123456789','۰۱۲۳۴۵۶۷۸۹'))
    page.locator('#m').fill(fa);page.locator('#orderId').fill(oid);page.locator('#orderId').press('Enter')
    expect(page.locator('#out .order-card')).to_contain_text(oid);expect(page.locator('#out')).to_contain_text(payload)
    expect(page.locator('#out')).to_contain_text('۱۱ / ۱۰ / ۱۴۰۴')
    assert page.locator('#out img, #out script, #out svg[onload]').count()==0 and page.evaluate('window.__trackXss || false') is False
    page.evaluate("() => Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__copied=value}}})")
    button=page.locator('[data-track-copy]');assert button.get_attribute('data-code')==payload;button.click()
    expect(button).to_have_text('کپی شد ✓');assert page.evaluate('window.__copied')==payload
    page.evaluate("() => Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined})");button.click();expect(page.locator('.toast')).to_contain_text('کپی خودکار در این مرورگر در دسترس نیست')
    # Pressing Enter repeatedly while a request is pending must not issue
    # multiple tracking requests, even though inputs remain focusable.
    page.evaluate('''()=>{window.__trackCalls=0;const old=window.fetch.bind(window);window.fetch=(u,o)=>{
      if(String(u)==='/api/orders/track'){window.__trackCalls++;return new Promise(resolve=>{window.__releaseTrack=()=>resolve(new Response(JSON.stringify({orders:[]}),{status:200,headers:{'Content-Type':'application/json'}}))})}return old(u,o)};}''')
    page.locator('#m').press('Enter');page.wait_for_function('()=>window.__trackCalls===1');page.locator('#orderId').press('Enter');page.evaluate('track()');page.wait_for_timeout(100);assert page.evaluate('window.__trackCalls')==1
    page.evaluate('window.__releaseTrack()');expect(page.locator('#out')).to_contain_text('سفارشی با این مشخصات پیدا نشد');expect(page.locator('#trackSearch')).to_be_enabled()
    attack=page.evaluate('''()=>new Promise(resolve=>{let blocked=false;document.addEventListener('securitypolicyviolation',e=>{if(e.effectiveDirective==='script-src-attr')blocked=true});const b=document.createElement('button');b.setAttribute('onclick','window.__inlineAttack=1');document.body.appendChild(b);b.click();setTimeout(()=>resolve({blocked,ran:window.__inlineAttack||0}),200)})''')
    assert attack=={'blocked':True,'ran':0},attack
    assert not errors,errors;assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+1');context.close()
   browser.close()
  print('PASS guest tracking CSP, exact safe copy, Enter controls and in-flight guard on mobile/desktop Chromium')
 finally:
  p.terminate()
  try:p.wait(timeout=5)
  except subprocess.TimeoutExpired:p.kill();p.wait()
