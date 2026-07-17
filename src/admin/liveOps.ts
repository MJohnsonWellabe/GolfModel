/**
 * Admin → Retention / Live Ops. Routine live-operation changes WITHOUT code
 * edits: pin a Daily Challenge to a date, point a Weekly Featured event at a
 * different course. Drafts stage privately at /adminDrafts/retentionLiveOps;
 * Publish validates and writes the public /liveOpsConfig node the game reads
 * (deterministic defaults always cover an absent/partial config).
 *
 * Everything else retention-related is shown READ-ONLY with its code-defined
 * boundary stated explicitly: streak reward amounts, mastery third-star
 * conditions and achievement definitions are economy/correctness surfaces and
 * deliberately cannot be edited from here (retention plan, Part 14).
 */
import { DAILY_CHALLENGES, ACHIEVEMENTS, dailyChallengeFor } from '../data/progression';
import { MASTERY_CHALLENGES } from '../data/masteryChallenges';
import { streakRewardFor } from '../systems/Streak';
import { weeklyEventFor, WEEKLY_ROTATION } from '../systems/WeeklyFeatured';
import {
  emptyLiveOpsConfig,
  LiveOpsConfig,
  migrateLiveOpsConfig,
  validateLiveOpsConfig
} from '../data/liveOpsConfig';
import { loadLiveOpsConfig, publishLiveOpsConfig } from '../firebase/LiveOpsConfig';
import { loadAdminDraft, saveAdminDraft, draftStatusMessage } from '../firebase/AdminDrafts';

export const LIVEOPS_DRAFT_KEY = 'retentionLiveOps';

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function escAttr(s: string): string {
  return esc(s).replace(/"/g, '&quot;');
}

let draft: LiveOpsConfig;
let mountApp: HTMLElement;
let mountBack: () => void;
let statusMsg = '';

const COURSE_NAMES: Record<string, string> = {
  sablebay: 'Sable Bay',
  wildwood: 'Wildwood Glen',
  timberline: 'Timberline',
  portjohnson: 'Port Johnson Links'
};

export async function renderLiveOps(app: HTMLElement, onBack: () => void): Promise<void> {
  mountApp = app;
  mountBack = onBack;
  app.innerHTML = `<p class="sub">Loading live-ops config…</p>`;
  // Prefer the private draft; fall back to the published config; else empty.
  const draftRes = await loadAdminDraft<LiveOpsConfig>(LIVEOPS_DRAFT_KEY);
  const published = draftRes.value ? null : await loadLiveOpsConfig();
  draft = migrateLiveOpsConfig(draftRes.value ?? published ?? emptyLiveOpsConfig());
  statusMsg = draftRes.value
    ? 'Loaded the saved draft.'
    : published
      ? `Loaded published v${published.version}.`
      : 'No draft or published config yet — starting empty.';
  paint();
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function challengeOptions(sel: string): string {
  return DAILY_CHALLENGES.map(
    (c) => `<option value="${escAttr(c.id)}"${c.id === sel ? ' selected' : ''}>${esc(c.name)}</option>`
  ).join('');
}

function courseOptions(sel: string): string {
  return WEEKLY_ROTATION.map(
    (id) => `<option value="${escAttr(id)}"${id === sel ? ' selected' : ''}>${esc(COURSE_NAMES[id] ?? id)}</option>`
  ).join('');
}

function dailyRows(): string {
  const entries = Object.entries(draft.dailyOverrides).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) return `<p class="sub">No daily overrides — every day uses its deterministic challenge.</p>`;
  return entries
    .map(
      ([date, id]) => `<div class="lo-row" data-date="${escAttr(date)}">
        <code>${esc(date)}</code>
        <select data-action="daily-set" data-date="${escAttr(date)}">${challengeOptions(id)}</select>
        <button class="mm-icon" data-action="daily-remove" data-date="${escAttr(date)}">✕ Remove</button>
      </div>`
    )
    .join('');
}

function weeklyRows(): string {
  const entries = Object.entries(draft.weeklyOverrides).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) return `<p class="sub">No weekly overrides — the fixed course rotation applies.</p>`;
  return entries
    .map(
      ([week, courseId]) => `<div class="lo-row" data-week="${escAttr(week)}">
        <code>${esc(week)}</code>
        <select data-action="weekly-set" data-week="${escAttr(week)}">${courseOptions(courseId)}</select>
        <button class="mm-icon" data-action="weekly-remove" data-week="${escAttr(week)}">✕ Remove</button>
      </div>`
    )
    .join('');
}

function readOnlySections(): string {
  const streak = Array.from({ length: 7 }, (_, i) => {
    const r = streakRewardFor(i + 1);
    return `<tr><td>Day ${i + 1}</td><td>${r.label.replace(/^Day \d+ · /, '')}${r.milestone ? ' · milestone badge' : ''}</td></tr>`;
  }).join('');
  const mastery = MASTERY_CHALLENGES.map(
    (m) => `<tr><td><code>${esc(m.id)}</code></td><td><b>${esc(m.name)}</b></td><td>${esc(m.desc)}</td></tr>`
  ).join('');
  const ach = ACHIEVEMENTS.map(
    (a) => `<tr><td><code>${esc(a.id)}</code></td><td><b>${esc(a.name)}</b></td><td>${esc(a.desc)}</td><td>+${a.xp} XP · +${a.coins} 🪙</td></tr>`
  ).join('');
  const daily = DAILY_CHALLENGES.map((c) => `<tr><td><code>${esc(c.id)}</code></td><td>${esc(c.name)}</td></tr>`).join('');
  return `
    <section><h2>Code-defined (read-only)</h2>
      <p class="sub">These stay in code for integrity: reward amounts and completion conditions must not be editable at runtime. Changing them is a reviewed code change.</p>
      <h3>Daily challenge roster</h3><table>${daily}</table>
      <h3>Streak reward cycle</h3><table>${streak}</table>
      <h3>Hole mastery third stars</h3><table>${mastery}</table>
      <h3>Achievements</h3><table>${ach}</table>
    </section>`;
}

function paint(): void {
  const today = todayKey();
  const todaysDefault = dailyChallengeFor(today);
  const thisWeek = weeklyEventFor(new Date());
  mountApp.innerHTML = `<div id="liveops">
    <style>
      .lo-row { display:flex; gap:10px; align-items:center; margin-top:8px; flex-wrap:wrap; }
      .lo-add { display:flex; gap:10px; align-items:center; margin-top:10px; flex-wrap:wrap; }
      #liveops table td { padding: 4px 10px 4px 0; vertical-align: top; }
    </style>
    <button class="btn back" data-action="back">← Admin home</button>
    <h1>🔁 Retention / Live Ops</h1>
    <p class="sub">${esc(statusMsg)}</p>

    <section><h2>Daily Challenge overrides</h2>
      <p class="sub">Today (${esc(today)}) defaults to “${esc(todaysDefault.name)}”. Pin a specific challenge to any date; unlisted dates keep their deterministic pick.</p>
      ${dailyRows()}
      <div class="lo-add">
        <input type="date" id="lo-daily-date" value="${escAttr(today)}"/>
        <select id="lo-daily-ch">${challengeOptions(todaysDefault.id)}</select>
        <button class="btn back" data-action="daily-add">+ Add override</button>
      </div>
    </section>

    <section><h2>Weekly Featured overrides</h2>
      <p class="sub">This week is <code>${esc(thisWeek.id)}</code> on ${esc(COURSE_NAMES[thisWeek.courseId] ?? thisWeek.courseId)} (rotation). Override a week's course; the shared wind seed stays derived from the event id.</p>
      ${weeklyRows()}
      <div class="lo-add">
        <input type="text" id="lo-week-id" placeholder="w2026-30" value="${escAttr(thisWeek.id)}" size="10"/>
        <select id="lo-week-course">${courseOptions(thisWeek.courseId)}</select>
        <button class="btn back" data-action="weekly-add">+ Add override</button>
      </div>
    </section>

    <section><h2>Save &amp; publish</h2>
      <p class="sub">Save keeps a private draft (<code>/adminDrafts/${LIVEOPS_DRAFT_KEY}</code>). Publish validates and writes the public <code>/liveOpsConfig</code> node players read. Active configuration and drafts never mix.</p>
      <button class="btn" data-action="save">💾 Save draft</button>
      <button class="btn" data-action="publish">🚀 Publish to live</button>
      <p class="sub" id="lo-status"></p>
    </section>

    ${readOnlySections()}
  </div>`;

  const root = document.getElementById('liveops')!;
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
}

function status(msg: string): void {
  const el = document.getElementById('lo-status');
  if (el) el.innerHTML = msg;
}

function onChange(e: Event): void {
  const t = e.target as HTMLSelectElement;
  const action = t.dataset.action;
  if (action === 'daily-set' && t.dataset.date) draft.dailyOverrides[t.dataset.date] = t.value;
  else if (action === 'weekly-set' && t.dataset.week) draft.weeklyOverrides[t.dataset.week] = t.value;
}

function onClick(e: Event): void {
  const el = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
  if (!el) return;
  switch (el.dataset.action) {
    case 'back':
      mountBack();
      break;
    case 'daily-add': {
      const date = (document.getElementById('lo-daily-date') as HTMLInputElement).value;
      const ch = (document.getElementById('lo-daily-ch') as HTMLSelectElement).value;
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        draft.dailyOverrides[date] = ch;
        paint();
      }
      break;
    }
    case 'daily-remove':
      delete draft.dailyOverrides[el.dataset.date ?? ''];
      paint();
      break;
    case 'weekly-add': {
      const week = (document.getElementById('lo-week-id') as HTMLInputElement).value.trim();
      const course = (document.getElementById('lo-week-course') as HTMLSelectElement).value;
      if (/^w\d{4}-\d{2}$/.test(week)) {
        draft.weeklyOverrides[week] = course;
        paint();
      } else {
        status('⚠ Week id must look like <code>w2026-30</code>.');
      }
      break;
    }
    case 'weekly-remove':
      delete draft.weeklyOverrides[el.dataset.week ?? ''];
      paint();
      break;
    case 'save':
      void doSave();
      break;
    case 'publish':
      void doPublish();
      break;
    default:
      break;
  }
}

async function doSave(): Promise<void> {
  status('Saving draft…');
  const res = await saveAdminDraft(LIVEOPS_DRAFT_KEY, { ...draft, savedAt: Date.now() });
  status(esc(draftStatusMessage(res, 'Save')));
}

async function doPublish(): Promise<void> {
  const errors = validateLiveOpsConfig(draft);
  if (errors.length) {
    status(`⛔ Publish blocked:<ul>${errors.map((e2) => `<li>${esc(e2)}</li>`).join('')}</ul>`);
    return;
  }
  status('Publishing…');
  const payload: LiveOpsConfig = {
    ...draft,
    version: (Number(draft.version) || 0) + 1,
    publishedAt: Date.now()
  };
  const res = await publishLiveOpsConfig(payload);
  if (res.status === 'saved') {
    draft.version = payload.version;
    draft.publishedAt = payload.publishedAt;
    status(`✅ Published v${payload.version} — live for all players.`);
  } else if (res.status === 'denied') {
    status('⛔ Permission denied — deploy the /liveOpsConfig rule + /admins node (docs/FIREBASE_SETUP.md).');
  } else if (res.status === 'skipped') {
    status('⚠️ Not signed in — sign in as an admin to publish.');
  } else {
    status(`⚠️ Publish failed (offline/other): ${esc(res.error ?? 'unknown')}.`);
  }
}
