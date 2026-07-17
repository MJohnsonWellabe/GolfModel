/**
 * Admin → Next Season Pass staging area. A staging-ONLY editor for drafting the
 * NEXT season's pass. It NEVER activates or affects the live season — there is
 * no "go live" control here; the draft persists to `/adminDrafts/nextSeasonPass`
 * (via firebase/AdminDrafts) for later hand-off to a real SeasonDef.
 *
 * Mirrors the Marketing Manager's house style (src/admin/marketing.ts): a single
 * `draft` module variable, a `paint()` re-render, and one delegated listener per
 * event type on the root. The draft is shaped to the live `SeasonDef` schema
 * (src/data/seasonPass.ts) — same id/name/dates/xpPerLevel/rewards fields — plus
 * a few staging-only marketing fields (theme, headline reward, artwork, copy) so
 * it can later seed a genuine SeasonDef.
 *
 * Load/save honesty: a draft is NEVER reported saved when the write did not land
 * (denied/offline/skipped surface a real error, but local editing continues).
 */
import { SeasonDef, SeasonReward, SEASON_1 } from '../data/seasonPass';
import { IMAGE_LIBRARY } from '../marketing/config';
import { loadAdminDraft, saveAdminDraft, draftStatusMessage } from '../firebase/AdminDrafts';

// ---- Draft schema -----------------------------------------------------------

export interface SeasonPassDraft {
  id: string;
  name: string;
  /** Art / theme label — the headline theme of the season. */
  theme: string;
  /** ISO date (inclusive) the season starts. */
  start: string;
  /** ISO date (inclusive) the season ends. */
  end: string;
  /** ISO instant real-money purchases open. */
  salesOpenAt: string;
  levels: number;
  /** Length === levels; per-level XP thresholds. */
  xpPerLevel: number[];
  /** Length === levels; the free/premium reward for each level, in level order. */
  rewards: SeasonReward[];
  /** Marquee / headline reward label. */
  headlineReward: string;
  /** Image path from the committed library. */
  artwork: string;
  /** Marketing copy / description. */
  copy: string;
  /** Epoch ms of the last save (stamped by publishableDraft); read by the admin
   *  landing to show a last-saved time. Optional so older drafts still load. */
  savedAt?: number;
}

/** The five reward variants, as an editable discriminator. */
export type RewardKind = 'item' | 'perk' | 'coins' | 'xp' | 'trueVision';
const REWARD_KINDS: RewardKind[] = ['item', 'perk', 'coins', 'xp', 'trueVision'];

const DRAFT_KEY = 'nextSeasonPass';
const MIN_LEVELS = 1;
const MAX_LEVELS = 100;
const DEFAULT_LEVEL_XP = 1000;
/** Sensible reward for a freshly-grown level (owner can retype it). */
const defaultReward = (): SeasonReward => ({ coins: 50 });
const defaultArtwork = (): string => IMAGE_LIBRARY[0]?.value ?? '';

// ---- Small pure helpers -----------------------------------------------------

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function escAttr(s: string): string {
  return esc(s).replace(/"/g, '&quot;');
}
function clone<T>(o: T): T {
  return JSON.parse(JSON.stringify(o)) as T;
}
/** Coerce a text field to a finite number (NaN → 0). */
function num(v: string | number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function clampLevels(n: number): number {
  const v = Math.round(num(n));
  return Math.max(MIN_LEVELS, Math.min(MAX_LEVELS, v));
}

/** The reward union's discriminating key. */
export function rewardKind(r: SeasonReward): RewardKind {
  if ('item' in r) return 'item';
  if ('perk' in r) return 'perk';
  if ('coins' in r) return 'coins';
  if ('xp' in r) return 'xp';
  return 'trueVision';
}
/** The reward's payload as a raw editable string. */
export function rewardRawValue(r: SeasonReward): string {
  return String((r as Record<string, unknown>)[rewardKind(r)] ?? '');
}
/** Build a reward from a kind + a raw value (numeric kinds are coerced). */
export function makeReward(kind: RewardKind, value: string | number): SeasonReward {
  switch (kind) {
    case 'item':
      return { item: String(value) };
    case 'perk':
      return { perk: String(value) };
    case 'coins':
      return { coins: num(value) };
    case 'xp':
      return { xp: num(value) };
    case 'trueVision':
      return { trueVision: num(value) };
  }
}
/** Human-readable reward label for the preview panel. */
export function rewardLabel(r: SeasonReward): string {
  switch (rewardKind(r)) {
    case 'item':
      return `Item: ${(r as { item: string }).item || '—'}`;
    case 'perk':
      return `Perk: ${(r as { perk: string }).perk || '—'}`;
    case 'coins':
      return `${(r as { coins: number }).coins} J-Coins`;
    case 'xp':
      return `${(r as { xp: number }).xp} XP`;
    case 'trueVision':
      return `True Vision ×${(r as { trueVision: number }).trueVision}`;
  }
}

// ---- Pure draft factories / transforms (exported for tests) -----------------

/** A fresh, VALID starting draft (arrays sized to `levels`). */
export function defaultDraft(): SeasonPassDraft {
  const levels = 10;
  return {
    id: 'season_next',
    name: 'Next Season',
    theme: '',
    start: '2026-12-01',
    end: '2027-03-31',
    salesOpenAt: '2026-12-01T00:00:00Z',
    levels,
    xpPerLevel: Array.from({ length: levels }, () => DEFAULT_LEVEL_XP),
    rewards: Array.from({ length: levels }, () => defaultReward()),
    headlineReward: '',
    artwork: defaultArtwork(),
    copy: ''
  };
}

/** Seed a draft from a live SeasonDef ("Duplicate current season"). Keeps the
 *  level track (levels/xpPerLevel/rewards) but mints a distinct id so it can
 *  never be mistaken for — or overwrite — the live season. */
export function duplicateFromSeason(def: SeasonDef): SeasonPassDraft {
  return {
    id: `${def.id}_next`,
    name: `${def.name} (Next)`,
    theme: '',
    start: def.start,
    end: def.end,
    salesOpenAt: def.salesOpenAt,
    levels: def.levels,
    xpPerLevel: def.xpPerLevel.slice(),
    rewards: clone(def.rewards),
    headlineReward: rewardLabel(def.rewards[def.rewards.length - 1] ?? defaultReward()),
    artwork: defaultArtwork(),
    copy: ''
  };
}

/** Resize the level track to `n` levels: grow with sensible defaults, shrink by
 *  truncation. Keeps xpPerLevel and rewards in lock-step with `levels`. */
export function resizeLevels(d: SeasonPassDraft, n: number): SeasonPassDraft {
  const levels = clampLevels(n);
  const out = clone(d);
  out.levels = levels;
  out.xpPerLevel = d.xpPerLevel.slice(0, levels);
  while (out.xpPerLevel.length < levels) out.xpPerLevel.push(DEFAULT_LEVEL_XP);
  out.rewards = clone(d.rewards).slice(0, levels);
  while (out.rewards.length < levels) out.rewards.push(defaultReward());
  return out;
}

/** Swap a level's XP threshold AND its reward with the adjacent level (reorder
 *  keeps the two arrays aligned). `dir` = -1 (up) or +1 (down). */
export function moveLevel(d: SeasonPassDraft, idx: number, dir: -1 | 1): SeasonPassDraft {
  const j = idx + dir;
  if (j < 0 || j >= d.levels) return d;
  const out = clone(d);
  [out.xpPerLevel[idx], out.xpPerLevel[j]] = [out.xpPerLevel[j], out.xpPerLevel[idx]];
  [out.rewards[idx], out.rewards[j]] = [out.rewards[j], out.rewards[idx]];
  return out;
}

/** Coerce a draft to a well-formed, persistable shape: arrays synced to
 *  `levels`, xp thresholds numeric, strings trimmed. Pure — used before save. */
export function normalizeDraft(d: SeasonPassDraft): SeasonPassDraft {
  const out = resizeLevels(d, d.levels);
  out.id = String(out.id).trim();
  out.name = String(out.name).trim();
  out.theme = String(out.theme).trim();
  out.headlineReward = String(out.headlineReward).trim();
  out.copy = String(out.copy).trim();
  out.artwork = String(out.artwork).trim();
  out.xpPerLevel = out.xpPerLevel.map((x) => num(x));
  return out;
}

// ---- Validation (pure, exported & tested) -----------------------------------

/** Human-readable problems with a draft. Empty ⇒ ready to seed a SeasonDef. */
export function validateSeasonPassDraft(d: SeasonPassDraft): string[] {
  const errs: string[] = [];
  if (!d.name || !d.name.trim()) errs.push('Season name is required.');
  if (!Number.isInteger(d.levels) || d.levels < MIN_LEVELS || d.levels > MAX_LEVELS) {
    errs.push(`Level count must be a whole number between ${MIN_LEVELS} and ${MAX_LEVELS}.`);
  }
  if (d.xpPerLevel.length !== d.levels) {
    errs.push(`XP thresholds (${d.xpPerLevel.length}) must have one entry per level (${d.levels}).`);
  }
  if (d.rewards.length !== d.levels) {
    errs.push(`Rewards (${d.rewards.length}) must have one entry per level (${d.levels}).`);
  }
  d.xpPerLevel.forEach((x, i) => {
    if (!Number.isFinite(x) || x <= 0) errs.push(`Level ${i + 1}: XP threshold must be a positive number.`);
  });
  const startT = Date.parse(d.start);
  const endT = Date.parse(d.end);
  if (Number.isNaN(startT)) errs.push('Start date is not a valid date.');
  if (Number.isNaN(endT)) errs.push('End date is not a valid date.');
  if (!Number.isNaN(startT) && !Number.isNaN(endT) && startT > endT) {
    errs.push('Start date must be on or before the end date.');
  }
  if (Number.isNaN(Date.parse(d.salesOpenAt))) errs.push('Sales-open time is not a valid date/time.');
  d.rewards.forEach((r, i) => {
    const kind = rewardKind(r);
    if (!REWARD_KINDS.includes(kind)) {
      errs.push(`Level ${i + 1}: unknown reward type.`);
      return;
    }
    if (kind === 'coins' || kind === 'xp' || kind === 'trueVision') {
      const v = (r as Record<string, number>)[kind];
      if (!Number.isFinite(v) || v <= 0) errs.push(`Level ${i + 1}: ${kind} amount must be greater than 0.`);
    } else {
      const v = (r as Record<string, string>)[kind];
      if (!v || !String(v).trim()) errs.push(`Level ${i + 1}: ${kind} id is required.`);
    }
  });
  if (!d.artwork || !d.artwork.trim()) errs.push('Artwork is required — pick an image from the library.');
  return errs;
}

// ---- Editor (DOM) -----------------------------------------------------------

let draft: SeasonPassDraft;
let mountApp: HTMLElement;
let mountBack: () => void;
let statusMsg = '';

/** Ensure our scoped stylesheet is present exactly once (we never edit admin.html). */
function ensureStyle(): void {
  if (document.getElementById('sps-style')) return;
  const s = document.createElement('style');
  s.id = 'sps-style';
  s.textContent = `
  #sps .sps-badge{display:inline-block;background:#b91c1c;color:#fff;font-weight:700;
    letter-spacing:.06em;padding:4px 10px;border-radius:6px;font-size:12px;margin-left:8px;vertical-align:middle}
  #sps .sps-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
  #sps .sps-lbl{display:flex;flex-direction:column;gap:4px;font-size:13px;color:#cbd5e1}
  #sps .sps-lbl input,#sps .sps-lbl select,#sps .sps-lbl textarea{padding:6px;border-radius:6px;
    border:1px solid #334155;background:#0f172a;color:#e2e8f0}
  #sps .sps-lvl{display:grid;grid-template-columns:auto auto auto 1fr 1.2fr 1.4fr;gap:8px;align-items:end;
    padding:6px;border-bottom:1px solid #1e293b}
  #sps .sps-lvl .sps-ord{font-weight:700;color:#94a3b8;min-width:34px}
  #sps .sps-icon{padding:4px 8px;border-radius:6px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;cursor:pointer}
  #sps .sps-icon:disabled{opacity:.35;cursor:default}
  #sps .sps-errs{border:1px solid #b91c1c;background:#450a0a;color:#fecaca;border-radius:8px;padding:10px;margin:8px 0}
  #sps .sps-errs ul{margin:4px 0 0 18px}
  #sps .sps-ok{color:#86efac}
  #sps .sps-preview{border:1px solid #334155;border-radius:10px;padding:12px;background:#0b1220}
  #sps .sps-thumb{max-width:220px;border-radius:8px;display:block;margin:6px 0}
  #sps .sps-pv-row{display:flex;justify-content:space-between;gap:10px;padding:3px 0;border-bottom:1px dashed #1e293b}
  #sps .sps-warn{color:#fca5a5}`;
  document.head.appendChild(s);
}

export async function renderSeasonPassStaging(app: HTMLElement, onBack: () => void): Promise<void> {
  mountApp = app;
  mountBack = onBack;
  ensureStyle();
  app.innerHTML = `<p class="sub">Loading next-season draft…</p>`;

  const { value, status } = await loadAdminDraft<SeasonPassDraft>(DRAFT_KEY);
  if (value) {
    // A saved draft may predate a schema tweak — normalize so the arrays line up.
    draft = normalizeDraft({ ...defaultDraft(), ...value });
    statusMsg = 'Loaded your saved draft.';
  } else if (status === 'saved') {
    draft = defaultDraft();
    statusMsg = 'No draft yet — starting a new one.';
  } else {
    // denied / offline / skipped: let them edit locally, but be honest about it.
    draft = defaultDraft();
    statusMsg = `Couldn't load a saved draft — ${draftStatusMessage({ status }, 'Load')} You can still edit locally.`;
  }
  paint();
}

function optionsHtml(current: string): string {
  const known = IMAGE_LIBRARY.some((i) => i.value === current);
  const extra =
    current && !known ? `<option value="${escAttr(current)}" selected>${esc(current)} (current)</option>` : '';
  return (
    extra +
    IMAGE_LIBRARY.map(
      (i) => `<option value="${escAttr(i.value)}"${i.value === current ? ' selected' : ''}>${esc(i.label)}</option>`
    ).join('')
  );
}

function kindOptions(current: RewardKind): string {
  return REWARD_KINDS.map(
    (k) => `<option value="${k}"${k === current ? ' selected' : ''}>${k}</option>`
  ).join('');
}

function levelRowHtml(idx: number): string {
  const xp = draft.xpPerLevel[idx];
  const reward = draft.rewards[idx];
  const kind = rewardKind(reward);
  const numeric = kind === 'coins' || kind === 'xp' || kind === 'trueVision';
  const valInput = numeric
    ? `<input type="number" min="1" step="1" data-field="rewardValue" data-idx="${idx}" value="${escAttr(rewardRawValue(reward))}"/>`
    : `<input type="text" data-field="rewardValue" data-idx="${idx}" value="${escAttr(rewardRawValue(reward))}" placeholder="${kind} id"/>`;
  return `<div class="sps-lvl" data-idx="${idx}">
    <span class="sps-ord">L${idx + 1}</span>
    <button class="sps-icon" data-action="up" data-idx="${idx}" ${idx === 0 ? 'disabled' : ''}>↑</button>
    <button class="sps-icon" data-action="down" data-idx="${idx}" ${idx === draft.levels - 1 ? 'disabled' : ''}>↓</button>
    <label class="sps-lbl">XP<input type="number" min="1" step="1" data-field="xp" data-idx="${idx}" value="${escAttr(String(xp))}"/></label>
    <label class="sps-lbl">Reward type<select data-field="rewardKind" data-idx="${idx}">${kindOptions(kind)}</select></label>
    <label class="sps-lbl">Value${valInput}</label>
  </div>`;
}

function previewHtml(): string {
  const rows = draft.rewards
    .slice(0, 10)
    .map(
      (r, i) =>
        `<div class="sps-pv-row"><span>L${i + 1} · ${esc(String(draft.xpPerLevel[i]))} XP</span><span>${esc(rewardLabel(r))}</span></div>`
    )
    .join('');
  const more = draft.levels > 10 ? `<p class="sub">…and ${draft.levels - 10} more level(s).</p>` : '';
  const thumb = draft.artwork
    ? `<img class="sps-thumb" src="${escAttr(draft.artwork)}" alt="${escAttr(draft.name)} artwork"/>`
    : '';
  return `<div class="sps-preview" id="sps-preview">
    <h3>Preview <span class="sub">(read-only)</span></h3>
    <p><b>${esc(draft.name || 'Untitled season')}</b>${draft.theme ? ` — ${esc(draft.theme)}` : ''}</p>
    <p class="sub">${esc(draft.start)} → ${esc(draft.end)} · sales open ${esc(draft.salesOpenAt)} · ${draft.levels} levels</p>
    <p>Headline reward: <b>${esc(draft.headlineReward || '—')}</b></p>
    ${thumb}
    ${rows}
    ${more}
  </div>`;
}

function errorsHtml(): string {
  const errs = validateSeasonPassDraft(normalizeDraft(draft));
  if (errs.length === 0) return `<p class="sps-ok">✓ No validation issues — this draft could seed a real season.</p>`;
  return `<div class="sps-errs"><b>${errs.length} issue(s) to fix before this can seed a season:</b>
    <ul>${errs.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>`;
}

function paint(): void {
  mountApp.innerHTML = `<div id="sps">
    <button class="btn back" data-action="back">← Back</button>
    <h1>🎟️ Next Season Pass <span class="sps-badge">DRAFT / NOT LIVE</span></h1>
    <p class="sub">Staging only — this never activates or touches the live season. Persists to <code>/adminDrafts/nextSeasonPass</code>.</p>
    <p class="sub" id="sps-status">${esc(statusMsg)}</p>

    <section><h2>Season details</h2>
      <div class="sps-grid">
        <label class="sps-lbl">Id<input type="text" data-field="id" value="${escAttr(draft.id)}"/></label>
        <label class="sps-lbl">Name<input type="text" data-field="name" value="${escAttr(draft.name)}"/></label>
        <label class="sps-lbl">Theme<input type="text" data-field="theme" value="${escAttr(draft.theme)}"/></label>
        <label class="sps-lbl">Start (ISO date)<input type="date" data-field="start" value="${escAttr(draft.start)}"/></label>
        <label class="sps-lbl">End (ISO date)<input type="date" data-field="end" value="${escAttr(draft.end)}"/></label>
        <label class="sps-lbl">Sales open (ISO instant)<input type="text" data-field="salesOpenAt" value="${escAttr(draft.salesOpenAt)}"/></label>
        <label class="sps-lbl">Levels<input type="number" min="${MIN_LEVELS}" max="${MAX_LEVELS}" step="1" data-field="levels" value="${escAttr(String(draft.levels))}"/></label>
        <label class="sps-lbl">Headline reward<input type="text" data-field="headlineReward" value="${escAttr(draft.headlineReward)}"/></label>
        <label class="sps-lbl">Artwork<select data-field="artwork">${optionsHtml(draft.artwork)}</select></label>
      </div>
      <label class="sps-lbl">Marketing copy<textarea data-field="copy" rows="3">${esc(draft.copy)}</textarea></label>
      <p><button class="btn back" data-action="duplicate">Duplicate current season</button></p>
    </section>

    <section><h2>Levels, rewards &amp; XP thresholds</h2>
      <p class="sub">Reorder levels (↑/↓ swap the XP threshold and reward together). Change the level count to grow/shrink the track.</p>
      <div id="sps-levels">${draft.rewards.map((_, i) => levelRowHtml(i)).join('')}</div>
    </section>

    <section><h2>Preview</h2>${previewHtml()}</section>

    <section><h2>Save draft</h2>
      <div id="sps-errbox">${errorsHtml()}</div>
      <button class="btn" data-action="save">Save draft</button>
      <p class="sub" id="sps-save-status"></p>
    </section>
  </div>`;

  const root = document.getElementById('sps')!;
  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
  root.addEventListener('click', onClick);
}

/** Refresh only the derived panels (preview + validation) after a text edit,
 *  so typing doesn't repaint the whole form and steal focus. */
function refreshDerived(): void {
  const pv = document.getElementById('sps-preview');
  if (pv) pv.outerHTML = previewHtml();
  const eb = document.getElementById('sps-errbox');
  if (eb) eb.innerHTML = errorsHtml();
}

function onInput(e: Event): void {
  const t = e.target as HTMLInputElement | HTMLTextAreaElement;
  const field = t.dataset.field;
  if (!field) return;
  const idx = Number(t.dataset.idx);
  switch (field) {
    case 'xp':
      draft.xpPerLevel[idx] = num(t.value);
      break;
    case 'rewardValue':
      draft.rewards[idx] = makeReward(rewardKind(draft.rewards[idx]), t.value);
      break;
    case 'id':
    case 'name':
    case 'theme':
    case 'start':
    case 'end':
    case 'salesOpenAt':
    case 'headlineReward':
    case 'copy':
      (draft as unknown as Record<string, string>)[field] = t.value;
      break;
    default:
      return;
  }
  refreshDerived();
}

function onChange(e: Event): void {
  const t = e.target as HTMLInputElement | HTMLSelectElement;
  const field = t.dataset.field;
  if (!field) return;
  const idx = Number(t.dataset.idx);
  if (field === 'levels') {
    draft = resizeLevels(draft, num(t.value));
    paint();
    return;
  }
  if (field === 'rewardKind') {
    // Preserve the current raw value where it still makes sense, else reset it.
    draft.rewards[idx] = makeReward(t.value as RewardKind, rewardRawValue(draft.rewards[idx]));
    paint();
    return;
  }
  if (field === 'artwork') {
    draft.artwork = t.value;
    refreshDerived();
    return;
  }
  // date inputs report via change too
  if (field === 'start' || field === 'end' || field === 'salesOpenAt') {
    (draft as unknown as Record<string, string>)[field] = t.value;
    refreshDerived();
  }
}

function onClick(e: Event): void {
  const el = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
  if (!el) return;
  const action = el.dataset.action;
  const idx = Number(el.dataset.idx);
  switch (action) {
    case 'back':
      mountBack();
      break;
    case 'duplicate':
      draft = duplicateFromSeason(SEASON_1);
      statusMsg = `Duplicated ${SEASON_1.name} into a fresh draft (id "${draft.id}"). Not yet saved.`;
      paint();
      break;
    case 'up':
      draft = moveLevel(draft, idx, -1);
      paint();
      break;
    case 'down':
      draft = moveLevel(draft, idx, 1);
      paint();
      break;
    case 'save':
      void doSave();
      break;
    default:
      break;
  }
}

/** The exact object written to `/adminDrafts/nextSeasonPass`. */
function publishableDraft(): SeasonPassDraft {
  return { ...normalizeDraft(draft), savedAt: Date.now() };
}

async function doSave(): Promise<void> {
  const status = document.getElementById('sps-save-status');
  if (status) status.textContent = 'Saving…';
  const res = await saveAdminDraft(DRAFT_KEY, publishableDraft());
  if (status) status.textContent = draftStatusMessage(res, 'Save');
}
