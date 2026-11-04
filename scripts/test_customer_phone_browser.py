#!/usr/bin/env python3
"""Real browser: verified signup, legacy reset, OTP login and safe account rendering."""
import hashlib,os,re,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.parse
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='phone-verify-browser-') as td:
 db=str(Path(td)/'db.sqlite');sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
 env={**os.environ,'DB_PATH':db,'BACKUP_DISABLED':'1','NODE_ENV':'test','PORT':str(port),'ADMIN_PASSWORD':'Browser-Phone-Owner-827','SMS_PROVIDER':'console'}
 proc=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE);base=f'http://127.0.0.1:{port}'
 def code_for(mobile):
  c=sqlite3.connect(db);r=c.execute('select code from otp_codes where mobile=?',(mobile,)).fetchone();c.close();assert r;return r[0]
 try:
  for _ in range(200):
   if proc.poll() is not None:raise RuntimeError(proc.stderr.read().decode())
   try:
    with urllib.request.urlopen(base+'/api/health',timeout=1):break
   except OSError:time.sleep(.1)
  else:raise RuntimeError('server not ready')
  c=sqlite3.connect(db)
  for index in range(2):
   legacy=f'0912000777{index+1}';salt=os.urandom(16).hex();h=hashlib.scrypt(b'Legacy-Old-Password-83',salt=salt.encode(),n=16384,r=8,p=1,dklen=64,maxmem=33554432).hex()
   c.execute("insert into customers(mobile,first_name,pass_hash,pass_salt) values(?,'Legacy',?,?)",(legacy,h,salt))
   guest=f'0912000888{index+1}';oid=f'BROWSER-GUEST-{index+1}'
   c.execute("insert into orders(order_id,created_at,customer_name,mobile,subtotal,shipping_fee,total_paid,status,carrier,tracking_code,discount_code,discount_amount,payment_ref) values(?,?,'Test',?,1000,0,1000,'PAID',?,'CODE',?,1,?)",(oid,time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),guest,'<svg onload=window.__attack=1>','<img src=x onerror=window.__attack=2>','<img src=x onerror=window.__attack=3>'))
  c.commit();c.close()
  with sync_playwright() as pw:
   browser=pw.chromium.launch(headless=True,args=['--no-sandbox'])
   for index,width in enumerate([390,1440]):
    page=browser.new_page(viewport={'width':width,'height':844});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.route('**/*',lambda route:route.continue_() if route.request.url.startswith(base) else route.abort())
    mobile=f'0912000666{index+1}';password='Browser-Password-9826'
    # Signup asks for OTP before creating a password-bearing account; malicious next is rejected.
    attack=urllib.parse.quote('javascript:window.__attack=9',safe='');response=page.goto(base+'/login?next='+attack,wait_until='domcontentloaded')
    policy=response.headers['content-security-policy'];assert "script-src-attr 'none'" in policy
    fallback=next(x.strip() for x in policy.split(';') if x.strip().startswith('script-src '));assert "'unsafe-inline'" not in fallback and "'sha256-" in fallback
    result=page.evaluate('''() => new Promise(resolve => {
      const blocked=[];document.addEventListener('securitypolicyviolation',e=>blocked.push(e.effectiveDirective));
      const el=document.createElement('button');el.setAttribute('onclick','window.__blockedHandler=1');document.body.appendChild(el);el.click();
      const script=document.createElement('script');script.textContent='window.__blockedScript=1';document.head.appendChild(script);
      setTimeout(()=>resolve({blocked,handler:window.__blockedHandler||0,script:window.__blockedScript||0}),200);
    })''');assert 'script-src-attr' in result['blocked'] and 'script-src-elem' in result['blocked'] and result['handler']==0 and result['script']==0,result
    page.locator('#tabReg').click()
    page.locator('#rgFirst').fill('کاربر');page.locator('#rgMobile').fill(mobile);page.locator('#rgPass').fill(password);page.locator('#rgSendBtn').click();expect(page.locator('#rgCode')).to_be_visible();expect(page.locator('#ok')).to_contain_text('آزمایشی')
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'),('signup overflow',width)
    otp=code_for(mobile);page.locator('#rgCode').fill(otp);page.locator('#rgMobile').fill('09120000000');page.locator('#rgBtn').click();expect(page.locator('#err')).to_contain_text('شماره تغییر کرده')
    page.locator('#rgMobile').fill(mobile)
    with page.expect_response(lambda r:r.url.endswith('/api/auth/register') and r.request.method=='POST') as response:page.locator('#rgBtn').click()
    assert response.value.status==201 and 'token' not in response.value.json()
    expect(page).to_have_url(re.compile(r'/account$'));expect(page.locator('#accMobile')).to_have_text(mobile)
    cookies=[c for c in page.context.cookies() if c['name']=='yazd_customer'];assert len(cookies)==1 and cookies[0]['httpOnly']
    assert page.evaluate("localStorage.getItem('yazd_customer_token')") is None and 'yazd_customer=' not in page.evaluate('document.cookie')
    assert password not in page.evaluate('JSON.stringify(localStorage)') and page.evaluate('window.__attack || 0')==0
    # Cookie-authenticated wishlist still works without a readable token.
    page.goto(base+'/perfume/creed-aventus',wait_until='domcontentloaded');expect(page.locator('#content')).to_be_visible()
    page.locator('#wishBtn').click();expect(page.locator('#wishBtn')).to_have_attribute('aria-label','حذف از علاقه‌مندی')
    page.goto(base+'/wishlist',wait_until='domcontentloaded');expect(page.locator('.wish-card')).to_have_count(1)
    page.close()
    # An old untrusted password cannot sign in; verified reset establishes trust.
    page=browser.new_page(viewport={'width':width,'height':844});page.route('**/*',lambda route:route.continue_() if route.request.url.startswith(base) else route.abort())
    legacy=f'0912000777{index+1}';page.goto(base+'/login',wait_until='domcontentloaded');page.locator('#lgMobile').fill(legacy);page.locator('#lgPass').fill('Legacy-Old-Password-83');page.locator('#lgBtn').click();expect(page.locator('#err')).to_contain_text('بازیابی رمز')
    page.get_by_role('button',name='رمز عبور را فراموش کرده‌ام').click();page.locator('#fgMobile').fill(legacy);page.locator('#fgBtn').click();expect(page.locator('#rsCode')).to_be_visible();page.locator('#rsCode').fill(code_for(legacy));page.locator('#rsPass').fill('Legacy-New-Password-97')
    with page.expect_response(lambda r:r.url.endswith('/api/auth/reset-password') and r.request.method=='POST') as response:page.locator('#rsBtn').click()
    assert response.value.status==200 and 'token' not in response.value.json()
    expect(page).to_have_url(re.compile(r'/account$'));expect(page.locator('#accMobile')).to_have_text(legacy);page.close()
    page=browser.new_page(viewport={'width':width,'height':844});page.route('**/*',lambda route:route.continue_() if route.request.url.startswith(base) else route.abort())
    page.goto(base+'/login',wait_until='domcontentloaded');page.locator('#lgMobile').fill(legacy);page.locator('#lgPass').fill('Legacy-New-Password-97')
    with page.expect_response(lambda r:r.url.endswith('/api/auth/login') and r.request.method=='POST') as response:page.locator('#lgBtn').click()
    assert response.value.status==200 and 'token' not in response.value.json()
    expect(page).to_have_url(re.compile(r'/account$'));expect(page.locator('#accMobile')).to_have_text(legacy);page.close()
    # OTP-only verified guest may see their own order; stored strings remain escaped.
    page=browser.new_page(viewport={'width':width,'height':844});page.on('pageerror',lambda e:errors.append(str(e)));page.route('**/*',lambda route:route.continue_() if route.request.url.startswith(base) else route.abort())
    guest=f'0912000888{index+1}';page.goto(base+'/login',wait_until='domcontentloaded');page.get_by_role('button',name='ورود با کد پیامکی').click();page.locator('#otpMobile').fill(guest);page.locator('#otpSendBtn').click();expect(page.locator('#otpCode')).to_be_visible();page.locator('#otpCode').fill(code_for(guest))
    with page.expect_response(lambda r:r.url.endswith('/api/auth/verify-code') and r.request.method=='POST') as response:page.locator('#otpVerifyBtn').click()
    assert response.value.status==200 and 'token' not in response.value.json()
    expect(page).to_have_url(re.compile(r'/account$'));expect(page.locator('#orders')).to_contain_text(f'BROWSER-GUEST-{index+1}')
    assert page.locator('#orders svg[onload], #orders img[onerror]').count()==0 and page.evaluate('window.__attack || 0')==0
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'),('account overflow',width)
    page.goto(base+'/invoice?order='+urllib.parse.quote(f'BROWSER-GUEST-{index+1}'),wait_until='domcontentloaded');expect(page.locator('#sheet')).to_contain_text('Test')
    assert page.evaluate("localStorage.getItem('yazd_customer_token')") is None
    assert not errors,errors;page.close()
   # A rejected cookie must not lead to a false successful login.
   page=browser.new_page(viewport={'width':390,'height':844});page.route('**/api/auth/me',lambda r:r.fulfill(status=200,content_type='application/json',body='{"authenticated":false}'))
   phone='09120009990';page.goto(base+'/login',wait_until='domcontentloaded');page.get_by_role('button',name='ورود با کد پیامکی').click();page.locator('#otpMobile').fill(phone);page.locator('#otpSendBtn').click();expect(page.locator('#otpCode')).to_be_visible();page.locator('#otpCode').fill(code_for(phone));page.locator('#otpVerifyBtn').click()
   expect(page.locator('#err')).to_contain_text('نشست برقرار نشد');assert '/login' in page.url
   assert page.evaluate("localStorage.getItem('yazd_customer_token')") is None;page.close()
   browser.close()
  print('PASS browser mobile/desktop: verified signup, legacy reset, OTP guest login, safe redirect and escaped order data')
 finally:proc.terminate();proc.wait(timeout=10)
