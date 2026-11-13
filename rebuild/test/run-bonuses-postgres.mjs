// Real PostgreSQL acceptance tests. Requires Docker; no host ports or persistent volumes.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const container = `owo-qa-${process.pid}-${Date.now()}`;
let started = false;
let checks = 0;

function docker(args, input, keepOpen = false) {
  const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  const complete = new Promise((resolve, reject) => {
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`docker ${args[0]} failed (${code}): ${stderr.trim()}`));
    });
    if (keepOpen) child.stdin.write(input);
    else child.stdin.end(input);
  });
  return { child, complete };
}

function psql(statement) {
  return docker([
    'exec', '-i', container, 'psql', '-X', '-q', '-t', '-A',
    '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'owo_test', '-f', '-'
  ], statement).complete;
}

async function check(name, fn) {
  await fn();
  checks += 1;
  console.log(`PASS ${name}`);
}

async function rejectSql(statement) {
  await assert.rejects(psql(statement));
}

function cleanup() {
  if (started) {
    spawnSync('docker', ['rm', '-f', container], { stdio: 'ignore', timeout: 15000 });
    started = false;
  }
}
process.once('SIGINT', () => { cleanup(); process.exit(130); });
process.once('SIGTERM', () => { cleanup(); process.exit(143); });

try {
  await docker([
    'run', '--detach', '--rm', '--name', container, '--network', 'none',
    '--tmpfs', '/var/lib/postgresql/data:rw',
    '--env', 'POSTGRES_HOST_AUTH_METHOD=trust', '--env', 'POSTGRES_DB=owo_test',
    'postgres:17-alpine'
  ]).complete;
  started = true;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await psql('select 1;');
      break;
    } catch (error) {
      if (attempt >= 59) throw error;
      await delay(250);
    }
  }
  await psql('create role anon; create role authenticated; create role service_role;');
  await psql(await readFile(new URL('../migrations/001_core.sql', import.meta.url), 'utf8'));
  await psql("insert into players(guild_id,user_id,balance,daily_at) values('upgrade','existing',321,now()-interval '1 day'); insert into receipts values('historical','historical result');");
  await psql(await readFile(new URL('../migrations/002_daily_core.sql', import.meta.url), 'utf8'));

  await psql(await readFile(new URL('../supabase/migrations/003_daily_bonuses.sql', import.meta.url), 'utf8'));
  async function pair(name, today=false, recent=false) {
    await psql(`insert into players(guild_id,user_id,daily_at,daily_streak) values('${name}','a',clock_timestamp()-interval '${today?'0':'1'} days',10),('${name}','b',clock_timestamp()-interval '${today?'0':'1'} days',20); insert into marriages(guild_id,user1_id,user2_id,married_at) values('${name}','a','b',clock_timestamp()-interval '${recent?'0':'2'} days');`);
  }
  await check('003 preserves existing daily state',async()=>assert.equal(await psql("select balance=321 and daily_streak=0 from players where guild_id='upgrade' and user_id='existing';"),'t'));
  await check('supporter threshold expiry cap and guild identity',async()=>{
    for(const [user,rank,expiry,doubled] of [['normal',2,'null',false],['active',3,'null',true],['high',100,"clock_timestamp()+interval '1 day'",true],['expired',3,"clock_timestamp()-interval '1 second'",false]]) {
      await psql(`insert into players(guild_id,user_id,daily_at,daily_streak) values('support','${user}',clock_timestamp()-interval '1 day',179); insert into supporter_entitlements values('support','${user}',${rank},${expiry}); select play('support-${user}','support','${user}','daily');`);
      assert.equal(await psql(`select balance=${doubled?10000:5000} and xp=100 and lootboxes+weapon_crates=1 from players where guild_id='support' and user_id='${user}';`),'t');
    }
    await psql("select play('other-scope','other','active','daily');");
    assert.equal(await psql("select balance between 525 and 724 from players where guild_id='other' and user_id='active';"),'t');
  });
  await check('supporter doubles uncapped range and exact seeded reward',async()=>{
    await psql("insert into players(guild_id,user_id) values('support','seed'); insert into supporter_entitlements values('support','seed',3,null);");
    const expected=(await psql('select setseed(0.25);select daily_reward(1,random())*2;')).split('\n').at(-1);
    await psql("select setseed(0.25);select play('seed','support','seed','daily');");
    assert.equal(await psql("select balance from players where guild_id='support' and user_id='seed';"),expected);
    assert.ok(Number(expected)>=1050&&Number(expected)<=1448);
  });
  await check('marriage formula bounds rounding cap invalid inputs',async()=>{
    assert.equal(await psql('select marriage_daily_reward(0,0,0),marriage_daily_reward(0,0,0.999999),marriage_daily_reward(1,0,0),marriage_daily_reward(9223372036854775807,9223372036854775807,0);'),'100|199|113|1000');
    for(const args of ['-1,0,0','0,0,1','0,0,-0.1','0,0,NULL',"0,0,'NaN'",'NULL,0,0'])await rejectSql(`select marriage_daily_reward(${args});`);
  });
  await check('ordinary spouse sequence grants both once and replay preserves result',async()=>{
    await pair('ordinary');
    await psql("select play('ordinary-a','ordinary','a','daily');");
    assert.equal(await psql("select dailies from marriages where guild_id='ordinary';"),'0');
    const result=await psql("select play('ordinary-b','ordinary','b','daily');");
    assert.match(result,/Marriage:/);
    assert.equal(await psql("select dailies=1 and claimed_at is not null from marriages where guild_id='ordinary';"),'t');
    assert.equal(await psql("select bool_and(xp=100 and lootboxes+weapon_crates=2) from players where guild_id='ordinary';"),'t');
    const before=await psql("select row(user_id,balance,xp,lootboxes,weapon_crates,daily_at)::text from players where guild_id='ordinary' order by user_id;");
    assert.equal(await psql("select play('ordinary-b','ordinary','b','daily');"),result);
    await psql("select play('ordinary-cooldown','ordinary','a','daily');");
    assert.equal(await psql("select row(user_id,balance,xp,lootboxes,weapon_crates,daily_at)::text from players where guild_id='ordinary' order by user_id;"),before);
  });
  await check('seeded ordinary marriage uses claimant preclaim streak and equal spouse money',async()=>{
    await pair('exact');
    // Claimant a is already today at streak11; claimant b retains yesterday streak20.
    await psql("update players set daily_at=clock_timestamp(),daily_streak=11 where guild_id='exact' and user_id='a';");
    const expected=(await psql('select setseed(0.125);select daily_reward(21,random());select random();select marriage_daily_reward(20,11,random());')).split('\n').filter(Boolean);
    const base=Number(expected[0]),bonus=Number(expected[2]);
    const result=await psql("select setseed(0.125);select play('exact','exact','b','daily');");
    assert.match(result,new RegExp('Marriage: \\+'+bonus+' xu'));
    assert.equal(await psql("select balance from players where guild_id='exact' and user_id='a';"),String(bonus));
    assert.equal(await psql("select balance from players where guild_id='exact' and user_id='b';"),String(base+bonus));
  });
  await check('cooldown catchup allows today marriage and gives no personal XP',async()=>{
    await pair('catchup',true,true); await psql("select play('catchup','catchup','a','daily');");
    assert.equal(await psql("select bool_and(xp=0 and daily_streak in (10,20) and balance between 475 and 574 and lootboxes+weapon_crates=1) from players where guild_id='catchup';"),'t');
    assert.equal(await psql("select dailies from marriages where guild_id='catchup';"),'1');
  });
  await check('Valentine explicit active window gives three boxes and doubled cap per spouse',async()=>{
    await psql("update game_config set valentine_enabled=true,valentine_starts_at=clock_timestamp()-interval '1 day',valentine_ends_at=clock_timestamp()+interval '1 day';");
    await pair('valentine',true);await psql("update players set daily_streak=180 where guild_id='valentine';select play('valentine','valentine','a','daily');");
    assert.equal(await psql("select bool_and(balance=2000 and xp=0 and lootboxes+weapon_crates=3) from players where guild_id='valentine';"),'t');
    await psql("update game_config set valentine_enabled=false;");
  });
  await check('future and expired Valentine windows do not activate bonus',async()=>{
    for(const [name,start,end]of [['future',1,2],['past',-2,-1]]){
      await pair(name,true);await psql(`update game_config set valentine_enabled=true,valentine_starts_at=clock_timestamp()+interval '${start} days',valentine_ends_at=clock_timestamp()+interval '${end} days';select play('${name}','${name}','a','daily');`);
      assert.equal(await psql(`select bool_and(lootboxes+weapon_crates=1) from players where guild_id='${name}';`),'t');
    }
    await psql('update game_config set valentine_enabled=false;');
  });
  await check('simultaneous spouses and duplicate receipts serialize with bounded timeout',async()=>{
    await pair('race');
    const holder=docker(['exec','-i',container,'psql','-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-U','postgres','-d','owo_test','-f','-'],"begin;select pg_advisory_xact_lock(hashtextextended('daily-marriage:race',1));\n\\echo gate_locked\n",true);
    await new Promise((resolve,reject)=>{let seen='';const timer=setTimeout(()=>reject(Error('gate timeout')),5000);holder.child.stdout.on('data',chunk=>{seen+=chunk;if(seen.includes('gate_locked')){clearTimeout(timer);resolve();}});holder.complete.catch(reject);});
    const claims=[psql("set application_name='bonus-race-a';set statement_timeout='5s';select play('race-a','race','a','daily');"),psql("set application_name='bonus-race-b';set statement_timeout='5s';select play('race-b','race','b','daily');")];
    let responses;
    try {
      let waiters=0;
      for(let i=0;i<40;i++){waiters=Number(await psql("select count(*) from pg_stat_activity where application_name in ('bonus-race-a','bonus-race-b') and wait_event_type='Lock';"));if(waiters===2)break;await delay(25);}
      assert.equal(waiters,2,'Both independent spouse sessions observed waiting on the marriage gate');
      holder.child.stdin.end('commit;\n');responses=await Promise.all(claims);await holder.complete;
    } finally {if(!holder.child.stdin.writableEnded)holder.child.stdin.end('rollback;\n');await Promise.allSettled([...claims,holder.complete]);}
    assert.equal(responses.filter(s=>s.includes('Marriage:')).length,1);
    assert.equal(await psql("select dailies=1 from marriages where guild_id='race';"),'t');
    assert.equal(await psql("select bool_and(xp=100 and lootboxes+weapon_crates=2) from players where guild_id='race';"),'t');
    const before=await psql("select row(user_id,balance,xp,lootboxes,weapon_crates)::text from players where guild_id='race' order by user_id;");
    assert.deepEqual(await Promise.all([psql("set statement_timeout='5s';select play('race-a','race','a','daily');"),psql("set statement_timeout='5s';select play('race-b','race','b','daily');")]),responses);
    assert.equal(await psql("select row(user_id,balance,xp,lootboxes,weapon_crates)::text from players where guild_id='race' order by user_id;"),before);
  });
  await check('concurrent same receipt catchup gives one marriage grant and identical result',async()=>{
    await pair('retry',true);
    const responses=await Promise.all([psql("set statement_timeout='5s';select play('retry-same','retry','a','daily');"),psql("set statement_timeout='5s';select play('retry-same','retry','a','daily');")]);
    assert.equal(responses[0],responses[1]);assert.match(responses[0],/Marriage:/);
    assert.equal(await psql("select dailies=1 from marriages where guild_id='retry';"),'t');
    assert.equal(await psql("select bool_and(xp=0 and lootboxes+weapon_crates=1) from players where guild_id='retry';"),'t');
    assert.equal(await psql("select count(*) from receipts where id='retry-same';"),'1');
    await rejectSql("select play('retry-same','retry','b','daily');");
  });
  await check('first personal daily and new marriage ordinary path defer marriage grant',async()=>{
    await pair('new',true,true);await psql("update players set daily_at=clock_timestamp()-interval '1 day' where guild_id='new' and user_id='a';select play('new','new','a','daily');");
    assert.equal(await psql("select dailies=0 from marriages where guild_id='new';"),'t');
    await pair('first',true);await psql("update players set daily_at=null,daily_streak=0 where guild_id='first' and user_id='a';select play('first','first','a','daily');");
    assert.equal(await psql("select dailies=0 from marriages where guild_id='first';"),'t');
    assert.equal(await psql("select xp=100 and daily_streak=1 and lootboxes+weapon_crates=1 from players where guild_id='first' and user_id='a';"),'t');
  });
  await check('lock timeout leaves both spouses and receipt unchanged',async()=>{
    await pair('timeout',true);
    const before=await psql("select row(user_id,balance,xp,lootboxes,weapon_crates,daily_at)::text from players where guild_id='timeout' order by user_id;");
    const holder=docker(['exec','-i',container,'psql','-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-U','postgres','-d','owo_test','-f','-'],"begin;select user_id from players where guild_id='timeout' and user_id='b' for update;\n\\echo gate_locked\n",true);
    await new Promise((resolve,reject)=>{let seen='';const timer=setTimeout(()=>reject(Error('lock timeout')),5000);holder.child.stdout.on('data',chunk=>{seen+=chunk;if(seen.includes('gate_locked')){clearTimeout(timer);resolve();}});holder.complete.catch(reject);});
    try {await rejectSql("set lock_timeout='100ms';select play('timeout','timeout','a','daily');");}finally{holder.child.stdin.end('rollback;\n');await holder.complete;}
    assert.equal(await psql("select row(user_id,balance,xp,lootboxes,weapon_crates,daily_at)::text from players where guild_id='timeout' order by user_id;"),before);
    assert.equal(await psql("select dailies=0 and claimed_at is null from marriages where guild_id='timeout';"),'t');
    assert.equal(await psql("select count(*) from receipts where id='timeout';"),'0');
  });
  await check('receipt failure rolls back both spouses and marriage metadata',async()=>{
    await pair('rollback',true); const before=await psql("select row(user_id,balance,xp,lootboxes,weapon_crates,daily_at)::text from players where guild_id='rollback' order by user_id;");
    await psql("create function qa_fail() returns trigger language plpgsql as $$begin if new.id='rollback' then raise exception 'forced';end if;return new;end$$;create trigger qa_fail before insert on receipts for each row execute function qa_fail();");
    await rejectSql("select play('rollback','rollback','a','daily');");
    assert.equal(await psql("select row(user_id,balance,xp,lootboxes,weapon_crates,daily_at)::text from players where guild_id='rollback' order by user_id;"),before);
    assert.equal(await psql("select dailies=0 and claimed_at is null from marriages where guild_id='rollback';"),'t');
    assert.equal(await psql("select count(*) from receipts where id='rollback';"),'0');await psql('drop trigger qa_fail on receipts;drop function qa_fail();');
  });
  await check('new tables helpers and rank cannot be accessed by application roles',async()=>{
    for(const role of ['anon','authenticated','service_role']) {
      for(const table of ['supporter_entitlements','marriages']) {await rejectSql(`set role ${role};select * from ${table};`);await rejectSql(`set role ${role};delete from ${table};`);}
      await rejectSql(`set role ${role};select marriage_daily_reward(1,1,0);`);
    }
    await rejectSql("select play('race-a','other','a','daily');");
    assert.equal(await psql("select count(*) from players where guild_id='other' and user_id='a';"),'0');
    await rejectSql("insert into marriages(guild_id,user1_id,user2_id) values('race','a','b');");
  });
  console.log(`PostgreSQL bonus integration: ${checks}/${checks} checks passed.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  cleanup();
}
