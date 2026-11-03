'use strict';
// Never trust client-supplied forwarding headers unless the socket peer is in
// an operator-configured, verified proxy CIDR. Walk the chain from the right.
const net=require('net');
function normalize(value){
 if(typeof value!=='string')return null;
 const ip=value.trim();
 if(ip.toLowerCase().startsWith('::ffff:')&&net.isIP(ip.slice(7))===4)return ip.slice(7);
 return net.isIP(ip)?ip.toLowerCase():null;
}
function createPolicy(spec=''){
 if(typeof spec!=='string')throw Error('Invalid trusted proxy configuration');
 const raw=spec.trim(),block=new net.BlockList();let count=0;
 if(raw){
  const entries=raw.split(',');if(entries.length>64||entries.some(x=>!x.trim()))throw Error('Invalid trusted proxy configuration');
  for(const entry of entries){
   const parts=entry.trim().split('/');if(parts.length>2)throw Error('Invalid trusted proxy configuration');
   const address=normalize(parts[0]);if(!address)throw Error('Invalid trusted proxy configuration');
   const family=net.isIP(address),max=family===4?32:128,type=family===4?'ipv4':'ipv6';
   if(parts.length===1)block.addAddress(address,type);
   else {
    if(!/^\d{1,3}$/.test(parts[1]))throw Error('Invalid trusted proxy configuration');
    const prefix=Number(parts[1]);if(prefix<1||prefix>max)throw Error('Invalid trusted proxy configuration');
    block.addSubnet(address,prefix,type);
   }
   count++;
  }
 }
 function trusted(ip){const family=net.isIP(ip);return !!family&&block.check(ip,family===4?'ipv4':'ipv6');}
 function clientIP(req){
  const peer=normalize(req.socket?.remoteAddress)||'unknown';
  const forwarded=req.headers?.['x-forwarded-for'];
  if(!trusted(peer)||typeof forwarded!=='string'||!forwarded.trim())return peer;
  const parts=forwarded.split(',');if(parts.length>16)return peer;
  const chain=parts.map(normalize);if(chain.some(x=>!x))return peer;
  let current=peer;
  for(let i=chain.length-1;i>=0&&trusted(current);i--)current=chain[i];
  return current;
 }
 return {configured:count>0,count,clientIP};
}
module.exports={createPolicy,normalize};
