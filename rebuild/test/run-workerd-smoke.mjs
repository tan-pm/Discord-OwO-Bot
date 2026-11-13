import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, sign, createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const key = publicKey.export({ format:'der', type:'spki' }).subarray(-32).toString('hex');
const secret = 'local-runtime-test-only-32-bytes-secret';
const workdir=fileURLToPath(new URL('..',import.meta.url));
const port=process.env.OWO_SMOKE_PORT??'8793';
const origin = `http://127.0.0.1:${port}`;
let fixtureDirectory;
let child;
let logs='';
async function request(path, body, relay=false) {
 const raw=JSON.stringify(body),ts=String(Math.floor(Date.now()/1000));
 const headers=relay?{'x-relay-timestamp':ts,'x-relay-signature':createHmac('sha256',secret).update(ts+'.'+raw).digest('hex')}:{'x-signature-timestamp':ts,'x-signature-ed25519':sign(null,Buffer.from(ts+raw),privateKey).toString('hex')};
 return fetch(origin+path,{method:'POST',body:raw,headers});
}
try {
 fixtureDirectory = await mkdtemp(join(tmpdir(), 'owo-local-env-'));
 const config = (await readFile(join(workdir, 'wrangler.toml'), 'utf8')).replace('main = "src/worker.js"', `main = ${JSON.stringify(join(workdir, 'src/worker.js'))}`);
 const configPath = join(fixtureDirectory, 'wrangler.toml');
 await writeFile(configPath, config);
 await writeFile(join(fixtureDirectory, '.env'), `ALLOWED_GUILD_ID=123456789012345678\nDISCORD_PUBLIC_KEY=${key}\nRELAY_SHARED_SECRET=${secret}\nOWO_LOCAL_PORT=${port}\nDISCORD_BOT_TOKEN=synthetic-local-test-token\nDISCORD_APPLICATION_ID=323456789012345678\n`, { mode: 0o600 });
 const fixtureEnv = { ...process.env, WRANGLER_SEND_METRICS: 'false' };
 for (const name of ['ALLOWED_GUILD_ID', 'DISCORD_PUBLIC_KEY', 'RELAY_SHARED_SECRET', 'OWO_LOCAL_PORT', 'DISCORD_BOT_TOKEN', 'DISCORD_APPLICATION_ID', 'CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV', 'CLOUDFLARE_INCLUDE_PROCESS_ENV']) delete fixtureEnv[name];
 child = spawn(`${workdir}/node_modules/.bin/wrangler`, ['dev','--config',configPath,'--local','--ip','127.0.0.1','--port',port], { cwd:fixtureDirectory, env:fixtureEnv,stdio:['ignore','pipe','pipe'],detached:true });
 child.stdout.on('data',b=>logs+=b); child.stderr.on('data',b=>logs+=b);
 let ready=false;
 for(let i=0;i<120;i++) { try { const r=await fetch(origin); if(r.status===404){ready=true;break;} }catch{} await new Promise(r=>setTimeout(r,250)); }
 assert.equal(ready,true,'local Workers runtime starts');
 const ping=await request('/interactions',{type:1});assert.equal(ping.status,200);assert.deepEqual(await ping.json(),{type:1});console.log('PASS workerd Ed25519 signed PING');
 const help=await request('/interactions',{type:2,id:'223456789012345678',guild_id:'123456789012345678',channel_id:'323456789012345678',member:{user:{id:'423456789012345678'}},data:{name:'help'}});assert.equal(help.status,200);assert.equal((await help.json()).type,4);console.log('PASS workerd slash normalization and reply');
 const envelope={version:1,eventId:'523456789012345678',guildId:'123456789012345678',channelId:'323456789012345678',userId:'423456789012345678',commandName:'help',args:[]};
 const relay=await request('/relay',envelope,true);assert.equal(relay.status,200);assert.deepEqual((await relay.json()).allowed_mentions,{parse:[]});console.log('PASS workerd HMAC relay normalization and reply');
 const forbidden=await request('/relay',{...envelope,guildId:'623456789012345678'},true);assert.equal(forbidden.status,403);console.log('PASS workerd wrong guild rejected');
 const unsigned=await fetch(origin+'/relay',{method:'POST',body:JSON.stringify(envelope)});assert.equal(unsigned.status,401);console.log('PASS workerd unsigned relay rejected');
 const execute = promisify(execFile);
 const cliOptions = { cwd: fixtureDirectory, env: fixtureEnv, timeout: 20000 };
 const cliArgs = ['--env-file=.env', `${workdir}/scripts/local-command.mjs`];
 const cli = await execute(process.execPath, [...cliArgs, 'help', envelope.userId, envelope.channelId, envelope.eventId], cliOptions);
 assert.match(cli.stdout, new RegExp(`Local event ID: ${envelope.eventId}`));
 assert.match(cli.stdout, /\/daily/);console.log('PASS Worker and local command CLI use the same .env configuration');
 await assert.rejects(execute(process.execPath, [...cliArgs, 'help', 'invalid-user', envelope.channelId], cliOptions), error => error.code === 1 && /Invalid command or Discord IDs/.test(error.stderr));
 console.log('PASS local command CLI rejects invalid Discord IDs');
 console.log('Local Workers runtime smoke:7/7 checks passed. No database or external Discord call.');
} catch(error) { console.error(error.message);console.error(logs.slice(-3000).replaceAll(secret,'[redacted]').replaceAll(key,'[public key]'));process.exitCode=1; }
finally { try { process.kill(-child.pid,'SIGTERM'); } catch {} if (fixtureDirectory) await rm(fixtureDirectory, { recursive: true, force: true }); }
