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
import { avgByArchetype, avgByCharacter, avgByCourse, avgByHole, avgPutts } from './aggregate';
import { isAdminEmail } from './adminEmails';

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

function bar(value: number, max: number): string {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return `<div class="bar"><div class="fill" style="width:${pct.toFixed(1)}%"></div></div>`;
}

function render(rounds: RoundRecord[]): void {
  const courses = avgByCourse(rounds);
  const holes = avgByHole(rounds);
  const archetypes = avgByArchetype(rounds);
  const characters = avgByCharacter(rounds);
  const putts = avgPutts(rounds);
  const fmtPar = (v: number): string => (v > 0 ? `+${v}` : `${v}`);
  const maxTotal = Math.max(...courses.map((c) => c.avgTotal), 1);

  let html = `<h1>⛳ Bite-Sized Golf — Admin</h1>
    <p class="sub">${rounds.length} rounds on the shared leaderboard</p>`;

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
      <tr><td>Avg</td>${per.map((h) => `<td>${h.avgStrokes} <span class="n">n=${h.n}</span></td>`).join('')}</tr>
    </table>`;
  }
  html += `</section>`;

  html += `<section><h2>Average score by golfer type</h2><table>
    <tr><th>Archetype</th><th>Rounds</th><th>Avg total</th><th>Avg to par</th></tr>`;
  for (const t of archetypes) {
    html += `<tr><td>${esc(t.type)}</td><td>${t.n}</td><td>${t.avgTotal}</td><td>${fmtPar(t.avgToPar)}</td></tr>`;
  }
  html += `</table><h3>By character</h3><table>
    <tr><th>Character</th><th>Rounds</th><th>Avg total</th><th>Avg to par</th></tr>`;
  for (const t of characters) {
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
  }
  html += `</section>`;

  $('app').innerHTML = html;
}

async function showDashboard(email: string): Promise<void> {
  if (!isAdminEmail(email)) {
    $('app').innerHTML = `<h1>⛳ Bite-Sized Golf — Admin</h1>
      <p class="sub">Not authorized for ${esc(email)}.</p>`;
    return;
  }
  $('app').innerHTML = `<p class="sub">Loading rounds…</p>`;
  try {
    render(await fetchRounds());
  } catch (e) {
    $('app').innerHTML = `<p class="sub">Failed to load rounds: ${esc(String(e))}</p>`;
  }
}

async function boot(): Promise<void> {
  // Arriving from the game (or a return visit): if a Google session already
  // persists on this origin, skip the sign-in step entirely.
  const existing = await currentEmail();
  if (existing) {
    await showDashboard(existing);
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
    await showDashboard(email);
  });
}

void boot();
