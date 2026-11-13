import test from 'node:test';
import assert from 'node:assert/strict';
import worker, {verify,verifyRelay} from './worker.js';
const encoder=new TextEncoder();
const keys=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);
const hex=b=>Buffer.from(b).toString('hex');
const publicKey=hex(await crypto.subtle.exportKey('raw',keys.publicKey));
const env={ALLOWED_GUILD_ID:'123456789012345678',DISCORD_PUBLIC_KEY:publicKey,SUPABASE_URL:'https://database.invalid',SUPABASE_SERVICE_ROLE_KEY:'qa-valid-service-secret',RELAY_SHARED_SECRET:'qa-random-style-secret-32-bytes-long-12345'};
const slash=(overrides={})=>({id:'223456789012345678',application_id:'323456789012345678',token:'qa-token',type:2,guild_id:env.ALLOWED_GUILD_ID,channel_id:'523456789012345678',member:{user:{id:'423456789012345678'}},data:{name:'daily'},...overrides});
const relay=(overrides={})=>({version:1,eventId:'223456789012345678',userId:'423456789012345678',guildId:env.ALLOWED_GUILD_ID,channelId:'523456789012345678',commandName:'daily',args:[],...overrides});
async function request(payload,{transport='slash',timestamp=String(Math.floor(Date.now()/1000)),path,raw,chunked=false}={}) {
 const body=raw??JSON.stringify(payload); const bytes=typeof body==='string'?encoder.encode(body):body;
 let headers;
 if(transport==='relay') {const key=await crypto.subtle.importKey('raw',encoder.encode(env.RELAY_SHARED_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']); const data=new Uint8Array([...encoder.encode(timestamp+'.'),...bytes]); headers={'x-relay-timestamp':timestamp,'x-relay-signature':hex(await crypto.subtle.sign('HMAC',key,data))};}
 else {const data=new Uint8Array([...encoder.encode(timestamp),...bytes]);headers={'x-signature-timestamp':timestamp,'x-signature-ed25519':hex(await crypto.subtle.sign('Ed25519',keys.privateKey,data))};}
 return new Request('https://worker.invalid'+(path??(transport==='relay'?'/relay':'/interactions')),{method:'POST',headers,body:chunked?new ReadableStream({start(c){c.enqueue(bytes.slice(0,3));c.enqueue(bytes.slice(3));c.close();}}):bytes,...(chunked?{duplex:'half'}:{})});
}
async function invoke(payload,options={},config=env){const pending=[];const response=await worker.fetch(await request(payload,options),config,{waitUntil:p=>pending.push(p)});await Promise.all(pending);return response;}
function mockRpc(t,{fail,replyFail=false}={}) {const calls=[];t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url,options});if(String(url).includes('/rpc/')){if(fail==='network')throw Error('private DB internals');if(fail==='http')return new Response('private DB internals',{status:500});if(fail==='shape')return Response.json({private:'internals'});return Response.json('safe reward');}if(replyFail)throw Error('private webhook internals');return Response.json({});});return calls;}

test('verify actual raw Ed25519 and reject tampering',async()=>{const req=await request({type:1},{timestamp:'1000'});assert.equal(await verify(req,'{"type":1}',publicKey,1000),true);assert.equal(await verify(req,'{"type":2}',publicKey,1000),false);assert.equal(await verify(req,'{"type":1}','bad',1000),false);});
for(const age of [-301,301])test(`Discord freshness rejects offset ${age}`,async()=>{assert.equal((await invoke({type:1},{timestamp:String(Math.floor(Date.now()/1000)+age)})).status,401);});
test('signed PING bypasses guild and database configuration',async t=>{const calls=mockRpc(t);const response=await invoke({type:1},{},{DISCORD_PUBLIC_KEY:publicKey});assert.deepEqual(await response.json(),{type:1});assert.equal(calls.length,0);});
for(const transport of ['slash','relay']) {
 test(`${transport} unsigned request fails closed`,async()=>{const response=await worker.fetch(new Request('https://worker.invalid/'+(transport==='relay'?'relay':'interactions'),{method:'POST',body:'{}'}),env,{});assert.equal(response.status,401);});
 for(const raw of ['{',new Uint8Array([0xff])])test(`${transport} malformed JSON/UTF8 rejected after auth ${typeof raw}`,async()=>assert.equal((await invoke(null,{transport,raw})).status,400));
 test(`${transport} chunked oversized request without content-length rejected`,async()=>assert.equal((await invoke(null,{transport,raw:' '.repeat(16385),chunked:true})).status,413));
 test(`${transport} small chunked body succeeds`,async t=>{mockRpc(t);assert.equal((await invoke(transport==='relay'?relay({commandName:'help'}):slash({data:{name:'help'}}),{transport,chunked:true})).status,200);});
 for(const guild of [undefined,'YOUR_GUILD_ID','0'])test(`${transport} guild configuration ${guild} rejected`,async t=>{const calls=mockRpc(t);assert.equal((await invoke(transport==='relay'?relay():slash(),{transport},{...env,ALLOWED_GUILD_ID:guild})).status,503);assert.equal(calls.length,0);});
 test(`${transport} wrong guild rejected without RPC`,async t=>{const calls=mockRpc(t);assert.equal((await invoke(transport==='relay'?relay({guildId:'9'}):slash({guild_id:'9'}),{transport})).status,403);assert.equal(calls.length,0);});
 test(`${transport} aliases map to canonical RPC identity`,async t=>{const calls=mockRpc(t);for(const [alias,action] of [['BAL','balance'],['cash','balance'],['h','hunt'],['z','zoo'],['daily','daily']]){const response=await invoke(transport==='relay'?relay({commandName:alias}):slash({data:{name:alias}}),{transport});assert.equal(response.status,200);const call=calls.filter(c=>String(c.url).includes('/rpc/')).at(-1);assert.deepEqual(JSON.parse(call.options.body),{interaction:(transport==='relay'?'relay:':'')+'223456789012345678',guild:env.ALLOWED_GUILD_ID,player:'423456789012345678',action});}});
 test(`${transport} help returns safe payload without RPC`,async t=>{const calls=mockRpc(t);const response=await invoke(transport==='relay'?relay({commandName:'help'}):slash({data:{name:'help'}}),{transport});const body=await response.json();assert.deepEqual((transport==='relay'?body:body.data).allowed_mentions,{parse:[]});assert.equal(calls.length,0);});
 for(const fail of ['http','network','shape'])test(`${transport} upstream ${fail} remains generic`,async t=>{const calls=mockRpc(t,{fail});const response=await invoke(transport==='relay'?relay():slash(),{transport});if(transport==='relay'){assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'upstream_unavailable'});assert.equal(calls.length,1);}else{assert.deepEqual(await response.json(),{type:5});const body=JSON.parse(calls.at(-1).options.body);assert.deepEqual(body.allowed_mentions,{parse:[]});assert.doesNotMatch(body.content,/private|internals/);}});
}
test('slash deferred response edits original and disables mentions',async t=>{const calls=mockRpc(t);const response=await invoke(slash());assert.deepEqual(await response.json(),{type:5});assert.equal(calls.length,2);assert.match(calls[1].url,/webhooks\/323456789012345678\/qa-token\/messages\/@original$/);assert.deepEqual(JSON.parse(calls[1].options.body),{content:'safe reward',allowed_mentions:{parse:[]}});});
test('webhook delivery failure does not reject background task',async t=>{mockRpc(t,{replyFail:true});assert.equal((await invoke(slash())).status,200);});
for(const customId of ['command:balance','command:zoo','command:help'])test(`component allowlist ${customId}`,async t=>{const calls=mockRpc(t);assert.equal((await invoke(slash({type:3,data:{component_type:2,custom_id:customId},message:{id:'999'}}))).status,200);if(customId!=='command:help')assert.equal(JSON.parse(calls[0].options.body).interaction,'223456789012345678');});
for(const customId of ['command:daily','command:hunt','xcommand:balance','command:balance:daily'])test(`component rejects ${customId}`,async t=>{const calls=mockRpc(t);assert.equal((await invoke(slash({type:3,data:{component_type:2,custom_id:customId}}))).status,400);assert.equal(calls.length,0);});
for(const overrides of [{channelId:undefined},{args:['100']},{rank:'patreon'},{reward:999},{action:'daily'},{version:2},{eventId:'relay:123'},{userId:'0'}])test(`relay rejects untrusted shape ${JSON.stringify(overrides)}`,async t=>{const calls=mockRpc(t);assert.equal((await invoke(relay(overrides),{transport:'relay'})).status,400);assert.equal(calls.length,0);});
for(const age of [-301,301])test(`relay rejects stale/future ${age}`,async()=>assert.equal((await invoke(relay(),{transport:'relay',timestamp:String(Math.floor(Date.now()/1000)+age)})).status,401));
for(const secret of [undefined,'short','YOUR_RELAY_SHARED_SECRET'])test(`relay bad secret config ${secret}`,async()=>assert.equal((await invoke(relay(),{transport:'relay'},{...env,RELAY_SHARED_SECRET:secret})).status,503));
test('auth cannot cross routes',async()=>{const a=await request(relay(),{transport:'relay',path:'/interactions'});const b=await request(slash(),{path:'/relay'});assert.equal((await worker.fetch(a,env,{})).status,401);assert.equal((await worker.fetch(b,env,{})).status,401);});
test('relay raw body tampering invalidates MAC',async()=>{const original=await request(relay(),{transport:'relay'});const tampered=new Request(original.url,{method:'POST',headers:original.headers,body:JSON.stringify(relay({userId:'9'}))});assert.equal((await worker.fetch(tampered,env,{})).status,401);});
for(const overrides of [{channel_id:undefined},{guild_id:undefined},{data:{name:'daily',options:[{name:'rank',value:10}]}},{data:{name:'daily',type:2}}])test(`slash rejects missing identity/options ${JSON.stringify(overrides)}`,async t=>{const calls=mockRpc(t);assert.equal((await invoke(slash(overrides))).status,400);assert.equal(calls.length,0);});
for(const [path,method] of [['/unknown','POST'],['/relay','GET'],['/interactions','GET']])test(`unknown route ${method} ${path}`,async()=>assert.equal((await worker.fetch(new Request('https://worker.invalid'+path,{method}),env,{})).status,404));

for(const offset of [-300,300,-301,301])test(`exact signature freshness boundary ${offset}`,async()=>{
 const body=JSON.stringify({type:1});const discord=await request({type:1},{timestamp:String(1000+offset)});
 assert.equal(await verify(discord,body,publicKey,1000),Math.abs(offset)<=300);
 const envelope=relay();const gateway=await request(envelope,{transport:'relay',timestamp:String(1000+offset)});
 assert.equal(await verifyRelay(gateway,JSON.stringify(envelope),env.RELAY_SHARED_SECRET,1000),Math.abs(offset)<=300);
});
for(const [name,config]of [['http URL',{SUPABASE_URL:'http://database.invalid'}],['placeholder URL',{SUPABASE_URL:'https://your-project.supabase.co'}],['missing key',{SUPABASE_SERVICE_ROLE_KEY:undefined}],['placeholder key',{SUPABASE_SERVICE_ROLE_KEY:'YOUR_SERVICE_ROLE_KEY'}]])test(`RPC misconfiguration ${name} prevents all outbound calls`,async t=>{const calls=mockRpc(t);assert.equal((await invoke(relay(),{transport:'relay'},{...env,...config})).status,503);assert.equal(calls.length,0);});
test('legacy root interaction route remains signed',async t=>{mockRpc(t);assert.deepEqual(await(await invoke({type:1},{path:'/'})).json(),{type:1});});
test('relay RPC carries bounded timeout signal and never calls Discord',async t=>{const calls=mockRpc(t);const response=await invoke(relay(),{transport:'relay'});assert.deepEqual(await response.json(),{content:'safe reward',allowed_mentions:{parse:[]}});assert.equal(calls.length,1);assert.equal(calls[0].options.signal instanceof AbortSignal,true);});

for (const transport of ['slash', 'relay']) {
 test(`${transport} Supabase secret key works without a legacy key and is not sent as a bearer JWT`, async t => {
  const calls = mockRpc(t);
  const key = 'sb_secret_qaSyntheticKey123456789';
  const response = await invoke(transport === 'relay' ? relay() : slash(), { transport }, { ...env, SUPABASE_SECRET_KEY: key, SUPABASE_SERVICE_ROLE_KEY: undefined });
  assert.equal(response.status, 200);
  assert.equal(calls[0].options.headers.apikey, key);
  assert.equal(Object.hasOwn(calls[0].options.headers, 'Authorization'), false);
 });
}
test('new Supabase secret key takes precedence over the legacy key', async t => {
 const calls = mockRpc(t);
 const key = 'sb_secret_qaSyntheticKey123456789';
 await invoke(relay(), { transport: 'relay' }, { ...env, SUPABASE_SECRET_KEY: key });
 assert.equal(calls[0].options.headers.apikey, key);
});
test('legacy Supabase service-role key retains bearer authentication', async t => {
 const calls = mockRpc(t);
 await invoke(relay(), { transport: 'relay' });
 assert.equal(calls[0].options.headers.apikey, env.SUPABASE_SERVICE_ROLE_KEY);
 assert.equal(calls[0].options.headers.Authorization, `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
});
for (const key of ['', 'sb_publishable_qa', 'qa-legacy-key', 'sb_secret_qa key', 'sb_secret_qa\nkey']) {
 test(`invalid new Supabase key ${JSON.stringify(key)} prevents all outbound calls`, async t => {
  const calls = mockRpc(t);
  assert.equal((await invoke(relay(), { transport: 'relay' }, { ...env, SUPABASE_SECRET_KEY: key })).status, 503);
  assert.equal(calls.length, 0);
 });
}
