'use strict';
// Real image fixtures and hostile containers in a disposable upload directory.
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto'),{Readable}=require('stream'),{spawnSync}=require('child_process');
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'image-upload-security-'));
process.env.MEDIA_DIR=tmp;process.env.MEDIA_MAX_BYTES='not-a-number';
const media=require('../src/media'),{detectFormat,safeName}=media._internals;
const png=fs.readFileSync(path.join(root,'public/icon-192.png'));
const jpg=fs.readFileSync(path.join(root,'public/images/products/variant-sample.jpg'));
const webp=fs.readFileSync(path.join(root,'public/images/products/variant-sample.webp'));
const gif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');
function req(b,declared){const r=Readable.from([b]);r.headers=declared===undefined?{}:{'content-length':String(declared)};return r}
(async()=>{
 try {
  assert.equal(media.MAX_BYTES,3*1024*1024);
  // All existing local sample assets of these types should remain accepted.
  for(const dir of [path.join(root,'public'),path.join(root,'public/images/products')])for(const name of fs.readdirSync(dir)){
   if(!/\.(?:jpg|png|webp|gif)$/i.test(name))continue;
   const file=path.join(dir,name);if(fs.statSync(file).isFile())assert(detectFormat(fs.readFileSync(file)),name);
  }
  for(const [name,buf] of [['png',png],['jpg',jpg],['webp',webp],['gif',gif]]){
   assert.equal(detectFormat(buf)?.ext,name);
   assert.equal(detectFormat(buf.subarray(0,Math.min(12,buf.length))),null,name+' truncated');
   assert.equal(detectFormat(Buffer.concat([buf,Buffer.from('<script>alert(1)</script>')])),null,name+' trailing payload');
   const cut=buf.subarray(0,buf.length-1);assert.equal(detectFormat(cut),null,name+' truncated tail');
  }
  const badCrc=Buffer.from(png);badCrc[20]^=1;assert.equal(detectFormat(badCrc),null);
  const hugePng=Buffer.from(png);hugePng.writeUInt32BE(12001,16);
  let crc=0xffffffff;for(let i=12;i<29;i++){crc^=hugePng[i];for(let j=0;j<8;j++)crc=(crc&1)?(0xedb88320^(crc>>>1)):(crc>>>1)}hugePng.writeUInt32BE((crc^0xffffffff)>>>0,29);
  assert.equal(detectFormat(hugePng),null);
  const hugeGif=Buffer.from(gif);hugeGif.writeUInt16LE(12001,6);assert.equal(detectFormat(hugeGif),null);
  const badGif=Buffer.from(gif);badGif.write('GIFxxx',0,'ascii');assert.equal(detectFormat(badGif),null);
  const badWebp=Buffer.from(webp);badWebp.writeUInt32LE(0,4);assert.equal(detectFormat(badWebp),null);
  const fakeJpg=Buffer.from([255,216,255,224,0,2,0,0,0,0,255,217]);assert.equal(detectFormat(fakeJpg),null);
  assert.equal(detectFormat(Buffer.from('<svg><script/></svg>')),null);
  assert.equal((await media.saveUpload(req(Buffer.from('not image')),'x.jpg')).ok,false);
  assert.equal((await media.saveUpload(req(png,media.MAX_BYTES+1),'x.png')).ok,false);
  const uploaded=await media.saveUpload(req(png),'../../عکس.png');assert(uploaded.ok);assert(/^[a-z0-9-]+\.png$/.test(uploaded.name));assert.equal(fs.statSync(path.join(tmp,uploaded.name)).mode&0o777,0o600);
  // Force collisions: a second upload must not overwrite an existing file.
  const origRandom=crypto.randomBytes,origNow=Date.now;
  try{
   crypto.randomBytes=n=>Buffer.alloc(n,7);Date.now=()=>1700000000000;
   const first=await media.saveUpload(req(png),'same.png');assert(first.ok);
   const before=fs.readFileSync(path.join(tmp,first.name));
   const second=await media.saveUpload(req(png),'same.png');assert(!second.ok);
   assert.deepEqual(fs.readFileSync(path.join(tmp,first.name)),before);
  }finally{crypto.randomBytes=origRandom;Date.now=origNow;}
  const probe=spawnSync(process.execPath,['-e',"console.log(require('./src/media').MAX_BYTES)"],{cwd:root,env:{...process.env,MEDIA_MAX_BYTES:'Infinity'},encoding:'utf8'});
  assert.equal(probe.status,0,probe.stderr);assert.equal(Number(probe.stdout.trim()),3*1024*1024);
  assert(!safeName('../../outside.jpg','jpg').includes('/'));
  console.log('PASS upload structure, dimensions, CRC, invalid limits and exclusive file creation; no real uploads');
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
