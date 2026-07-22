/**
 * Admin dashboard (admin.html) — owner-only round statistics.
 *
 * Sign-in gate: Google auth, admitted only when the account email is in
 * ADMIN_EMAILS. This is a UX gate, not a security boundary — the /rounds
 * leaderboard node is world-readable by design (see FIREBASE_SETUP.md), so
 * the page surfaces nothing that isn't already public; the gate just keeps
 * the dashboard out of casual reach.
 */
import { FIREBASE, LEADERBOARD_URL } from '../config';
import { RoundRecord } from '../firebase/History';
import { avgByArchetype, avgByCourse, avgByHole, avgPutts, avgPuttsByHole, guestSummary, overallAvg, roundsByAccount } from './aggregate';
import { aggregateRetention, flattenEvents, RawEventsNode, RetentionStats } from './retentionStats';
import { isAdminEmail } from './adminEmails';
import { renderMarketingManager } from './marketing';
import { renderSeasonPassStaging } from './seasonPassStaging';
import { renderStoreStaging } from './storeStaging';
import { renderLiveOps } from './liveOps';
import { loadMarketingConfig } from '../firebase/MarketingConfig';
import { loadAdminDraft } from '../firebase/AdminDrafts';
import { ENV } from '../config/env';
import { buildLabelLong } from '../core/buildInfo';
import { mountEnvBadge } from '../core/envBadge';
import { enableFlagOverrides } from '../core/flags';
import { ARCHETYPES } from '../data/archetypes';
// The LIVE roster the game now loads (courseRebuilds + newCourses released): the
// v2 rebuilds (Sable Bay, Timberline East, Port Johnson) + Timberline West + the
// two new courses, plus hand-authored Wildwood. Rounds record under these names,
// so the dashboard MUST use them — after the release the old base names
// ("Timberline") no longer match, which silently hid every round on the renamed
// and new courses from the stats (owner: "rounds aren't getting recorded").
import wildwood from '../data/courses/wildwood.json';
import sablebay from '../data/courses/v2/sablebay.json';
import timberlineEast from '../data/courses/v2/timberline.json';
import timberlineWest from '../data/courses/v2/timberlinewest.json';
import portjohnson from '../data/courses/v2/portjohnson.json';
import redhollow from '../data/courses/redhollow.json';
import wildvalley from '../data/courses/wildvalley.json';
// Base "Timberline" kept too so any pre-rename straggler still counts.
import timberlineBase from '../data/courses/timberline.json';

// Only CURRENT content — the public rounds node still holds rounds from prior
// game versions (retired courses/characters). Drop anything not in the live roster.
const ACTIVE_COURSES = new Set<string>(
  [wildwood, sablebay, timberlineEast, timberlineWest, portjohnson, redhollow, wildvalley, timberlineBase].map(
    (c) => (c as { name: string }).name
  )
);
const ACTIVE_ARCHETYPES = new Set<string>(ARCHETYPES.map((a) => a.id));

// COURSE-STATS RESET (owner, 2026-07-22): the rebuilt courses shipped, so every
// pre-release round describes holes that no longer exist. The dashboard counts
// only rounds recorded at/after this epoch (ms), giving a clean slate on the new
// layouts. Non-destructive — the raw rounds stay in /rounds; they're just
// excluded from every average, per-hole table, and count. Bump this to reset
// again after a future course change.
const STATS_EPOCH = 1784754000000; // 2026-07-22T21:00:00Z

const $ = (id: string): HTMLElement => document.getElementById(id)!;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The already-persisted account email (shared with the game via Firebase auth
 *  on the same origin), without triggering a sign-in popup. */
async function currentEmail(): Promise<string | null> {
  const { initializeApp } = await import('firebase/app');
  const { getAuth } = await import('firebase/auth');
  const auth = getAuth(initializeApp(FIREBASE));
  await auth.authStateReady();
  return auth.currentUser?.email ?? null;
}

async function signIn(): Promise<string | null> {
  const { initializeApp } = await import('firebase/app');
  const { getAuth, GoogleAuthProvider, signInWithPopup } = await import('firebase/auth');
  const auth = getAuth(initializeApp(FIREBASE));
  await auth.authStateReady();
  if (!auth.currentUser) {
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch {
      return null;
    }
  }
  return auth.currentUser?.email ?? null;
}

async function fetchRounds(): Promise<RoundRecord[]> {
  const res = await fetch(`${LEADERBOARD_URL}/rounds.json`);
  if (!res.ok) throw new Error(`rounds fetch failed: HTTP ${res.status}`);
  const data = (await res.json()) as Record<string, RoundRecord> | null;
  return data ? Object.values(data).filter((r) => r && typeof r.total === 'number') : [];
}

/** Best-effort fetch of the retention analytics events node (guest + account
 *  activity). Absent node / denied read / offline → null, and the dashboard
 *  simply omits the retention section rather than failing. */
async function fetchRetention(): Promise<RetentionStats | null> {
  try {
    const res = await fetch(`${LEADERBOARD_URL}/events.json`);
    if (!res.ok) return null;
    const node = (await res.json()) as RawEventsNode;
    const events = flattenEvents(node);
    if (events.length === 0) return null;
    return aggregateRetention(events);
  } catch {
    return null;
  }
}

/**
 * Best-effort per-account XP backfill from the private profiles tree.
 *
 * Going forward every RoundRecord carries `xp`, so the account table's XP
 * normally comes straight off the public /rounds node (aggregate.roundsByAccount).
 * This fills in accounts whose newest round predates that field. It reads only
 * profiles/{uid}/xp for each uid.
 *
 * IMPORTANT — RTDB rules: under the SHIPPED rules (docs/FIREBASE_SETUP.md) a
 * signed-in admin can read ONLY their own profile, so every OTHER uid here
 * returns permission-denied and is silently skipped (that account then falls
 * back to its round-carried xp — 0 for a legacy-only account). To enable the
 * full backfill WITHOUT widening profile access, expose ONLY the xp leaf to an
 * admin allow-list, e.g.:
 *   "profiles": { "$uid": {
 *      ".read":  "auth != null && auth.uid === $uid",
 *      ".write": "auth != null && auth.uid === $uid",
 *      "xp": { ".read": "auth != null && root.child('admins').child(auth.uid).val() === true" }
 *   } }
 * with an /admins/{uid}=true allow-list. No other profile field becomes readable.
 */
async function fetchAccountXp(uids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (uids.length === 0) return out;
  try {
    const { initializeApp, getApps, getApp } = await import('firebase/app');
    const { getDatabase, ref, get } = await import('firebase/database');
    const app = getApps().length ? getApp() : initializeApp(FIREBASE);
    const db = getDatabase(app);
    await Promise.all(
      uids.map(async (uid) => {
        try {
          const snap = await get(ref(db, `profiles/${uid}/xp`));
          const val = snap.val();
          if (typeof val === 'number') out.set(uid, val);
        } catch {
          // permission-denied for a non-self uid under the shipped rules — skip.
        }
      })
    );
  } catch {
    // Firebase unavailable — the round-carried xp still renders.
  }
  return out;
}

function bar(value: number, max: number): string {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return `<div class="bar"><div class="fill" style="width:${pct.toFixed(1)}%"></div></div>`;
}

/** Players & Retention section — guest vs signed-in activity from the
 *  analytics events node. Explicitly labels guests as GUESTS, never accounts. */
function retentionSectionHtml(r: RetentionStats | null): string {
  if (!r) {
    return `<section><h2>Players &amp; Retention</h2>
      <p class="sub">No analytics events yet (or the /events node is unreadable). Guest and session tracking appears here once players generate events.</p></section>`;
  }
  const pct = (v: number | null): string => (v === null ? '—' : `${v}%`);
  const usage = (m: Record<string, number>): string =>
    Object.entries(m)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`)
      .join('');
  return `<section><h2>Players &amp; Retention</h2>
    <p class="sub">From the analytics events node. Guest players are counted separately — a guest is never shown as an account, and a guest who later signs in is counted once (rounds are never double-counted across the transition).</p>
    <div class="tiles">
      <div class="tile"><div class="tval">${r.guestPlayers}</div><div class="tlbl">Guest Players</div></div>
      <div class="tile"><div class="tval">${r.signedInPlayers}</div><div class="tlbl">Signed-In Players</div></div>
      <div class="tile"><div class="tval">${r.totalUniquePlayers}</div><div class="tlbl">Total Unique Players</div></div>
      <div class="tile"><div class="tval">${r.totalSessions}</div><div class="tlbl">Total Sessions</div></div>
    </div>
    <div class="tiles">
      <div class="tile"><div class="tval">${r.roundsStarted}</div><div class="tlbl">Rounds Started</div></div>
      <div class="tile"><div class="tval">${r.roundsCompleted}</div><div class="tlbl">Rounds Completed</div></div>
      <div class="tile"><div class="tval">${r.replaySelected}</div><div class="tlbl">Replay Selections</div></div>
      <div class="tile"><div class="tval">${r.playNextSelected}</div><div class="tlbl">Play Next Selections</div></div>
    </div>
    <div class="tiles">
      <div class="tile"><div class="tval">${pct(r.nextRoundConversion)}</div><div class="tlbl">Next-Round Conversion</div></div>
      <div class="tile"><div class="tval">${pct(r.replayConversion)}</div><div class="tlbl">↳ via Replay</div></div>
      <div class="tile"><div class="tval">${pct(r.playNextConversion)}</div><div class="tlbl">↳ via Play Next</div></div>
      <div class="tile"><div class="tval">${r.dailyCompleted}</div><div class="tlbl">Daily Challenges Done</div></div>
    </div>
    <div class="tiles">
      <div class="tile"><div class="tval">${pct(r.d1ReturnRate)}</div><div class="tlbl">D1 Return Rate</div></div>
      <div class="tile"><div class="tval">${pct(r.d7ReturnRate)}</div><div class="tlbl">D7 Return Rate</div></div>
    </div>
    <table><tr><th>Rounds completed as…</th><th>Count</th></tr>
      <tr><td>Guest Players</td><td>${r.guestRoundsCompleted}</td></tr>
      <tr><td>Signed-In Players</td><td>${r.signedInRoundsCompleted}</td></tr>
    </table>
    <h3>Rounds started by course</h3><table><tr><th>Course</th><th>Started</th></tr>${usage(r.byCourse)}</table>
    <h3>Rounds started by mode</h3><table><tr><th>Mode</th><th>Started</th></tr>${usage(r.byMode)}</table>
  </section>`;
}

function render(allRounds: RoundRecord[], xpBackfill: Map<string, number> = new Map(), onBack: () => void = () => void showLanding(), retention: RetentionStats | null = null): void {
  // Keep only rounds on courses that still exist AND recorded at/after the stats
  // epoch (the course-rebuild reset — see STATS_EPOCH); type tables filter to the
  // live archetype roster below.
  const rounds = allRounds.filter((r) => ACTIVE_COURSES.has(r.course) && r.d >= STATS_EPOCH);
  const courses = avgByCourse(rounds);
  const holes = avgByHole(rounds);
  const puttHoles = avgPuttsByHole(rounds);
  const archetypes = avgByArchetype(rounds).filter((t) => ACTIVE_ARCHETYPES.has(t.type));
  const putts = avgPutts(rounds);
  const accounts = roundsByAccount(rounds);
  const guests = guestSummary(rounds);
  const overall = overallAvg(rounds);
  const fmtPar = (v: number): string => (v > 0 ? `+${v}` : `${v}`);
  const maxTotal = Math.max(...courses.map((c) => c.avgTotal), 1);

  let html = `<button id="backHome" class="btn back">← Admin home</button>
    <h1>📊 Round Statistics</h1>
    <p class="sub">${rounds.length} active rounds (legacy versions hidden)</p>`;

  // Top summary tile — the whole-population headline numbers.
  html += `<section class="summary"><div class="tiles">
      <div class="tile"><div class="tval">${overall.rounds}</div><div class="tlbl">Total rounds</div></div>
      <div class="tile"><div class="tval">${overall.avgTotal}</div><div class="tlbl">Avg score</div></div>
      <div class="tile"><div class="tval">${fmtPar(overall.avgToPar)}</div><div class="tlbl">Avg to par</div></div>
      <div class="tile"><div class="tval">${putts.tracked ? putts.overall.avgPutts : '—'}</div><div class="tlbl">Avg putts</div></div>
    </div></section>`;

  html += retentionSectionHtml(retention);

  html += `<section><h2>Average score by course</h2><table>
    <tr><th>Course</th><th>Rounds</th><th>Avg total</th><th>Avg to par</th><th></th></tr>`;
  for (const c of courses) {
    html += `<tr><td>${esc(c.course)}</td><td>${c.n}</td><td>${c.avgTotal}</td>
      <td>${fmtPar(c.avgToPar)}</td><td class="barcell">${bar(c.avgTotal, maxTotal)}</td></tr>`;
  }
  html += `</table></section>`;

  html += `<section><h2>Average strokes by hole</h2>`;
  for (const c of courses) {
    const per = holes.get(c.course) ?? [];
    html += `<h3>${esc(c.course)}</h3><table>
      <tr><th>Hole</th>${per.map((h) => `<th>${h.hole}</th>`).join('')}</tr>
      <tr><td>Avg</td>${per.map((h) => `<td>${h.avg} <span class="n">n=${h.n}</span></td>`).join('')}</tr>
    </table>`;
  }
  html += `</section>`;

  html += `<section><h2>Average score by golfer type</h2><table>
    <tr><th>Archetype</th><th>Rounds</th><th>Avg total</th><th>Avg to par</th></tr>`;
  for (const t of archetypes) {
    html += `<tr><td>${esc(t.type)}</td><td>${t.n}</td><td>${t.avgTotal}</td><td>${fmtPar(t.avgToPar)}</td></tr>`;
  }
  html += `</table></section>`;

  html += `<section><h2>Average putts</h2>
    <p class="sub">Putt tracking shipped mid-season: ${putts.tracked} of ${putts.totalRounds} rounds report putts.</p>`;
  if (putts.tracked === 0) {
    html += `<p>No putt data yet — averages will appear as new rounds are played.</p>`;
  } else {
    html += `<table><tr><th>Course</th><th>Rounds w/ putts</th><th>Avg putts</th></tr>
      <tr><td><b>${esc(putts.overall.course)}</b></td><td>${putts.overall.n}</td><td><b>${putts.overall.avgPutts}</b></td></tr>`;
    for (const p of putts.byCourse) {
      html += `<tr><td>${esc(p.course)}</td><td>${p.n}</td><td>${p.avgPutts}</td></tr>`;
    }
    html += `</table>`;
    html += `<h3>Average putts by hole</h3>`;
    for (const c of putts.byCourse) {
      const per = puttHoles.get(c.course) ?? [];
      if (!per.some((h) => h.n > 0)) continue;
      html += `<h4>${esc(c.course)}</h4><table>
        <tr><th>Hole</th>${per.map((h) => `<th>${h.hole}</th>`).join('')}</tr>
        <tr><td>Avg</td>${per.map((h) => `<td>${h.n ? h.avg : '—'} <span class="n">n=${h.n}</span></td>`).join('')}</tr>
      </table>`;
    }
  }
  html += `</section>`;

  html += `<section><h2>Rounds by account</h2>
    <p class="sub">${accounts.tracked.length} accounts have played`;
  if (accounts.untracked > 0) html += ` · ${accounts.untracked} round(s) predate account tracking`;
  html += `.</p>`;
  if (accounts.tracked.length === 0) {
    html += `<p>No account-linked rounds yet.</p>`;
  } else {
    html += `<table><tr><th>Player</th><th>Rounds played</th><th>Avg score</th><th>Avg to par</th><th>XP</th><th>Last played</th></tr>`;
    for (const a of accounts.tracked) {
      // Round-carried xp is grow-only; a profiles/{uid}/xp backfill (when the
      // admin can read it) fills accounts with no xp-bearing round yet.
      const xp = Math.max(a.xp, xpBackfill.get(a.uid) ?? 0);
      html += `<tr><td>${esc(a.name || 'Player')}</td><td>${a.n}</td><td>${a.avgTotal}</td><td>${fmtPar(a.avgToPar)}</td><td>${xp || '—'}</td><td>${new Date(a.lastPlayed).toLocaleDateString()}</td></tr>`;
    }
    html += `</table>`;
  }
  // Guest (anonymous) play — counted from the shared /rounds node (works
  // without the analytics rules), shown separately and never as an account.
  html += `<div class="guestLine"><b>Guest players:</b> ${guests.rounds} round(s) from ${guests.devices} device(s)`;
  if (guests.rounds > 0) {
    html += ` · avg ${guests.avgTotal}`;
    if (guests.lastPlayed) html += ` · last ${new Date(guests.lastPlayed).toLocaleDateString()}`;
  }
  html += `</div>`;
  html += `</section>`;

  $('app').innerHTML = html;
  document.getElementById('backHome')!.addEventListener('click', onBack);
}

/** The signed-in admin email, remembered so the landing can re-render freely. */
let adminEmail: string | null = null;

/** Dashboard destination: fetch rounds + XP and render the stats, back to home. */
async function openDashboard(): Promise<void> {
  $('app').innerHTML = `<p class="sub">Loading rounds…</p>`;
  try {
    const [rounds, retention] = await Promise.all([fetchRounds(), fetchRetention()]);
    // Best-effort XP backfill for accounts whose newest round predates
    // RoundRecord.xp (silently yields nothing under the shipped profile rules).
    const uids = [...new Set(rounds.map((r) => r.uid).filter((u): u is string => !!u))];
    const xpBackfill = await fetchAccountXp(uids);
    render(rounds, xpBackfill, () => void showLanding(), retention);
  } catch (e) {
    $('app').innerHTML = `<button id="backHome" class="btn back">← Admin home</button>
      <p class="sub">Failed to load rounds: ${esc(String(e))}</p>`;
    document.getElementById('backHome')!.addEventListener('click', () => void showLanding());
  }
}

function destCardHtml(
  key: string,
  icon: string,
  title: string,
  desc: string,
  status: string,
  statusCls: string
): string {
  return `<section class="adminCard" data-card="${key}">
    <div class="acIcon">${icon}</div>
    <div class="acTitle">${esc(title)}</div>
    <div class="acDesc">${esc(desc)}</div>
    <div class="acMeta"><span class="acStatus ${statusCls}" data-role="status">${esc(status)}</span><span data-role="saved"></span></div>
    <button class="btn acOpen" data-open="${key}">Open</button>
  </section>`;
}

function fmtWhen(ms: number | undefined): string {
  if (!ms || !Number.isFinite(ms)) return '';
  try {
    return `saved ${new Date(ms).toLocaleString()}`;
  } catch {
    return '';
  }
}

/** Update a landing card's status pill + last-saved line in place. */
function setCardStatus(key: string, text: string, cls: string, saved: string): void {
  const card = document.querySelector(`.adminCard[data-card="${key}"]`);
  if (!card) return;
  const st = card.querySelector('[data-role=status]') as HTMLElement | null;
  if (st) {
    st.textContent = text;
    st.className = `acStatus ${cls}`;
  }
  const sv = card.querySelector('[data-role=saved]') as HTMLElement | null;
  if (sv) sv.textContent = saved;
}

/** A staging draft's landing status, tolerating a read that couldn't complete. */
async function fillDraftStatus(key: string, draftKey: string): Promise<void> {
  const { value, status } = await loadAdminDraft<{ savedAt?: number }>(draftKey);
  if (status !== 'saved') {
    const label =
      status === 'skipped' ? 'Sign in to read' : status === 'denied' ? 'Rules needed' : 'Offline';
    setCardStatus(key, label, '', '');
    return;
  }
  if (value) setCardStatus(key, 'Draft saved', 'draft', fmtWhen(value.savedAt));
  else setCardStatus(key, 'Not started', '', '');
}

/** Fill each destination's live status (published marketing config + drafts). */
async function fillLandingStatus(): Promise<void> {
  try {
    const cfg = await loadMarketingConfig();
    if (cfg && cfg.publishedAt) {
      setCardStatus('marketing', `Published v${cfg.version ?? 1}`, 'live', fmtWhen(cfg.publishedAt));
    } else {
      setCardStatus('marketing', 'Static fallback', 'draft', '');
    }
  } catch {
    setCardStatus('marketing', 'Unknown', '', '');
  }
  await fillDraftStatus('season', 'nextSeasonPass');
  await fillDraftStatus('store', 'futureStoreItems');
  await fillDraftStatus('liveops', 'retentionLiveOps');
}

/** The admin landing: four workspace destinations. Auth is enforced here — the
 *  destinations themselves assume an allow-listed admin (as before). */
async function showLanding(): Promise<void> {
  const email = adminEmail;
  if (!email || !isAdminEmail(email)) {
    $('app').innerHTML = `<h1>⛳ Bite-Sized Golf — Admin</h1>
      <p class="sub">Not authorized${email ? ` for ${esc(email)}` : ''}.</p>`;
    return;
  }
  // Confirmed admin — allow flag overrides on this device (a no-op for the
  // sensitive dev-only flags, which stay additionally hard-gated to non-prod).
  enableFlagOverrides(true);
  $('app').innerHTML = `<button id="backGame" class="btn back">← Back to game</button>
    <h1>⛳ Bite-Sized Golf — Admin</h1>
    <p class="sub">Signed in as ${esc(email)} · choose a workspace</p>
    <div class="adminGrid" id="adminGrid">
      ${destCardHtml('dashboard', '📊', 'Dashboard', 'Round statistics — scoring by course, hole and golfer type, plus per-account play.', 'Live data', 'live')}
      ${destCardHtml('marketing', '🎬', 'Marketing Manager', 'Edit the public About page: montage, gameplay clips, hero copy and every marketing image.', 'Loading…', '')}
      ${destCardHtml('season', '🏆', 'Next Season Pass Staging', 'Draft the next season pass — theme, dates, levels and rewards. Staging only, never live.', 'Loading…', '')}
      ${destCardHtml('store', '🛍️', 'Future Store Items Staging', 'Draft upcoming store items — price, rarity and availability. Staging only, never live.', 'Loading…', '')}
      ${destCardHtml('liveops', '🔁', 'Retention / Live Ops', 'Daily Challenge and Weekly Featured overrides — stage, validate, publish. Reward math stays code-defined.', 'Loading…', '')}
    </div>
    <p class="sub" style="margin-top:22px">
      <a id="openDev" href="index.html?env=dev" style="color:#ffcf33;font-weight:600;text-decoration:none">
        🧪 Open Dev Preview →
      </a>
      <span style="opacity:0.7"> — the game with the in-progress polish (delight, juice, ambient life) turned on. Production stays unchanged.</span>
    </p>
    <p class="sub" style="margin-top:6px;opacity:0.6;font-size:12px">
      Environment: <b>${ENV.name.toUpperCase()}</b> · build ${esc(buildLabelLong())}
    </p>`;
  document.getElementById('backGame')!.addEventListener('click', () => (window.location.href = 'index.html'));
  document.getElementById('adminGrid')!.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest('[data-open]') as HTMLElement | null;
    if (!el) return;
    const back = (): void => void showLanding();
    switch (el.dataset.open) {
      case 'dashboard':
        void openDashboard();
        break;
      case 'marketing':
        void renderMarketingManager($('app'), back);
        break;
      case 'season':
        void renderSeasonPassStaging($('app'), back);
        break;
      case 'store':
        void renderStoreStaging($('app'), back);
        break;
      case 'liveops':
        void renderLiveOps($('app'), back);
        break;
      default:
        break;
    }
  });
  void fillLandingStatus();
}

async function boot(): Promise<void> {
  // Arriving from the game (or a return visit): if a Google session already
  // persists on this origin, skip the sign-in step entirely.
  const existing = await currentEmail();
  if (existing) {
    adminEmail = existing;
    await showLanding();
    return;
  }
  $('app').innerHTML = `<h1>⛳ Bite-Sized Golf — Admin</h1>
    <p class="sub">Owner sign-in required.</p>
    <button id="signin" class="btn">Sign in with Google</button>`;
  $('signin').addEventListener('click', async () => {
    $('app').innerHTML = `<p class="sub">Signing in…</p>`;
    const email = await signIn();
    if (!email) {
      boot();
      return;
    }
    adminEmail = email;
    await showLanding();
  });
}

// Visual-capture / preview hook: render the landing SHELL for a given admin
// email without a live Google session. The four cards are just menu chrome —
// every data destination still requires real auth + RTDB rules to load
// anything, so this exposes nothing that isn't already gated.
(window as unknown as { __adminLandingPreview?: (email: string) => void }).__adminLandingPreview = (
  email: string
): void => {
  adminEmail = email;
  void showLanding();
};

mountEnvBadge();
void boot();
