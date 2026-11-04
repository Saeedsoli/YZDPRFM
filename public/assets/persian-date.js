/* Persian calendar for display and date-only input. Database/API values remain ISO.
   A calendar date has no time zone; instants are displayed in Asia/Tehran. */
(function(root,factory){
  const core=typeof module!=='undefined' && module.exports ? require('./jalaali-core.js') : root?.jalaali;
  // A page-level fallback keeps non-date actions working if this dependency
  // fails to load. Date entry must remain disabled rather than guess.
  if(!core) { if(root?.YazdDate)return; throw Error('Persian calendar core unavailable'); }
  const api=factory(core);
  if(typeof module!=='undefined' && module.exports)module.exports=api;
  if(root)root.YazdDate=api;
})(typeof window!=='undefined'?window:null,function(jalaali){
 'use strict';
 const MONTHS=['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];
 const WEEK=['ش','ی','د','س','چ','پ','ج'];
 const DAY=86400000, ZONE='Asia/Tehran';
 const fa=v=>String(v).replace(/\d/g,d=>'۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
 const pad=v=>String(v).padStart(2,'0');
 const utcGregorian=new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn',{timeZone:'UTC',year:'numeric',month:'numeric',day:'numeric'});
 const shopGregorian=new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn',{timeZone:ZONE,year:'numeric',month:'numeric',day:'numeric'});
 const shopClock=new Intl.DateTimeFormat('en-GB-u-nu-latn',{timeZone:ZONE,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 function parts(formatter,date){
  const x=Object.fromEntries(formatter.formatToParts(date).filter(p=>['year','month','day'].includes(p.type)).map(p=>[p.type,Number(p.value)]));
  return {year:x.year,month:x.month,day:x.day};
 }
 function isoDateMs(v){
  if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))return null;
  const [y,m,d]=v.split('-').map(Number),ms=Date.UTC(y,m-1,d),dt=new Date(ms);
  if(!Number.isFinite(ms)||dt.getUTCFullYear()!==y||dt.getUTCMonth()+1!==m||dt.getUTCDate()!==d)return null;
  return ms;
 }
 function parse(v){
  if(v instanceof Date){const n=v.getTime();return Number.isFinite(n)?{ms:n,dateOnly:false}:null;}
  if(typeof v==='number')return Number.isFinite(v)&&Number.isFinite(new Date(v).getTime())?{ms:v,dateOnly:false}:null;
  if(typeof v!=='string'||!v)return null;
  if(/^\d{4}-\d{2}-\d{2}$/.test(v)){const ms=isoDateMs(v);return ms===null?null:{ms,dateOnly:true};}
  // SQLite CURRENT_TIMESTAMP and unzoned stored timestamps are UTC.
  let text=v.trim().replace(' ','T');
  if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(text))text+='Z';
  const ms=Date.parse(text);return Number.isFinite(ms)?{ms,dateOnly:false}:null;
 }
 function toPersian(v){
  const parsed=parse(v);if(!parsed)return null;
  const g=parts(parsed.dateOnly?utcGregorian:shopGregorian,new Date(parsed.ms));
  try{const j=jalaali.toJalaali(g.year,g.month,g.day);return {year:j.jy,month:j.jm,day:j.jd};}catch{return null;}
 }
 function formatDate(v){const p=toPersian(v);return p?`${fa(pad(p.day))} / ${fa(pad(p.month))} / ${fa(p.year)}`:'—';}
 function formatDateTime(v){
  const parsed=parse(v);if(!parsed)return '—';const date=formatDate(v);
  if(parsed.dateOnly)return date;
  const p=Object.fromEntries(shopClock.formatToParts(new Date(parsed.ms)).filter(x=>['hour','minute'].includes(x.type)).map(x=>[x.type,x.value]));
  return `${date}، ${fa(p.hour+':'+p.minute)}`;
 }
 function toISO(year,month,day){
  if(!Number.isInteger(year)||year<1200||year>1600||!Number.isInteger(month)||month<1||month>12||!Number.isInteger(day)||day<1||day>31)return null;
  if(!jalaali.isValidJalaaliDate(year,month,day))return null;
  const g=jalaali.toGregorian(year,month,day);
  return `${String(g.gy).padStart(4,'0')}-${pad(g.gm)}-${pad(g.gd)}`;
 }
 let clockBase=null;
 function monotonic(){return typeof performance!=='undefined'&&typeof performance.now==='function'?performance.now():null;}
 function setClock(serverMs,latencyMs=0){
  const n=monotonic();if(!Number.isSafeInteger(serverMs)||serverMs<Date.UTC(2000,0,1)||serverMs>Date.UTC(2300,0,1)||n===null)return false;
  const latency=Number.isFinite(latencyMs)?Math.max(0,Math.min(latencyMs,60000)):0;
  clockBase={ms:serverMs+latency/2,at:n};return true;
 }
 function now(){const n=monotonic();return clockBase&&n!==null?clockBase.ms+(n-clockBase.at):Date.now();}
 function current(){return toPersian(now());}
 function inputISO(el){
  if(!el||!el.value||!el.dataset.iso)return null;
  const v=el.dataset.iso;return isoDateMs(v)!==null&&formatDate(v)===el.value?v:null;
 }
 function setInput(el,iso){
  if(!el)return false;
  if(!iso){el.value='';delete el.dataset.iso;el.dispatchEvent(new Event('change',{bubbles:true}));return true;}
  if(isoDateMs(iso)===null)return false;
  el.dataset.iso=iso;el.value=formatDate(iso);el.dispatchEvent(new Event('change',{bubbles:true}));return true;
 }
 let activeCalendar=null,globalEventsInstalled=false;
 function installGlobalEvents(){
  if(globalEventsInstalled)return;globalEventsInstalled=true;
  document.addEventListener('pointerdown',e=>{
   if(activeCalendar && !activeCalendar.input.isConnected){activeCalendar.close();return;}
   if(activeCalendar && !activeCalendar.panel.contains(e.target) && e.target!==activeCalendar.input)activeCalendar.close();
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&activeCalendar)activeCalendar.close()});
  const reposition=()=>{if(activeCalendar){if(!activeCalendar.input.isConnected)activeCalendar.close();else activeCalendar.position();}};
  window.addEventListener('resize',reposition);window.addEventListener('scroll',reposition,true);
 }
 function mount(input){
  if(!input||input.dataset.jalaliMounted==='1'||typeof document==='undefined')return;
  installGlobalEvents();input.dataset.jalaliMounted='1';input.readOnly=true;input.setAttribute('aria-haspopup','dialog');input.setAttribute('aria-expanded','false');
  const label=input.closest('label') || input.parentElement?.querySelector('label');
  if(!input.getAttribute('aria-label') && label)input.setAttribute('aria-label',label.textContent.trim());
  input.setAttribute('placeholder','روز / ماه / سال');
  let panel=null,year,month;
  function close(){if(panel){panel.remove();panel=null;}if(activeCalendar?.input===input)activeCalendar=null;input.setAttribute('aria-expanded','false');}
  function make(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
  function position(){
   if(!panel)return;const r=input.getBoundingClientRect(),w=Math.min(340,window.innerWidth-16);
   panel.style.width=w+'px';panel.style.left=Math.max(8,Math.min(r.right-w,window.innerWidth-w-8))+'px';
   const h=panel.offsetHeight,below=r.bottom+6;panel.style.top=Math.max(8,Math.min(below,window.innerHeight-h-8))+'px';
  }
  function draw(){
   if(!panel)return;panel.replaceChildren();
   const controls=make('div','jalali-controls');
   const prev=make('button','jalali-arrow','‹');prev.type='button';prev.setAttribute('aria-label','ماه قبل');
   const m=make('select','jalali-month');m.setAttribute('aria-label','ماه');
   MONTHS.forEach((v,i)=>{const o=make('option','',v);o.value=String(i+1);m.appendChild(o)});m.value=String(month);
   const y=make('select','jalali-year');y.setAttribute('aria-label','سال');
   for(let n=1200;n<=1600;n++){const o=make('option','',fa(n));o.value=String(n);y.appendChild(o)}y.value=String(year);
   const next=make('button','jalali-arrow','›');next.type='button';next.setAttribute('aria-label','ماه بعد');
   function move(n){month+=n;if(month<1){month=12;year--}if(month>12){month=1;year++}if(year<1200){year=1200;month=1}if(year>1600){year=1600;month=12}draw()}
   prev.addEventListener('click',()=>move(-1));next.addEventListener('click',()=>move(1));
   m.addEventListener('change',()=>{month=Number(m.value);draw();panel?.querySelector('.jalali-month')?.focus()});y.addEventListener('change',()=>{year=Number(y.value);draw();panel?.querySelector('.jalali-year')?.focus()});
   controls.append(prev,m,y,next);panel.appendChild(controls);
   const grid=make('div','jalali-days');WEEK.forEach(v=>grid.appendChild(make('div','jalali-week',v)));
   const first=toISO(year,month,1),offset=(new Date(isoDateMs(first)).getUTCDay()+1)%7;
   for(let i=0;i<offset;i++)grid.appendChild(make('span','jalali-empty'));
   const today=current(),selected=inputISO(input);
   for(let d=1;d<=31;d++){
    const iso=toISO(year,month,d);if(!iso)break;
    const b=make('button','jalali-day',fa(d));b.type='button';b.dataset.iso=iso;
    b.setAttribute('aria-label',`${fa(d)} ${MONTHS[month-1]} ${fa(year)}`);
    if(today.year===year&&today.month===month&&today.day===d)b.classList.add('today');
    if(selected===iso)b.classList.add('selected');
    b.addEventListener('click',()=>{setInput(input,iso);close();input.focus()});grid.appendChild(b);
   }
   panel.appendChild(grid);const bottom=make('div','jalali-bottom');
   const todayButton=make('button','','امروز');todayButton.type='button';todayButton.addEventListener('click',()=>{
    const p=current(),iso=toISO(p.year,p.month,p.day);if(iso){setInput(input,iso);close();input.focus()}
   });
   const clear=make('button','','پاک کردن تاریخ');clear.type='button';clear.addEventListener('click',()=>{setInput(input,null);close();input.focus()});
   bottom.append(todayButton,clear);panel.appendChild(bottom);position();
  }
  function open(){
   if(panel){close();return;}if(activeCalendar)activeCalendar.close();const chosen=inputISO(input),p=chosen?toPersian(chosen):current();year=Math.max(1200,Math.min(1600,p.year));month=p.month;
   panel=make('div','jalali-picker');panel.setAttribute('role','dialog');panel.setAttribute('aria-label','تقویم شمسی');document.body.appendChild(panel);activeCalendar={input,panel,close,position};input.setAttribute('aria-expanded','true');draw();
  }
  input.addEventListener('click',open);
  input.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open()}else if(e.key==='Escape')close()});
 }
 function mountAll(parent){if(typeof document==='undefined')return;if(activeCalendar&&!activeCalendar.input.isConnected)activeCalendar.close();(parent||document).querySelectorAll('[data-jalali-date]').forEach(mount);}
 return {ready:true,MONTHS,formatDate,formatDateTime,toPersian,toISO,parse,setClock,now,current,inputISO,setInput,mount,mountAll};
});
