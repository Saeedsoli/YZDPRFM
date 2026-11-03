#!/usr/bin/env python3
"""Return volume snapshots commit atomically with real checkout; disposable DB."""
import json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='return-snapshot-') as td:
    t=Path(td);db=t/'shop.sqlite';env={**os.environ,'DB_PATH':str(db),'BACKUP_DISABLED':'1','NODE_ENV':'test','PAYMENT_GATEWAY':'sandbox'}
    init=subprocess.run(['node','-e',"require('./src/db').db.close()"],cwd=root,env=env,capture_output=True,text=True,timeout=120);assert init.returncode==0,init.stderr
    with sqlite3.connect(db) as c:
        pairs=c.execute("select v.sku,v.volume_ml from variants v join products p on p.id=v.product_id where p.supply_mode='MADE_TO_ORDER' and v.type in ('EDP','SAMPLE') and v.volume_ml in (5,30) and v.price_toman>0 group by v.volume_ml order by v.volume_ml").fetchall();assert len(pairs)==2,pairs
        c.execute("insert into orders(order_id,created_at,customer_name,mobile,subtotal,shipping_fee,total_paid,status) values('HISTORIC','2026-01-01','old','09120001111',100,0,100,'PAID')")
        c.execute("insert into order_items(order_id,sku,product_name,unit_price,quantity,line_total) values('HISTORIC',?,'old item',100,1,100)",(pairs[1][0],))
    def boot(extra={}):
        s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1];s.close()
        p=subprocess.Popen(['node','src/server.js'],cwd=root,env={**env,'PORT':str(port),**extra},stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        for _ in range(240):
            if p.poll() is not None:raise RuntimeError(p.stderr.read().decode())
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health',timeout=1):return p,port
            except OSError:time.sleep(.05)
        raise RuntimeError('server not ready')
    def order(port,mobile,items):
        b={'customer_name':'Sample','mobile':mobile,'items':[{'sku':sku,'quantity':1} for sku,_ in items]}
        req=urllib.request.Request(f'http://127.0.0.1:{port}/api/orders',data=json.dumps(b).encode(),headers={'Content-Type':'application/json'},method='POST')
        try:
            with urllib.request.urlopen(req,timeout=10) as r:return r.status,json.load(r)
        except urllib.error.HTTPError as e:return e.code,json.load(e)
    def stop(p):
        if p.poll() is None:p.terminate();p.wait(timeout=10)
    p,port=boot()
    try:
        code,res=order(port,'09120002222',pairs);assert code==201,res;oid=res['order_id']
        with sqlite3.connect(db) as c:
            rows=c.execute('select i.sku,e.volume_ml from order_items i join return_item_evidence e on e.item_id=i.id where i.order_id=? order by e.volume_ml',(oid,)).fetchall();assert rows==pairs,rows
            assert c.execute("select count(*) from return_item_evidence e join order_items i on i.id=e.item_id where i.order_id='HISTORIC'").fetchone()[0]==0
            c.execute('update variants set volume_ml=100 where sku=?',(pairs[1][0],));c.commit()
            assert c.execute('select e.volume_ml from return_item_evidence e join order_items i on i.id=e.item_id where i.order_id=? and i.sku=?',(oid,pairs[1][0])).fetchone()[0]==30
            c.execute('update variants set volume_ml=30 where sku=?',(pairs[1][0],));c.commit()
    finally:stop(p)
    # Kill after snapshot while order transaction is still open. No partial
    # order, stock reservation or evidence is committed.
    patch=t/'kill.js';patch.write_text("const x=require("+json.dumps(str(root/'src/return-store.js'))+");const f=x.captureNewItem;x.captureNewItem=(...a)=>{f(...a);process.kill(process.pid,'SIGKILL')};")
    p,port=boot({'NODE_OPTIONS':'--require='+str(patch)})
    try:
        try:order(port,'09120003333',[pairs[1]])
        except (OSError,urllib.error.URLError):pass
        p.wait(timeout=10);assert p.returncode!=0
        with sqlite3.connect(db) as c:
            assert c.execute("select count(*) from orders where mobile='09120003333'").fetchone()[0]==0
            assert c.execute('select count(*) from return_item_evidence e left join order_items i on i.id=e.item_id where i.id is null').fetchone()[0]==0
            assert c.execute("select count(*) from order_items where order_id='HISTORIC'").fetchone()[0]==1
            assert c.execute('pragma integrity_check').fetchone()[0]=='ok'
    finally:stop(p)
    # Existing stores without the migration remain able to accept orders and
    # do not get the schema silently installed or historical evidence inferred.
    with sqlite3.connect(db) as c:
        c.execute('drop index account_return_one_open_per_item')
        for name in ('account_return_requests','return_item_evidence','return_delivery_evidence'):c.execute('drop table '+name)
        c.execute("delete from settings where key='account_returns_schema_v1'");c.commit()
    p,port=boot()
    try:
        code,res=order(port,'09120004444',[pairs[1]]);assert code==201,res
        with sqlite3.connect(db) as c:assert not c.execute("select 1 from sqlite_master where name='return_item_evidence'").fetchone()
    finally:stop(p)
    print('PASS checkout volume snapshots, historic exclusion, hard-crash atomicity and legacy store compatibility')
