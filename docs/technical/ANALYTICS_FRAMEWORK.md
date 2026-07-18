# Analytics Decision Framework

**Status:** AUTHORITATIVE (Prompt 16 deliverable)
**Owner systems:** `src/systems/Analytics.ts` (pipeline),
`src/admin/retentionStats.ts` (aggregation), `src/admin/main.ts` (dashboard)
**Constitution:** rule 17 (each metric supports a decision), rule 18 (guests
are real players), Prohibited: analytics on critical input paths

## Pipeline invariants (audited 2026-07-18, all holding)

- `track()` is an O(1) enqueue; flushes are debounced-idle + page-hide
  beacon. Nothing touches input or render paths.
- Events carry NO personal identifiers; a regex guard strips
  email/token/auth/password/name-like props at enqueue.
- Offline / unconfigured Firebase degrades to a silent no-op.
- Queue hard-capped at 200 events; one retry lifetime per batch.

## Identity model (the uniqueness contract)

- Every event carries a stable random **guest id** (`gid`, per device) and,
  when signed in, the account **uid**.
- `identity_linked` marks the transition; the aggregator resolves any gid
  ever seen with a uid to that uid, so a converted guest is ONE player and
  rounds are never double-counted (constitution 18).
- **Unique players** = unlinked gids + distinct uids. **Sessions** = distinct
  per-page-load `sid`. **Rounds** = `round_started`/`round_completed` events
  (each exists exactly once regardless of identity).

## Event registry — every event and the decision it supports

| Event | Props | Decision it supports |
|---|---|---|
| `app_open` | — | Session/day activity baseline; D1/D7 return rates |
| `round_started` | course, mode | Course/mode popularity; funnel top |
| `round_completed` | course, mode, score_to_par, round_duration | Completion rate (abandonment); difficulty tuning; session depth |
| `replay_selected` | course, mode | Replay vs Play Next balance → results-screen design |
| `play_next_selected` | course, destination_course, mode | Same decision, other branch; rotation health |
| `daily_completed` | course, streak_length | Daily participation → Live Ops scheduling |
| `weekly_round_completed` | weekly_event, score_to_par | Weekly participation & difficulty → event configuration |
| `streak_advanced` | streak_length | Streak system health; cliff detection |
| `streak_protection_used` | streak_length | Protection-token generosity tuning |
| `mastery_star_earned` | mastery_star_id, course | Star difficulty curve; content gaps |
| `achievement_earned` | achievement_id | Achievement pacing |
| `identity_linked` | — | Guest→account conversion rate → sign-in nudge placement |
| `async_challenge_created` / `_opened` / `_completed` | course / result | Social-loop funnel (share → open → play) |

### Deprecated (removed 2026-07-18; the aggregator tolerates historic rows)

- **`next_course_started`** — fired immediately after `play_next_selected`
  with a subset of its props. Pure duplication; no decision consumed it.
- **`weekly_round_started`** — the weekly funnel decision (participation,
  difficulty) is served by `round_started` + `weekly_round_completed`; the
  started-side split was never consumed by any dashboard.

Deprecation policy: remove the *emitter*; never rewrite stored history. The
aggregator ignores unknown event names by construction (its switch has a
default), so old rows stay harmless forever.

## Metric definitions (dashboard vocabulary)

- **Next-round conversion** — % of `round_completed` events followed by a
  `round_started` later in the SAME session; the follow-up is classified
  Replay vs Play Next by the selection event between them. The primary
  product metric (roadmap Phase 9).
- **Daily participants** — sessions containing ≥1 `daily_completed`.
- **Guest vs signed-in rounds** — identity at event time (uid presence).
- **D1 / D7 return rate** — of players first seen on day X (and for whom a
  full day of observation exists), the % with any event on day X+1 / X+7
  (computed on player-local UTC day keys from event timestamps; added to
  `retentionStats.ts` with this pass).
- **Rounds per session** — `round_started` count / distinct sessions.

## Rules for adding an event (the admission test)

1. Name the decision the metric will change, in one sentence, in the PR.
2. Reuse an existing event + prop if the decision can be derived — derived
   metrics beat new events (this audit's two deprecations both violated
   this rule).
3. Props are flat, small (≤120-char strings), and never identifying.
4. The dashboard change lands WITH the event, or the event doesn't land.
5. Every aggregation is a pure function with unit tests
   (`retentionStats.ts` pattern).
