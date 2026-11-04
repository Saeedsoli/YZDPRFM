#!/usr/bin/env python3
"""Backup-first reconciliation migration using disposable databases only."""
import json, os, shutil, sqlite3, subprocess, tempfile
from pathlib import Path
root=Path(__file__).resolve().parent.parent

def run(*args,env=None):
    return subprocess.run(['node',*map(str,args)],cwd=root,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
def snapshot(conn):
    tables=conn.execute("select name from sqlite_master where type='table' order by name").fetchall()
    result={}
    for (name,) in tables:
        quoted='"'+name.replace('"','""')+'"'
        rows=conn.execute('select * from '+quoted).fetchall()
        result[name]=sorted(rows,key=repr)
    return result
with tempfile.TemporaryDirectory(prefix='reconciliation-migration-') as t:
    tmp=Path(t); db=tmp/'store.sqlite';backup=tmp/'before.sqlite'; replay=tmp/'replay.sqlite'
    env={**os.environ,'DB_PATH':str(db),'BACKUP_DISABLED':'1','NODE_ENV':'test'}
    created=run('-e',"const s=require('./src/db');if(!require('./src/order-reconciliation').ready(s.db))process.exit(3)",env=env)
    assert created.returncode==0,created.stderr
    with sqlite3.connect(db) as c:
        # Model an existing store predating this additive feature.
        c.execute('drop index order_attempt_reviews_order');c.execute('drop index return_delivery_corrections_order')
        c.execute('drop table order_attempt_reviews');c.execute('drop table return_delivery_corrections')
        c.execute("delete from settings where key='order_reconciliation_schema_v1'")
        c.execute("insert into orders(order_id,created_at,customer_name,mobile,province,city,address,postal_code,subtotal,shipping_fee,total_paid,status) values('KEEP-ORDER','2026-01-01','Sentinel','09120001111','Y','Y','A','1234567890',500,0,500,'DELIVERED')")
        c.commit(); before=snapshot(c)
    # Mandatory arguments; no backup means no writes.
    missing=run('src/order-reconciliation-cli.js','--db',db,'--backup',backup)
    assert missing.returncode!=0 and not backup.exists()
    migration=run('src/order-reconciliation-cli.js','--db',db,'--backup',backup,'--offline-confirmed')
    assert migration.returncode==0,migration.stderr
    result=json.loads(migration.stdout);assert result['backup_verified'] and result['result']['created'] and not result['legacy_reviews_and_corrections_backfilled']
    with sqlite3.connect(backup) as b,sqlite3.connect(db) as c:
        assert b.execute('pragma integrity_check').fetchone()[0]=='ok' and snapshot(b)==before
        assert c.execute('pragma integrity_check').fetchone()[0]=='ok'
        after=snapshot(c)
        for k,v in before.items():
            if k=='settings':
                assert [r for r in after[k] if r[0]!='order_reconciliation_schema_v1']==v
            else: assert after[k]==v,k
        assert after['order_attempt_reviews']==[] and after['return_delivery_corrections']==[]
    again=run('src/order-reconciliation-cli.js','--db',db,'--backup',replay,'--offline-confirmed')
    assert again.returncode==0 and not json.loads(again.stdout)['result']['created']
    no_overwrite=run('src/order-reconciliation-cli.js','--db',db,'--backup',backup,'--offline-confirmed')
    assert no_overwrite.returncode!=0
    # Conflict must leave existing objects untouched and still preserve backup.
    conflict=tmp/'conflict.sqlite';shutil.copyfile(backup,conflict); conflict_backup=tmp/'conflict-backup.sqlite'
    with sqlite3.connect(conflict) as c:
        c.execute('create table order_attempt_reviews(x)');c.commit();conflict_before=snapshot(c)
    bad=run('src/order-reconciliation-cli.js','--db',conflict,'--backup',conflict_backup,'--offline-confirmed')
    assert bad.returncode!=0
    with sqlite3.connect(conflict) as c,sqlite3.connect(conflict_backup) as b:
        assert snapshot(c)==conflict_before and snapshot(b)==conflict_before
        assert c.execute('pragma integrity_check').fetchone()[0]=='ok' and b.execute('pragma integrity_check').fetchone()[0]=='ok'
    print('PASS fresh-store schema, offline backup-first migration, all existing tables preserved, idempotence and conflict rollback')
