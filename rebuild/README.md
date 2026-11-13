# Private OwO hybrid rebuild

Incomplete private-guild port: Cloudflare Worker + atomic Supabase economy, with a thin Gateway relay planned for Sprint 2. Legacy `src/` and `secret/` remain read-only references. Do not launch a production economy yet: hunt/zoo are still placeholder counters, no Gateway process is shipped, and deployed integration/CPU/load/backup gates remain open.

## Architecture

- Discord HTTP slash commands and allowlisted read-only buttons enter `POST /interactions` (`POST /` remains compatible), verified using Discord Ed25519 signatures.
- Prefix command relay enters `POST /relay`, verified using HMAC-SHA256 and a five-minute timestamp window. Both paths normalize through `src/contracts/commands.js` and call the same `public.play(interaction,guild,player,action)` RPC.
- The Worker uses no bot token and holds no game state. Supabase owns RNG, server time, row locks and scoped idempotency receipts. Future Gateway holds Discord Gateway/session state and sends prefix replies, with zero database access and zero reward logic.
- Reactions and passive chat XP are not accepted by this Sprint 1 command envelope. The Gateway process is Sprint 2; XP batching is Sprint 4.

## Local validation

Use Node.js 24+. Do not install root dependencies.

**Hướng dẫn chạy local và điền key:** [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md). Copy `.env.example` to `.env` and fill all local configuration there: Worker, local command CLI and Discord command registration use the same file. The real `.env` is gitignored. `npm run dev` starts the Worker at `http://127.0.0.1:8787`; `npm run local:command -- daily <user-id> <channel-id>` sends a signed local request using that configuration.

```sh
npm test --prefix rebuild
npm run test:db --prefix rebuild
npm run test:runtime --prefix rebuild
```

Unit/HTTP tests use real cryptography and mocked outbound HTTP. Database tests use real PostgreSQL in isolated temporary Docker containers, no published ports or persistent volumes. Docker and the `postgres:17-alpine` image are required; the harness may download the image and removes its containers afterward. `test:db` runs the full core regression suite after migration003 plus the bonus suite. `test:db:core` tests the historical001/002 upgrade baseline. `test:runtime` additionally requires installed Wrangler and starts a local Workers runtime with synthetic keys only; it exercises authentication and routing without a database or external Discord calls. Exact evidence is recorded in `.scrum/QA_TEST_REPORT.md`.

For Wrangler packaging only, run `npm ci --prefix rebuild`, then from `rebuild/` run `npx wrangler deploy --dry-run`. This builds locally without publishing. Deployment commands below are setup instructions, not evidence that deployment has occurred.

## Configuration and future deployment

1. Create a **new** Supabase project. Apply `migrations/001_core.sql`, then `migrations/002_daily_core.sql`, then `supabase/migrations/003_daily_bonuses.sql` in that order. For an existing prototype, apply only unapplied migrations. Never apply to the original OwO database. These are one-time migrations.
2. Set `ALLOWED_GUILD_ID` in `wrangler.toml` to the intended private guild snowflake. The checked-in value is deliberately empty; missing/template values fail closed instead of silently permitting another guild.
3. Provision Worker secrets through `wrangler secret put`: `DISCORD_PUBLIC_KEY`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `RELAY_SHARED_SECRET`. A new Supabase `sb_secret_...` key is sent only in the `apikey` header. Existing deployments may use `SUPABASE_SERVICE_ROLE_KEY` for a legacy JWT instead; when both exist, `SUPABASE_SECRET_KEY` takes precedence. Supabase URL must use HTTPS. Keep database and relay secrets private; relay secret must be at least 32 UTF-8 bytes of cryptographically random material. Never put these values in source or reports. Local `.env` is not automatically uploaded on deploy. No PostgreSQL connection string is used by the Worker: it calls the Supabase Data API.
4. After release gates/sign-off, deploy the Worker with `npm run deploy` from this directory and set `<worker-url>/interactions` as the application's Discord Interactions Endpoint URL. A signed PING verifies the endpoint without needing a database connection.
5. For a **new Discord application**, fill `DISCORD_BOT_TOKEN`, `DISCORD_APPLICATION_ID` and `ALLOWED_GUILD_ID` in the same `.env` and run `npm run register:commands` from this directory (or export those variables and run `node src/register.js`). Registration replaces that application's guild command list. Invite with `applications.commands`; the future Gateway additionally needs bot permissions/intents. No registration is performed by tests.
6. Provision trusted supporter privileges, marriage pairs and event configuration only using SQL owner access; see `supabase/README.md`. No client/relay argument may grant benefits. Live Patreon synchronization, marriage/social commands, announcement/survey/custom presentation systems remain separate work.

`DISCORD_BOT_TOKEN` is only for registration/future Gateway. It is not a Worker secret. No live provider deployment or Discord registration has been performed for this sprint.

## Relay protocol (Gateway implementation follows in Sprint 2)

Send the exact UTF-8 JSON body to `POST /relay` over HTTPS:

```json
{"version":1,"eventId":"123456789012345678","userId":"234567890123456789","guildId":"345678901234567890","channelId":"456789012345678901","commandName":"daily","args":[]}
```

`X-Relay-Timestamp` is Unix seconds; `X-Relay-Signature` is 64 hex characters from HMAC-SHA256(secret, timestamp + "." + exactRawBody). Sign the bytes actually sent, not a reserialized copy. Body limit is 16 KiB, timestamps must be within ±300 seconds, all fields are required, unknown fields/arguments are rejected. `eventId` stays the original Discord message snowflake across retries. Commands include daily/hunt/zoo/balance/help; cash/bal aliases normalize to balance. All automatic mentions are disabled.

Successful relay response is `{content,allowed_mentions:{parse:[]}}`. Gateway sends it to the validated source channel; Worker does not publish prefix messages. Non-success responses are `{error:<code>}` with 400/401/403/413/503 status. Retry an ambiguous RPC transport failure only with the same event ID. Receipts protect economy grants, **not exactly-once Discord message delivery**. A Gateway must not blindly resend successful replies on retries.

Discord button IDs allowed this sprint: `command:balance`, `command:zoo`, `command:help` only. Reward-changing buttons need persistent owner-bound sessions in a future sprint.

## Daily mechanics and adaptations

Personal daily gives `min(500 + floor(U*200) + 25*new_streak, 5000)` coins, XP100, and one independent 50/50 lootbox or standard weapon crate. First-claim coins are 525–724. Streak survives missed days, matching the live legacy override. Server-owned active supporter rank >=3 doubles money only, after the base cap. Marriage/Valentine reward semantics and administrative provisioning are documented in `supabase/README.md` and `.scrum/specs/hybrid_sprint_01_daily.md`.

`game_config.daily_timezone` defaults UTC; SQL owner can select an IANA timezone before use. Named-zone calendar midnight handles DST; changing zones can change eligibility. Legacy uses unknown host-local timezone, so UTC is an explicit adaptation. Accounts/XP/items are guild-scoped instead of legacy global. Counters persist but opening items, chat XP and level rewards are unimplemented.

Migration002 preserves prototype balances/timestamps and initializes new counters at zero. Old unbound receipts remain non-replayable for audit. New receipts bind guild/user/action and replay the exact result. Relay receipts use `relay:<message-id>`; Discord interaction receipts retain their snowflake IDs.

## Remaining release gates

Original hunt/zoo collections, economy/shop/inventory, lootboxes/gems, battle/weapons, macro protections, full game parity, Gateway reconnect/delivery tests, live Discord/Supabase integration, Cloudflare CPU/load measurements, receipt retention, backups and restore remain open. No claim of production readiness or guaranteed free hosting is made.

Free-tier limits must be measured against expected traffic. [Cloudflare Free](https://developers.cloudflare.com/workers/platform/limits/) currently allows 100,000 requests/day and 10 ms CPU per request. [Fly](https://docs.fly.io/about/free-trial) provides a limited trial, not perpetual free hosting. [Koyeb Free](https://www.koyeb.com/docs/reference/instances) sleeps after one hour without incoming traffic and is not accepted as an always-on relay guarantee. A persistent outbound Discord socket does not itself establish an inbound wake-up route. Wispbyte remains unverified. Final host choice belongs to Sprint 6.

Source and assets retain Christopher Thai attribution and the repository's CC-BY-NC-SA-4.0 license. Rebuild changes are a private-server adaptation. Sprint evidence is in `.scrum/QA_TEST_REPORT.md` and `../report/`.
