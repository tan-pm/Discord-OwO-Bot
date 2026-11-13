begin;

-- Server-owned state. No rank, spouse, event flag or clock is accepted by play.
create table public.supporter_entitlements (
  guild_id text not null,
  user_id text not null,
  benefit_rank integer not null default 0 check (benefit_rank >= 0),
  expires_at timestamptz,
  primary key (guild_id, user_id),
  foreign key (guild_id, user_id) references public.players(guild_id, user_id)
);

alter table public.game_config
  add column valentine_enabled boolean not null default false,
  add column valentine_starts_at timestamptz,
  add column valentine_ends_at timestamptz,
  add constraint valentine_window_valid check (
    valentine_starts_at is null or valentine_ends_at is null
    or valentine_starts_at < valentine_ends_at
  );

create table public.marriages (
  guild_id text not null,
  user1_id text not null,
  user2_id text not null,
  married_at timestamptz not null default clock_timestamp(),
  claimed_at timestamptz,
  dailies bigint not null default 0 check (dailies >= 0),
  primary key (guild_id, user1_id),
  check (user1_id collate "C" < user2_id collate "C"),
  foreign key (guild_id, user1_id) references public.players(guild_id, user_id),
  foreign key (guild_id, user2_id) references public.players(guild_id, user_id)
);

-- Administrative writes use the same lock as play; pair endpoints are immutable.
create function public.validate_marriage() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'UPDATE' and (new.guild_id, new.user1_id, new.user2_id)
      is distinct from (old.guild_id, old.user1_id, old.user2_id) then
    raise exception 'Marriage endpoints are immutable' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtextextended('daily-marriage:' || new.guild_id, 1));
    if exists (select 1 from public.marriages m where m.guild_id = new.guild_id
      and (new.user1_id in (m.user1_id,m.user2_id) or new.user2_id in (m.user1_id,m.user2_id))) then
      raise exception 'Player already married in this guild' using errcode = '23505';
    end if;
  end if;
  return new;
end;
$$;
create trigger validate_marriage before insert or update on public.marriages
  for each row execute function public.validate_marriage();

create function public.marriage_daily_reward(streak1 bigint, streak2 bigint, roll double precision)
returns bigint language plpgsql immutable set search_path = pg_catalog as $$
begin
  if streak1 is null or streak2 is null or streak1 < 0 or streak2 < 0
      or roll is null or not (roll >= 0 and roll < 1) then
    raise exception 'Invalid marriage reward inputs' using errcode = '22023';
  end if;
  -- PostgreSQL numeric round matches Math.round for these nonnegative values.
  return least(1000, round(100 + floor(roll * 100)::numeric
    + (least(streak1,80)::numeric + least(streak2,80)::numeric) * 12.5)::bigint);
end;
$$;

alter table public.supporter_entitlements enable row level security;
alter table public.marriages enable row level security;
revoke all on public.supporter_entitlements, public.marriages from public, anon, authenticated, service_role;
revoke all on function public.validate_marriage() from public, anon, authenticated, service_role;
revoke all on function public.marriage_daily_reward(bigint,bigint,double precision) from public, anon, authenticated, service_role;

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
  marriage public.marriages%rowtype;
  spouse public.players%rowtype;
  partner_id text;
  supporter_rank integer;
  marriage_reward bigint;
  marriage_boxes integer;
  marriage_lootbox boolean;
  event_lootbox boolean;
  valentine_active boolean;
  cfg public.game_config%rowtype;
  personal_claimed boolean;
  prior_daily timestamptz;
  prior_streak bigint;
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

  -- Serialize marriage discovery before any player locks. The guild gate also
  -- protects concurrent spouse claims and admin marriage insertion. Provisioning
  -- and deletion must acquire this same gate before changing marriage rows.
  perform pg_advisory_xact_lock(hashtextextended('daily-marriage:' || guild, 1));
  select m.* into marriage from public.marriages m
    where m.guild_id = guild and player in (m.user1_id, m.user2_id) for update;
  if found then
    partner_id := case when marriage.user1_id = player then marriage.user2_id else marriage.user1_id end;
  end if;
  insert into public.players (guild_id, user_id) values (guild, player) on conflict do nothing;
  -- Both endpoints already exist (foreign keys). Always acquire row locks in the
  -- same order, including balance/hunt/zoo calls against married players.
  perform 1 from public.players pl where pl.guild_id = guild
    and (pl.user_id = player or pl.user_id = partner_id)
    order by pl.user_id collate "C" for update;
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
      select c.* into cfg from public.game_config c where c.singleton;
      claim_zone := cfg.daily_timezone;
      if claim_zone is null or not exists (
        select 1 from pg_catalog.pg_timezone_names tz where tz.name = claim_zone
      ) then
        raise exception 'Missing or invalid daily timezone' using errcode = '22023';
      end if;
      day_start := public.daily_day_start(claim_time, claim_zone);
      personal_claimed := p.daily_at is not null and p.daily_at >= day_start;
      prior_daily := p.daily_at;
      prior_streak := p.daily_streak;
      if personal_claimed then
        result := 'Bạn đã nhận daily hôm nay.';
      else
        -- Legacy override preserves the streak even after missed calendar days.
        new_streak := case when p.daily_at is null then 1 else p.daily_streak + 1 end;
        reward := public.daily_reward(new_streak, random());
        select e.benefit_rank into supporter_rank from public.supporter_entitlements e
          where e.guild_id = guild and e.user_id = player
            and (e.expires_at is null or e.expires_at >= claim_time);
        if coalesce(supporter_rank, 0) >= 3 then
          reward := reward * 2;
        end if;
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
          || '. +100 XP.'
          || case when coalesce(supporter_rank, 0) >= 3 then ' Supporter x2.' else '' end;
      end if;
      -- This also runs on cooldown: a previously claimed daily can catch up a
      -- newly eligible marriage once, without granting base daily or XP twice.
      if partner_id is not null then
        select pl.* into p from public.players pl where pl.guild_id = guild and pl.user_id = player;
        select pl.* into spouse from public.players pl where pl.guild_id = guild and pl.user_id = partner_id;
        if (personal_claimed or (marriage.married_at < day_start and prior_daily is not null))
            and (marriage.claimed_at is null or marriage.claimed_at < day_start)
            and p.daily_at >= day_start and spouse.daily_at >= day_start then
          valentine_active := cfg.valentine_enabled
            and (cfg.valentine_starts_at is null or claim_time > cfg.valentine_starts_at)
            and (cfg.valentine_ends_at is null or claim_time < cfg.valentine_ends_at);
          marriage_reward := public.marriage_daily_reward(prior_streak, spouse.daily_streak, random());
          if valentine_active then marriage_reward := marriage_reward * 2; end if;
          marriage_lootbox := random() < 0.5;
          marriage_boxes := case when valentine_active then 2 else 1 end;
          event_lootbox := valentine_active and random() < 0.5;
          update public.players pl set
            balance = pl.balance + marriage_reward,
            lootboxes = pl.lootboxes + case when marriage_lootbox then marriage_boxes else 0 end
              + case when event_lootbox then 1 else 0 end,
            weapon_crates = pl.weapon_crates + case when marriage_lootbox then 0 else marriage_boxes end
              + case when valentine_active and not event_lootbox then 1 else 0 end
            where pl.guild_id = guild and pl.user_id in (player, partner_id);
          update public.marriages m set claimed_at = claim_time, dailies = m.dailies + 1
            where m.guild_id = guild and m.user1_id = marriage.user1_id;
          result := result || ' Marriage: +' || marriage_reward || ' xu mỗi người; +'
            || marriage_boxes || ' ' || case when marriage_lootbox then 'lootbox' else 'weapon crate' end
            || ' mỗi người.'
            || case when valentine_active then ' Valentine: +1 '
              || case when event_lootbox then 'lootbox' else 'weapon crate' end || ' mỗi người.' else '' end;
        end if;
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

revoke all on function public.play(text,text,text,text) from public, anon, authenticated;
grant execute on function public.play(text,text,text,text) to service_role;

commit;
