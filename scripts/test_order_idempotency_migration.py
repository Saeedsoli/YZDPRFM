#!/usr/bin/env python3
"""Backup-first idempotency migration using disposable databases only."""
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
with tempfile.TemporaryDirectory(prefix='idem-migration-') as t:
    tmp=Path(t); db=tmp/'store.sqlite';backup=tmp/'before.sqlite'; replay=tmp/'replay.sqlite'
    env={**os.environ,'DB_PATH':str(db),'BACKUP_DISABLED':'1','NODE_ENV':'test'}
    created=run('-e',"const s=require('./src/db');if(!require('./src/order-idempotency').ready(s.db)||!require('./src/checkout-attempt').ready(s.db))process.exit(3)",env=env)
    assert created.returncode==0,created.stderr
    with sqlite3.connect(db) as c:
        # Model an existing store predating this additive feature.
        c.execute('drop table checkout_attempt_tokens')
        c.execute('drop table order_idempotency')
        c.execute("delete from settings where key in ('order_idempotency_schema_v1','checkout_attempt_cookie_schema_v1')")
        c.execute("insert into orders(order_id,created_at,customer_name,mobile,province,city,address,postal_code,subtotal,shipping_fee,total_paid,status) values('KEEP-ORDER','2026-01-01','Sentinel','09120001111','Y','Y','A','1234567890',500,0,500,'DELIVERED')")
        c.commit(); before=snapshot(c)
    # Mandatory arguments; no backup means no writes.
    missing=run('src/order-idempotency-cli.js','--db',db,'--backup',backup)
    assert missing.returncode!=0 and not backup.exists()
    migration=run('src/order-idempotency-cli.js','--db',db,'--backup',backup,'--offline-confirmed')
    assert migration.returncode==0,migration.stderr
    result=json.loads(migration.stdout);assert result['backup_verified'] and result['result']['created'] and result['result']['checkout']['created'] and not result['legacy_order_attempts_backfilled']
    with sqlite3.connect(backup) as b,sqlite3.connect(db) as c:
        assert b.execute('pragma integrity_check').fetchone()[0]=='ok' and snapshot(b)==before
        assert c.execute('pragma integrity_check').fetchone()[0]=='ok'
        after=snapshot(c)
        for k,v in before.items():
            if k=='settings':
                assert [r for r in after[k] if r[0] not in ('order_idempotency_schema_v1','checkout_attempt_cookie_schema_v1')]==v
            else: assert after[k]==v,k
        assert after['order_idempotency']==[] and after['checkout_attempt_tokens']==[]
    again=run('src/order-idempotency-cli.js','--db',db,'--backup',replay,'--offline-confirmed')
    assert again.returncode==0 and not json.loads(again.stdout)['result']['created']
    no_overwrite=run('src/order-idempotency-cli.js','--db',db,'--backup',backup,'--offline-confirmed')
    assert no_overwrite.returncode!=0
    # Upgrade from an already-installed key schema; existing data is preserved.
    upgrade=tmp/'upgrade.sqlite';shutil.copyfile(db,upgrade);upgrade_backup=tmp/'upgrade-before.sqlite'
    with sqlite3.connect(upgrade) as c:
        c.execute('drop table checkout_attempt_tokens');c.execute("delete from settings where key='checkout_attempt_cookie_schema_v1'");c.commit();up_before=snapshot(c)
    upgraded=run('src/order-idempotency-cli.js','--db',upgrade,'--backup',upgrade_backup,'--offline-confirmed')
    assert upgraded.returncode==0,upgraded.stderr
    up=json.loads(upgraded.stdout)['result'];assert not up['created'] and up['checkout']['created']
    with sqlite3.connect(upgrade_backup) as b,sqlite3.connect(upgrade) as c:
        assert snapshot(b)==up_before;up_after=snapshot(c)
        for k,v in up_before.items():
            if k=='settings':assert [r for r in up_after[k] if r[0]!='checkout_attempt_cookie_schema_v1']==v
            else:assert up_after[k]==v,k
        assert up_after['checkout_attempt_tokens']==[]
    # Conflict must leave existing objects untouched and still preserve backup.
    conflict=tmp/'conflict.sqlite';shutil.copyfile(backup,conflict); conflict_backup=tmp/'conflict-backup.sqlite'
    with sqlite3.connect(conflict) as c:
        c.execute('create table order_idempotency(x)');c.commit();conflict_before=snapshot(c)
    bad=run('src/order-idempotency-cli.js','--db',conflict,'--backup',conflict_backup,'--offline-confirmed')
    assert bad.returncode!=0
    with sqlite3.connect(conflict) as c,sqlite3.connect(conflict_backup) as b:
        assert snapshot(c)==conflict_before and snapshot(b)==conflict_before
        assert c.execute('pragma integrity_check').fetchone()[0]=='ok' and b.execute('pragma integrity_check').fetchone()[0]=='ok'
    print('PASS fresh-store schema, offline backup-first migration, all existing tables preserved, idempotence and conflict rollback')
