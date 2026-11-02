#!/usr/bin/env python3
"""Customer ownership, legacy trust, OTP replay/races and order privacy on temporary DB."""
import concurrent.futures,hashlib,json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='customer-phone-verify-') as td:
 db=str(Path(td)/'shop.sqlite');ports=[]
 for _ in range(2):
  sock=socket.socket();sock.bind(('127.0.0.1',0));ports.append(sock.getsockname()[1]);sock.close()
 env={**os.environ,'DB_PATH':db,'BACKUP_DISABLED':'1','NODE_ENV':'test','ADMIN_PASSWORD':'Customer-Verify-Owner-381','SMS_PROVIDER':'console'};servers=[]
 def boot(port):
  p=subprocess.Popen(['node','src/server.js'],cwd=root,env={**env,'PORT':str(port)},stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
  for _ in range(200):
   if p.poll() is not None:raise RuntimeError(p.stderr.read().decode())
   try:
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health',timeout=1):return p
   except Exception:time.sleep(.1)
  p.terminate();raise RuntimeError('server timeout')
 counter=0
 def api(port,method,path,body=None,token=None):
  global counter
  counter+=1;h={'Content-Type':'application/json','X-Forwarded-For':f'198.51.100.{counter%250+1}'}
  if token:h['X-Customer-Token']=token
  req=urllib.request.Request(f'http://127.0.0.1:{port}'+path,data=None if body is None else json.dumps(body).encode(),headers=h,method=method)
  try:
   with urllib.request.urlopen(req,timeout=5) as r:return r.status,json.load(r),dict(r.headers)
  except urllib.error.HTTPError as e:return e.code,json.load(e),dict(e.headers)
 def getcode(mobile):
  c=sqlite3.connect(db);r=c.execute('select code from otp_codes where mobile=?',(mobile,)).fetchone();c.close();return r[0] if r else None
 def request(mobile):return api(ports[0],'POST','/api/auth/request-code',{'mobile':mobile})
 try:
  servers.append(boot(ports[0]));servers.append(boot(ports[1]));p=ports[0];mobile='09120004444'
  # Historical guest order cannot be claimed with a new unverified password.
  c=sqlite3.connect(db);c.execute("insert into orders(order_id,created_at,customer_name,mobile,address,subtotal,shipping_fee,total_paid,status,admin_note) values('GUEST-ORDER',?,'Test',?,'Private address',1000,0,1000,'PAID','Private admin note')",(time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),mobile));c.commit();c.close()
  signup={'first_name':'کاربر','mobile':mobile,'password':'User-Test-Password-982'}
  code,r,_=api(p,'POST','/api/auth/register',signup);assert code==400 and 'token' not in r
  assert api(p,'POST','/api/auth/login',{'mobile':mobile,'password':signup['password']})[0]==401
  c=sqlite3.connect(db);assert c.execute('select count(*) from customers where mobile=?',(mobile,)).fetchone()[0]==0;c.close()
  assert request(mobile)[0]==200;otp=getcode(mobile);assert otp
  bad={**signup,'code':'00000' if otp!='00000' else '00001'};assert api(p,'POST','/api/auth/register',bad)[0]==400
  code,r,h=api(p,'POST','/api/auth/register',{**signup,'code':otp});assert code==201 and r['token'] and h.get('Cache-Control')=='no-store';token=r['token']
  assert api(p,'POST','/api/auth/register',{**signup,'code':otp})[0]==400
  code,orders,h=api(p,'GET','/api/auth/orders',token=token);assert code==200 and h.get('Cache-Control')=='no-store' and orders['total']==1
  record=orders['orders'][0];assert record['order_id']=='GUEST-ORDER' and 'address' not in record and 'admin_note' not in record
  assert api(p,'POST','/api/auth/login',{'mobile':mobile,'password':signup['password']})[0]==200
  # Old sessions and password-only legacy accounts are not proof of phone ownership.
  legacy='09120005555';oldtoken='a'*48
  subprocess.run(['node','-e',"const D=require('better-sqlite3'),c=require('crypto'),d=new D(process.argv[1]);const salt=c.randomBytes(16).toString('hex'),hash=c.scryptSync('Legacy-Password-724',salt,64).toString('hex');d.prepare(\"insert into customers(mobile,first_name,pass_hash,pass_salt) values(?,'Legacy',?,?)\").run('09120005555',hash,salt);d.prepare(\"insert into sessions(token,kind,subject,expires_at) values(?,'CUSTOMER',?,?)\").run('a'.repeat(48),'09120005555',Date.now()+600000);d.close()",db],cwd=root,check=True)
  assert api(p,'GET','/api/auth/me',token=oldtoken)[1]['authenticated'] is False
  assert api(p,'GET','/api/auth/orders',token=oldtoken)[0]==401
  code,old,_=api(p,'POST','/api/auth/login',{'mobile':legacy,'password':'Legacy-Password-724'});assert code==403 and old.get('phone_verification_required') and 'token' not in old
  assert request(legacy)[0]==200;otp=getcode(legacy);code,v,_=api(p,'POST','/api/auth/verify-code',{'mobile':legacy,'code':otp});assert code==200 and v['token'];priorVerifiedToken=v['token']
  c=sqlite3.connect(db);assert c.execute('select password_trusted from customer_phone_verifications where mobile=?',(legacy,)).fetchone()[0]==0;c.close()
  assert api(p,'POST','/api/auth/login',{'mobile':legacy,'password':'Legacy-Password-724'})[0]==403
  assert api(p,'GET','/api/auth/me',token=oldtoken)[1]['authenticated'] is False
  # Only the phone owner can reset and trust a new password; old sessions are revoked.
  assert request(legacy)[0]==200;otp=getcode(legacy)
  code,v,h=api(p,'POST','/api/auth/reset-password',{'mobile':legacy,'code':otp,'new_password':'New-Legacy-Password-952'});assert code==200 and v['token'] and h.get('Cache-Control')=='no-store'
  assert api(p,'POST','/api/auth/login',{'mobile':legacy,'password':'Legacy-Password-724'})[0]==401
  assert api(p,'POST','/api/auth/login',{'mobile':legacy,'password':'New-Legacy-Password-952'})[0]==200
  assert api(p,'GET','/api/auth/me',token=oldtoken)[1]['authenticated'] is False
  assert api(p,'GET','/api/auth/me',token=priorVerifiedToken)[1]['authenticated'] is False
  # Same OTP racing across two server processes can yield only one session.
  race='09120006666';assert request(race)[0]==200;otp=getcode(race)
  def verify(i):return api(ports[i],'POST','/api/auth/verify-code',{'mobile':race,'code':otp})
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(verify,[0,1]))
  assert sorted(x[0] for x in results)==[200,400],results
  c=sqlite3.connect(db);assert c.execute("select count(*) from sessions where kind='CUSTOMER_VERIFIED' and subject=?",(race,)).fetchone()[0]==1 and not c.execute('select 1 from otp_codes where mobile=?',(race,)).fetchone();c.close()
  # Concurrent registrations cannot consume one code twice.
  reg_race='09120008888';assert request(reg_race)[0]==200;otp=getcode(reg_race)
  def register(i):return api(ports[i],'POST','/api/auth/register',{'first_name':'Race','mobile':reg_race,'password':'Race-Password-862','code':otp})
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:regs=list(pool.map(register,[0,1]))
  assert sorted(x[0] for x in regs)==[201,400],regs
  c=sqlite3.connect(db);assert c.execute('select count(*) from customers where mobile=?',(reg_race,)).fetchone()[0]==1;assert c.execute('select password_trusted from customer_phone_verifications where mobile=?',(reg_race,)).fetchone()[0]==1;assert c.execute("select count(*) from sessions where kind='CUSTOMER_VERIFIED' and subject=?",(reg_race,)).fetchone()[0]==1;c.close()
  # Expired codes and disabled accounts do not acquire verified sessions.
  expired='09120009998';assert request(expired)[0]==200;otp=getcode(expired);c=sqlite3.connect(db);c.execute('update otp_codes set expires_at=0 where mobile=?',(expired,));c.commit();c.close()
  assert api(p,'POST','/api/auth/verify-code',{'mobile':expired,'code':otp})[0]==400
  c=sqlite3.connect(db);assert not c.execute('select 1 from customer_phone_verifications where mobile=?',(expired,)).fetchone();c.close()
  disabled='09120009997';c=sqlite3.connect(db);c.execute("insert into customers(mobile,first_name,active) values(?,'Disabled',0)",(disabled,));c.commit();c.close();assert request(disabled)[0]==200;otp=getcode(disabled)
  assert api(p,'POST','/api/auth/verify-code',{'mobile':disabled,'code':otp})[0]==400
  c=sqlite3.connect(db);assert not c.execute('select 1 from customer_phone_verifications where mobile=?',(disabled,)).fetchone();c.close()
  # Customer password guesses are bounded by phone even across rotating IPs.
  for i in range(8):assert api(p,'POST','/api/auth/login',{'mobile':mobile,'password':'wrong'})[0]==401
  assert api(p,'POST','/api/auth/login',{'mobile':mobile,'password':signup['password']})[0]==429
  key='clogin-phone:'+hashlib.sha256(mobile.encode()).hexdigest();c=sqlite3.connect(db);c.execute('update rate_limits set blocked_until=0,window_end=0 where bucket=?',(key,));c.commit();c.close()
  assert api(p,'POST','/api/auth/login',{'mobile':mobile,'password':signup['password']})[0]==200
  c=sqlite3.connect(db);assert not c.execute('select 1 from rate_limits where bucket=?',(key,)).fetchone();c.close()
  # Invalid multibyte codes fail safely rather than causing a timing-comparison 500.
  invalid='09120007777';assert request(invalid)[0]==200;assert api(p,'POST','/api/auth/verify-code',{'mobile':invalid,'code':'😀😀x'})[0]==400
  print('PASS OTP-gated signup, guest-order privacy, legacy session/password isolation, one-time reset and cross-process OTP race')
 finally:
  for s in servers:s.terminate()
  for s in servers:s.wait(timeout=10)
