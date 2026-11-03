#!/usr/bin/env python3
"""Contact details and ticket rendering are inert, including admin reply actions."""
import os,socket,subprocess,tempfile,time,urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parent.parent
payload='<img src=x onerror="window.__xss=1">'
key="TKT');window.__xss=1;//"
with tempfile.TemporaryDirectory(prefix='ticket-xss-') as td:
    sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close();base=f'http://127.0.0.1:{port}'
    env={**os.environ,'DB_PATH':str(Path(td)/'db.sqlite'),'BACKUP_DISABLED':'1','NODE_ENV':'test','PORT':str(port),'ADMIN_USERNAME':'owner','ADMIN_PASSWORD':'Ticket-Xss-Owner-981'}
    p=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
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
                context=browser.new_context(viewport={'width':width,'height':844},service_workers='block');page=context.new_page();errors=[]
                page.on('pageerror',lambda e:errors.append(str(e)))
                page.route('**/api/contact-info',lambda r:r.fulfill(json={'phone':payload,'address':payload}))
                def ticket(r):
                    if r.request.method=='POST':r.fulfill(status=201,json={'ticket_id':payload})
                    else:r.fulfill(json={'tickets':[{'ticket_id':key,'order_id':payload,'product_name':payload,'description':payload,'volume_ml':30,'status':'NEW_PENDING'}]})
                page.route('**/api/tickets',ticket)
                page.goto(base+'/contact',wait_until='domcontentloaded');expect(page.locator('#ways')).to_contain_text(payload)
                assert page.locator('#ways img').count()==0
                expect(page.get_by_role('link',name='ورود به حساب کاربری')).to_be_visible();assert page.locator('#formBox').count()==0
                page.goto(base+'/admin',wait_until='domcontentloaded');page.locator('#usr').fill('owner');page.locator('#pw').fill('Ticket-Xss-Owner-981');page.locator('#loginView button').click();expect(page.locator('#panel')).to_be_visible()
                page.locator('.tab[data-t="tickets"]').click();expect(page.locator('#ticketsTable')).to_contain_text(payload)
                assert page.locator('#ticketsTable img').count()==0
                page.evaluate('window.replyTicket = x => { window.__ticket = x }');page.locator('#ticketsTable button').click();assert page.evaluate('window.__ticket')==key
                page.wait_for_timeout(250);assert page.evaluate('window.__xss || 0')==0;assert not errors,errors
                context.close()
            browser.close()
        print('PASS contact info and admin ticket rendering XSS; reply action preserved on mobile and desktop')
    finally:
        p.terminate()
        try:p.wait(timeout=5)
        except subprocess.TimeoutExpired:p.kill();p.wait()
