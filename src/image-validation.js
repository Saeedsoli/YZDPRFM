'use strict';

const MAX_SIDE=12000,MAX_PIXELS=80000000;
const dimensions=(w,h)=>Number.isInteger(w)&&Number.isInteger(h)&&w>0&&h>0&&w<=MAX_SIDE&&h<=MAX_SIDE&&w*h<=MAX_PIXELS;
const u24=(b,p)=>b[p]|(b[p+1]<<8)|(b[p+2]<<16);
const crcTable=(()=>{const t=new Uint32Array(256);for(let i=0;i<256;i++){let x=i;for(let j=0;j<8;j++)x=(x&1)?(0xedb88320^(x>>>1)):(x>>>1);t[i]=x>>>0}return t})();
function crc32(b,start,end){let x=0xffffffff;for(let i=start;i<end;i++)x=crcTable[(x^b[i])&255]^(x>>>8);return (x^0xffffffff)>>>0}
function png(b){
 if(b.length<45||!b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return false;
 let p=8,first=true,idat=false;
 while(p+12<=b.length){
  const n=b.readUInt32BE(p),end=p+12+n;if(end>b.length)return false;
  const tag=b.toString('ascii',p+4,p+8);
  if(crc32(b,p+4,p+8+n)!==b.readUInt32BE(p+8+n))return false;
  if(first){if(tag!=='IHDR'||n!==13||!dimensions(b.readUInt32BE(p+8),b.readUInt32BE(p+12)))return false;first=false}
  else if(tag==='IHDR')return false;
  if(tag==='IDAT'&&n>0)idat=true;
  if(tag==='IEND')return n===0&&idat&&end===b.length;
  p=end;
 }
 return false;
}
function jpeg(b){
 if(b.length<16||b[0]!==255||b[1]!==216||b[b.length-2]!==255||b[b.length-1]!==217)return false;
 let p=2,hasDimensions=false;
 while(p<b.length-2){
  if(b[p++]!==255)return false;
  while(p<b.length&&b[p]===255)p++;
  if(p>=b.length)return false;
  const marker=b[p++];
  if(marker===0||marker===216||marker===217)return false;
  if(marker===1||(marker>=208&&marker<=215))continue;
  if(p+2>b.length)return false;
  const n=b.readUInt16BE(p);if(n<2||p+n>b.length)return false;
  if((marker>=192&&marker<=207)&&![196,200,204].includes(marker)){
   if(n<8||!dimensions(b.readUInt16BE(p+5),b.readUInt16BE(p+3)))return false;
   hasDimensions=true;
  }
  if(marker===218)return hasDimensions&&p+n<b.length-2;
  p+=n;
 }
 return false;
}
function webp(b){
 if(b.length<30||b.toString('ascii',0,4)!=='RIFF'||b.toString('ascii',8,12)!=='WEBP'||b.readUInt32LE(4)+8!==b.length)return false;
 let p=12,w=0,h=0,image=false;
 while(p+8<=b.length){
  const tag=b.toString('ascii',p,p+4),n=b.readUInt32LE(p+4),start=p+8,end=start+n,padded=end+(n%2);
  if(end>b.length||padded>b.length)return false;
  if(tag==='VP8X'){if(n<10)return false;w=u24(b,start+4)+1;h=u24(b,start+7)+1}
  else if(tag==='VP8 '){
   if(n<10||b[start+3]!==157||b[start+4]!==1||b[start+5]!==42)return false;
   const x=b.readUInt16LE(start+6)&0x3fff,y=b.readUInt16LE(start+8)&0x3fff;if(!w){w=x;h=y}image=true;
  }else if(tag==='VP8L'){
   if(n<5||b[start]!==47)return false;
   const x=1+b[start+1]+((b[start+2]&63)<<8),y=1+(b[start+2]>>6)+(b[start+3]<<2)+((b[start+4]&15)<<10);if(!w){w=x;h=y}image=true;
  }else if(tag==='ANMF'){if(n<24)return false;image=true;}
  p=padded;
 }
 return p===b.length&&image&&dimensions(w,h);
}
function gif(b){
 if(b.length<20||!['GIF87a','GIF89a'].includes(b.toString('ascii',0,6)))return false;
 const w=b.readUInt16LE(6),h=b.readUInt16LE(8);if(!dimensions(w,h))return false;
 const table=packed=>(packed&128)?3*(1<<((packed&7)+1)):0;
 let p=13+table(b[10]),image=false;
 const subblocks=()=>{while(p<b.length){const n=b[p++];if(!n)return true;if(p+n>b.length)return false;p+=n}return false};
 while(p<b.length){
  const marker=b[p++];
  if(marker===59)return image&&p===b.length;
  if(marker===33){if(p>=b.length)return false;p++;if(!subblocks())return false;continue}
  if(marker!==44||p+9>b.length)return false;
  const x=b.readUInt16LE(p),y=b.readUInt16LE(p+2),iw=b.readUInt16LE(p+4),ih=b.readUInt16LE(p+6),packed=b[p+8];
  if(!dimensions(iw,ih)||x+iw>w||y+ih>h)return false;
  p+=9+table(packed);if(p>=b.length||b[p]<2||b[p]>8)return false;p++;
  if(!subblocks())return false;image=true;
 }
 return false;
}
function detect(buf){
 if(!Buffer.isBuffer(buf))return null;
 try{
  if(png(buf))return {ext:'png',mime:'image/png'};
  if(jpeg(buf))return {ext:'jpg',mime:'image/jpeg'};
  if(webp(buf))return {ext:'webp',mime:'image/webp'};
  if(gif(buf))return {ext:'gif',mime:'image/gif'};
 }catch{}
 return null;
}
module.exports={detect,MAX_SIDE,MAX_PIXELS};
