#!/usr/bin/env python3
"""Stored data in admin coupons, reports and logs remains inert in Chromium."""
import json, os, socket, sqlite3, subprocess, tempfile, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
root = Path(__file__).resolve().parent.parent
payload = '<img src=x onerror="window.__xss=1">'
code = "X');window.__xss=1;//"
with tempfile.TemporaryDirectory(prefix='admin-report-xss-') as td:
    db = str(Path(td)/'db.sqlite')
    s=socket.socket(); s.bind(('127.0.0.1',0)); port=s.getsockname()[1]; s.close()
    base=f'http://127.0.0.1:{port}'
    env={**os.environ,'DB_PATH':db,'BACKUP_DISABLED':'1','NODE_ENV':'test','PORT':str(port),'ADMIN_USERNAME':'owner','ADMIN_PASSWORD':'Browser-Test-Owner-981'}
    p=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    try:
        for _ in range(240):
            if p.poll() is not None: raise RuntimeError(p.stderr.read().decode())
            try:
                with urllib.request.urlopen(base+'/api/health',timeout=1): break
            except OSError: time.sleep(.05)
        else: raise RuntimeError('server did not start')
        with sqlite3.connect(db) as c:
            c.execute("INSERT INTO coupons(code,type,value,description,active) VALUES(?, 'PERCENT',10,?,1)",(code,payload))
            c.execute("INSERT INTO app_logs(level,scope,message,meta) VALUES('WARN',?,?,?)",(payload,payload,payload))
        with sync_playwright() as pw:
            browser=pw.chromium.launch(headless=True,args=['--no-sandbox'])
            for width in (390,1440):
                context=browser.new_context(viewport={'width':width,'height':844},service_workers='block')
                page=context.new_page(); errors=[]; page.on('pageerror',lambda e: errors.append(str(e)))
                def reports(route):
                    response=route.fetch(); data=response.json()
                    data.update(top_products=[{'brand_fa':payload,'name_fa':payload,'units':1,'revenue':100}],
                        by_brand=[{'brand':payload,'revenue':100}], by_type=[{'type':payload,'revenue':100}],
                        by_province=[{'province':payload,'orders':1,'revenue':100}],
                        top_customers=[{'name':payload,'mobile':payload,'orders':1,'spent':100}],
                        coupons=[{'code':payload,'uses':1,'given':1,'revenue':100}])
                    route.fulfill(response=response,json=data)
                page.route('**/api/admin/reports?*',reports)
                page.goto(base+'/admin',wait_until='domcontentloaded');page.locator('#usr').fill('owner');page.locator('#pw').fill('Browser-Test-Owner-981');page.locator('#loginView button').click()
                expect(page.locator('#panel')).to_be_visible()
                expect(page.locator('#couponsTable')).to_contain_text(payload)
                expect(page.locator('#logsBox')).to_contain_text(payload)
                assert page.locator('#couponsTable img, #logsBox img').count()==0
                page.locator('.tab[data-t="coupons"]').click()
                page.evaluate('window.delCoupon = value => { window.__clickedCoupon = value }')
                page.locator('#couponsTable tr').filter(has_text=code).locator('button.del').click()
                assert page.evaluate('window.__clickedCoupon') == code
                page.locator('.tab[data-t="reports"]').click()
                for selector in ('#repTop','#repBrand','#repType','#repProv','#repCust','#repCoup'):
                    expect(page.locator(selector)).to_contain_text(payload)
                    assert page.locator(selector+' img, '+selector+' script').count()==0,selector
                page.wait_for_timeout(300)
                assert page.evaluate('window.__xss || 0')==0
                assert not errors,errors
                context.close()
            browser.close()
        print('PASS admin coupon, log and report XSS payloads inert, coupon action preserved (mobile and desktop Chromium)')
    finally:
        p.terminate()
        try:p.wait(timeout=5)
        except subprocess.TimeoutExpired:p.kill();p.wait()
