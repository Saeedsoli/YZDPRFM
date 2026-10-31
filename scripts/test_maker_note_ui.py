#!/usr/bin/env python3
"""Verify admin sees unreviewed draft and explicitly confirms publication."""
import os,socket,sqlite3,subprocess,tempfile,time,urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='yazd-maker-ui-') as tmp:
    dbfile=str(Path(tmp)/'db.sqlite');sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
    env={**os.environ,'DB_PATH':dbfile,'BACKUP_DISABLED':'1','PORT':str(port),'ADMIN_USERNAME':'owner','ADMIN_PASSWORD':'test-secret-123'}
    subprocess.run(['node','-e',"require('./src/db')"],cwd=root,env=env,check=True,stdout=subprocess.DEVNULL,timeout=120)
    con=sqlite3.connect(dbfile);con.execute("update products set maker_note=?,maker_note_by=?,maker_note_approved=0 where id='YZD-PROD-0429'",('پیش‌نویس ساختگی برای تست','مدیر'));con.commit()
    server=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    try:
        base=f'http://127.0.0.1:{port}'
        for _ in range(200):
            if server.poll() is not None:raise RuntimeError(server.stderr.read().decode())
            try:urllib.request.urlopen(base+'/api/health',timeout=1);break
            except OSError:time.sleep(.1)
        else:raise RuntimeError('server not ready')
        with sync_playwright() as pw:
            browser=pw.chromium.launch(headless=True,args=['--no-sandbox']);page=browser.new_page(viewport={'width':390,'height':844});errors=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(base+'/admin.html',wait_until='domcontentloaded');page.locator('#usr').fill('owner');page.locator('#pw').fill('test-secret-123');page.locator('button[onclick="login()"]').click()
            page.locator('#tabs [data-t="products"]').click();page.locator('#pSearch').fill('Aventus');page.locator("#pResults button[onclick=\"editProduct('creed-aventus')\"]").click()
            expect(page.locator('#makerNote')).to_have_value('پیش‌نویس ساختگی برای تست');expect(page.locator('#makerApprovalStatus')).to_contain_text('پیش‌نویس')
            page.locator('#makerNote').fill('یادداشت تجربی تأییدشده برای تست');dialogs=[]
            def reject(d):dialogs.append(d.message);d.dismiss()
            page.once('dialog',reject);page.locator('button[onclick="saveMakerNote()"]').click()
            assert dialogs and 'تجربه واقعی' in dialogs[0]
            assert con.execute("select maker_note_approved from products where id='YZD-PROD-0429'").fetchone()[0]==0
            page.once('dialog',lambda d:d.accept());page.locator('button[onclick="saveMakerNote()"]').click()
            expect(page.locator('#makerApprovalStatus')).to_contain_text('تأیید و منتشر')
            assert con.execute("select maker_note_approved from products where id='YZD-PROD-0429'").fetchone()[0]==1
            assert not errors,errors;browser.close()
        print('PASS browser: draft shown in admin, confirmation required, dismissal cancels, approval publishes')
    finally:
        con.close();server.terminate()
        try:server.wait(timeout=5)
        except subprocess.TimeoutExpired:server.kill();server.wait()
