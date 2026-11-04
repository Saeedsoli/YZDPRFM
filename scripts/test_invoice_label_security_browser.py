#!/usr/bin/env python3
"""Real Chromium: hostile invoice fields stay literal and print controls work."""
import json,os,socket,subprocess,tempfile,time,urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parent.parent
payload='<img src=x onerror="window.__attack=true">'
with tempfile.TemporaryDirectory(prefix='invoice-label-xss-') as td:
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
  order={'order_id':payload,'created_at':'2026-11-01T10:00:00Z','status':payload,'customer_name':payload,'mobile':payload,'province':payload,'city':payload,'address':payload,'postal_code':payload,'carrier':payload,'payment_ref':payload,'discount_code':payload,'customer_note':payload}
  item={'product_name':payload,'sku':payload,'quantity':payload,'unit_price':1000,'line_total':1000}
  settings={'shop_name':payload,'shop_name_en':payload,'legal_name':payload,'economic_code':payload,'national_id':payload,'register_no':payload,'address':payload,'phone':payload,'postal_code':payload,'sender_person':payload,'invoice_note':payload}
  totals={'subtotal':1000,'campaign':0,'coupon':0,'shipping':0,'gift_wrap':0,'grand_total':1000}
  fixture={'order':order,'items':[item],'settings':settings,'totals':totals,'invoice_no':payload}
  with sync_playwright() as pw:
   browser=pw.chromium.launch(headless=True,args=['--no-sandbox'])
   for width in (390,1440):
    context=browser.new_context(viewport={'width':width,'height':844},service_workers='block');page=context.new_page();errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.route('**/api/orders/*/invoice',lambda r:r.fulfill(status=200,json=fixture))
    for screen,selector,buttons in [('invoice?order=TEST&formal=1','#sheet',2),('label?order=TEST','#label',1)]:
     response=page.goto(base+'/'+screen,wait_until='domcontentloaded');policy=response.headers['content-security-policy']
     assert "script-src-attr 'none'" in policy
     fallback=next(x.strip() for x in policy.split(';') if x.strip().startswith('script-src '));assert "'unsafe-inline'" not in fallback
     expect(page.locator(selector)).to_contain_text(payload)
     expect(page.locator(selector)).to_contain_text('۱۰ / ۰۸ / ۱۴۰۵')
     assert page.locator(selector+' img, '+selector+' script, '+selector+' svg[onload]').count()==0
     barcode=page.locator(selector+' svg[role=img]');assert barcode.count()==1 and barcode.get_attribute('aria-label')=='بارکد '+payload
     assert page.evaluate('window.__attack || false') is False
     if screen.startswith('invoice'):assert page.evaluate('toWords(Infinity)')=='—' and page.evaluate('toWords(0)')=='صفر'
     page.evaluate('() => { window.__printed=0; window.print=()=>{window.__printed++}; }')
     assert page.locator('[data-print]').count()==buttons
     for i in range(buttons):page.locator('[data-print]').nth(i).click()
     assert page.evaluate('window.__printed')==buttons,(screen,buttons,page.evaluate('window.__printed'),errors)
     attack=page.evaluate('''()=>new Promise(resolve=>{let blocked=false;document.addEventListener('securitypolicyviolation',e=>{if(e.effectiveDirective==='script-src-attr')blocked=true});const b=document.createElement('button');b.setAttribute('onclick','window.__inlineAttack=1');document.body.appendChild(b);b.click();setTimeout(()=>resolve({blocked,ran:window.__inlineAttack||0}),200)})''')
     assert attack=={'blocked':True,'ran':0},attack
    assert not errors,errors;context.close()
   browser.close()
  print('PASS invoice/label escaping, barcode SVG attribute, strict CSP and print controls on mobile/desktop Chromium')
 finally:
  p.terminate()
  try:p.wait(timeout=5)
  except subprocess.TimeoutExpired:p.kill();p.wait()
