#!/usr/bin/env python3
"""Official single-molecule data must not become an invented note pyramid."""
import json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='yazd-unclassified-') as tmp:
    dbfile=str(Path(tmp)/'db.sqlite');sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
    env={**os.environ,'DB_PATH':dbfile,'BACKUP_DISABLED':'1','PORT':str(port)}
    server=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    try:
        base=f'http://127.0.0.1:{port}'
        for _ in range(200):
            if server.poll() is not None:raise RuntimeError(server.stderr.read().decode())
            try:urllib.request.urlopen(base+'/api/health',timeout=1);break
            except OSError:time.sleep(.1)
        else:raise RuntimeError('server not ready')
        slug='escentric-molecules-molecule-04'
        with urllib.request.urlopen(base+'/api/products/'+slug) as r:p=json.load(r)
        assert p['notes']=={'top':[],'middle':[],'base':[]},p['notes']
        assert p['accords']==['جاوانول (Javanol)'],p['accords']
        assert p['supply_mode']=='UNAVAILABLE'
        con=sqlite3.connect(dbfile)
        assert con.execute("select count(*) from product_notes where product_id=? and position='accord' and note=?",(p['id'],'جاوانول (Javanol)')).fetchone()[0]==1
        assert con.execute("select count(*) from product_notes where product_id=? and note='چوب صندل شیری'",(p['id'],)).fetchone()[0]==0
        con.close()
        with sync_playwright() as pw:
            browser=pw.chromium.launch(headless=True,args=['--no-sandbox']);page=browser.new_page(viewport={'width':390,'height':844});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(base+'/perfume/'+slug,wait_until='domcontentloaded')
            expect(page.locator('#pyramid')).to_contain_text('هرم نُت برای این رایحه ثبت نشده است')
            assert 'چوب صندل شیری' not in page.locator('#pyramid').inner_text()
            assert not errors,errors;browser.close()
        print('PASS official single-molecule record, no fabricated note tiers, updated index and honest public fallback')
    finally:
        server.terminate()
        try:server.wait(timeout=5)
        except subprocess.TimeoutExpired:server.kill();server.wait()
