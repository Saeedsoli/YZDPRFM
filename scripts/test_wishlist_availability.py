#!/usr/bin/env python3
"""Wishlist quick-add only sells a real 5ml sample from an orderable product."""
import os,socket,sqlite3,subprocess,tempfile,time,urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='yazd-wishlist-') as tmp:
    dbfile=str(Path(tmp)/'db.sqlite');sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
    env={**os.environ,'DB_PATH':dbfile,'BACKUP_DISABLED':'1','PORT':str(port)}
    subprocess.run(['node','-e',"require('./src/db')"],cwd=root,env=env,check=True,stdout=subprocess.DEVNULL,timeout=120)
    con=sqlite3.connect(dbfile);mobile='09120001234';token='c'*48
    con.execute('insert into customers(mobile,first_name) values(?,?)',(mobile,'تست'))
    con.execute('insert into sessions(token,kind,subject,expires_at) values(?,?,?,?)',(token,'CUSTOMER',mobile,int(time.time()*1000)+600000))
    rows=[('YZD-PROD-0429','UNAVAILABLE',5,100000),('YZD-PROD-0430','MADE_TO_ORDER',None,None),('YZD-PROD-0431','MADE_TO_ORDER',0,260000),('YZD-PROD-0432','IN_STOCK',2,0)]
    for pid,mode,stock,price in rows:
        con.execute('update products set supply_mode=? where id=?',(mode,pid));con.execute('update variants set stock=0 where product_id=?',(pid,))
        con.execute('insert into wishlist(mobile,product_id) values(?,?)',(mobile,pid))
        if stock is not None:con.execute('insert into variants(sku,product_id,type,type_label,volume_ml,price_toman,stock) values(?,?,?,?,?,?,?)',('sample-'+pid,pid,'SAMPLE','سمپل',5,price,stock))
    con.commit();slugs={pid:con.execute('select slug from products where id=?',(pid,)).fetchone()[0] for pid,_,_,_ in rows}
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
            page.goto(base+'/');page.evaluate("token=>{localStorage.setItem('yazd_customer_token',token);localStorage.setItem('yazd_customer_mobile','09120001234')}",token)
            page.goto(base+'/wishlist',wait_until='domcontentloaded')
            expect(page.locator('.wish-card')).to_have_count(4)
            for pid in ['YZD-PROD-0429','YZD-PROD-0430','YZD-PROD-0432']:
                assert page.locator(f'.wish-card[data-slug="{slugs[pid]}"] button.gold').count()==0,pid
            card=page.locator(f'.wish-card[data-slug="{slugs["YZD-PROD-0431"]}"]')
            expect(card.locator('button.gold')).to_be_visible();card.locator('button.gold').click()
            items=page.evaluate("JSON.parse(localStorage.getItem('yazd_cart_v1'))")
            assert len(items)==1 and items[0]['sku']=='sample-YZD-PROD-0431',items
            assert not errors,errors;browser.close()
        print('PASS wishlist: unavailable/zero-price/no-sample not quick-added; real 5ml made-to-order sample can be added')
    finally:
        con.close();server.terminate()
        try:server.wait(timeout=5)
        except subprocess.TimeoutExpired:server.kill();server.wait()
