# Local testing and configuration — 2026-11-09

User request: make local validation and credential placement clear before considering deployment. The audited daily spec is preserved.

Implemented:

- `rebuild/.env.example`: all local configuration in one file, including guild ID, Discord public key, Supabase project URL/backend API key, relay HMAC secret, bot token and application ID. The real `.env` is gitignored. The earlier split templates were removed at the user's request.
- `npm run dev` binds the local Worker to `127.0.0.1:8787`; `npm run local:command -- <command> <user-id> <channel-id> [event-id]` reads `.env`, signs the relay envelope, prints its event ID for safe retries and displays the response. It accepts only a loopback destination, with optional `OWO_LOCAL_PORT`.
- `npm run register:commands` reads the same `.env`; it is never part of dev or tests.
- Worker supports new Supabase `SUPABASE_SECRET_KEY` values in the apikey header, with legacy service-role JWT fallback. New-key configuration errors fail closed.
- `rebuild/LOCAL_DEVELOPMENT.md` explains setup, automated tests, manual daily/replay checks, migrations, credential roles and deployment preparation in Vietnamese; linked from the README.

Validation: Node 24.22.2, Wrangler 4.158.0. Node tests 98/98, latest PostgreSQL core 16/16 and bonuses 15/15, local Workers runtime/CLI 7/7, packaging dry-run passed. The runtime checks read a temporary env file using synthetic keys and contact no external game service. Restricted sandbox runtime startup failed; the permitted local runtime run passed outside that sandbox. PostgreSQL containers cleaned up.

No bot token or real database key was supplied or printed. An ignored `.env` was created from the blank template for the user to fill. Supabase Data API/Discord integration is not validated against live services. For manual daily calls, the user must configure a separate Supabase development project and apply migrations 001 → 002 → 003. The Worker uses HTTPS RPC rather than a PostgreSQL connection string; no script reads `DATABASE_URL`. Prefix `owo ...` remains dependent on Sprint 2 Gateway work. No deployment or command registration was performed.
