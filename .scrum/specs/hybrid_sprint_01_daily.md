# Hybrid Sprint 01: audited daily behavior and implementation boundary

Audited 2026-11-08 directly from read-only legacy files: `src/commands/commandList/economy/daily.js`, `src/utils/dateUtil.js`, `src/commands/commandList/patreon/utils/patreonUtil.js`, `src/utils/eventUtil.js`, `src/data/event.json`, `src/utils/levels.js`, and `src/commands/commandList/patreon/alterDaily.js`. Existing specs remain preserved. This document describes legacy facts; it does not claim these integrations exist in the rebuild.

## Daily core and clock

- Claim is available when previous daily timestamp is strictly before today's process-local midnight; absent timestamp is eligible. At exactly midnight a stored timestamp equal to midnight is ineligible (`midnight - stored <= 0`). Future timestamps also block.
- Legacy uses JavaScript process-local timezone, not an explicit PST conversion despite command description. Next-midnight/countdown is local midnight plus exactly 86,400,000 ms, so DST transitions are not calendar-aware. Rebuild UTC/configured timezone is an explicit adaptation.
- `afterMidnight` returns current SQL timestamp, now, next-midnight and truncated countdown. `withinDay` is true if elapsed from stored timestamp to today's midnight is positive and <=172,810,000 ms. For a longer elapsed time it returns `overrideWithinDay || false`; the live constant is **true**. Thus any prior claim, however old, preserves and increments streak. No timestamp returns no `withinDay`, so first streak is 1.
- New stored streak = previous stored streak + 1 when `withinDay`, otherwise 1. No cap on stored streak. Displayed streak = new stored streak - 1 and is displayed only when positive. Preserve this distinction in response fields.
- Draw U uniformly in [0,1): base reward = `min(5000, 500 + floor(U*200) + newStoredStreak*25)`. First claim range 525–724. Cap applies before supporter bonus.
- Supporter extra = base reward when resolved benefitRank >=3, otherwise 0. Total credited to claimant = base + extra (maximum 10,000); supporter does not double XP or boxes.
- Independently draw one box: U<0.5 gives one lootbox, otherwise one weapon crate (type 0). Every successful personal daily gets exactly one core box.
- After response send, `giveUserXP(id,100)` increments **global** Redis XP only. It does not apply normal chat XP cooldown, daily cap, guild XP, or level-up distribution. This is not awaited by daily.js. Rebuild atomic player XP100 is a deliberate reliability/storage adaptation.
- Legacy personal balance/streak/timestamp UPDATE compares the previously read streak to reject concurrent claims; ancillary SQL then executes separately. Failed personal claim grants no box/XP. It is not a transaction, and partial failures are possible. Rebuild must keep reward/receipt/state updates atomic rather than duplicate this failure mode.

## Supporter entitlement resolution

`getSupporterRank` chooses highest unexpired benefit rank across three sources; equal ranks use latest end time. Expiry check rejects endTime < current time (equality passes fresh resolution). Sources: `patreons` start=`patreonTimer`, end via JavaScript `setMonth(start.month + patreonMonths)`, rank=`patreonType`; every `patreon_wh` row rank/type and endDate; first `patreon_discord` row rank/type and endDate, but active=true synthesizes end one month from now. Discord entitlement ingestion assigns rank 3 for SKU 1164099862984400926.

User-object cache refreshes after 24h; cached rank with future end time returns immediately. Expired cache sets rank0/end null and returns for updateDiff<=20 seconds, otherwise rereads storage. Resolver also modifies unrelated pet-team enabled state; that side effect is not part of daily reward semantics.

Hybrid supportable boundary: trusted DB-managed per-user privilege with numeric rank and valid-until timestamp can reproduce **reward eligibility**. Ordinary relay JSON, command args, Discord display roles, client-supplied rank/clock cannot authorize benefits. Actual Patreon/Discord billing synchronization, historical entitlement import, cache parity, and pet-team changes remain integration features unless explicitly implemented and tested. Do not label a manual server privilege as live Patreon integration.

## Marriage reward (both ordinary and catch-up paths)

A marriage references both user IDs/UIDs, both daily timestamps and stored streaks, marriedDate, claimDate, cumulative `dailies`, ring ID.

Ordinary path runs while personal daily is eligible. Marriage must exist and both previously stored personal daily timestamps must exist. Current day must be after marriedDate's calendar day; partner must already have claimed today (`afterMidnight(partnerDaily).after === false`). It reads **both pre-update streaks**, including claimant's previous streak, and uses them in formula:

`marriageEach = min(1000, round(100 + floor(U*100) + (storedStreak1+storedStreak2)*12.5))`.

During Valentine this capped amount is multiplied by 2, allowing 2,000 each. Both spouses receive this amount. Marriage claimDate becomes current SQL time; dailies increases by 1. Ordinary legacy path lacks explicit claimDate check or marriage-row compare-and-swap; rebuild must guard once per pair per date atomically and lock both player rows in stable order if implementing it.

Ordinary marriage boxes: start count=1; independently choose one shared type (50/50 lootbox/crate) and give **count of that type to each spouse**. Core daily's one box remains additional and only for claimant. During Valentine: first independently choose one shared type and give one extra box of that type to each spouse; also increment count to 2 before ordinary marriage roll. Thus Valentine grants **three marriage boxes per spouse** (one extra roll + two from ordinary roll), not merely two. Two rolls may select same or different types.

Catch-up path runs when claimant already claimed personal daily today. Requires marriage and both personal timestamps, claimDate before current day, and both personal daily timestamps today. It compares marriage `dailies` in UPDATE; only winner proceeds. Unlike ordinary path it does **not** check marriedDate. Money formula and Valentine extra/count behavior match ordinary path. It sends marriage-only response and no core money, core box, XP or announcements.

Known catch-up defect: normal lootbox SQL inserts `(marriage.id2,count)` **twice**, never id1; depending on existing-row duplicate updates this may credit partner2 twice, not both partners. Crate path targets both correctly. Do not reproduce this defect; document deliberate correction if marriage implemented. Legacy mutation of marriage row precedes secondary reward query and can partially fail.

Marriage display uses ring emoji/name, partner username (fallback `your partner`), pre-increment marriage.dailies for custom text. Ring does not affect reward formula. Full marriage parity requires authoritative pair relation, partner row access, pair claim ledger and transactional rewards, not a caller-provided boolean.

## Valentine timing dependency

`isValentines()` is true only when `getCurrentActive()?.type === 'valentine'`. Active test is strictly `start < Date.now() < end`; endpoints excluded. Events are converted from strings to timestamps at module import. First active event in JSON insertion order wins if overlap; past entries are removed/rebuilt lazily. This is configured event schedule, **not recurring Feb 14**.

2023 entry named `valentine` lacks a `type`, therefore does not satisfy predicate. 2024 entry `2024_valentines` has type valentine, start 1707897600000 and end 1708588800000. All bundled schedules end in 2024, so at audit date no Valentine daily bonus is active. Do not silently add yearly recurring dates. A rebuild event toggle/window must be server-controlled, explicitly configured, and default inactive. Other event random drops/items are outside daily.js reward path.

## Non-reward presentation/integration behavior

- Announcement: latest announcement shown unless user row marks latest seen or disabled. Successful daily records latest announcement and may attach latest URL image; for newly created cowoncy account legacy suppresses initial announcement embed via execution argument.
- Survey: offered when an unexpired survey exists, unless user has in-progress survey or latest survey completed. Successful daily sets user_survey latest sid, question_number1/in_progress0 and emits `survey` button. Survey reward itself is not granted by daily.
- Custom daily templates: `alterDaily` selects display/marriage/cooldown template and supplies amount including supporter extra, displayed streak, box, timer and marriage fields. It changes presentation, not reward formula. Announcement/survey integrations and customized template storage may be deferred, but must be marked deferred rather than claimed as bonus parity.
- Command legacy cooldown5000, half100/six500 and bot=true are command metadata, not extra daily currency formulas. Relay authentication, replay protection, interactions and normalized context are hybrid ingress work, not legacy bonuses.

## Acceptance boundary

Core + trusted server-managed supporter privilege is a feasible Sprint 1 slice if migration and concurrency tests cover eligibility/expiry, doubled capped money, untouched box/XP, live no-reset streak and receipt replay. Marriage/Valentine can only be marked implemented when authoritative data model and all pair/box/catch-up cases are actually tested. Until then report them as audited deferred integrations. Preserve exact formulas above even when reducing scope; never claim full daily bonus parity from core alone.
