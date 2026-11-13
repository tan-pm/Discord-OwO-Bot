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
  if (process.argv.includes('--latest')) await psql(await readFile(new URL('../supabase/migrations/003_daily_bonuses.sql', import.meta.url), 'utf8'));

  await check('migration preserves prototype state and unbound receipt history', async () => {
    const data = await psql("select balance||','||daily_streak||','||xp||','||lootboxes||','||weapon_crates from players where guild_id='upgrade' and user_id='existing';");
    assert.equal(data, '321,0,0,0,0');
    await rejectSql("select public.play('historical','upgrade','existing','daily');");
    assert.equal(await psql("select result from receipts where id='historical';"), 'historical result');
  });

  await check('reward formula has exact bounds, progression and overflow-safe cap', async () => {
    assert.equal(await psql('select public.daily_reward(1,0), public.daily_reward(1,0.999999999999), public.daily_reward(2,0), public.daily_reward(179,0), public.daily_reward(179,0.999999999999), public.daily_reward(180,0), public.daily_reward(9223372036854775807,0);'), '525|724|550|4975|5000|5000|5000');
    for (const args of ['0,0', '-1,0', 'NULL,0', '1,NULL', '1,-0.1', '1,1', "1,'NaN'", "1,'Infinity'", "1,'-Infinity'"]) {
      await rejectSql(`select public.daily_reward(${args});`);
    }
  });

  await check('fresh daily grants exact core state and a bound receipt', async () => {
    await psql("select public.play('fresh-1','qa','fresh','daily');");
    assert.equal(await psql("select (balance between 525 and 724) and daily_streak=1 and xp=100 and lootboxes+weapon_crates=1 and daily_at is not null from players where guild_id='qa' and user_id='fresh';"), 't');
    assert.equal(await psql("select guild_id='qa' and user_id='fresh' and action='daily' from receipts where id='fresh-1';"), 't');
  });

  await check('seeded PostgreSQL RNG exercises both guaranteed box-grant branches', async () => {
    const seeds = new Map();
    for (const seed of [-1, -0.5, 0, 0.5, 1]) {
      const result = (await psql(`select setseed(${seed}); select random(); select random()<0.5;`)).split('\n').at(-1);
      if (!seeds.has(result)) seeds.set(result, seed);
    }
    assert.equal(seeds.size, 2, 'Fixture seeds must exercise both box outcomes');
    for (const [lootbox, seed] of seeds) {
      const id = lootbox === 't' ? 'lootbox' : 'crate';
      await psql(`select setseed(${seed}); select public.play('box-${id}','qa','box-${id}','daily');`);
      assert.equal(await psql(`select lootboxes||','||weapon_crates from players where guild_id='qa' and user_id='box-${id}';`), lootbox === 't' ? '1,0' : '0,1');
    }
  });

  await check('same-day claims and same-interaction replay cannot grant twice', async () => {
    const before = await psql("select row(balance,daily_streak,xp,lootboxes,weapon_crates,daily_at)::text from players where guild_id='qa' and user_id='fresh';");
    const first = await psql("select result from receipts where id='fresh-1';");
    assert.equal(await psql("select public.play('fresh-1','qa','fresh','daily');"), first);
    await psql("select public.play('fresh-2','qa','fresh','daily');");
    assert.equal(await psql("select row(balance,daily_streak,xp,lootboxes,weapon_crates,daily_at)::text from players where guild_id='qa' and user_id='fresh';"), before);
    assert.equal(await psql("select count(*) from receipts where id in ('fresh-1','fresh-2');"), '2');
  });

  await check('receipt scope/action mismatch and invalid RPC input fail without state changes', async () => {
    const before = await psql('select count(*) from players;');
    for (const call of [
      "'fresh-1','other','fresh','daily'", "'fresh-1','qa','other','daily'",
      "'fresh-1','qa','fresh','balance'", "'invalid','','fresh','daily'",
      "'invalid','qa','fresh','unknown'", "NULL,'qa','fresh','daily'"
    ]) await rejectSql(`select public.play(${call});`);
    assert.equal(await psql('select count(*) from players;'), before);
    assert.equal(await psql("select count(*) from receipts where id='invalid';"), '0');
  });

  await check('missed days preserve streak and cap grants at 5000', async () => {
    await psql("insert into players(guild_id,user_id,daily_at,daily_streak) values('qa','missed',now()-interval '60 days',9),('qa','capped',now()-interval '60 days',179); select public.play('missed','qa','missed','daily'); select public.play('capped','qa','capped','daily');");
    assert.equal(await psql("select daily_streak=10 and balance between 750 and 949 and xp=100 and lootboxes+weapon_crates=1 from players where guild_id='qa' and user_id='missed';"), 't');
    assert.equal(await psql("select daily_streak=180 and balance=5000 from players where guild_id='qa' and user_id='capped';"), 't');
  });

  await check('configured-zone midnight gate includes exact midnight and future timestamps', async () => {
    await psql("update game_config set daily_timezone='America/Los_Angeles'; insert into players(guild_id,user_id,daily_at,daily_streak) values ('qa','midnight',date_trunc('day',clock_timestamp() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles',4),('qa','previous', (date_trunc('day',clock_timestamp() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles')-interval '1 microsecond',4),('qa','future',clock_timestamp()+interval '2 days',4); select public.play('midnight','qa','midnight','daily'); select public.play('previous','qa','previous','daily'); select public.play('future','qa','future','daily');");
    assert.equal(await psql("select bool_and(balance=0 and daily_streak=4 and xp=0 and lootboxes+weapon_crates=0) from players where guild_id='qa' and user_id in ('midnight','future');"), 't');
    assert.equal(await psql("select balance between 625 and 824 and daily_streak=5 from players where guild_id='qa' and user_id='previous';"), 't');
    await psql("update game_config set daily_timezone='UTC';");
  });

  await check('named-zone day boundaries handle both 23-hour and 25-hour DST days', async () => {
    assert.equal(await psql("select public.daily_day_start('2026-03-08 12:00+00','America/Los_Angeles')='2026-03-08 08:00+00'::timestamptz and public.daily_day_start('2026-03-09 12:00+00','America/Los_Angeles')='2026-03-09 07:00+00'::timestamptz and public.daily_day_start('2026-11-01 12:00+00','America/Los_Angeles')='2026-11-01 07:00+00'::timestamptz and public.daily_day_start('2026-11-02 12:00+00','America/Los_Angeles')='2026-11-02 08:00+00'::timestamptz;"), 't');
  });

  await check('missing or invalid owner timezone configuration fails closed', async () => {
    await psql("update game_config set daily_timezone='invalid/zone';");
    await rejectSql("select public.play('invalid-zone','qa','invalid-zone','daily');");
    assert.equal(await psql("select count(*) from players where user_id='invalid-zone';"), '0');
    await psql('delete from game_config;');
    await rejectSql("select public.play('missing-zone','qa','missing-zone','daily');");
    assert.equal(await psql("select count(*) from receipts where id in ('invalid-zone','missing-zone');"), '0');
    await psql("insert into game_config(singleton,daily_timezone) values(true,'UTC');");
  });

  await check('forced receipt failure rolls back balance, timestamp, streak, XP and box', async () => {
    await psql("insert into players(guild_id,user_id) values('qa','rollback'); create function public.qa_fail_receipt() returns trigger language plpgsql as $$ begin if new.id='rollback-fail' then raise exception 'forced receipt failure'; end if; return new; end $$; create trigger qa_fail before insert on receipts for each row execute function public.qa_fail_receipt();");
    await rejectSql("select public.play('rollback-fail','qa','rollback','daily');");
    assert.equal(await psql("select balance=0 and daily_streak=0 and xp=0 and lootboxes=0 and weapon_crates=0 and daily_at is null from players where guild_id='qa' and user_id='rollback';"), 't');
    assert.equal(await psql("select count(*) from receipts where id='rollback-fail';"), '0');
    await psql('drop trigger qa_fail on receipts; drop function public.qa_fail_receipt();');
  });

  await check('actual anon/authenticated roles cannot execute RPC or mutate economy tables', async () => {
    for (const role of ['anon', 'authenticated']) {
      await rejectSql(`set role ${role}; select public.play('forbidden','qa','fresh','daily');`);
      await rejectSql(`set role ${role}; update players set balance=999 where guild_id='qa';`);
      await rejectSql(`set role ${role}; update game_config set daily_timezone='Europe/London';`);
      await rejectSql(`set role ${role}; select public.daily_reward(1,0);`);
      await rejectSql(`set role ${role}; select public.daily_day_start(now(),'UTC');`);
    }
    assert.match(await psql("set role service_role; select public.play('service','qa','service','balance');"), /0/);
    await rejectSql("set role service_role; select public.daily_reward(1,0);");
    await rejectSql("set role service_role; select public.daily_day_start(now(),'UTC');");
    await rejectSql("set role service_role; update game_config set daily_timezone='Europe/London';");
  });

  async function concurrentClaims(player, firstId, secondId) {
    await psql(`insert into players(guild_id,user_id) values('qa','${player}');`);
    const holder = docker([
      'exec', '-i', container, 'psql', '-X', '-q', '-t', '-A',
      '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'owo_test', '-f', '-'
    ], `begin; select user_id from players where guild_id='qa' and user_id='${player}' for update;\n\\echo gate_locked\n`, true);
    await new Promise((resolve, reject) => {
      let seen = '';
      const timer = setTimeout(() => reject(new Error('Row-lock synchronization timed out')), 10000);
      holder.child.stdout.on('data', chunk => {
        seen += chunk;
        if (seen.includes('gate_locked')) { clearTimeout(timer); resolve(); }
      });
      holder.complete.catch(error => { clearTimeout(timer); reject(error); });
    });
    const claims = [
      psql(`set application_name='qa-${player}-first'; select public.play('${firstId}','qa','${player}','daily');`),
      psql(`set application_name='qa-${player}-second'; select public.play('${secondId}','qa','${player}','daily');`)
    ];
    try {
      let waiters = 0;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        waiters = Number(await psql(`select count(*) from pg_stat_activity where application_name in ('qa-${player}-first','qa-${player}-second') and wait_event_type='Lock';`));
        if (waiters === 2) break;
        await delay(50);
      }
      assert.equal(waiters, 2, 'Both independent PostgreSQL sessions must be observed waiting on locks');
      const unlockBoundary = await psql('select clock_timestamp();');
      holder.child.stdin.end('commit;\n');
      const responses = await Promise.all(claims);
      await holder.complete;
      assert.equal(await psql(`select balance between 525 and 724 and daily_streak=1 and xp=100 and lootboxes+weapon_crates=1 from players where guild_id='qa' and user_id='${player}';`), 't');
      assert.equal(await psql(`select daily_at >= '${unlockBoundary}'::timestamptz from players where guild_id='qa' and user_id='${player}';`), 't', 'Claim timestamp must be sampled after lock waiting');
      return responses;
    } finally {
      if (!holder.child.stdin.writableEnded) holder.child.stdin.end('rollback;\n');
      await Promise.allSettled([...claims, holder.complete]);
    }
  }

  await check('two concurrent distinct interactions produce one grant and two receipts', async () => {
    const responses = await concurrentClaims('race', 'race-1', 'race-2');
    assert.notEqual(responses[0], responses[1]);
    assert.equal(await psql("select count(*) from receipts where id in ('race-1','race-2');"), '2');
  });
  await check('two concurrent identical interactions replay one result and one receipt', async () => {
    const responses = await concurrentClaims('retry', 'retry-1', 'retry-1');
    assert.equal(responses[0], responses[1]);
    assert.equal(await psql("select count(*) from receipts where id='retry-1';"), '1');
  });

  await check('prototype balance, hunt cooldown and zoo behavior survives migration', async () => {
    assert.equal(await psql("select public.play('compat-balance','qa','compat','balance');"), 'Số dư: 0');
    assert.equal(await psql("select public.play('compat-hunt','qa','compat','hunt');"), 'Bạn bắt được 1 thú!');
    assert.equal(await psql("select public.play('compat-cooldown','qa','compat','hunt');"), 'Hãy đợi hết cooldown 15 giây.');
    assert.equal(await psql("select public.play('compat-zoo','qa','compat','zoo');"), 'Số thú: 1');
    assert.equal(await psql("select balance=0 and animals=1 from players where guild_id='qa' and user_id='compat';"), 't');
  });

  await check('negative balance and negative daily counters are rejected by database constraints', async () => {
    for (const column of ['balance', 'daily_streak', 'xp', 'lootboxes', 'weapon_crates']) {
      await rejectSql(`update players set ${column}=-1 where guild_id='qa' and user_id='fresh';`);
    }
  });

  console.log(`PostgreSQL integration: ${checks}/${checks} checks passed.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  cleanup();
}
