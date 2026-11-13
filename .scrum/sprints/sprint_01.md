# Sprint 01 — daily core

- Start: 2026-11-08 18:25 UTC. Maximum timebox: 30 minutes.
- Goal: replace the daily coin placeholder with a source-cited atomic core slice, and establish repeatable migration/testing practices.
- Selected: F01 (1 SP), D01 (3 SP), Q01 (2 SP). Scope is a forecast; unfinished validation is carried over openly.
- Team: PO/PM lead, Legacy Scout, BA/Architect, Serverless Dev, QA/Security; roles run in available concurrency slots. Requested older model tiers unavailable.
- Baseline: tracked legacy unchanged; `rebuild/` and an existing `temp` untracked. Root dependencies absent. Baseline Worker signature tests pass; full PG tests not yet run.

## Decisions and handoffs

- Read-only reference for all legacy files, including its known Redis defects and stub anti-macro. Do not fix them in place.
- Scout extracts exact behavior before Architect finalizes a port slice. Missing integrations are explicit backlog items.
- Core discovery: daily has randomized reward/streak, host-local midnight and additional reward side effects; +100 is not parity.
- QA investigates a real PostgreSQL test route; no fake database pass or unmeasured performance claim.
- F01 accepted: source-cited legacy extraction and architecture written; daily core includes reward, persistent streak, exactly one box and 100 daily XP. UTC and guild-local identity are explicit adaptations; supporter/marriage/event/presentation integrations are deferred.
- Local Docker access was approved and works; QA is preparing real PostgreSQL tests. Endpoint suite expanded from 3 to 10 passing cases.
- D01 implementation ready for QA: additive 002, private deterministic reward/day helpers, scoped receipts, owner-managed timezone, source-aligned counters. Worker and 001 remain unchanged. Local test runtime is Node 24 with visible case reporting.

## Review

- Closed: 2026-11-08 18:34 UTC; approximately 10 minutes from recorded start, within the 30-minute cap. Individual command durations were not instrumented.
- Accepted: F01, D01 and Q01 (6 forecast SP); ordinary-player daily core only. Source specs, additive migration 002, setup instructions and test commands are reviewable locally.
- Evidence: [QA report](../QA_TEST_REPORT.md). `npm test --prefix rebuild`: 16/16 signed HTTP cases pass (outbound transport mocked). `node rebuild/test/run-postgres.mjs`: 16/16 real PostgreSQL 17 checks pass, none skipped. The equivalent DB npm script is `npm run test:db --prefix rebuild`.
- DB coverage includes two observed blocked concurrent sessions, matching/mismatched receipt identity, post-lock timestamp, rollback of all rewards on forced receipt failure, deterministic reward bounds/cap, both seeded box branches, DST/calendar boundaries, fail-closed timezone, permissions and negative-state rejection. QA container cleanup confirmed.
- Independent Architect review: no blocking issue found in SQL, privilege handling or lock order. Lead reviewed specs/implementation and independently reran final HTTP suite. Protected legacy/root tracked files have no diff; root `node_modules` remains absent; existing `temp` untouched. Worker source and migration 001 were not changed.
- Release gates still open: deployed Discord/Supabase integration, Cloudflare CPU <10 ms, free-tier load/availability, backups/restore, receipt retention/retries and rebuild CI compatibility. No deployment or command registration performed. Full daily parity and hunt/battle/economy remain backlog work.
- Next sprint candidate: H01 extracts exact hunt cost/RNG/gems/cooldowns, then scopes a small atomic H02 port. Do not implement hunt from invented probability tables.

## Retrospective

- Source extraction prevented two mistaken assumptions: fixed +100 daily and automatic streak reset. Host timezone ambiguity is explicit rather than guessed.
- Separate Node test discovery from the standalone Docker runner; otherwise file-level runner output can hide a failed harness. Keep HTTP cases and actual PostgreSQL checks distinct in reports.
- Concurrent-session tests must observe lock waiters and verify committed state, rather than infer race safety from sequential mocks.
