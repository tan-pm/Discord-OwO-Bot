begin;

-- Ordinary-player daily only. Mechanics and adaptations: .scrum/specs/02_daily_serverless.md.
alter table public.players
  add column daily_streak bigint not null default 0 check (daily_streak >= 0),
  add column xp bigint not null default 0 check (xp >= 0),
  add column lootboxes bigint not null default 0 check (lootboxes >= 0),
  add column weapon_crates bigint not null default 0 check (weapon_crates >= 0);

-- Keep old receipts for audit, but never guess their missing identity or regrant them.
alter table public.receipts
  add column guild_id text,
  add column user_id text,
  add column action text,
  add constraint receipt_scope_complete check (
    (guild_id is null and user_id is null and action is null)
    or (guild_id is not null and user_id is not null and action is not null)
  );

create table public.game_config (
  singleton boolean primary key default true check (singleton),
  daily_timezone text not null default 'UTC'
);
insert into public.game_config (singleton) values (true);
alter table public.game_config enable row level security;
revoke all on public.game_config from public, anon, authenticated, service_role;
revoke all on public.players, public.receipts from public, anon, authenticated;

-- Internal seams for deterministic boundary fixtures. Neither is a public RPC.
create function public.daily_reward(streak bigint, roll double precision)
returns bigint language plpgsql immutable set search_path = pg_catalog as $$
begin
  if streak is null or streak < 1 or roll is null or not (roll >= 0 and roll < 1) then
    raise exception 'Invalid daily reward inputs' using errcode = '22023';
  end if;
  -- At streak >= 180 even the lowest roll hits the cap; avoid bigint overflow.
  return least(500 + floor(roll * 200)::bigint + least(streak, 180) * 25, 5000);
end;
$$;

create function public.daily_day_start(claim_time timestamptz, zone text)
returns timestamptz language sql stable strict set search_path = pg_catalog as $$
  select date_trunc('day', claim_time at time zone zone) at time zone zone;
$$;

revoke all on function public.daily_reward(bigint, double precision) from public, anon, authenticated, service_role;
revoke all on function public.daily_day_start(timestamptz, text) from public, anon, authenticated, service_role;

create or replace function public.play(interaction text, guild text, player text, action text)
returns text language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  p public.players%rowtype;
  previous public.receipts%rowtype;
  result text;
  claim_time timestamptz;
  claim_zone text;
  day_start timestamptz;
  new_streak bigint;
  reward bigint;
  grants_lootbox boolean;
begin
  if interaction is null or btrim(interaction) = ''
      or guild is null or btrim(guild) = ''
      or player is null or btrim(player) = ''
      or action is null or action not in ('balance', 'daily', 'hunt', 'zoo') then
    raise exception 'Invalid interaction or action' using errcode = '22023';
  end if;

  -- Lock order is always receipt, then player. Retries never sample RNG twice.
  perform pg_advisory_xact_lock(hashtextextended(interaction, 0));
  select r.* into previous from public.receipts r where r.id = interaction;
  if found then
    if previous.guild_id is distinct from guild
        or previous.user_id is distinct from player
        or previous.action is distinct from action then
      raise exception 'Interaction receipt scope mismatch' using errcode = '22023';
    end if;
    return previous.result;
  end if;

  insert into public.players (guild_id, user_id) values (guild, player) on conflict do nothing;
  select pl.* into p from public.players pl
    where pl.guild_id = guild and pl.user_id = player for update;
  -- now() is transaction-start time and can be stale after waiting on a row lock.
  claim_time := clock_timestamp();

  case action
    when 'balance' then
      result := 'Số dư: ' || p.balance;
    when 'zoo' then
      result := 'Số thú: ' || p.animals;
    when 'daily' then
      select c.daily_timezone into claim_zone from public.game_config c where c.singleton;
      if claim_zone is null or not exists (
        select 1 from pg_catalog.pg_timezone_names tz where tz.name = claim_zone
      ) then
        raise exception 'Missing or invalid daily timezone' using errcode = '22023';
      end if;
      day_start := public.daily_day_start(claim_time, claim_zone);
      if p.daily_at is not null and p.daily_at >= day_start then
        result := 'Bạn đã nhận daily hôm nay.';
      else
        -- Legacy override preserves the streak even after missed calendar days.
        new_streak := case when p.daily_at is null then 1 else p.daily_streak + 1 end;
        reward := public.daily_reward(new_streak, random());
        grants_lootbox := random() < 0.5;
        update public.players pl set
          balance = pl.balance + reward,
          daily_streak = new_streak,
          daily_at = claim_time,
          xp = pl.xp + 100,
          lootboxes = pl.lootboxes + case when grants_lootbox then 1 else 0 end,
          weapon_crates = pl.weapon_crates + case when grants_lootbox then 0 else 1 end
        where pl.guild_id = guild and pl.user_id = player;
        result := 'Bạn nhận được ' || reward || ' xu. Streak: ' || new_streak
          || '. +1 ' || case when grants_lootbox then 'lootbox' else 'weapon crate' end
          || '. +100 XP.';
      end if;
    when 'hunt' then
      -- Prototype hunt stays a placeholder until its own mechanics port.
      if p.hunt_at > claim_time - interval '15 seconds' then
        result := 'Hãy đợi hết cooldown 15 giây.';
      else
        update public.players pl set animals = pl.animals + 1, hunt_at = claim_time
          where pl.guild_id = guild and pl.user_id = player;
        result := 'Bạn bắt được 1 thú!';
      end if;
  end case;

  insert into public.receipts (id, result, guild_id, user_id, action)
    values (interaction, result, guild, player, action);
  return result;
end;
$$;

revoke all on function public.play(text, text, text, text) from public, anon, authenticated;
grant execute on function public.play(text, text, text, text) to service_role;

commit;
