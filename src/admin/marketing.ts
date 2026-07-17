/**
 * Admin → Marketing Manager. Edits the `/marketingConfig` node that drives the
 * public About page (marketing.html): reorder / enable / caption clips, pick
 * videos + posters from the committed library, choose the hero reel, set a simple
 * trim window, edit the hero copy + course gallery, live-preview the draft, and
 * publish. Reached from the admin dashboard (src/admin/main.ts); the admin is
 * already signed in and allow-listed there.
 *
 * Library-select only — no upload / no Firebase Storage (v1 is intentionally
 * simple). Publish writes via the signed-in admin's token; until the RTDB rule
 * in docs/FIREBASE_SETUP.md is deployed it returns permission-denied and the
 * live page keeps its static fallback (safe).
 */
import { LEADERBOARD_URL } from '../config';
import {
  DEFAULT_MARKETING_CONFIG,
  IMAGE_LIBRARY,
  LibItem,
  MarketingConfig,
  POSTER_LIBRARY,
  VIDEO_LIBRARY,
  clipTile,
  escHtml,
  fetchMarketingConfigREST,
  resolveRenderModel
} from '../marketing/config';
import { loadMarketingConfig, publishMarketingConfig } from '../firebase/MarketingConfig';

function esc(s: string): string {
  return escHtml(s);
}
function escAttr(s: string): string {
  return esc(s).replace(/"/g, '&quot;');
}
function clone<T>(o: T): T {
  return JSON.parse(JSON.stringify(o)) as T;
}

let draft: MarketingConfig;
let mountApp: HTMLElement;
let mountBack: () => void;
let statusMsg = '';

/** Sort clips/courses into array order and coerce fields to safe defaults. */
function normalize(cfg: MarketingConfig): MarketingConfig {
  const c = clone(cfg);
  c.clips = (Array.isArray(c.clips) ? c.clips : [])
    .map((x, i) => ({
      ...x,
      trimStart: Number(x.trimStart) || 0,
      trimEnd: Number(x.trimEnd) || 0,
      enabled: x.enabled !== false,
      heroFlag: !!x.heroFlag,
      order: typeof x.order === 'number' ? x.order : i
    }))
    .sort((a, b) => a.order - b.order);
  c.courses = (Array.isArray(c.courses) ? c.courses : [])
    .map((x, i) => ({ ...x, enabled: x.enabled !== false, order: typeof x.order === 'number' ? x.order : i }))
    .sort((a, b) => a.order - b.order);
  // Only one hero
  let seenHero = false;
  for (const clip of c.clips) {
    if (clip.heroFlag && !seenHero) seenHero = true;
    else clip.heroFlag = false;
  }
  if (!c.hero) c.hero = clone(DEFAULT_MARKETING_CONFIG.hero);
  if (!c.reel) c.reel = clone(DEFAULT_MARKETING_CONFIG.reel);
  if (!Array.isArray(c.hero.stats)) c.hero.stats = [];
  return c;
}

export async function renderMarketingManager(app: HTMLElement, onBack: () => void): Promise<void> {
  mountApp = app;
  mountBack = onBack;
  app.innerHTML = `<p class="sub">Loading marketing config…</p>`;
  const loaded = (await loadMarketingConfig()) ?? (await fetchMarketingConfigREST(LEADERBOARD_URL));
  draft = normalize(loaded ?? DEFAULT_MARKETING_CONFIG);
  statusMsg = loaded ? 'Loaded the published config.' : 'No published config yet — editing the built-in default.';
  paint();
}

function optionsHtml(items: LibItem[], current: string): string {
  const known = items.some((i) => i.value === current);
  const extra = current && !known ? `<option value="${escAttr(current)}" selected>${esc(current)} (current)</option>` : '';
  return (
    extra +
    items
      .map((i) => `<option value="${escAttr(i.value)}"${i.value === current ? ' selected' : ''}>${esc(i.label)}</option>`)
      .join('')
  );
}

function clipRowHtml(idx: number, total: number): string {
  const c = draft.clips[idx];
  return `<div class="mm-clip" data-idx="${idx}">
    <div class="mm-clip-head">
      <span class="mm-ord">#${idx + 1}</span>
      <button class="mm-icon" data-action="up" data-scope="clip" data-idx="${idx}" ${idx === 0 ? 'disabled' : ''}>↑</button>
      <button class="mm-icon" data-action="down" data-scope="clip" data-idx="${idx}" ${idx === total - 1 ? 'disabled' : ''}>↓</button>
      <label class="mm-check"><input type="checkbox" data-action="enable" data-scope="clip" data-idx="${idx}" ${c.enabled ? 'checked' : ''}/> Enabled</label>
      <label class="mm-check"><input type="radio" name="mm-hero" data-action="hero" data-idx="${idx}" ${c.heroFlag ? 'checked' : ''}/> Hero reel</label>
    </div>
    <div class="mm-grid2">
      <div class="mm-prev-wrap"><video class="mm-prev" data-role="rowprev" muted playsinline preload="metadata"
        poster="${escAttr(c.poster)}" data-trim-start="${c.trimStart}" data-trim-end="${c.trimEnd}">
        <source src="${escAttr(c.videoFile)}" type="video/mp4" /></video></div>
      <div class="mm-fields">
        <label class="mm-lbl">Video<select data-field="videoFile" data-scope="clip" data-idx="${idx}">${optionsHtml(VIDEO_LIBRARY, c.videoFile)}</select></label>
        <label class="mm-lbl">Poster<select data-field="poster" data-scope="clip" data-idx="${idx}">${optionsHtml(POSTER_LIBRARY, c.poster)}</select></label>
        <label class="mm-lbl">Badge<input type="text" data-field="badge" data-scope="clip" data-idx="${idx}" value="${escAttr(c.badge)}"/></label>
        <label class="mm-lbl">Title<input type="text" data-field="title" data-scope="clip" data-idx="${idx}" value="${escAttr(c.title)}"/></label>
        <label class="mm-lbl">Caption<input type="text" data-field="caption" data-scope="clip" data-idx="${idx}" value="${escAttr(c.caption)}"/></label>
        <label class="mm-lbl">Description<textarea data-field="description" data-scope="clip" data-idx="${idx}" rows="2">${esc(c.description || '')}</textarea></label>
        <div class="mm-trim">
          <label class="mm-lbl mm-num">Trim start (s)<input type="number" min="0" step="0.1" data-field="trimStart" data-scope="clip" data-idx="${idx}" value="${c.trimStart}"/></label>
          <label class="mm-lbl mm-num">Trim end (s)<input type="number" min="0" step="0.1" data-field="trimEnd" data-scope="clip" data-idx="${idx}" value="${c.trimEnd}"/></label>
        </div>
      </div>
    </div>
  </div>`;
}

function courseRowHtml(idx: number, total: number): string {
  const c = draft.courses[idx];
  return `<div class="mm-course" data-idx="${idx}">
    <div class="mm-clip-head">
      <span class="mm-ord">#${idx + 1}</span>
      <button class="mm-icon" data-action="up" data-scope="course" data-idx="${idx}" ${idx === 0 ? 'disabled' : ''}>↑</button>
      <button class="mm-icon" data-action="down" data-scope="course" data-idx="${idx}" ${idx === total - 1 ? 'disabled' : ''}>↓</button>
      <label class="mm-check"><input type="checkbox" data-action="enable" data-scope="course" data-idx="${idx}" ${c.enabled ? 'checked' : ''}/> Enabled</label>
    </div>
    <label class="mm-lbl">Art<select data-field="art" data-scope="course" data-idx="${idx}">${optionsHtml(IMAGE_LIBRARY, c.art)}</select></label>
    <label class="mm-lbl">Title<input type="text" data-field="title" data-scope="course" data-idx="${idx}" value="${escAttr(c.title)}"/></label>
    <label class="mm-lbl">Description<textarea data-field="desc" data-scope="course" data-idx="${idx}" rows="2">${esc(c.desc)}</textarea></label>
  </div>`;
}

function heroSectionHtml(): string {
  const h = draft.hero;
  const stats = h.stats
    .map(
      (s, i) => `<div class="mm-trim">
      <label class="mm-lbl mm-num">Value<input type="text" data-field="value" data-scope="stat" data-idx="${i}" value="${escAttr(s.value)}"/></label>
      <label class="mm-lbl">Label<input type="text" data-field="label" data-scope="stat" data-idx="${i}" value="${escAttr(s.label)}"/></label>
    </div>`
    )
    .join('');
  return `<section><h2>Hero</h2>
    <label class="mm-lbl">Plate image<select data-field="plateImage" data-scope="hero">${optionsHtml(IMAGE_LIBRARY, h.plateImage)}</select></label>
    <label class="mm-lbl">Title<input type="text" data-field="title" data-scope="hero" value="${escAttr(h.title)}"/></label>
    <label class="mm-lbl">Lede<textarea data-field="lede" data-scope="hero" rows="3">${esc(h.lede)}</textarea></label>
    <h3>Stats</h3>${stats}
  </section>`;
}

function reelSectionHtml(): string {
  const r = draft.reel;
  const heroClip = draft.clips.find((c) => c.heroFlag && c.enabled);
  const note = heroClip
    ? `<p class="sub">A clip is flagged as Hero (“${esc(heroClip.title)}”) — it overrides this reel on the live page.</p>`
    : `<p class="sub">No clip flagged Hero — this reel video is used for the highlight slot.</p>`;
  return `<section><h2>Highlight reel (fallback)</h2>${note}
    <label class="mm-check"><input type="checkbox" data-action="enable" data-scope="reel" ${r.enabled ? 'checked' : ''}/> Reel enabled</label>
    <label class="mm-lbl">Video<select data-field="videoFile" data-scope="reel">${optionsHtml(VIDEO_LIBRARY, r.videoFile)}</select></label>
    <label class="mm-lbl">Poster<select data-field="poster" data-scope="reel">${optionsHtml(POSTER_LIBRARY, r.poster)}</select></label>
  </section>`;
}

function previewHtml(): string {
  const m = resolveRenderModel(draft);
  const reel = m.reel.enabled && m.reel.file
    ? `<div class="mm-reel"><video class="mm-prev" muted playsinline preload="metadata" poster="${escAttr(m.reel.poster)}"
        data-trim-start="${m.reel.trimStart}" data-trim-end="${m.reel.trimEnd}"><source src="${escAttr(m.reel.file)}" type="video/mp4" /></video></div>`
    : '';
  return `<section id="mm-preview"><h2>Preview</h2>
    <button class="btn back" data-action="refresh-preview">↻ Update preview</button>
    <div class="mm-pv-hero" style="background-image:url('${escAttr(m.hero.plateImage)}')">
      <h3>${esc(m.hero.title)}</h3><p>${esc(m.hero.lede)}</p>
      <div class="mm-pv-stats">${m.hero.stats.map((s) => `<span><b>${esc(s.value)}</b> ${esc(s.label)}</span>`).join('')}</div>
    </div>
    ${reel}
    <div class="clip-grid mm-pv-grid">${m.clips.map(clipTile).join('')}</div>
    <div class="mm-pv-courses">${m.courses.map((c) => `<div class="mm-pv-course"><img src="${escAttr(c.art)}" alt="${escAttr(c.title)}"/><b>${esc(c.title)}</b></div>`).join('')}</div>
  </section>`;
}

function paint(): void {
  const total = draft.clips.length;
  const cTotal = draft.courses.length;
  mountApp.innerHTML = `<div id="mm">
    <button class="btn back" data-action="back">← Back to dashboard</button>
    <h1>🎬 Marketing Manager</h1>
    <p class="sub">${esc(statusMsg)}</p>
    ${heroSectionHtml()}
    <section><h2>Gameplay clips</h2>
      <p class="sub">Reorder, toggle, caption, pick a library video + poster, set a hero and a trim window.</p>
      ${draft.clips.map((_, i) => clipRowHtml(i, total)).join('')}
    </section>
    ${reelSectionHtml()}
    <section><h2>Course gallery</h2>
      ${draft.courses.map((_, i) => courseRowHtml(i, cTotal)).join('')}
    </section>
    ${previewHtml()}
    <section><h2>Publish</h2>
      <p class="sub">Writes <code>/marketingConfig</code> for all players. Needs the RTDB rule in docs/FIREBASE_SETUP.md.</p>
      <button class="btn" data-action="publish">Publish to live</button>
      <button class="btn back" data-action="revert">Revert to built-in default</button>
      <p class="sub" id="mm-publish-status"></p>
    </section>
  </div>`;

  const root = document.getElementById('mm')!;
  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
  root.addEventListener('click', onClick);
  wirePreviewVideos(root);
}

/** Apply a trim window + autoplay muted (admin previews aren't IO-gated). */
function wireVideo(v: HTMLVideoElement): void {
  const start = Number(v.dataset.trimStart) || 0;
  const end = Number(v.dataset.trimEnd) || 0;
  const seek = (): void => {
    try {
      if (start > 0) v.currentTime = start;
    } catch {
      /* metadata not ready */
    }
  };
  v.addEventListener('loadedmetadata', seek);
  if (v.readyState >= 1) seek();
  if (end > 0) {
    v.removeAttribute('loop');
    v.addEventListener('timeupdate', () => {
      if (v.currentTime >= end) {
        try {
          v.currentTime = start;
        } catch {
          /* ignore */
        }
      }
    });
  } else {
    v.loop = true;
  }
  void v.play().catch(() => undefined);
}

function wirePreviewVideos(root: HTMLElement): void {
  root.querySelectorAll<HTMLVideoElement>('video.mm-prev').forEach(wireVideo);
}

function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function onInput(e: Event): void {
  const t = e.target as HTMLInputElement | HTMLTextAreaElement;
  const field = t.dataset.field;
  const scope = t.dataset.scope;
  if (!field || !scope) return;
  const idx = Number(t.dataset.idx);
  if (scope === 'clip') {
    const clip = draft.clips[idx] as unknown as Record<string, unknown>;
    if (field === 'trimStart' || field === 'trimEnd') {
      clip[field] = num(t.value);
      const row = (t.closest('.mm-clip') as HTMLElement | null)?.querySelector<HTMLVideoElement>('video[data-role=rowprev]');
      if (row) {
        row.dataset.trimStart = String(draft.clips[idx].trimStart);
        row.dataset.trimEnd = String(draft.clips[idx].trimEnd);
      }
    } else {
      clip[field] = t.value;
    }
  } else if (scope === 'course') {
    (draft.courses[idx] as unknown as Record<string, unknown>)[field] = t.value;
  } else if (scope === 'hero') {
    (draft.hero as unknown as Record<string, unknown>)[field] = t.value;
  } else if (scope === 'stat') {
    (draft.hero.stats[idx] as unknown as Record<string, unknown>)[field] = t.value;
  }
}

function onChange(e: Event): void {
  const t = e.target as HTMLInputElement | HTMLSelectElement;
  const scope = t.dataset.scope;
  const action = t.dataset.action;
  const idx = Number(t.dataset.idx);

  if (action === 'enable') {
    const checked = (t as HTMLInputElement).checked;
    if (scope === 'clip') draft.clips[idx].enabled = checked;
    else if (scope === 'course') draft.courses[idx].enabled = checked;
    else if (scope === 'reel') draft.reel.enabled = checked;
    return;
  }
  if (action === 'hero') {
    draft.clips.forEach((c, i) => (c.heroFlag = i === idx));
    return;
  }

  const field = t.dataset.field;
  if (!field) return;
  if (scope === 'clip') {
    (draft.clips[idx] as unknown as Record<string, unknown>)[field] = t.value;
    if (field === 'videoFile' || field === 'poster') {
      const wrap = t.closest('.mm-clip') as HTMLElement | null;
      const v = wrap?.querySelector<HTMLVideoElement>('video[data-role=rowprev]');
      if (v) {
        if (field === 'poster') v.poster = t.value;
        else {
          const src = v.querySelector('source');
          if (src) src.setAttribute('src', t.value);
          v.load();
          wireVideo(v);
        }
      }
    }
  } else if (scope === 'course') {
    (draft.courses[idx] as unknown as Record<string, unknown>)[field] = t.value;
  } else if (scope === 'hero') {
    (draft.hero as unknown as Record<string, unknown>)[field] = t.value;
  } else if (scope === 'reel') {
    (draft.reel as unknown as Record<string, unknown>)[field] = t.value;
  }
}

function reorder<T>(arr: T[], idx: number, dir: number): void {
  const j = idx + dir;
  if (j < 0 || j >= arr.length) return;
  const tmp = arr[idx];
  arr[idx] = arr[j];
  arr[j] = tmp;
}

function onClick(e: Event): void {
  const el = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
  if (!el) return;
  const action = el.dataset.action;
  const scope = el.dataset.scope;
  const idx = Number(el.dataset.idx);
  switch (action) {
    case 'back':
      mountBack();
      break;
    case 'up':
    case 'down':
      if (scope === 'clip') reorder(draft.clips, idx, action === 'up' ? -1 : 1);
      else if (scope === 'course') reorder(draft.courses, idx, action === 'up' ? -1 : 1);
      paint();
      break;
    case 'refresh-preview': {
      const host = document.getElementById('mm-preview');
      if (host) {
        host.outerHTML = previewHtml();
        wirePreviewVideos(document.getElementById('mm')!);
      }
      break;
    }
    case 'revert':
      draft = normalize(DEFAULT_MARKETING_CONFIG);
      statusMsg = 'Reverted to the built-in default (not yet published).';
      paint();
      break;
    case 'publish':
      void doPublish();
      break;
    default:
      break;
  }
}

/** Build the publishable config: array order → order fields, bump version. */
function publishable(): MarketingConfig {
  const out = clone(draft);
  out.clips.forEach((c, i) => {
    c.order = i;
    c.trimStart = num(String(c.trimStart));
    c.trimEnd = num(String(c.trimEnd));
  });
  out.courses.forEach((c, i) => (c.order = i));
  out.version = (Number(draft.version) || 0) + 1;
  out.publishedAt = Date.now();
  return out;
}

async function doPublish(): Promise<void> {
  const status = document.getElementById('mm-publish-status');
  if (status) status.textContent = 'Publishing…';
  const payload = publishable();
  const res = await publishMarketingConfig(payload);
  if (!status) return;
  if (res.status === 'saved') {
    draft.version = payload.version;
    draft.publishedAt = payload.publishedAt;
    status.textContent = `✅ Published v${payload.version} — live for all players.`;
  } else if (res.status === 'denied') {
    status.textContent =
      '⛔ Permission denied — deploy the /marketingConfig rule + /admins node (docs/FIREBASE_SETUP.md). ' +
      'The live page keeps its static fallback until then.';
  } else if (res.status === 'skipped') {
    status.textContent = '⚠️ Not signed in — sign in as an admin to publish.';
  } else {
    status.textContent = `⚠️ Publish failed (offline/other): ${esc(res.error ?? 'unknown')}. Try again.`;
  }
}
