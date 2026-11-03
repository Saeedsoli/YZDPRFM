#!/usr/bin/env python3
"""Both CSV exports: authentication, escaped cells and formula-like data."""
import csv, io, json, os, socket, sqlite3, subprocess, tempfile, time, urllib.error, urllib.request
from pathlib import Path
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='csv-security-') as td:
    db=str(Path(td)/'db.sqlite'); s=socket.socket(); s.bind(('127.0.0.1',0)); port=s.getsockname()[1];s.close()
    base=f'http://127.0.0.1:{port}'
    env={**os.environ,'DB_PATH':db,'BACKUP_DISABLED':'1','NODE_ENV':'test','PORT':str(port),'ADMIN_USERNAME':'owner','ADMIN_PASSWORD':'CSV-Owner-Test-981'}
    p=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    def req(path, token=None, data=None):
        headers={}
        if token: headers['Authorization']='Bearer '+token
        if data is not None: headers['Content-Type']='application/json'; data=json.dumps(data).encode()
        r=urllib.request.Request(base+path,headers=headers,data=data)
        try:
            with urllib.request.urlopen(r,timeout=10) as h:return h.status,h.read(),dict(h.headers)
        except urllib.error.HTTPError as e:return e.code,e.read(),dict(e.headers)
    try:
        for _ in range(240):
            if p.poll() is not None:raise RuntimeError(p.stderr.read().decode())
            try:
                if req('/api/health')[0]==200:break
            except OSError:time.sleep(.05)
        else:raise RuntimeError('server did not start')
        with sqlite3.connect(db) as c:
            sku,product=c.execute('select sku,product_id from variants limit 1').fetchone()
            c.execute('update products set brand_fa=?,name_fa=? where id=?',('=BRAND','  @PRODUCT',product))
            c.execute("""insert into orders(order_id,created_at,customer_name,mobile,province,city,address,postal_code,subtotal,shipping_fee,total_paid,status,discount_code,discount_amount,tracking_code)
                values('CSV-FIXTURE',datetime('now'),?, '09120001111', ?, ?, 'address','8916100000',1000,0,1000,'PAID',?, -10, ?)""",
                ('=HYPERLINK("https://example.test", "x")','+PROVINCE','Town,"quoted"\r\nnext','@COUPON','\t=TRACK'))
            c.execute("insert into order_items(order_id,sku,product_name,unit_price,quantity,line_total) values('CSV-FIXTURE',?,?,1000,1,1000)",(sku,'-PRODUCT'))
        paths=['/api/admin/export/csv','/api/admin/reports/csv?days=30']
        for path in paths:assert req(path)[0] in (401,403)
        status,body,_=req('/api/admin/login',data={'username':'owner','password':'CSV-Owner-Test-981'})
        assert status==200,(status,body); token=json.loads(body)['token']
        status,body,headers=req(paths[0],token); assert status==200 and headers.get('Cache-Control')=='no-store' and body.startswith(b'\xef\xbb\xbf')
        rows=list(csv.reader(io.StringIO(body.decode('utf-8-sig'),newline=''))); row=next(r for r in rows if r[0]=='CSV-FIXTURE')
        assert len(row)==len(rows[0])==18,(len(row),row)
        assert row[2]=='''\'=HYPERLINK("https://example.test", "x")''' and row[4]=="'+PROVINCE" and row[5]=='Town,"quoted"\r\nnext'
        assert row[7]=="'-PRODUCT" and row[11]=="'@COUPON" and row[12]=='-10' and row[17]=="'\t=TRACK"
        status,body,headers=req(paths[1],token); assert status==200 and headers.get('Cache-Control')=='no-store'
        report=list(csv.reader(io.StringIO(body.decode('utf-8-sig'),newline='')))
        assert any(r[:2]==["'=BRAND","'  @PRODUCT"] for r in report),report
        assert any(r and r[0]=="'+PROVINCE" for r in report)
        assert any(r and r[0]=="'@COUPON" for r in report)
        print('PASS both authenticated CSV exports: structural quoting, formula-like text, numeric negatives, Persian BOM and no-store')
    finally:
        p.terminate()
        try:p.wait(timeout=5)
        except subprocess.TimeoutExpired:p.kill();p.wait()
