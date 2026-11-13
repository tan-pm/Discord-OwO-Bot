# Shared project context
Updated 2026-11-08. Sprint H01 (requested Sprint 1 hybrid extension) starts 18:47 UTC; deadline 19:17 UTC.
Prior daily-core Sprint 01 artifacts and migrations already exist; preserve and extend them.
## Architecture decision
Hybrid: thin stateless Gateway relay -> authenticated Worker -> atomic Supabase RPC.
Discord HTTP interactions and relay commands normalize to the same command context.
Legacy src/ and secret/ are STRICTLY READ ONLY. Never print secret/env contents.
No deployment or external command registration in Sprint 1.
## Existing state
rebuild/src/worker.js handles Ed25519 signed interactions; play(interaction,guild,player,action) returns text.
rebuild/migrations/001_core.sql and 002_daily_core.sql define players, receipts, game_config and daily helpers.
players keyed by (guild_id,user_id), stores balance, daily_at, daily_streak, xp, lootboxes, weapon_crates.
receipts bind id to guild/user/action; play locks receipt advisory key then player row, writes atomically.
Current daily core uses 500+floor(random()*200)+25*streak capped 5000, grants XP100 and one 50/50 box.
Legacy dateUtil overrideWithinDay=true means streak never resets; configurable timezone defaults UTC adaptation.
Existing tests: rebuild/src/worker.test.js and rebuild/test/run-postgres.mjs (Docker PostgreSQL).
## Sprint 1 target
Shared NormalizedCommandContext: userId,guildId,channelId,commandName,args,triggerType,interactionId.
Architect freezes exact ingress/auth/RPC/response contracts before implementation.
POST /interactions (and legacy /) signed Ed25519; POST /relay HMAC with timestamp and scoped receipt id.
Fail closed on placeholder/missing guild config; no trust in relay-supplied rewards, clock or rank.
Components normalized but only explicitly supported handlers execute; reactions/XP reserved for future sprints.
Full bonus scope and legacy limitations must be documented honestly, never described as full parity without evidence.
## Ownership and handoff
PO alone writes PROJECT_CONTEXT, registry, board, backlog and sprint logs.
Architect owns ARCHITECTURE_SPEC and rebuild/src/contracts/.
Scout owns .scrum/specs/ except anti_macro_and_balance.md reserved for later specialist.
DB owns rebuild/supabase/ only; existing migrations remain intact.
Engine owns rebuild/src/ excluding contracts/, ui/, middleware/guard*, and all tests.
QA owns rebuild/test/, QA_TEST_REPORT and (explicit handoff) existing rebuild/src/worker.test.js.
PO owns rebuild/package.json, wrangler.toml, README.md and final integration only after owner release.
Gateway and balance roles inactive Sprint 1; four maximum simultaneous agents including PO.
Read this file before acting. Never edit another owner's files; communicate contract changes through PO.
## Environment
ALLOWED_GUILD_ID, DISCORD_PUBLIC_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RELAY_SHARED_SECRET.
Actual model routing uses currently supported equivalents; requested historical tiers unavailable.
Free-tier compatibility is a target; host availability, uptime and deployed Worker CPU unverified.
## Frozen ingress handoff
contracts/commands.js exports normalizeRelay, normalizeInteraction, rpcParams, receiptId, assertAllowedGuild, ContractError, messagePayload.
Relay body exactly {version:1,eventId,userId,guildId,channelId,commandName,args:[]} with string snowflakes.
Headers x-relay-timestamp (Unix seconds), x-relay-signature (hex HMAC SHA256); signed timestamp+'.'+rawBody; ±300s freshness; secret >=32 UTF8 bytes.
Body max16KiB. Prefix receipt is relay:eventId; Discord interaction keeps raw id; play scope binds guild/user/action.
Relay returns synchronous safe Discord message JSON; future relay sends it. Worker needs no bot token.
Components only read-only command:balance, command:zoo, command:help buttons this sprint; unsupported mutations fail closed.
PO also owns report/* per user's new instruction; final notes report/hybrid-sprint-01.md.

## Implementation handoff for QA
Migration003: supporter_entitlements(guild_id,user_id,benefit_rank,expires_at); marriages(guild_id,user1_id,user2_id,married_at,claimed_at,dailies).
game_config adds Valentine enabled/optional strict start/end window; defaults inactive.
Supporter/marriage/event state SQL-owner only; public/anon/authenticated/service_role cannot mutate it.
play acquires receipt lock -> per-guild marriage advisory gate -> marriage row -> player rows sorted C collation.
Guild serialization is initial safety tradeoff; reassess throughput before broad rollout. Owner administration obeys same gate.
Supporter doubles only base coins, marriage pre-update streak formula/cap, catchup once/day, Valentine3 shared-type boxes per spouse.
Prior migrations remain unchanged; apply001 ->002 ->supabase/migrations/003. See supabase/README.md.
Signed Discord PING can work without guild/DB/relay config; every actual command enforces configured guild.
Wrangler4.158.0 local dry-run passed; this is packaging evidence, not deployment or runtime CPU validation.

## Sprint1 acceptance and stop state
All seven HY stories accepted locally.89/89 Node tests; latest PostgreSQL16 core+15 bonus; baseline16; local workerd5; packaging dry-run passed.
All test containers and local runtime processes cleaned up. All subagent locks released after explicit handoff.
Independent read-only architecture/security/concurrency review found no blocking issue; full lock order consolidated in ARCHITECTURE_SPEC.
No deployment/command registration, live provider roundtrip or Gateway process. Prefix endpoint tested; live owo commands wait for Sprint2 relay.
Latest setup instructions and migrations documented. Backups, retention, anti-macro and free-tier runtime measurements remain release gates.
Final report report/hybrid-sprint-01.md; pause for user sign-off. Do not start Sprint2 without user direction.
