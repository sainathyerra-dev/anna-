const $ = id => document.getElementById(id);
let messages=[], ledgerByDate={}, revision=0, ready=false, busy=false, conflicted=false, dirty=false, configured=false, controller=null;
const localDay = (date=new Date()) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
let currentDate=localDay();
let storageMode='file';
const storageKey='anna-personal-state-v1';
function validSaved(data) {
  return data && Array.isArray(data.messages) && data.messages.length<=10000 && data.messages.every(m=>m && ['user','assistant'].includes(m.role) && typeof m.content==='string' && m.content.trim() && m.content.length<=16000 && Number.isSafeInteger(m.ts) && m.ts>=0) && data.ledger && typeof data.ledger==='object' && !Array.isArray(data.ledger) && Object.keys(data.ledger).length<=10000 && Object.entries(data.ledger).every(([day,entry])=>/^\d{4}-\d{2}-\d{2}$/.test(day) && entry && typeof entry==='object' && !Array.isArray(entry) && Object.entries(entry).every(([k,v])=>['swim','temple','water','parents','study','market','laundry','room'].includes(k) && typeof v==='boolean')) && Number.isSafeInteger(data.revision);
}
function readLocal() {
  const raw=localStorage.getItem(storageKey);
  if(!raw)return {messages:[],ledger:{},revision:0};
  const saved=JSON.parse(raw);
  if(!validSaved(saved))throw Error('Device history is invalid. Keep a copy of browser storage and restore a valid backup.');
  return saved;
}
function error(message='') { $('connError').textContent=message; $('connError').hidden=!message; }
function controls() {
  $('send-btn').disabled=!ready||busy||conflicted||!configured;
  $('text-input').disabled=!ready||conflicted;
  $('resetLink').disabled=!ready||busy||conflicted;
  for (const item of $('ledger').children) item.disabled=!ready||busy||conflicted;
  $('retryBtn').hidden=!ready || !(dirty || messages.at(-1)?.role==='user');
  $('retryBtn').disabled=busy||conflicted;
  $('cancelBtn').hidden=!busy;
  $('importBtn').disabled=!ready||busy||conflicted;
}
async function request(url,body,signal) {
  const res=await fetch(url,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:signal||AbortSignal.timeout(15000)});
  const data=await res.json().catch(()=>({error:'Server returned an invalid response.'}));
  if (!res.ok) {
    if(res.status===401) {ready=false;$('loginPanel').hidden=false;controls();}
    if(res.status===409) {conflicted=true;$('reloadBtn').hidden=false;controls();}
    throw Error(data.error||`Request failed (${res.status}).`);
  }
  return data;
}
function renderMessages() {
  $('chat').replaceChildren();
  const display=messages.length?messages:[{role:'assistant',content:'Em ra, ela unnav ivala? Talk to me when you’re ready.',ts:Date.now()}];
  for(const m of display) {
    const row=document.createElement('div');row.className='msg '+(m.role==='user'?'user':'anna');
    const avatar=document.createElement('div');avatar.className='avatar-sm';avatar.textContent=m.role==='user'?'S':'A';avatar.setAttribute('aria-hidden','true');
    const wrap=document.createElement('div');const bubble=document.createElement('div');bubble.className='bubble';bubble.textContent=m.content;
    const meta=document.createElement('div');meta.className='meta';meta.textContent=new Date(m.ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    wrap.append(bubble,meta);row.append(avatar,wrap);$('chat').append(row);
  }
  $('chat').scrollTop=$('chat').scrollHeight;
}
function renderLedger() {
  currentDate=localDay();
  const entry=ledgerByDate[currentDate]||{};
  for(const item of $('ledger').children) {const done=!!entry[item.dataset.key];item.classList.toggle('done',done);item.setAttribute('aria-pressed',String(done));}
  let streak=0;const day=new Date();day.setHours(12,0,0,0);
  for(let i=0;i<=Object.keys(ledgerByDate).length+1;i++) {
    const checked=Object.values(ledgerByDate[localDay(day)]||{}).some(Boolean);
    if(checked) streak++;else if(i!==0) break;
    day.setDate(day.getDate()-1);
  }
  $('streakNote').textContent=`streak: ${streak} day${streak===1?'':'s'}`;
}
async function persistState() {
  dirty=true;controls();
  if(storageMode==='browser') {
    const saved=readLocal();
    if(saved.revision!==revision) {conflicted=true;$('reloadBtn').hidden=false;controls();throw Error('Another tab updated Anna. Export unsaved changes, then reload.');}
    const next={messages,ledger:ledgerByDate,revision:revision+1};
    if(!validSaved(next))throw Error('Conversation data is invalid or too large. Export a backup and start a new conversation.');
    try{localStorage.setItem(storageKey,JSON.stringify(next));}catch{throw Error('Could not save on this device. Storage may be full or blocked. Export a backup before closing.');}
    revision=next.revision;dirty=false;controls();return;
  }
  const data=await request('/api/state',{messages,ledger:ledgerByDate,revision});
  revision=data.revision;dirty=false;controls();
}
async function loadInitialState() {
  if(busy)return;
  ready=false;controls();
  try {
    let data=await request('/api/state');
    storageMode=data.storageMode;
    if(storageMode==='browser')data={...data,...readLocal()};
    if(!validSaved(data)) throw Error('Saved data is invalid. Restore your backup before continuing.');
    messages=data.messages;ledgerByDate=data.ledger;revision=data.revision;configured=data.configured;
    ready=true;dirty=false;conflicted=false;$('loginPanel').hidden=true;$('logoutBtn').hidden=!data.privateLogin;$('reloadBtn').hidden=true;
    renderMessages();renderLedger();error(configured?'':'Add your OpenAI API key to the server settings, then restart Anna to enable replies.');
    $('storageNote').textContent=storageMode==='browser'?'History is saved in this browser only. Export backups; devices have separate chats.':'History is saved on your Anna server. Export backups regularly.';
  } catch(e) {error(e.message);$('reloadBtn').hidden=false;}
  controls();
}
function apiHistory() {
  let history=messages.map(({role,content})=>({role,content}));
  while(history.length>1 && (history.length>80||JSON.stringify(history).length>24000)) history.shift();
  while(history.length>1 && history[0].role!=='user') history.shift();
  $('contextNote').hidden=history.length===messages.length;
  return history;
}
async function reply() {
  controller=new AbortController();
  $('typingNote').hidden=false;
  try {
    const data=await request('/api/chat',{messages:apiHistory()},AbortSignal.any([controller.signal,AbortSignal.timeout(50000)]));
    if(typeof data.reply!=='string'||!data.reply.trim()) throw Error('Anna returned an empty reply. Retry your message.');
    messages.push({role:'assistant',content:data.reply,ts:Date.now()});renderMessages();await persistState();
  } finally {controller=null;$('typingNote').hidden=true;}
}
async function handleSend() {
  if(!ready||busy||conflicted||!configured)return;
  const text=$('text-input').value.trim();if(!text)return;
    if(messages.at(-1)?.role==='user') {error('Retry the unanswered message, or clear the conversation before sending another.');return;}
  if(text.length>16000){error('Please keep each message under 16,000 characters.');return;}
  busy=true;controls();error();
  messages.push({role:'user',content:text,ts:Date.now()});$('text-input').value='';$('text-input').style.height='auto';renderMessages();
  try {await persistState();await reply();}catch(e){error(e.name==='AbortError'?'Reply cancelled. You can retry your message.':e.name==='TimeoutError'?'The request timed out. Try again.':e.message);}
  finally {busy=false;controls();$('text-input').focus();}
}
$('send-btn').addEventListener('click',handleSend);
$('text-input').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();handleSend();}});
$('text-input').addEventListener('input',()=>{$('text-input').style.height='auto';$('text-input').style.height=Math.min($('text-input').scrollHeight,100)+'px';});
$('ledger').addEventListener('click',async e=>{
  const item=e.target.closest('button[data-key]');if(!item||!ready||busy||conflicted)return;
  busy=true;controls();renderLedger();error();
  ledgerByDate[currentDate] ||= {};ledgerByDate[currentDate][item.dataset.key]=!ledgerByDate[currentDate][item.dataset.key];renderLedger();
  try{await persistState();}catch(e){error(e.message);}finally{busy=false;controls();}
});
$('retryBtn').addEventListener('click',async()=>{
  if(!ready||busy||conflicted)return;
  busy=true;controls();error();
  try{if(dirty)await persistState();if(messages.at(-1)?.role==='user'){if(!configured)throw Error('Configure your OpenAI API key first.');await reply();}}
  catch(e){error(e.name==='AbortError'?'Reply cancelled. Retry when ready.':e.message);}finally{busy=false;controls();}
});
$('cancelBtn').addEventListener('click',()=>controller?.abort());
$('resetLink').addEventListener('click',async()=>{
  if(!ready||busy||conflicted)return;
  if(!confirm('Clear this conversation? Your habit ledger stays. Export first if you want to keep these messages.'))return;
  busy=true;controls();const previous=messages;messages=[];
  try{await persistState();renderMessages();error();}catch(e){messages=previous;dirty=false;error(e.message);}finally{busy=false;controls();}
});
$('reloadBtn').addEventListener('click',()=>{if((dirty||conflicted)&&!confirm('Reload saved data? Export first to keep any unsaved changes in this tab.'))return;loadInitialState();});
$('exportBtn').addEventListener('click',()=>{
  if(!ready)return;
  const url=URL.createObjectURL(new Blob([JSON.stringify({messages,ledger:ledgerByDate},null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download=`anna-backup-${localDay()}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
$('importBtn').addEventListener('click',()=>{if(ready&&!busy&&!conflicted)$('importFile').click();});
$('importFile').addEventListener('change',async()=>{
  const file=$('importFile').files?.[0];if(!file||!ready||busy||conflicted)return;
  const previous={messages,ledgerByDate,dirty};
  busy=true;controls();
  try{
    if(file.size>2000000)throw Error('Backup is too large. Maximum size is 2 MB.');
    const data=JSON.parse(await file.text());
    if(!validSaved({...data,revision:0}))throw Error('This is not a valid Anna backup.');
    if(!confirm('Replace this device’s conversation and habits with this backup? Export your current data first if you want to keep it.'))return;
    messages=data.messages;ledgerByDate=data.ledger;await persistState();renderMessages();renderLedger();error('Backup restored.');
  }catch(e){messages=previous.messages;ledgerByDate=previous.ledgerByDate;dirty=previous.dirty;error(e.message);}
  finally{$('importFile').value='';busy=false;controls();}
});
$('loginForm').addEventListener('submit',async e=>{
  e.preventDefault();$('loginBtn').disabled=true;
  try {await request('/api/login',{password:$('password').value});$('password').value='';await loadInitialState();}
  catch(e){error(e.message);}finally{$('loginBtn').disabled=false;}
});
$('logoutBtn').addEventListener('click',async()=>{
  if(busy)return;
  if(dirty&&!confirm('There are unsaved changes. Export them before signing out. Sign out now?'))return;
  try{await request('/api/logout',{});ready=false;messages=[];ledgerByDate={};$('chat').replaceChildren();renderLedger();$('loginPanel').hidden=false;controls();error('Signed out.');}catch(e){error(e.message);}
});
window.addEventListener('focus',renderLedger);
window.addEventListener('storage',e=>{if(storageMode==='browser'&&e.key===storageKey&&ready){conflicted=true;$('reloadBtn').hidden=false;controls();error('Another tab updated Anna. Export any unsaved changes, then reload.');}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)renderLedger();});
setInterval(renderLedger,60000);
window.addEventListener('beforeunload',e=>{if(dirty||busy){e.preventDefault();e.returnValue='';}});
if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
loadInitialState();
