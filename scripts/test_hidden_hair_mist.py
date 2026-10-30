#!/usr/bin/env python3
"""Hair mist stays historical/admin-visible, but not publicly purchasable."""
import json, os, socket, sqlite3, subprocess, tempfile, time, urllib.error, urllib.request
from pathlib import Path
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='yazd-hidden-hair-') as tmp:
    dbfile=str(Path(tmp)/'test.db')
    sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
    env={**os.environ,'DB_PATH':dbfile,'BACKUP_DISABLED':'1','PORT':str(port)}
    subprocess.run(['node','-e',"require('./src/db')"],cwd=root,env=env,check=True,stdout=subprocess.DEVNULL,timeout=120)
    con=sqlite3.connect(dbfile)
    hair,pid=con.execute("select sku,product_id from variants where type='HAIR_MIST' limit 1").fetchone()
    edp=con.execute("select sku from variants where product_id=? and type='EDP' limit 1",(pid,)).fetchone()[0]
    con.execute('update variants set stock=0');con.execute("update products set supply_mode='MADE_TO_ORDER' where id=?",(pid,))
    con.execute('update variants set stock=5,price_toman=1 where sku=?',(hair,));con.commit()
    js="const {db,parseProduct,attachVariants}=require('./src/db');const p=parseProduct(db.prepare('SELECT * FROM products WHERE id=?').get(process.argv[1]));if(!attachVariants(p,{includeHidden:true}).variants.some(v=>v.type==='HAIR_MIST'))process.exit(1);"
    subprocess.run(['node','-e',js,pid],cwd=root,env=env,check=True,stdout=subprocess.DEVNULL,timeout=120)
    server=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    try:
        base=f'http://127.0.0.1:{port}'
        def call(path,data=None):
            req=urllib.request.Request(base+path,data=None if data is None else json.dumps(data).encode(),headers={'Content-Type':'application/json'},method='GET' if data is None else 'POST')
            try:
                with urllib.request.urlopen(req,timeout=3) as r:return r.status,json.load(r)
            except urllib.error.HTTPError as e:return e.code,json.load(e)
        for _ in range(200):
            if server.poll() is not None: raise RuntimeError(server.stderr.read().decode())
            try: status,product=call('/api/products/'+pid);break
            except (OSError,urllib.error.URLError):time.sleep(.1)
        else: raise RuntimeError('server not ready')
        assert status==200,(status,product)
        assert all(v['type']!='HAIR_MIST' for v in product['variants'])
        assert any(v['sku']==edp for v in product['variants'])
        assert product['min_price']>1,product['min_price']
        status,body=call('/api/cart/sync',{'skus':[hair,edp]})
        assert status==200 and [x['sku'] for x in body['variants']]==[edp],body
        status,body=call('/api/cart/calculate',{'items':[{'sku':hair,'quantity':1}]})
        assert status==400,(status,body)
        status,body=call('/api/stock-alert',{'sku':hair,'mobile':'09123456789'})
        assert status==404,(status,body)
        status,body=call('/api/products?in_stock=1')
        assert status==200,(status,body)
        assert not body.get('products',[]),body
        assert con.execute('select count(*) from variants where sku=?',(hair,)).fetchone()[0]==1
        print('PASS hair hidden in catalog, prices, stock filter, cart sync/checkout and stock alerts; retained for admin/history')
    finally:
        con.close();server.terminate()
        try:server.wait(timeout=5)
        except subprocess.TimeoutExpired:server.kill();server.wait()
