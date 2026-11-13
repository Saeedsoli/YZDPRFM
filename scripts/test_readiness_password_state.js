'use strict';

const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),net=require('net'),crypto=require('crypto'),{spawn}=require('child_process');
const Database=require('better-sqlite3');
const root=path.join(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'readiness-password-')),dbPath=path.join(dir,'db.sqlite');
const password='PrivateTestPassword-312', defaultPw='yazd1404';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function port(){return new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});}
async function boot(envPassword){const p=await port();const child=spawn(process.execPath,['src/server.js'],{cwd:root,env:{PATH:process.env.PATH,HOME:process.env.HOME,DB_PATH:dbPath,ADMIN_PASSWORD:envPassword,PORT:String(p),BACKUP_DISABLED:'1',NODE_ENV:'test'},stdio:'ignore'});for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error('server exited');try{if((await fetch(`http://127.0.0.1:${p}/api/health`)).ok)return {child,base:`http://127.0.0.1:${p}`};}catch{}await sleep(100);}child.kill();throw Error('server failed to start');}
async function stop(child){if(child.exitCode!==null)return;child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),sleep(2000)]);if(child.exitCode===null)child.kill('SIGKILL');}
async function api(base,method,url,body,token){const r=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});const text=await r.text();return {status:r.status,text,json:JSON.parse(text)};}
(async()=>{let server;try{
 server=await boot(password);const login=await api(server.base,'POST','/api/admin/login',{username:'owner',password});assert.equal(login.status,200);const token=login.json.token;
 async function state(){const out=await api(server.base,'GET','/api/admin/readiness',null,token);assert.equal(out.status,200);assert(!out.text.includes(password));assert(!out.text.includes(defaultPw));return out.json.items.find(x=>x.key==='admin_password');}
 assert.equal((await state()).level,'ok');await stop(server.child);

 server=await boot(defaultPw);const again=await api(server.base,'POST','/api/admin/login',{username:'owner',password});assert.equal(again.status,200);const token2=again.json.token;
 async function check(){const r=await api(server.base,'GET','/api/admin/readiness',null,token2);assert.equal(r.status,200);assert(!r.text.includes(password));assert(!r.text.includes(defaultPw));return r.json.items.find(x=>x.key==='admin_password');}
 assert.equal((await check()).level,'ok');
 const db=new Database(dbPath);const salt=crypto.randomBytes(16).toString('hex');const hash=p=>crypto.scryptSync(p,salt,64).toString('hex');
 const result=db.prepare("INSERT INTO staff(username,display_name,role_key,pass_hash,pass_salt,must_change,active,created_by) VALUES('isolated-second-owner','Test','owner',?,?,0,1,'test')").run(hash(defaultPw),salt);const id=result.lastInsertRowid;
 let item=await check();assert.equal(item.level,'error');assert.match(item.hint,/پنل/);assert(!JSON.stringify(item).includes(salt));
 db.prepare('UPDATE staff SET active=0 WHERE id=?').run(id);assert.equal((await check()).level,'ok');
 db.prepare('UPDATE staff SET active=1,pass_hash=?,must_change=1 WHERE id=?').run(hash('OtherStrongPassword-83'),id);assert.equal((await check()).level,'error');
 db.prepare('UPDATE staff SET must_change=0 WHERE id=?').run(id);assert.equal((await check()).level,'ok');
 db.prepare("UPDATE staff SET pass_hash='corrupt' WHERE id=?").run(id);assert.equal((await check()).level,'error');db.close();
 console.log('PASS stored owner password versus environment; multiple/disabled owners, pending change, malformed hash and no secret leakage');
 }finally{if(server)await stop(server.child);fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
