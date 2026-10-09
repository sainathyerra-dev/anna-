require('dotenv').config();
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const SYSTEM_PROMPT = require('./personality');
const HABITS = ['swim','temple','water','parents','study','market','laundry','room'];
function validState(data) {
  if (!data || !Array.isArray(data.messages) || data.messages.length > 10000 || !data.ledger || typeof data.ledger !== 'object' || Array.isArray(data.ledger)) return false;
  if (!data.messages.every(m => m && ['user','assistant'].includes(m.role) && typeof m.content === 'string' && m.content.trim().length > 0 && m.content.length <= 16000 && Number.isSafeInteger(m.ts) && m.ts >= 0)) return false;
  if (Object.keys(data.ledger).length > 10000) return false;
  return Object.entries(data.ledger).every(([day, entry]) => /^\d{4}-\d{2}-\d{2}$/.test(day) && entry && typeof entry === 'object' && !Array.isArray(entry) && Object.entries(entry).every(([key,val]) => HABITS.includes(key) && typeof val === 'boolean'));
}
function createApp(options = {}) {
  const production = options.production ?? process.env.NODE_ENV === 'production';
  const password = options.password ?? process.env.APP_PASSWORD ?? '';
  if (production && password.length < 16) throw Error('Set APP_PASSWORD to at least 16 characters before hosting.');
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  const providerFetch = options.fetch ?? global.fetch;
  const storageMode=options.storageMode ?? process.env.STORAGE_MODE ?? 'file';
  if (!['file','browser'].includes(storageMode)) throw Error('STORAGE_MODE must be file or browser.');
  if (production && storageMode==='file' && !process.env.DATA_DIR && !options.dataDir) throw Error('Hosted file storage requires DATA_DIR on a persistent disk, or choose STORAGE_MODE=browser.');
  const dataDir = options.dataDir ?? process.env.DATA_DIR ?? path.join(__dirname,'data');
  if(storageMode==='file') fs.mkdirSync(dataDir,{recursive:true});
  const db = path.join(dataDir,'db.json');
  let state = {messages:[],ledger:{},revision:0};
  if (storageMode==='file' && fs.existsSync(db)) {
    const saved = JSON.parse(fs.readFileSync(db,'utf8'));
    if (!validState(saved)) throw Error('Saved data is invalid. Restore db.json from a backup before starting.');
    state = {...saved,revision:Number.isSafeInteger(saved.revision) ? saved.revision : 0};
  }
  function save(next) {
    const temp = db+'.tmp';
    const fd=fs.openSync(temp,'w');
    try { fs.writeFileSync(fd,JSON.stringify(next)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    if (fs.existsSync(db)) fs.copyFileSync(db,db+'.bak');
    fs.renameSync(temp,db);
    state=next;
  }
  if (storageMode==='file' && !fs.existsSync(db)) save(state);
  const app = express();
  app.disable('x-powered-by');
  app.use((req,res,next)=>{
    res.set('X-Content-Type-Options','nosniff');
    res.set('Referrer-Policy','no-referrer');
    res.set('X-Frame-Options','DENY');
    if (req.path.startsWith('/api/')) res.set('Cache-Control','no-store');
    if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
      if (req.get('Sec-Fetch-Site') === 'cross-site') return res.status(403).json({error:'Cross-site request rejected.'});
      const origin=req.get('Origin');
      if (origin) { try { if (new URL(origin).host !== req.get('host')) return res.status(403).json({error:'Origin rejected.'}); } catch { return res.status(403).json({error:'Invalid origin.'}); } }
      if (!req.is('application/json')) return res.status(415).json({error:'Send JSON.'});
    }
    next();
  });
  app.use(express.json({limit:'2mb'}));
  app.get('/health', (req,res)=>res.json({ok:true}));
  const sign = value => crypto.createHmac('sha256',password).update(value).digest('hex');
  const equal = (a,b) => typeof a==='string' && typeof b==='string' && Buffer.byteLength(a)===Buffer.byteLength(b) && crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
  function authenticated(req) {
    if (!password) return true;
    const cookie=(req.get('cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('anna_session='));
    if (!cookie) return false;
    const [expires,mac]=cookie.slice(13).split('.');
    return /^\d+$/.test(expires||'') && Number(expires)>Date.now() && equal(mac,sign(expires));
  }
  let loginWindow=0, loginAttempts=0;
  app.post('/api/login',(req,res)=>{
    if (Date.now()-loginWindow>60000) {loginWindow=Date.now();loginAttempts=0;}
    if (++loginAttempts>10) return res.status(429).json({error:'Too many login attempts. Wait a minute.'});
    const supplied=req.body?.password;
    if (password && (typeof supplied!=='string' || !equal(crypto.createHash('sha256').update(supplied).digest('hex'),crypto.createHash('sha256').update(password).digest('hex')))) return res.status(401).json({error:'Incorrect password.'});
    const expires=String(Date.now()+7*86400000);
    res.set('Set-Cookie',`anna_session=${expires}.${sign(expires)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${production?'; Secure':''}`);
    res.json({ok:true});
  });
  app.use('/api',(req,res,next)=>authenticated(req)?next():res.status(401).json({error:'Sign in to Anna.'}));
  app.post('/api/logout',(req,res)=>{res.set('Set-Cookie',`anna_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${production?'; Secure':''}`);res.json({ok:true});});
  app.get('/api/state',(req,res)=>res.json({...state,storageMode,configured:!!apiKey && apiKey!=='sk-ant-your-key-here',privateLogin:!!password}));
  app.post('/api/state',(req,res)=>{
    if(storageMode==='browser') return res.status(405).json({error:'This Anna stores history on your device, not on the hosting server.'});
    if (!validState(req.body)) return res.status(400).json({error:'Invalid conversation or habit data.'});
    if (req.body.revision!==state.revision) return res.status(409).json({error:'Anna was updated in another tab or device. Reload before making more changes.'});
    const next={messages:req.body.messages.map(({role,content,ts})=>({role,content,ts})),ledger:req.body.ledger,revision:state.revision+1};
    try {save(next);res.json({revision:state.revision});} catch {res.status(500).json({error:'Could not save. Check storage and retry.'});}
  });
  let active=false, chatWindow=0, chatCount=0;
  app.post('/api/chat',async(req,res)=>{
    if (!apiKey || apiKey==='sk-ant-your-key-here') return res.status(503).json({error:'Add your Anthropic API key to the server settings, then restart Anna.'});
    const messages=req.body?.messages;
    if (!Array.isArray(messages) || !messages.length || messages.length>100 || !messages.every(m=>m && ['user','assistant'].includes(m.role) && typeof m.content==='string' && m.content.trim() && m.content.length<=16000) || messages[0].role!=='user' || messages.at(-1).role!=='user' || JSON.stringify(messages).length>32000) return res.status(400).json({error:'Conversation request is invalid or too long.'});
    if (active) return res.status(429).json({error:'Anna is already replying. Wait, then retry.'});
    if (Date.now()-chatWindow>60000) {chatWindow=Date.now();chatCount=0;}
    if (++chatCount>12) return res.status(429).json({error:'Please wait a minute before sending more messages.'});
    active=true;
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),45000);
    const abort=()=>{if (!res.writableEnded) controller.abort();};
    res.on('close',abort);
    try {
      const response=await providerFetch('https://api.anthropic.com/v1/messages',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:process.env.ANTHROPIC_MODEL||'claude-sonnet-4-6',max_tokens:1000,system:SYSTEM_PROMPT,messages})});
      if (!response.ok) {await response.text(); return res.status(502).json({error:response.status===401?'The Anthropic API key was rejected. Check the server settings.':response.status===429?'Anthropic is busy or your API limit was reached. Try again later.':'Anthropic could not answer. Check API billing and model access, then retry.'});}
      const data=await response.json();
      const reply=(data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n').trim();
      if (!reply || reply.length>16000) return res.status(502).json({error:'Anna returned an unusable reply. Please retry.'});
      res.json({reply});
    } catch {if (!res.destroyed) res.status(504).json({error:'Anna could not connect or took too long. Please retry.'});}
    finally {clearTimeout(timer);res.off('close',abort);active=false;}
  });
  app.use(express.static(path.join(__dirname,'public'),{etag:true}));
  app.use((err,req,res,next)=>res.status(err.type==='entity.too.large'?413:err instanceof SyntaxError?400:500).json({error:err.type==='entity.too.large'?'Saved history is too large. Export it and start a new conversation.':err instanceof SyntaxError?'Invalid JSON request.':'Server request failed.'}));
  return app;
}
if (require.main===module) {
  const production=process.env.NODE_ENV==='production';
  const host=production?'0.0.0.0':'127.0.0.1';
  const port=process.env.PORT||3000;
  createApp().listen(port,host,()=>console.log(`Anna is running at http://localhost:${port}${process.env.ANTHROPIC_API_KEY?'':' — API key still needed for replies'}`));
}
module.exports={createApp,validState};
