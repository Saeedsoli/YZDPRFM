#!/usr/bin/env python3
"""Staged account return form, ownership and XSS in real Chromium."""
import json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parent.parent
payload='<img src=x onerror="window.__xss=1">'
with tempfile.TemporaryDirectory(prefix='returns-browser-') as td:
 t=Path(td);db=t/'db.sqlite';mock=t/'sms.js';mock.write_text('const s=require('+json.dumps(str(root/'src/sms.js'))+');s.sendOtp=async()=>({ok:true});s.send=async()=>({ok:true});')
 s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1];s.close();base=f'http://127.0.0.1:{port}'
 env={**os.environ,'DB_PATH':str(db),'BACKUP_DISABLED':'1','NODE_ENV':'test','PORT':str(port),'NODE_OPTIONS':'--require='+str(mock),'RETURNS_API_TEST_ONLY':'1'}
 p=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 def api(method,path,body):
  req=urllib.request.Request(base+path,data=json.dumps(body).encode(),headers={'Content-Type':'application/json'},method=method)
  try:
   with urllib.request.urlopen(req,timeout=10) as r:return r.status,json.load(r)
  except urllib.error.HTTPError as e:return e.code,json.load(e)
 def token(phone):
  assert api('POST','/api/auth/request-code',{'mobile':phone})[0]==200
  with sqlite3.connect(db) as c:code=c.execute('select code from otp_codes where mobile=?',(phone,)).fetchone()[0]
  status,data=api('POST','/api/auth/verify-code',{'mobile':phone,'code':code});assert status==200,data;return data['token']
 try:
  for _ in range(240):
   if p.poll() is not None:raise RuntimeError(p.stderr.read().decode())
   try:
    with urllib.request.urlopen(base+'/api/health',timeout=1):break
   except OSError:time.sleep(.05)
  else:raise RuntimeError('server not ready')
  now=int(time.time()*1000);fixtures=[]
  with sqlite3.connect(db) as c:
   sku=c.execute('select sku from variants limit 1').fetchone()[0]
   for n,phone in enumerate(['09120001111','09120002222']):
    oid=f'BROWSER-{n}';c.execute("insert into orders(order_id,created_at,customer_name,mobile,subtotal,shipping_fee,total_paid,status) values(?,'2026-01-01','Name',?,100,0,100,'DELIVERED')",(oid,phone))
    def add(name,vol,qty):
     i=c.execute('insert into order_items(order_id,sku,product_name,unit_price,quantity,line_total) values(?,?,?,100,?,?)',(oid,sku,name,qty,100*qty)).lastrowid
     c.execute('insert into return_item_evidence(item_id,volume_ml) values(?,?)',(i,vol));return i
    product=add('کرید — اونتوس «دست‌ساز» '+payload,30,2);sample=add('کرید — اونتوس «دست‌ساز» — سمپل ۵ میل',5,1)
    c.execute('insert into return_delivery_evidence values(?,?,?,?)',(oid,now-1000,now,'staff'));fixtures.append((phone,product,sample));c.commit()
  tokens=[token(f[0]) for f in fixtures]
  with sync_playwright() as pw:
   browser=pw.chromium.launch(headless=True,args=['--no-sandbox'])
   for n,width in enumerate((390,1440)):
    phone,product,sample=fixtures[n];context=browser.new_context(viewport={'width':width,'height':844},service_workers='block');context.add_cookies([{'name':'yazd_customer','value':tokens[n],'url':base,'httpOnly':True,'sameSite':'Lax'}])
    page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    response=page.goto(base+'/account',wait_until='domcontentloaded');expect(page.locator('#content')).to_be_visible();expect(page.locator('#orders')).to_contain_text('مرجوعی تا ۷۲ ساعت')
    policy=response.headers['content-security-policy'];assert "script-src-attr 'none'" in policy
    fallback=next(x.strip() for x in policy.split(';') if x.strip().startswith('script-src '));assert "'unsafe-inline'" not in fallback and "'sha256-" in fallback
    header=page.locator('.order-card .ord-top').first;assert header.get_attribute('aria-expanded')=='true'
    header.focus();page.keyboard.press('Enter');assert header.get_attribute('aria-expanded')=='false'
    page.keyboard.press('Space');assert header.get_attribute('aria-expanded')=='true'
    attack=page.evaluate('''() => new Promise(resolve => {
      let blocked=false;document.addEventListener('securitypolicyviolation',e=>{if(e.effectiveDirective==='script-src-attr')blocked=true});
      const b=document.createElement('button');b.setAttribute('onclick','window.__inline_attack=1');document.body.appendChild(b);b.click();
      setTimeout(()=>resolve({blocked,executed:window.__inline_attack||0}),200);
    })''');assert attack=={'blocked':True,'executed':0},attack
    assert page.locator('#orders img').count()==0;expect(page.locator('#orders')).to_contain_text(payload)
    assert page.locator(f'[data-return-toggle="{sample}"]').count()==0
    assert page.locator(f'[data-return-toggle="{product}"]').count()==1
    expect(page.locator('#orders')).to_contain_text('حجم‌های ۱۰ میل و کمتر')
    page.locator(f'[data-return-toggle="{product}"]').click();form=page.locator(f'[data-return-form="{product}"]');expect(form).to_be_visible()
    form.locator('[name=description]').fill('دلیل مشخص برای درخواست مرجوعی');form.locator('[name=quantity]').fill('2');form.locator('[name=used]').check()
    with page.expect_response(lambda r:r.url.endswith('/api/auth/account-returns') and r.request.method=='POST') as event:form.locator('[type=submit]').click()
    assert event.value.status==201,event.value.text();request=event.value.json()['request_id']
    expect(page.locator('#orders')).to_contain_text(request);expect(page.locator('#orders')).to_contain_text('در انتظار بررسی')
    assert page.locator(f'[data-return-toggle="{product}"]').count()==0
    with sqlite3.connect(db) as c:
     assert c.execute('select quantity,item_id from account_return_requests where request_id=?',(request,)).fetchone()==(2,product)
     c.execute("update tickets set reply=? where ticket_id=?",(payload,request));c.execute("update account_return_requests set status='ANSWERED' where request_id=?",(request,));c.commit()
    page.reload(wait_until='domcontentloaded');expect(page.locator('#orders')).to_contain_text('پاسخ داده شده');expect(page.locator('#orders')).to_contain_text(payload)
    assert page.locator('#orders img').count()==0 and page.evaluate('window.__xss || 0')==0
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
    assert not errors,errors
    page.locator('#accountLogout').click();page.wait_for_url(base+'/');assert not any(c['name']=='yazd_customer' for c in context.cookies())
    context.close()
   browser.close()
  print('PASS staged account return UX, quantity, status, reply XSS and sample labels on mobile/desktop Chromium; mocked SMS')
 finally:
  p.terminate()
  try:p.wait(timeout=5)
  except subprocess.TimeoutExpired:p.kill();p.wait()
