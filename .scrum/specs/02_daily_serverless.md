# Daily core port — implementation contract

Source: [01_daily_legacy.md](01_daily_legacy.md). Scope: non-supporter personal daily only; **partial parity**.

## Migration 002 and contract

- Add nonnegative `bigint NOT NULL DEFAULT 0` fields to `public.players`: `daily_streak`, `xp`, `lootboxes`, `weapon_crates`. Existing balances, timestamps, hunt and zoo remain intact.
- Add `guild_id`, `user_id`, `action` text columns to `receipts`; new inserts must bind all three. Existing unbound rows stay non-replayable and must not be deleted to permit accidental re-grant.
- Add `game_config` singleton (for example boolean PK constrained true) with `daily_timezone text NOT NULL DEFAULT 'UTC'`; seed one row. Validate zone against `pg_catalog.pg_timezone_names`, fail closed on missing/invalid config. Owner updates through SQL; no player command configures zone. Apply RLS/revocations.
- Replace `play` preserving its four named text parameters and text return. Receipt and row locks follow global architecture. Retain balance/zoo/hunt behavior. No extra Worker RPC parameters required.

## Algorithm inside locked daily branch

1. `claim_time = clock_timestamp()` **after player/interaction locks**. `day_start = date_trunc('day', claim_time AT TIME ZONE daily_timezone) AT TIME ZONE daily_timezone`. This uses calendar midnight and handles named-zone DST without fixed 86,400-second assumptions.
2. If `daily_at >= day_start`, return a no-claim message and persist its receipt. This includes future timestamps. Change no reward/streak/XP/box state.
3. If `daily_at IS NULL`, `new_streak=1`; otherwise `new_streak=daily_streak+1`, even after missed days. The legacy override intentionally prevents streak reset.
4. Draw `U` independently of box RNG; `reward = least(500 + floor(U*200) + new_streak*25, 5000)` with `0<=U<1`. First-claim range is **525..724**, not 500..699. No supporter multiplier in this sprint.
5. Independent second RNG: `<0.5` gives one lootbox; otherwise one standard weapon crate. Increment exactly one counter, `balance += reward`, `xp += 100`, persist `daily_streak` and `daily_at=claim_time` atomically with receipt.
6. Vietnamese response includes granted currency, persisted streak, box type and XP. Avoid claiming consecutive days (legacy streak survives missed days). Replaying the receipt returns byte-identical text with no new RNG or mutation.

Use internal pure `daily_reward(streak bigint, roll double precision) → bigint` for deterministic reward fixtures; reject NULL, streak<1, nonfinite roll and roll outside `[0,1)`. Calculate the cap without overflowing on a large positive streak (for example cap the streak contribution before multiplication). Revoke EXECUTE from `PUBLIC`, `anon`, `authenticated`; only the definer RPC/test owner calls it. Do not add client-facing deterministic RNG or clock overrides.

Use private `daily_day_start(claim_time timestamptz, zone text) → timestamptz` for calendar arithmetic so QA can test historical DST boundaries against the actual production expression. Revoke the same roles and fix its search path; `play` still owns timestamp sampling and zone validation, never accepting these from an interaction.

## Explicit adaptations / deferred effects

- UTC default is explicit configuration until original host timezone is known; changing zone may change eligibility. All instants persist as `timestamptz`.
- Guild-local XP/counts are the prototype identity model; legacy XP/economy were global. `xp` stores daily credit only; chat XP/level rewards are not implemented.
- Supporter rank>=3 doubling, marriage/ring/Valentine rewards, announcements, surveys, display alterations and generic 5-second command throttle are deferred. Do not report full daily parity.
- Box counts persist now; opening boxes, gem/weapon drops and inventory UI remain backlog work.
- Existing prototype players retain `daily_at`; their unknown historical streak starts at zero, so next new-day claim starts at one. This is prototype migration, not legacy data import.

## Acceptance criteria / QA handoff

| Case | Required outcome |
|---|---|
| Fresh claim | Streak1, +525..724 coins, XP100, exactly one box, daily timestamp, bound receipt. |
| RNG boundaries/cap | Pure reward fixtures U=0 and just below1; increasing streak; cap5000. No rounding/multiplier invented. |
| Same day/new IDs | Only first claim grants; later receipt has no-claim result and unchanged counters. |
| Same interaction retries | Exact result replay, one grant; scope/action mismatch rejects without leaking result. |
| Concurrent distinct IDs | Real PostgreSQL sessions race; only one daily grant, two stable receipts. |
| Missed days/next midnight | Streak increments; named-zone calendar midnight unlocks, exact boundary/future timestamps deny correctly. Include DST zone fixture. |
| Atomic rollback | Forced SQL failure leaves balance, all counters, timestamp and receipt unchanged. |
| Permissions | `anon`/`authenticated` cannot call RPC or mutate tables; only intended service access. |
| HTTP regression | Invalid/tampered signatures rejected, wrong guild/unsupported interaction causes no RPC; allowed daily deferred then edits original with mentions disabled. |

`npm test --prefix rebuild` must pass with honest distinction between executed real DB tests, transport mocks and skipped tests. Database concurrency cannot be certified by sequential PGlite or JavaScript mock tests.
