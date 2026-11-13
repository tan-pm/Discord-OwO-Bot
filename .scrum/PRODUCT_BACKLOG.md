# Product backlog

Goal: migrate OwO into an interaction-driven Workers + Supabase application for a private guild, with no paid dependencies. Free-tier viability and legacy parity require evidence; neither is assumed.

## Working agreement

- `src/`, `secret/`, `index.js`, root manifests and dependencies: read-only reference. Never install root dependencies.
- All new code, tests, migrations and project records: `rebuild/` or `.scrum/` only. Leave existing `temp` untouched.
- Source-cited mechanics before implementation; preserve quirks unless an explicit adaptation is recorded.
- 30-minute maximum sprint timebox, not a guaranteed completion time. Unfinished stories return to the backlog; record actual elapsed time.
- Runtime cannot select the requested GPT-4o/o3/o4-mini tiers. Roles use the available inherited model; no claim of model switching.

## Definition of Done

1. Acceptance criteria and source references are recorded; parity gaps are explicit.
2. Only permitted paths changed; no credentials committed or logged.
3. Signature verification, guild restriction and atomic receipt behavior remain covered.
4. `npm test --prefix rebuild` passes with visible case counts.
5. Changed database behavior is exercised on PostgreSQL: double claims, replay, concurrent calls, boundaries and rollback. A harness without execution is not a pass.
6. Setup/migration and QA evidence updated; no deployment or CPU/free-tier claim without measurements.

## Ordered stories

Points are relative complexity, not minutes. Large epics are discovery work until decomposed into the following small slices.

| ID | Epic / story | SP | Acceptance criteria | State |
|---|---|---:|---|---|
| F01 | Foundation: mechanics and architecture | 1 | Source-cited daily rules; explicit timezone/parity decisions; RPC and locking conventions | Done (Sprint 01) |
| D01 | Daily core: remove +100 placeholder | 3 | Legacy base reward and persistent streak; atomic claim + receipt; timezone explicit; related reward counters per architecture | Done (Sprint 01) |
| Q01 | Daily and endpoint regression evidence | 2 | Signature/guild/deferred tests pass; executable PG boundary/concurrency/rollback coverage; results truthful | Done (Sprint 01) |
| D02a | Daily economy bonuses | 3 | Owner-managed supporter privileges, atomic marriage/catchup/Valentine, multiplier/cap and concurrency proof | Done (Hybrid Sprint1) |
| D02b | Daily external integrations/presentation | 3 | Live billing sync, social marriage APIs, announcement/survey/custom display and full legacy presentation | Backlog |
| H01 | Hunt discovery | 1 | Exact costs, RNG/drop tables, gems, cooldowns and zoo metadata extracted | Backlog |
| H02 | Hunt core transaction | 3 | Implements H01 slice; insufficient funds, replay and concurrent hunt tests | Depends H01 |
| H03 | Zoo data and display | 2 | Species inventory persisted; count/rank/sort parity fixtures | Depends H02 |
| E01 | Economy ledger and transfers | 3 | Integer money, atomic debit/credit, no negatives, scoped idempotency, ownership tests | Backlog |
| I01 | Inventory, sell and shop discovery | 1 | Price/quantity/ownership rules extracted; implementation split by command | Backlog |
| B01 | Battle discovery and deterministic fixtures | 2 | Turn order, formulas and RNG seams documented; weapons/buffs split into independent stories | Backlog |
| G01 | Gambling discovery | 1 | Stake limits, odds and payout formulas per command; separate implementation stories | Backlog |
| S01 | Quests/ranking/social discovery | 1 | Dependency map and parity matrix; each command sliced before coding | Backlog |
| P01 | Security and operations | 2 | Retry/timeout policy, receipt retention, permissions, backup/restore and secret handling verified | Backlog |
| P02 | Free-tier and CPU release gate | 2 | Current provider limits sourced; Worker CPU measured under representative load; no paid components enabled | Backlog |
| F02 | Rebuild validation pipeline | 1 | Independent Node 24 Worker + PostgreSQL checks reproducible; existing root Node 15/CommonJS lint pipeline compatibility assessed without modifying legacy | Backlog |

No promise of full feature parity or production readiness in Sprint 01.

## Hybrid architecture amendment — 2026-11-08
Target now locked: thin Gateway relay + unified Cloudflare Worker + Supabase atomic economy.
Sprint 1 extends the prior core: normalized contracts, authenticated relay ingress, strict config, supporter/marriage/Valentine daily reward state and parity/concurrency QA.
| Sprint | Goal | State |
|---|---|---|
| 1 | Scrum registry/shared context, unified ingress, real daily via slash/prefix transport | Done locally; awaiting user sign-off |
| 2 | Thin Gateway prototype; original hunt/zoo metadata and collection | Backlog |
| 3 | Row-locked give/cowoncy; shop/inventory/buy | Backlog |
| 4 | Lootboxes, gems and passive chat XP batcher | Backlog |
| 5 | Weapons and stateless turn-based battle; persistent button sessions | Backlog |
| 6 | Anti-macro verification and measured free-tier deployment pack | Backlog |
The six sprint goals are scope forecasts; a 30-minute sprint cannot guarantee full parity.
Server-owned privilege/pair setup reproduces reward semantics, not billing/social integration APIs.

Hybrid Sprint1 accepted evidence:89 unit/HTTP/contract +31 latest PostgreSQL +5 local Workers runtime checks pass; historical core16 also passed. See report/hybrid-sprint-01.md. Prefix transport is ready, but actual Gateway prefix commands await Sprint2. No deployment or next sprint started.
