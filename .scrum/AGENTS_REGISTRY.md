# Agents registry — Sprint 1 hybrid extension
Four runtime slots including PO. Roles execute in waves; directory locks are exclusive.
Historical model names in directive are unavailable; record available actual model per agent.

| Role | Actual model | State | Exclusive writes |
|---|---|---|---|
| PO / Scrum Master | inherited current model | Sprint complete; awaiting user sign-off | PRODUCT_BACKLOG.md, SPRINT_BOARD.md, PROJECT_CONTEXT.md, AGENTS_REGISTRY.md, sprints/*; report/*; rebuild package/config/docs |
| Legacy Scout | gpt-6.1-sol | Complete; lock released | .scrum/specs/* except anti_macro_and_balance.md |
| Chief Architect | gpt-6.1-sol | Complete; lock released to PO | .scrum/ARCHITECTURE_SPEC.md; rebuild/src/contracts/* |
| DB & Economy | gpt-6.1-sol | Complete; lock released | rebuild/supabase/* |
| Serverless Engine | gpt-6.1-sol | Complete; lock released | rebuild/src/* except contracts, ui, middleware/guard*, tests |
| Gateway & Discord UX | unassigned | Sprint 2 | rebuild/gateway/*; rebuild/src/ui/* |
| Balance & Anti-Macro | unassigned | Sprint 6 | .scrum/specs/anti_macro_and_balance.md; rebuild/src/middleware/guard* |
| QA & Concurrency | gpt-6.1-sol | Complete; lock released | rebuild/test/*; .scrum/QA_TEST_REPORT.md; existing rebuild/src/worker.test.js by explicit lock |
PO is sole context writer; architect proposes context changes via handoff. Scout excludes balance spec.
Every agent MUST read PROJECT_CONTEXT before work. Legacy src/ and secret/ read-only.
No unassigned directory writes. Release locks before integration fixes by another role.

Final state: all Sprint1 subagents finished; no active implementation locks. Architecture/engine/DB/QA locks released to PO for integration review only. Gateway/UX and Balance roles have not been spawned; assignments remain future-sprint reservations.
