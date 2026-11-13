# Daily bonus migration

Apply SQL in this exact order as the database owner, to a PostgreSQL/Supabase database with the standard `anon`, `authenticated`, and `service_role` roles:

1. `rebuild/migrations/001_core.sql`
2. `rebuild/migrations/002_daily_core.sql`
3. `rebuild/supabase/migrations/003_daily_bonuses.sql`

The Worker continues to call `public.play(interaction text, guild text, player text, action text) -> text`. Only `service_role` may execute it. Receipt identity remains bound to guild, user and action, and retries return the original result. No rank, spouse, event flag, reward or clock parameter exists.

## Server administration

Entitlements and marriages have RLS enabled and all privileges revoked from public, anon, authenticated and service_role. Manage them using database-owner SQL only. Default rank is zero; absent/expired entitlements do not grant benefits. Rank >=3 doubles capped core daily money only (maximum 10,000); it does not double XP, boxes or marriage money.

Example provisioning (replace identifiers; use actual trusted subscription records):

```sql
begin;
-- Always acquire the guild gate BEFORE modifying marriage rows or player rows
-- in a marriage administration transaction. Same gate is used by every play.
select pg_advisory_xact_lock(hashtextextended('daily-marriage:' || 'guild-id', 1));
insert into public.players(guild_id,user_id)
values ('guild-id','alice'), ('guild-id','bob') on conflict do nothing;
insert into public.supporter_entitlements(guild_id,user_id,benefit_rank,expires_at)
values ('guild-id','alice',3,clock_timestamp() + interval '30 days')
on conflict(guild_id,user_id) do update
set benefit_rank=excluded.benefit_rank, expires_at=excluded.expires_at;
-- Endpoints must be sorted under COLLATE "C", cannot be self-married, and
-- must both exist in this guild. A participant may have only one marriage.
insert into public.marriages(guild_id,user1_id,user2_id)
values ('guild-id','alice','bob');
commit;
```

Social commands are future work. Marriage endpoints are immutable; to replace a marriage, take the guild advisory gate, delete the old row, then insert the new row in the same transaction. Do not acquire player/marriage row locks before that gate. Manual multi-guild administration must acquire gates in a consistent sorted guild order. Play takes receipt advisory lock, guild advisory gate, marriage row, then both player rows in sorted order. Server clock is sampled after lock waits. This intentionally serializes all play calls within a guild for the small initial deployment; reassess throughput before a large rollout.

Valentine is explicit server state, never inferred from the calendar. It defaults disabled. Optional bounded event SQL:

```sql
update public.game_config set
  valentine_enabled=true,
  valentine_starts_at='2027-02-14 00:00:00+00',
  valentine_ends_at='2027-02-15 00:00:00+00'
where singleton;
```

An enabled event with null bounds is an explicit unrestricted event; with bounds it is active strictly after start and strictly before end. Set `valentine_enabled=false` to stop it. `daily_timezone` remains the shared calendar-day boundary (default UTC).

## Bonus behavior and deliberate legacy repairs

A successful core daily grants the existing money/streak reward, 100 XP and one random box. Marriage bonus normally triggers when the second spouse claims, provided both had existing daily timestamps and the marriage predates today's boundary; formula uses the stored streaks before the claimant's increment: `min(1000, round(100 + floor(U*100) + 12.5*(s1+s2)))`. Each spouse gets that money and one shared random box type. A later daily call on personal cooldown can catch up the marriage once when both have claimed today; like the legacy catch-up path this does not require the marriage to predate today. Catch-up grants no additional personal money, XP or core box.

Valentine doubles marriage money after its cap and grants each spouse three marriage boxes: two from the regular shared box roll plus one from an independent event box roll. Maximum marriage money is then 2,000 each. All updates, pair daily count, timestamp and response receipt commit atomically. The legacy catch-up duplicate-ID lootbox bug and non-atomic pair check are repaired: both endpoints receive rewards exactly once per calendar day, including simultaneous claims. Announcement, surveys and custom daily rendering are not ported here.
