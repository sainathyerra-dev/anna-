const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
function fixture(){
  const elements={};const events={};const storage=new Map();
  const el=()=>({disabled:false,hidden:false,value:'',style:{},dataset:{},children:[],classList:{toggle(){}},addEventListener(name,fn){this[name]=fn;},replaceChildren(){},append(){},setAttribute(){},focus(){},click(){}});
  const context={document:{getElementById(id){return elements[id] ||= el();},createElement:el,addEventListener(){}},window:{addEventListener(name,fn){events[name]=fn;}},navigator:{},Date,AbortSignal,AbortController,Blob,URL,setTimeout,clearTimeout,setInterval(){},confirm:()=>true,localStorage:{getItem:key=>storage.get(key)||null,setItem(key,val){storage.set(key,val);}}};
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8').replace(/loadInitialState\(\);\s*$/,''),context);
  return {context,elements,events,storage,run:code=>vm.runInContext(code,context)};
}
test('HTTP save failures remain visible and dirty',async()=>{
  const f=fixture();f.context.fetch=async()=>({ok:false,status:500,json:async()=>({error:'Disk failed'})});
  await assert.rejects(f.run('persistState()'),/Disk failed/);assert.equal(f.run('dirty'),true);
});
test('failed startup cannot trigger writes or a paid opening request',async()=>{
  const f=fixture();let calls=0;f.context.fetch=async()=>{calls++;return {ok:false,status:500,json:async()=>({error:'Load failed'})};};
  await f.run('loadInitialState()');assert.equal(calls,1);assert.equal(f.run('ready'),false);assert.equal(f.elements.connError.textContent,'Load failed');
});
test('repeated sends stay locked; reset does not race an active reply',async()=>{
  const f=fixture();let calls=0;let resolve;
  f.context.fetch=async url=>{if(url==='/api/chat'){calls++;return new Promise(r=>resolve=r);}return {ok:true,json:async()=>({revision:1})};};
  f.run('ready=true;configured=true;');f.elements['text-input'].value='hello';
  const send=f.run('handleSend()');await new Promise(setImmediate);
  f.elements['text-input'].value='second';await f.run('handleSend()');await f.elements.resetLink.click();
  assert.equal(calls,1);assert.equal(f.run('messages.length'),1);
  resolve({ok:true,json:async()=>({reply:'reply'})});await send;assert.equal(f.run('messages.length'),2);
});
test('browser saves detect conflicts and quota failures',async()=>{
  const f=fixture();f.run('storageMode="browser";ready=true;');await f.run('persistState()');assert.equal(f.run('revision'),1);
  f.storage.set('anna-personal-state-v1',JSON.stringify({messages:[],ledger:{},revision:2}));
  await assert.rejects(f.run('persistState()'),/Another tab/);assert.equal(f.run('conflicted'),true);
  f.run('revision=2;conflicted=false;');f.context.localStorage.setItem=()=>{throw Error('Quota');};await assert.rejects(f.run('persistState()'),/Storage may be full/);assert.equal(f.run('dirty'),true);
});
test('local dates match India midnight and streaks exceed sixty days',()=>{
  const f=fixture();const oldTZ=process.env.TZ;process.env.TZ='Asia/Kolkata';
  try{assert.equal(f.run('localDay(new Date("2026-10-09T00:30:00+05:30"))'),'2026-10-09');}finally{if(oldTZ===undefined)delete process.env.TZ;else process.env.TZ=oldTZ;}
  f.run('for(let i=0,d=new Date();i<90;i++,d.setDate(d.getDate()-1))ledgerByDate[localDay(d)]={water:true};renderLedger();');assert.match(f.elements.streakNote.textContent,/90 days/);
});
test('context is bounded while full saved history remains intact',()=>{
  const f=fixture();f.run('messages=Array.from({length:200},(_,i)=>({role:i%2?"assistant":"user",content:"x".repeat(1000),ts:i}));messages.push({role:"user",content:"last",ts:201});');
  const history=f.run('apiHistory()');assert.ok(JSON.stringify(history).length<=24000);assert.equal(history[0].role,'user');assert.equal(history.at(-1).content,'last');assert.equal(f.run('messages.length'),201);
});
