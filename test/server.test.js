const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createApp}=require('../server');
async function fixture(t,options={}) {
  const testRoot=path.resolve(process.env.ANNA_TEST_DIR||os.tmpdir());
  const dataDir=fs.mkdtempSync(path.join(testRoot,'anna-test-'));
  const server=createApp({dataDir,password:'',production:false,...options}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>{server.closeAllConnections();server.close();if(path.dirname(dataDir)!==testRoot)throw Error('Unexpected test directory');fs.rmSync(dataDir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  return {base,dataDir,call:(route,body,headers={})=>fetch(base+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)})};
}
test('production requires a private password and explicit storage choice',()=>{
  assert.throws(()=>createApp({production:true,password:'short'}),/16 characters/);
  assert.throws(()=>createApp({production:true,password:'a-long-test-password',storageMode:'file'}),/persistent disk/);
});
test('login gates history, writes and paid chat; signed cookies reject tampering',async t=>{
  const f=await fixture(t,{password:'a-long-test-password'});
  for(const [route,body] of [['/api/state',undefined],['/api/state',{}],['/api/chat',{}]])assert.equal((await f.call(route,body)).status,401);
  assert.equal((await f.call('/api/login',{password:'wrong'})).status,401);
  const login=await f.call('/api/login',{password:'a-long-test-password'});
  const cookie=login.headers.get('set-cookie').split(';')[0];
  assert.match(login.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
  assert.equal((await f.call('/api/state',undefined,{cookie})).status,200);
  assert.equal((await f.call('/api/state',undefined,{cookie:cookie+'invalid'})).status,401);
  assert.match((await f.call('/api/logout',{}, {cookie})).headers.get('set-cookie'),/Max-Age=0/);
});
test('production session uses Secure cookie',async t=>{
  const f=await fixture(t,{production:true,password:'a-long-test-password',storageMode:'browser'});
  assert.match((await f.call('/api/login',{password:'a-long-test-password'})).headers.get('set-cookie'),/; Secure/);
});
test('cross-site writes and malformed state are rejected',async t=>{
  const f=await fixture(t);
  assert.equal((await f.call('/api/state',{}, {Origin:'https://attacker.example'})).status,403);
  assert.equal((await f.call('/api/state',{messages:'broken',ledger:null,revision:0})).status,400);
  assert.equal((await f.call('/api/state',{messages:[],ledger:{'2026-10-09':{unknown:true}},revision:0})).status,400);
});
test('atomic saves survive restart; stale writes cannot overwrite newer data',async t=>{
  const f=await fixture(t);
  const payload={messages:[{role:'user',content:'hello',ts:123}],ledger:{'2026-10-09':{water:true}},revision:0};
  assert.equal((await f.call('/api/state',payload)).status,200);
  assert.equal((await f.call('/api/state',payload)).status,409);
  const read=await (await f.call('/api/state')).json();assert.equal(read.revision,1);assert.equal(read.messages[0].content,'hello');
  assert.equal(fs.existsSync(path.join(f.dataDir,'db.json.bak')),true);
  const restarted=createApp({dataDir:f.dataDir,password:'',production:false}).listen(0,'127.0.0.1');
  await new Promise(resolve=>restarted.once('listening',resolve));
  t.after(()=>{restarted.closeAllConnections();restarted.close();});
  const again=await(await fetch(`http://127.0.0.1:${restarted.address().port}/api/state`)).json();assert.deepEqual(again.messages,read.messages);
});
test('disk failure returns HTTP 500 and preserves the last saved state',async t=>{
  const f=await fixture(t);
  fs.mkdirSync(path.join(f.dataDir,'db.json.tmp'));
  assert.equal((await f.call('/api/state',{messages:[],ledger:{'2026-10-09':{water:true}},revision:0})).status,500);
  assert.equal((await(await f.call('/api/state')).json()).revision,0);
});
test('browser storage never writes history to the hosting filesystem',async t=>{
  const f=await fixture(t,{storageMode:'browser'});
  const state=await(await f.call('/api/state')).json();assert.equal(state.storageMode,'browser');
  assert.equal(fs.existsSync(path.join(f.dataDir,'db.json')),false);
  assert.equal((await f.call('/api/state',{messages:[],ledger:{},revision:0})).status,405);
});
test('missing API key gives a useful configuration error',async t=>{
  const f=await fixture(t,{apiKey:''});assert.equal((await f.call('/api/chat',{messages:[{role:'user',content:'hello'}]})).status,503);
});
test('mocked provider replies work; concurrent and oversized requests are rejected',async t=>{
  let release,started;const entered=new Promise(r=>started=r);const wait=new Promise(r=>release=r);
  const f=await fixture(t,{apiKey:'test-key',fetch:async(url,options)=>{const body=JSON.parse(options.body);assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(body.input[0].content,'hello');assert.equal(body.store,false);assert.ok(body.instructions.includes('You are Anna'));assert.equal(options.headers.Authorization,'Bearer test-key');started();await wait;return {ok:true,json:async()=>({output:[{type:'reasoning',summary:[]},{type:'message',role:'assistant',content:[{type:'output_text',text:'Hi there'}]}]})};}});
  const payload={messages:[{role:'user',content:'hello'}]};
  const first=f.call('/api/chat',payload);await entered;
  assert.equal((await f.call('/api/chat',payload)).status,429);release();
  assert.equal((await(await first).json()).reply,'Hi there');
  assert.equal((await f.call('/api/chat',{messages:[]})).status,400);
  assert.equal((await f.call('/api/chat',{messages:[{role:'user',content:'x'.repeat(16001)}]})).status,400);
});
test('upstream failures are separate errors without provider payload leakage',async t=>{
  const f=await fixture(t,{apiKey:'test-key',fetch:async()=>({ok:false,status:401,json:async()=> ({error:{message:'provider secret details'}})})});
  const res=await f.call('/api/chat',{messages:[{role:'user',content:'hello'}]});assert.equal(res.status,502);
  const text=await res.text();assert.match(text,/key was rejected/);assert.doesNotMatch(text,/secret details/);
});
test('OpenAI quota errors explain separate API billing',async t=>{
  const f=await fixture(t,{apiKey:'test-key',fetch:async()=>({ok:false,status:429,json:async()=>({error:{code:'insufficient_quota'}})})});
  const response=await f.call('/api/chat',{messages:[{role:'user',content:'hello'}]});assert.equal(response.status,502);assert.match((await response.json()).error,/API credits/);
});
test('OpenAI refusal blocks produce the actual model response',async t=>{
  const f=await fixture(t,{apiKey:'test-key',fetch:async()=>({ok:true,json:async()=>({output:[{type:'message',role:'assistant',content:[{type:'refusal',refusal:'I cannot help with that request.'}]}]})})});
  const response=await f.call('/api/chat',{messages:[{role:'user',content:'hello'}]});assert.equal((await response.json()).reply,'I cannot help with that request.');
});
test('login throttles repeated attempts',async t=>{
  const f=await fixture(t,{password:'a-long-test-password'});
  for(let i=0;i<10;i++)assert.equal((await f.call('/api/login',{password:'wrong'})).status,401);
  assert.equal((await f.call('/api/login',{password:'wrong'})).status,429);
});
