# Serverless architecture — Sprint 01

Status: implementation contract, 2026-11-08. Legacy mechanics: [daily extraction](specs/01_daily_legacy.md). Sprint slice: [daily RPC](specs/02_daily_serverless.md).

## Boundaries and flow

- `src/`, `secret/`, root manifests/dependencies are read-only references. Changes only in `rebuild/`, `.scrum/` and user-requested `report/`.
- Discord signed interaction → Worker Ed25519 verification → guild/type/command validation → deferred ACK → one Supabase `public.play` RPC → edit original Discord response.
- Worker holds no economy state, performs no reward RNG and trusts no user-supplied balance/reward/rank/time. Supabase service role secret stays server-side. Preserve signature verification and disabled mentions.
- Worker CPU excludes network waiting; `<10 ms` is a target requiring deployed runtime measurements. Node tests or wall-clock timing do not establish Cloudflare CPU compliance.
- Only a single configured private guild is supported. `(guild_id,user_id)` player identity is an intentional adaptation from legacy global economy, retained from prototype.

## Schema map

| Object | Purpose / authority |
|---|---|
| `players` | Guild/player PK; balance and timestamps; migration 002 adds nonnegative daily streak, XP, lootbox and weapon-crate counts. Server-authoritative only. |
| `receipts` | Interaction ID PK plus guild/player/action binding and stable result; atomic with economy changes. |
| `game_config` | Singleton `daily_timezone`, default `UTC`; owner-managed IANA timezone validated against `pg_timezone_names`. UTC is explicit adaptation, not proven legacy hosting timezone. |
| `play(text,text,text,text) → text` | Only application-facing mutation RPC, EXECUTE only `service_role`; SECURITY DEFINER with fixed search path and qualified tables. |

Enable RLS on all tables; revoke table/function access from `PUBLIC`, `anon`, `authenticated`. No browser or Discord client may call RPC directly. Retain named RPC parameters for PostgREST. Do not expose testing time/RNG/privilege overrides in `play`.

## Transaction convention

1. Reject missing/empty identifiers and unsupported actions before creating player or receipt.
2. Lock interaction using transaction advisory lock, then read receipt. Return stored result only for exact guild/player/action match; reject mismatched or historical unbound receipts without any mutation.
3. Acquire the per-guild marriage advisory gate, lock the authoritative marriage row if present, upsert the caller, then lock both player rows in stable `COLLATE "C"` order (caller only if unmarried). All economy actions use this same lock order. Migration003 deliberately serializes play within a guild; privileged marriage administration must acquire the guild gate before touching marriage/player rows. Same interaction serializes before receipt read.
4. Sample database clock **after locks**, calculate claim boundary using configured zone, validate before any RNG/grants, update all affected state and insert receipt in the same transaction.
5. Failure rolls back state and receipt; transport retry reuses interaction ID and obtains original result. No retry may generate a second reward.

Old prototype receipts gain nullable scope columns and remain unbound; reject replays rather than guessing identity or issuing rewards again. Keep existing IDs/results for audit. Receipt pruning is deferred until replay-window and audit requirements are defined; track storage growth meanwhile.

## Constraints verified from primary docs (2026-11-08)

- [Cloudflare limits](https://developers.cloudflare.com/workers/platform/limits/): Free HTTP requests have 10 ms CPU, 100,000 requests/day, 128 MB memory; network waiting does not count as CPU. Measure full signed request and completion path; keep image rendering/battle compute outside this sprint.
- [Supabase pricing](https://supabase.com/pricing): Free includes 500 MB database, 5 GB egress, at most 2 active free projects; automatic backups are not included. Plan-specific quotas are capacity constraints, not a promise of perpetual free operation.
- [Supabase pausing](https://supabase.com/docs/guides/platform/free-project-pausing): Free projects with low activity over 7 days may pause. Availability after inactivity must be tested and documented; do not claim production uptime.

## Delivery gates

Meaningful signed HTTP tests; real PostgreSQL migration and RPC tests for double claim, duplicate receipt, concurrency, rollback, permissions and configured-day boundaries. Mocks cover transport only. If database tooling is unavailable, report the gap and keep that acceptance item open. Deployment, provider CPU/load measurements, backups/restore and full game parity remain separate backlog items.

## Hybrid extension — Sprint H01 frozen ingress contract

The existing atomic RPC and migrations 001/002 remain intact. New economy entitlements may extend `play` via additive migration 003; they do not expand ingress authority. All branches use `play(interaction,guild,player,action) → text` through PostgREST named parameters, generated by `rpcParams`. No Discord bot token is held by the Worker. The Gateway is the sole owner of message delivery for prefix commands.

### Shared normalization

Executable authority: `rebuild/src/contracts/commands.js`. `NormalizedCommandContext` contains exactly `userId,guildId,channelId,commandName,args,triggerType,interactionId`. User, guild, channel and event IDs are nonzero decimal strings of 1–20 digits; a syntactically valid configured guild must also match exactly. No default guild is inferred. Configured guild placeholders, absent identifiers and DMs fail closed. `args` is an empty array for this slice; supplied options/arguments are rejected rather than silently ignored. No arbitrary reward, rank, clock or action parameters reach the RPC.

Aliases (case insensitive, no prefix in `commandName`): `balance|bal|cash → balance`, `daily → daily`, `hunt|h → hunt`, `zoo|z → zoo`, `help → help`. Prefix parsing, ignoring bot-authored messages, guild prefiltering and user/channel extraction are Gateway responsibilities; Worker independently revalidates. These are the frozen supported aliases, not a claim of all legacy aliases.

Discord type 2 chat-input commands normalize to `slash`. Type 3 button components normalize to `component` only for exact custom IDs `command:balance`, `command:zoo`, `command:help` and `component_type:2`. No substring parsing or arbitrary custom ID can invoke `daily`, `hunt`, or a mutating economy action. Unsupported component types/IDs fail before RPC. Each supported component uses its own interaction ID, never the source message ID. Reactions/chat XP remain reserved future event types and cannot enter `/relay` in H01.

### HTTP and authentication

Only `POST /interactions`, legacy `POST /`, and `POST /relay` exist; other paths/methods return 404. Both transports enforce a 16,384-byte raw-body maximum while consuming the stream, including chunked bodies; a Content-Length hint alone is insufficient. Reject malformed UTF-8/JSON. Authenticate raw bytes before JSON parsing. Signature timestamps are decimal Unix seconds with absolute difference from server time at most 300 seconds (inclusive); future timestamps outside the window fail too. Timestamp freshness is this application's replay hardening, not a claim that signature cryptography supplies freshness itself.

Discord uses `X-Signature-Ed25519` (128 hex characters), `X-Signature-Timestamp`, and the configured 64-hex-character public key. Verify Ed25519 over concatenated timestamp ASCII bytes and the exact raw request bytes, **without a separator**. Preserve exported `verify(request,body,publicKey)` for existing consumers; an optional fourth `nowSeconds` test seam may be added, with production default clock. Missing/malformed/stale signatures return 401. Signed type-1 PING returns `{type:1}` before guild-specific command normalization. PING does not authorize an economy command. [Discord's official overview](https://github.com/discord/discord-api-docs/blob/main/developers/interactions/overview.mdx) describes signature headers and the 401 failure requirement.

Relay envelope, all keys required and all unknown top-level keys rejected:

```json
{"version":1,"eventId":"123456789012345678","userId":"234567890123456789","guildId":"345678901234567890","channelId":"456789012345678901","commandName":"daily","args":[]}
```

Gateway supplies `X-Relay-Timestamp` and `X-Relay-Signature` (64 hex characters, no algorithm prefix). Signature is HMAC-SHA256 with the UTF-8 bytes of `RELAY_SHARED_SECRET`, over timestamp ASCII bytes, one literal period byte (`.`), then the exact transmitted raw body bytes. Do not parse/re-serialize before verification. Use Web Crypto HMAC verification; avoid ordinary string comparison of MACs. The shared secret must contain at least 32 UTF-8 bytes and be a randomly provisioned secret, never a checked-in example. Do not trim secret values as part of signing. Missing/invalid/too-short secret configuration fails with 503; missing/invalid authentication fails 401. HTTPS is required for deployed relay URLs. HMAC authenticates the trusted Gateway process, not individual Discord users; a compromised Gateway can impersonate guild members, so isolate its credentials.

Worker validates required configuration before economy work: allowed guild syntax, Discord public key syntax for interaction ingress, relay secret for relay ingress, Supabase HTTPS URL and non-placeholder service-role secret when a command requires RPC. Reject known template placeholders; never log keys, signatures, authorization headers or entire event payloads. No bot token, self-bot token or privileged user token enters the Worker.

### Receipts, response and retries

`receiptId` preserves existing raw snowflake interaction IDs for slash/components. Relay event `eventId` is the original Discord message snowflake; receipt ID is literal `relay:` plus that ID. It must remain unchanged across transport retries and command aliases. This namespace cannot collide with Discord snowflake interaction IDs. RPC receipt scope remains global ID plus bound guild/user/canonical action; channel is delivery metadata. An existing receipt with a different scope is rejected, with no grant. Gateway must not change `eventId` to bypass retries. Never accept arbitrary relay receipt strings or caller-supplied RPC action overrides.

For slash/components, retain deferred type-5 ACK, perform RPC in `waitUntil`, then PATCH the original interaction response using its transient webhook token; disable mentions. Help may reply immediately. Complete initial ACK within Discord's 3-second deadline. Webhook failure can leave an acknowledged interaction without visible output; log only status and document this delivery limitation. RPC failure returns a generic retry message, never database internals.

For prefix commands, return HTTP 200 synchronously with exactly `{content:<text>,allowed_mentions:{parse:[]}}`; Gateway sends that result to the validated channel exactly once. Worker does not call Discord message APIs for prefix commands. Help uses the same response shape without RPC. A bounded relay RPC timeout should produce HTTP 503 `{error:"upstream_unavailable"}`. On ambiguous transport failure the Gateway may retry the **same** envelope/event ID for the database result, but must not automatically resend a Discord command reply: receipts guarantee economy idempotence, not exactly-once message delivery. No automatic retries with a fresh receipt or queue redelivery are authorized. H01 implements no Gateway transport; this is its Sprint 2 contract.

HTTP failures are JSON `{error:<code>}`: 400 `invalid_request`, `unsupported_command`, `unsupported_component`; 401 `unauthorized`; 403 `forbidden_guild`; 413 `body_too_large`; 503 `misconfigured`, `upstream_unavailable`. Legacy Discord user-facing unsupported-command wording may be retained only if no RPC runs; machine-readable relay failures follow this table. Do not expose caught exception text. All successful message payloads disable automatic mentions.

### Gateway runtime and hosting decision (Sprint 2)

Select a thin Node.js Gateway for Sprint 2 to reuse the project's JavaScript contracts and maintain one language across ingress. This is a maintainability choice, **not a measured RAM advantage** over Go. It owns Gateway heartbeat/reconnect/session state, intent configuration, prefix recognition and Discord send permissions; the Worker owns authorization and database access. A persistent Gateway process is required for message events; a request-driven Worker cannot replace its WebSocket lifecycle. Measure actual Node RSS (idle/connected and during reconnect/load), CPU, reconnect recovery and delivery behavior before accepting a RAM/uptime budget. Compare a Go relay only if Node measurements miss the agreed host budget; no fabricated benchmark figures.

Free-tier support is a capacity target. [Cloudflare's current limits](https://developers.cloudflare.com/workers/platform/limits/) give the Free plan 10 ms request CPU and 100,000 daily requests; network waits are excluded from CPU, but deployed cryptographic ingress CPU remains unmeasured. [Fly's currently served free-trial documentation](https://docs.fly.io/about/free-trial) describes $1 credit valid for seven days, with trial Machines stopping automatically after five minutes; resources stop when credit expires. This is a trial, not ongoing free hosting. Do not describe Fly as perpetual free Gateway hosting. Supabase inactivity pausing and the earlier database capacity constraints still apply. No provider has been deployed or load-tested by this specification.

PO integration review after architect lock release: [Koyeb Free](https://www.koyeb.com/docs/reference/instances) is one web-service instance per organization and cannot be used as a Worker Service; it sleeps after one hour without traffic. [Scale-to-zero](https://www.koyeb.com/docs/run-and-scale/scale-to-zero) considers inbound Internet traffic/connections; an outbound Discord Gateway socket alone does not establish a wake-up path. Koyeb free is therefore not accepted as a guaranteed always-on relay host. Wispbyte remains unverified. Final provider selection belongs to Sprint 6.
