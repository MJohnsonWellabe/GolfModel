/**
 * Admin → Season Ownership Repair (one-time historical correction).
 *
 * Owner, with two screenshots: "this assigned a bunch of stuff to the wrong
 * pro. it is assigning most of my wins to Charlotte on the majors but they
 * were spread across pros. you can see parker has a grand slam but no wins
 * in the table." The forward-looking bug is fixed (every season now stamps
 * its own owner at creation — see TourSeason.ts/seasonOwner in main.ts), but
 * that fix cannot repair data that was ALREADY misattributed before it
 * shipped. This tool is the one-time correction for that existing data,
 * confirmed by the owner: "let me do a one time reassign of those stats".
 *
 * Operates on the SIGNED-IN ADMIN'S OWN account only — the shipped RTDB
 * rules only let a uid read/write its own `profiles/{uid}` node
 * (docs/FIREBASE_SETUP.md), which is exactly right here: this repairs the
 * operator's own misattributed history, never another player's.
 *
 * WHY BOTH THE ARCHIVE ENTRY AND TourHistory MUST MOVE: the records screen
 * reads `mergeTourHistory(profile.tourHistory, tourHistoryFromArchive(archive))`,
 * and `mergeTourHistory` takes the LARGER tally per Pro. Re-stamping the
 * archive entry's `proId` alone would leave the old Pro's stale, too-high
 * `profile.tourHistory` counters (built by the original buggy recording
 * calls) still winning that merge forever. `reassignArchivedSeason`
 * (TourSeason.ts) moves both halves together.
 *
 * WHY BOTH LOCAL AND REMOTE GET WRITTEN, DIRECTLY (no merge): the normal
 * player-facing sync (`cloudSyncProfile`) merges local against remote by
 * taking the larger tally per Pro — exactly the mechanism that would
 * silently UNDO this fix the next time the player's device syncs, if that
 * device still holds the old, uncorrected local copy. So this tool starts
 * from the best-of-both baseline (`mergeProfiles(local, remote)` — the same
 * thing a real sync would produce, so nothing already-progressed is lost),
 * applies the correction on top, then writes the result to BOTH sides
 * directly. That leaves local and remote already in agreement — no future
 * merge on THIS device can regress it. A player with more than one device
 * should sign out and back in (or otherwise force a fresh pull) on every
 * OTHER device after using this tool, or its still-uncorrected local copy
 * will win the next merge there.
 */
import { FIREBASE } from '../config';
import { loadProfile, mergeProfiles, migrateProfile, PlayerProfile, saveProfile } from '../profile/Profile';
import { ArchivedTourSeason, reassignArchivedSeason } from '../systems/TourSeason';

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function escAttr(s: string): string {
  return esc(s).replace(/"/g, '&quot;');
}
function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

function isPermissionDenied(e: unknown): boolean {
  const code = (e as { code?: string }).code ?? '';
  const msg = (e as { message?: string }).message ?? String(e);
  return /permission[_ ]?denied/i.test(code) || /permission[_ ]?denied/i.test(msg);
}

async function firebaseApp(): Promise<import('firebase/app').FirebaseApp> {
  const { initializeApp, getApps, getApp } = await import('firebase/app');
  return getApps().length ? getApp() : initializeApp(FIREBASE);
}

async function loadRemoteProfile(
  uid: string
): Promise<{ profile: PlayerProfile | null; status: 'saved' | 'denied' | 'offline' }> {
  try {
    const app = await firebaseApp();
    const { getDatabase, ref, get } = await import('firebase/database');
    const snap = await get(ref(getDatabase(app), `profiles/${uid}`));
    return {
      profile: snap.exists() ? migrateProfile(snap.val() as Partial<PlayerProfile>) : null,
      status: 'saved'
    };
  } catch (e) {
    return { profile: null, status: isPermissionDenied(e) ? 'denied' : 'offline' };
  }
}

/** Overwrite `profiles/{uid}` directly — see the file doc comment for why
 *  this deliberately bypasses the normal merge-on-sync path. */
async function saveRemoteProfileDirect(uid: string, next: PlayerProfile): Promise<'saved' | 'denied' | 'offline'> {
  try {
    const app = await firebaseApp();
    const { getDatabase, ref, set } = await import('firebase/database');
    await set(ref(getDatabase(app), `profiles/${uid}`), next);
    return 'saved';
  } catch (e) {
    return isPermissionDenied(e) ? 'denied' : 'offline';
  }
}

let profile: PlayerProfile | null = null;
let uid: string | null = null;
let mountApp: HTMLElement;
let mountBack: () => void;
/** archive key → the Pro picked in that row's dropdown, only while it
 *  differs from the entry's CURRENT owner. */
let pending: Map<string, { proId: string; proName: string }> = new Map();
let statusMsg = '';

function currentPickFor(a: ArchivedTourSeason): { proId: string; proName: string } {
  return pending.get(a.key) ?? { proId: a.proId, proName: a.proName };
}

function paint(): void {
  if (!profile) return;
  const p = profile;
  const pros = p.career.pros;
  const archive = [...p.tours.archive].sort((a, b) => a.at - b.at);

  const rows = archive
    .map((a) => {
      const pick = currentPickFor(a);
      const changed = pending.has(a.key);
      const currentOwnerKnown = pros.some((pr) => pr.id === a.proId);
      const currentLabel = currentOwnerKnown
        ? esc(a.proName)
        : `${esc(a.proName || 'Unknown')} <span class="thrGone">(no longer in your stable)</span>`;
      const pickMatchesRoster = pros.some((pr) => pr.id === pick.proId);
      const options =
        (pickMatchesRoster ? '' : `<option value="" disabled selected>— choose —</option>`) +
        pros
          .map(
            (pr) =>
              `<option value="${escAttr(pr.id)}" data-name="${escAttr(pr.name)}"${
                pr.id === pick.proId ? ' selected' : ''
              }>${esc(pr.name)}</option>`
          )
          .join('');
      return `<tr class="thrRow${changed ? ' thrChanged' : ''}" data-key="${escAttr(a.key)}">
        <td>Season ${a.seasonNo}</td>
        <td>${esc(a.ended)}</td>
        <td>${a.playerRank === 1 ? '🏆 ' : ''}${ordinal(a.playerRank)} · ${a.playerPoints} pts</td>
        <td>${currentLabel}</td>
        <td><select class="thrPick" data-key="${escAttr(a.key)}">${options}</select></td>
      </tr>`;
    })
    .join('');

  const pendingCount = pending.size;
  mountApp.innerHTML = `<button id="backHome" class="btn back">← Admin home</button>
    <h1>🩹 Season Ownership Repair</h1>
    <p class="sub">One-time correction for seasons archived under the wrong Pro, before the
      season-ownership fix shipped. Signed in as <b>${esc(uid ?? '')}</b>.</p>
    <section>
      <h3>Your Pros</h3>
      <p class="sub">${pros.length ? pros.map((pr) => esc(pr.name)).join(', ') : 'No Pros in your stable.'}</p>
    </section>
    <section>
      <h3>Archived seasons</h3>
      <p class="sub">Every closed season, oldest first, with who it's currently credited to.
        Pick a different Pro to reassign a row — nothing is saved until you tap
        "Save changes" below.</p>
      ${
        archive.length
          ? `<table><tr><th>Season</th><th>Ended</th><th>Result</th><th>Currently credited to</th><th>Reassign to</th></tr>${rows}</table>`
          : '<p>No archived seasons yet — nothing to reassign.</p>'
      }
    </section>
    <button id="thrSave" class="btn"${pendingCount ? '' : ' disabled'}>Save ${pendingCount} change${
    pendingCount === 1 ? '' : 's'
  }</button>
    <p class="sub" id="thrStatus">${statusMsg}</p>`;
  wire();
}

function wire(): void {
  document.getElementById('backHome')!.addEventListener('click', () => mountBack());
  mountApp.querySelectorAll('.thrPick').forEach((sel) =>
    sel.addEventListener('change', (e) => {
      const el = e.target as HTMLSelectElement;
      const key = el.dataset.key!;
      const opt = el.selectedOptions[0];
      const proId = el.value;
      const proName = opt?.dataset.name ?? '';
      const original = profile!.tours.archive.find((a) => a.key === key);
      if (!original || !proId) return;
      if (proId === original.proId) pending.delete(key);
      else pending.set(key, { proId, proName });
      paint();
    })
  );
  document.getElementById('thrSave')?.addEventListener('click', () => void save());
}

async function save(): Promise<void> {
  if (!profile || !uid || pending.size === 0) return;
  let archive: ArchivedTourSeason[] = profile.tours.archive;
  let history = profile.tourHistory;
  for (const [key, pick] of pending) {
    const res = reassignArchivedSeason(archive, history, key, pick.proId, pick.proName);
    archive = res.archive;
    history = res.history;
  }
  const next: PlayerProfile = { ...profile, tours: { ...profile.tours, archive }, tourHistory: history };

  statusMsg = 'Saving…';
  paint();

  // The local copy in THIS browser — same origin as the game, so a reload of
  // the game here picks up the fix immediately with nothing stale left to
  // out-merge it.
  saveProfile(next);

  const remoteStatus = await saveRemoteProfileDirect(uid, next);
  profile = next;
  pending = new Map();
  if (remoteStatus === 'saved') {
    statusMsg =
      '✅ Saved — the cloud and this browser are both corrected. Reload the game ' +
      '(in this browser) to see it. Any OTHER device still holds the old numbers: sign ' +
      'out and back in there (or otherwise force a fresh pull) so it does not merge its ' +
      'stale copy back over this fix.';
  } else if (remoteStatus === 'denied') {
    statusMsg =
      '⛔ This browser was corrected, but the cloud save was DENIED (permissions). ' +
      'The fix will not survive this device\'s next sync until the cloud copy is fixed too — try again.';
  } else {
    statusMsg =
      '⚠️ This browser was corrected, but the cloud save failed (offline?). ' +
      'The fix will not survive this device\'s next sync until the cloud copy is fixed too — try again.';
  }
  paint();
}

export async function renderTourHistoryRepair(app: HTMLElement, onBack: () => void): Promise<void> {
  mountApp = app;
  mountBack = onBack;
  pending = new Map();
  statusMsg = '';
  app.innerHTML = `<p class="sub">Loading your profile…</p>`;

  const { getAuth } = await import('firebase/auth');
  const authApp = await firebaseApp();
  const auth = getAuth(authApp);
  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user) {
    app.innerHTML = `<button id="backHome" class="btn back">← Admin home</button>
      <h1>🩹 Season Ownership Repair</h1>
      <p class="sub">Not signed in.</p>`;
    document.getElementById('backHome')!.addEventListener('click', () => onBack());
    return;
  }
  uid = user.uid;

  const local = loadProfile();
  const remote = await loadRemoteProfile(uid);
  if (remote.status !== 'saved') {
    const msg =
      remote.status === 'denied'
        ? '⛔ Permission denied reading your cloud profile.'
        : '⚠️ Could not reach the cloud (offline?). Try again.';
    app.innerHTML = `<button id="backHome" class="btn back">← Admin home</button>
      <h1>🩹 Season Ownership Repair</h1>
      <p class="sub">${msg}</p>`;
    document.getElementById('backHome')!.addEventListener('click', () => onBack());
    return;
  }

  // Best-of-both baseline — the same thing a real sync would produce — so the
  // correction below starts from ground truth on both sides.
  const base = remote.profile ? mergeProfiles(local, remote.profile) : local;
  base.id = uid;
  profile = base;
  paint();
}

// Exposed for tests only (mirrors the pattern in src/admin/main.ts): render
// with a fully-formed profile already in hand, no live Firebase auth needed.
(window as unknown as { __tourHistoryRepairPreview?: (profile: PlayerProfile) => void }).__tourHistoryRepairPreview = (
  p: PlayerProfile
): void => {
  uid = 'preview-uid';
  profile = p;
  pending = new Map();
  statusMsg = '';
  mountApp = document.getElementById('app')!;
  mountBack = () => void 0;
  paint();
};
