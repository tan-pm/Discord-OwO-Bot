# QA test report — Sprint H01

2026-11-08. Local acceptance passes: **89 Node test cases, 16 core PostgreSQL checks under migration003, 15 additional bonus PostgreSQL checks, and 5 local workerd checks.** No production service contacted. Baseline migrations001/002 were separately tested:16/16 pass.

| Executed command | Observed result |
|---|---|
| `npm test --prefix rebuild` |89/89 pass, no skips;73 signed HTTP/auth cases and16 contract cases.|
| `node rebuild/test/run-postgres.mjs` |16/16 pass on actual PostgreSQL17, migrations001/002.|
| `node rebuild/test/run-postgres.mjs --latest` |16/16 pass on actual PostgreSQL17, migrations001/002/003.|
| `node rebuild/test/run-bonuses-postgres.mjs` |15/15 pass on actual PostgreSQL17, migrations001/002/003.|
| `npm run test:db --prefix rebuild` |Final combined latest-core16/16 + bonus15/15 pass.|
| `npm run test:runtime --prefix rebuild` |5/5 pass in actual local Cloudflare workerd via Wrangler.|

The Docker runners start isolated containers with network disabled, no published ports, ephemeral tmpfs storage, no bind mounts, and remove them in finally. The database image remains cached. SQL tests run independent actual PostgreSQL processes, never mocked databases. Runtime smoke uses generated temporary keys and starts/stops its own local Wrangler process group. Outbound RPC and webhook calls are mocked only in Node HTTP tests.

## Ingress evidence

Real Ed25519 and HMAC signatures cover both transports, exact timestamp boundaries±300 inclusive and±301 denied, stale/future timestamps, payload tampering and authentication cross-route rejection. Chunked streams without Content-Length enforce16KiB; valid small streams succeed. Malformed UTF8/JSON fail closed. PING works before guild normalization. Missing/placeholder guild and secret configuration, wrong guild, missing identity, argument/options injection, and forbidden relay fields fail before RPC.

All aliases normalize identically for slash/prefix, preserve user/guild identity, and produce canonical actions. Relay receipts have the literal relay: namespace; slash/component receipts retain the interaction ID. Components allow only exact readonly balance/zoo/help button IDs, rejecting daily/hunt and substring tricks. Help requires no database. Successful replies disable mentions. Slash commands defer then edit the original webhook. Relay replies synchronously and makes one RPC call with bounded timeout signal, never a Discord message call. Bad upstream status, network failure and invalid RPC response remain generic; failed webhook delivery settles the background task without exposing internals. Known invalid database configuration prevents outbound calls.

## PostgreSQL core regression evidence

Both original and latest migration chains pass the16-check core harness: upgrade preservation; unbound historical receipt rejection; exact deterministic daily bounds and overflow-safe cap; seeded box branches; same-day/receipt replay; identity/action scope mismatch; missed-day streak behavior; timezone midnight/future gates and23/25-hour DST boundaries; missing configuration rollback; forced receipt failure rollback; actual role permissions; simultaneous distinct/same receipt claims; prototype hunt/balance/zoo; negative-state constraints.

Core concurrency holds a player row, observes both independent claim sessions waiting in pg_stat_activity, releases the lock, and checks the granted timestamp was sampled after waiting.

## Bonus evidence

The15 bonus checks cover:

1. 003 preserves existing player state.
2. Supporter threshold2/3, high rank, expiry, post-cap doubling10000, ordinary cap5000, and guild isolation.
3. Seeded exact supporter reward and uncapped doubled range.
4. Marriage helper minima/maxima, half rounding, overflow-safe cap and invalid arguments.
5. Ordinary spouse daily sequence pays both once; replay/cooldown cannot repeat.
6. Seeded exact ordinary marriage money uses claimant **preclaim** streak and equal spouse rewards.
7. Today-marriage cooldown catchup grants no second personal XP/reward.
8. Active explicit Valentine window grants each spouse three boxes and doubled capped marriage money.
9. Future/expired event windows do not activate.
10. Simultaneous spouses: both independent sessions are observed waiting on a held guild advisory gate; release produces one marriage grant, then receipt retries preserve state.
11. Same receipt concurrently yields identical catchup result and one receipt/grant; opposite-user replay fails.
12. First personal daily and newly married ordinary path preserve legacy eligibility guards.
13. A held spouse row plus100ms lock_timeout aborts without changing either spouse, marriage metadata or receipt.
14. Forced receipt failure rolls back both spouses and marriage metadata.
15. Actual anon/authenticated/service_role cannot read/mutate entitlement/marriage tables or call reward helper; receipt identity mismatch is rejected.

Concurrency sessions use5-second statement_timeout to surface unexpected deadlocks/hangs. This proves the exercised schedules; it is not an exhaustive deadlock proof or load benchmark. Seeded tests establish branch/formula correctness, not RNG distribution quality.

## Local runtime evidence and limits

Actual workerd accepts signed Discord PING, slash help and HMAC relay help; rejects wrong guild403 and unsigned relay401. This validates local Web Crypto and ingress compatibility. It performs no database or external Discord call and does not establish deployed CPU<10ms, uptime, quota fit or Discord's3-second delivery deadline.

No live Supabase PostgREST/Discord round trip, Gateway process, deployment, provider load/CPU/RAM measurements, backup restore, generic throttle or complete legacy economy parity was tested. Marriage tests validate the documented server-owned adaptations, not every historical calendar/event mechanism. Supabase roles are recreated locally for SQL permissions; managed-platform behavior remains a separate gate. Legacy source/root dependencies remain untouched.

## Local configuration follow-up — 2026-11-09

Added Worker `.dev.vars.example`, separate Discord registration `.env.discord.example`, Vietnamese `rebuild/LOCAL_DEVELOPMENT.md`, and an HMAC local command CLI. Real config files are gitignored. Worker now accepts `SUPABASE_SECRET_KEY` (`sb_secret_...`, apikey only) while retaining legacy `SUPABASE_SERVICE_ROLE_KEY` bearer behavior. A defined new key takes precedence; invalid/empty new keys fail closed before outbound calls.

Revalidation: **98/98 Node cases** (nine additional API-key compatibility/configuration cases), **16/16 latest core PostgreSQL checks + 15/15 bonus checks**, and **7/7 local workerd/CLI checks**. The two additional runtime checks exercise the local CLI with a temporary env file and reject an invalid user ID. Wrangler 4.158.0 packaging `deploy --dry-run` passed. Runtime required execution outside the restricted sandbox to start the local server. Docker test containers were removed; no live Supabase/Discord calls, command registration or deployment were performed. Configuration changes do not close the existing production gates.

### Unified local configuration

At the user's request, the two local config templates above were replaced by `rebuild/.env.example`; all local commands now use a single `rebuild/.env`. An ignored blank `.env` was created for editing. Node cases rerun: **98/98 pass**. Runtime/CLI checks rerun: **7/7 pass**, with the Worker automatically loading a temporary `.env` and the CLI loading the same file through Node's `--env-file=.env`. Test config and credentials are isolated from the user's real config. SQL and Worker reward logic did not change, so PostgreSQL tests were not repeated for this follow-up.
