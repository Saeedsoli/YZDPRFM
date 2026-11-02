#!/usr/bin/env python3
"""Real browser: staff creation and one-time secret dialog on mobile and desktop."""
import json,os,socket,subprocess,tempfile,time,urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='staff-credential-browser-') as td:
 db=str(Path(td)/'db.sqlite');sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
 env={**os.environ,'DB_PATH':db,'BACKUP_DISABLED':'1','NODE_ENV':'test','PORT':str(port),'ADMIN_USERNAME':'owner','ADMIN_PASSWORD':'Browser-Owner-Secret-281','SMS_PROVIDER':'console'}
 proc=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE);base=f'http://127.0.0.1:{port}'
 try:
  for _ in range(200):
   if proc.poll() is not None:raise RuntimeError(proc.stderr.read().decode())
   try:
    with urllib.request.urlopen(base+'/api/health',timeout=1):break
   except OSError:time.sleep(.1)
  else:raise RuntimeError('server not ready')
  with sync_playwright() as pw:
   browser=pw.chromium.launch(headless=True,args=['--no-sandbox'])
   for index,width in enumerate([390,1440]):
    page=browser.new_page(viewport={'width':width,'height':844});errors=[];page.on('pageerror',lambda err:errors.append(str(err)))
    page.route('**/*',lambda route:route.continue_() if route.request.url.startswith(base) else route.abort())
    page.goto(base+'/admin',wait_until='domcontentloaded');page.locator('#usr').fill('owner');page.locator('#pw').fill('Browser-Owner-Secret-281');page.locator('#loginView button').click()
    expect(page.locator('#panel')).to_be_visible();page.locator('.tab[data-t="staff"]').click();expect(page.locator('#btnNewStaff')).to_be_visible();page.locator('#btnNewStaff').click()
    expect(page.locator('#staffForm')).to_contain_text('رمز موقت تصادفی');expect(page.locator('#staffForm')).to_contain_text('رمز از طریق پیامک ارسال نمی‌شود')
    page.locator('#sfFirst').fill('آزمایشی');page.locator('#sfLast').fill('کارمند');page.locator('#sfNid').fill(f'100000000{index+1}');page.locator('#sfMobile').fill(f'0912000111{index+1}');page.locator('#sfRole').select_option('warehouse')
    with page.expect_response(lambda r:r.url.endswith('/api/admin/staff') and r.request.method=='POST') as response:
     with page.expect_event('dialog') as event:page.get_by_role('button',name='ساخت حساب',exact=True).click()
     dialog=event.value;message=dialog.message;shown=dialog.default_value;assert dialog.type=='prompt' and 'رمز موقت' in message and 'فقط یک‌بار' in message;dialog.accept()
    data=response.value.json();secret=data['temp_password'];assert response.value.status==201 and secret==shown and secret not in message and len(secret)>=20
    expect(page.locator('#staffTable')).to_contain_text(f'100000000{index+1}')
    assert secret not in page.content() and secret not in page.evaluate('JSON.stringify(localStorage)')
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'),width
    assert not errors,errors;page.close()
   browser.close()
  print('PASS staff onboarding browser mobile/desktop: one-time copyable prompt, correct password and no persisted DOM/localStorage secret')
 finally:proc.terminate();proc.wait(timeout=10)
