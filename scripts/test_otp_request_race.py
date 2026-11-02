#!/usr/bin/env python3
"""Cross-process OTP send reservation, retry, stale response and recovery tests.

Uses a disposable database and mocked SMS provider only; no real SMS.
"""
import json,os,sqlite3,subprocess,tempfile,time
from pathlib import Path
root=Path(__file__).resolve().parent.parent
worker=r'''const fs=require('fs');const sms=require('./src/sms');
sms.sendOtp=async()=>{if(process.env.SIGNAL)fs.writeFileSync(process.env.SIGNAL,'started');await new Promise(r=>setTimeout(r,Number(process.env.DELAY||0)));if(process.env.OUTCOME==='throw')throw Error('fake provider failure');return {ok:process.env.OUTCOME!=='fail'};};
const otp=require('./src/otp');(async()=>{const r=process.env.CONSUME==='1'?otp.consumeCode(process.env.MOBILE,'12345'):await otp.requestCode(process.env.MOBILE);console.log('RESULT '+JSON.stringify(r));process.exit(0)})().catch(e=>{console.error(e);process.exit(1)});'''
with tempfile.TemporaryDirectory(prefix='otp-race-') as td:
    td=Path(td);db=td/'db.sqlite';mobile='09120001111'
    env={**os.environ,'DB_PATH':str(db),'BACKUP_DISABLED':'1','NODE_ENV':'test','MOBILE':mobile}
    init=subprocess.run(['node','-e',"require('./src/db').db.close()"],cwd=root,env=env,capture_output=True,text=True,timeout=120);assert init.returncode==0,init.stderr
    def start(**kw):return subprocess.Popen(['node','-e',worker],cwd=root,env={**env,**kw},stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    def result(proc):
        out,err=proc.communicate(timeout=30);assert proc.returncode==0,(out,err)
        return json.loads(next(x[7:] for x in out.splitlines() if x.startswith('RESULT ')))
    def wait(path,proc):
        for _ in range(200):
            if path.exists():return
            assert proc.poll() is None,'worker exited too early';time.sleep(.02)
        raise AssertionError('provider not reached')
    def row():
        with sqlite3.connect(db) as c:return c.execute('select code,expires_at,last_sent,attempts from otp_codes where mobile=?',(mobile,)).fetchone()
    def put(code,expires,last,attempts=0):
        with sqlite3.connect(db) as c:c.execute('insert or replace into otp_codes(mobile,code,expires_at,last_sent,attempts) values(?,?,?,?,?)',(mobile,code,expires,last,attempts))
    def clear():
        with sqlite3.connect(db) as c:c.execute('delete from otp_codes where mobile=?',(mobile,))
    # Two independent processes: one provider call, cooldown blocks the other.
    signal=td/'first';a=start(SIGNAL=str(signal),DELAY='1500');wait(signal,a)
    assert row()[0].startswith('pending:')
    verify=result(start(CONSUME='1'));assert not verify['ok'] and row()[3]==0
    blocked=result(start());assert not blocked['ok'] and blocked['retry_after']>0
    assert result(a)['ok'];sent=row();assert len(sent[0])==5 and sent[0].isdigit() and sent[3]==0
    # Failed/throwing providers do not persist new codes; an unexpired prior
    # code and its attempt count survive a failed resend.
    now=int(time.time()*1000);put('12345',now+120000,now-61000,2)
    assert not result(start(OUTCOME='fail'))['ok'];assert row()==('12345',now+120000,now-61000,2)
    clear();assert not result(start(OUTCOME='throw'))['ok'];assert row() is None
    # A slow result must not overwrite a newer request or its code.
    signal=td/'stale';a=start(SIGNAL=str(signal),DELAY='1500');wait(signal,a)
    now=int(time.time()*1000);put('54321',now+120000,now,1)
    assert not result(a)['ok'];assert row()==('54321',now+120000,now,1)
    # A process crash leaves only a bounded non-code reservation; it cannot be
    # used for verification and a later request recovers after the cooldown.
    clear();signal=td/'crashed';a=start(SIGNAL=str(signal),DELAY='10000');wait(signal,a);a.kill();a.communicate(timeout=10)
    assert row()[0].startswith('pending:');assert not result(start(CONSUME='1'))['ok']
    with sqlite3.connect(db) as c:c.execute('update otp_codes set last_sent=?,expires_at=? where mobile=?',(int(time.time()*1000)-61000,int(time.time()*1000)-1000,mobile))
    assert result(start())['ok'];assert row()[0].isdigit()
print('PASS OTP request cross-process reservation, pending verification, failed resend, stale response and crash recovery; fake SMS only')
