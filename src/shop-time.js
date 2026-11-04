'use strict';
// Date-only commercial rules use the shop's civil day, independent of the
// server OS timezone. Stored timestamps remain UTC and 72-hour windows remain
// exact elapsed durations. No data migration or historical timestamp rewrite.
const formatter=new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn',{timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit'});
function dateKey(ms=Date.now()){
 if(!Number.isFinite(ms))throw Error('Invalid timestamp');
 const p=Object.fromEntries(formatter.formatToParts(new Date(ms)).filter(x=>['year','month','day'].includes(x.type)).map(x=>[x.type,x.value]));
 return `${p.year}-${p.month}-${p.day}`;
}
function validDateKey(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const t=Date.parse(value+'T00:00:00Z');return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===value;
}
module.exports={dateKey,validDateKey};
