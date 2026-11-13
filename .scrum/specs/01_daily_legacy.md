# DAILY legacy extraction

Source of truth: read-only legacy files. No root modules loaded. Paths/lines below refer to repository files. This documents observed behavior; private-server adaptations require explicit architecture decisions.

## Base claim

- Command: `daily`, no arguments, nominal invocation cooldown **5000 ms**; daily entitlement is a separate calendar-day gate. Requires sendMessages/embedLinks/attachFiles. Source: `src/commands/commandList/economy/daily.js:23–41`.
- Legacy identity/balance is global per Discord user (`cowoncy.id`), not per guild. `daily_streak` starts at 0; legacy schema uses an old timestamp default for daily. Source: `secret/CREATE-OWO-TABLES.sql:431–440`.
- Let `s` be stored streak or 0. If `afterMidnight(last_daily).withinDay` then `new_s=s+1`; otherwise `new_s=1`. **Current `overrideWithinDay=true` means every prior claim before today's midnight increments the streak even after long absences. It does not reset for missed days.** A truly absent last_daily has no withinDay flag and yields 1. Sources: `daily.js:369–391`; `src/utils/dateUtil.js:12,33–43,61–86`.
- Sample independent JS `Math.random()` value `U∈[0,1)`. `gain=min(500+floor(U*200)+25*new_s,5000)`. First claim: **525–724 inclusive**. Stored streak counts claims (1 on first claim), while normal success text displays `new_s-1` only when positive. Sources: `daily.js:118–123,378–389`.
- Resolve supporter rank on server. If `benefitRank>=3`, `extra=gain`; otherwise 0. Total currency `gain+extra`: cap **5000 ordinary / 10000 eligible supporter**. External entitlement resolution, expiry and cache are in `src/commands/commandList/patreon/utils/patreonUtil.js:104–190`; never accept rank from command options.
- Independently sample box RNG: `U<0.5` grants **one lootbox**, otherwise **one standard weapon crate (`cratetype=0`)**. This is guaranteed one item per successful claim, not a chance of no item. Sources: `daily.js:394–410`.
- Successful claim adds **100 global XP** via Redis sorted-set user_xp; does not call chat XP cooldown/limit or level-reward distribution. Sources: `daily.js:226`; `src/utils/levels.js:86–89`.
- Persist money, streak, last_daily, item grant and response atomically in rebuild. Legacy updates cowoncy first with optimistic `daily_streak=old_s`, then separately executes side-effect SQL; do not reproduce its partial-commit failure mode. Sources: `daily.js:75–90,162–179`.

## Calendar gate / ambiguity

- Description says **12am PST**, but implementation builds midnight in **host-local timezone** using JS Date constructor. No timezone identifier is established by daily.js/dateUtil.js. Do not claim confirmed UTC/PST/Los_Angeles production behavior from this code alone. Sources: `daily.js:28`; `dateUtil.js:17–20`.
- `after=false` iff `midnight-last_daily<=0`, including exact midnight and future timestamps. Missing timestamp is claimable. Remaining time is computed to local midnight+86400000, which assumes a 24-hour day and has DST caveats. Source: `dateUtil.js:20–28,33–59`.
- `withinDay` nominal threshold is **172810000 ms** (48h + 10s) from today's midnight, then overridden true anyway. Preserve the effective no-reset streak policy unless a documented product change says otherwise. Source: `dateUtil.js:61–85`.
- UTC day in existing rebuild is a prototype policy, not established legacy parity. Architect must choose/document an explicit server timezone for stateless SQL; use DB-owned clock and real timezone date boundaries (no client-supplied claim time).

## Marriage and event integrations (separate dependency slice)

- Marriage rewards require a marriage row and both users' daily timestamps. Normal claim path requires the marriage date before today's midnight and partner already claimed today. Grants bonus to **both** users and increments marriage.dailies/claimDate. Source: `daily.js:413–446`.
- Bonus uses stored pre-claim streaks: `min(round_JS(100+floor(U*100)+12.5*(streak1+streak2)),1000)`. Valentine doubles result after cap, max 2000 each. Positive JS rounding means `.5` rounds upward. Source: `daily.js:359–366`.
- Normal marriage grant gives each spouse 1 identical independently selected 50/50 lootbox or standard weapon crate. Valentine raises this count to 2 and additionally gives each spouse 1 independently selected 50/50 lootbox or crate. Thus three marriage items each on Valentine, plus claimant's base daily item. Source: `daily.js:454–501`.
- Already-claimed daily has a marriage catch-up branch when both spouses claimed today and marriage.claimDate is older. It optimistically increments marriage.dailies before crediting both. This branch omits the normal marriedDate gate and contains an apparent duplicate `id2` lootbox insert at line 326. Preserve intended mechanics in a future marriage spec, flag rather than blindly copy this bug. Source: `daily.js:276–346`.
- Valentine is active event type equality, not automatically a fixed calendar date: `src/utils/eventUtil.js:143–145`; static windows in `src/data/event.json`. No base daily currency Valentine multiplier outside marriage.

## Other integrations / presentation

- Latest announcement eligibility/acknowledgement and optional image; active survey eligibility/start reset and Answer Survey button. Sources: `daily.js:112–115,143–152,181–207,229–273`.
- `alterDaily.alter` replaces display/cooldown/marriage text for entitled customizations; it does not change currency math. Source: `src/commands/commandList/patreon/alterDaily.js:9–45`.
- Success includes currency, displayed streak, supporter bonus, box, optional marriage/survey and time to reset. Already claimed normally returns countdown; generic middleware/rules/anti-macro are outside daily formula.

## Recommended 30-minute slice

Implement independently testable **ordinary-player core daily**: explicit documented timezone, effective persistent streak, exact capped reward range, guaranteed 50/50 item, +100 XP, DB transaction/row lock, interaction receipt. Include deterministic boundary fixtures, duplicate interaction and distinct-interaction concurrency tests. Do not label whole legacy daily complete until entitlement, marriage/event, announcements/surveys/custom display dependencies are ported. If entitlement/XP/item schemas are deliberately deferred, list each omission in the board and response rather than silently claiming parity.
