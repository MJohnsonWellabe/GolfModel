/**
 * Admin → Marketing Manager. Edits the `/marketingConfig` node that drives the
 * public About page (marketing.html): reorder / enable / caption clips, pick
 * videos + posters from the committed library, choose the hero reel, set a simple
 * trim window, edit the hero copy + course gallery, live-preview the draft, and
 * publish. Reached from the admin dashboard (src/admin/main.ts); the admin is
 * already signed in and allow-listed there.
 *
 * Two further responsibilities:
 *   - MONTAGE editor: build an ordered highlight sequence (add / remove / reorder
 *     / enable / per-clip library video + poster / trim window / cut-or-fade
 *     transition) with a live SEQUENCE preview that plays the enabled clips in
 *     order (applying each trim window and a hard cut or ~0.3s crossfade) and
 *     loops — chained <video> playback, no libraries, no re-encoding.
 *   - IMAGE management: every marketing image (hero plate, course art, clip and
 *     reel posters, montage posters) is a committed-library <select> with a live
 *     preview thumbnail, an alt-text input and a revert-to-default button. Broken
 *     / off-library paths are flagged inline and BLOCK publishing (validated via
 *     validateImagePaths).
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
  MontageRender,
  POSTER_LIBRARY,
  VIDEO_LIBRARY,
  clipTile,
  escHtml,
  fetchMarketingConfigREST,
  isKnownImage,
  isKnownPoster,
  resolveRenderModel,
  revertImagePath,
  validateImagePaths
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

/** Small style extension for the montage editor + image controls. admin.html is
 *  not editable, so the CSS is self-injected once (mmx- prefix, .mm-* reused). */
const MMX_STYLE = `
  .mmx-img { margin-top: 8px; }
  .mmx-img-row { display: flex; gap: 12px; align-items: flex-start; margin-top: 6px; }
  .mmx-thumb {
    width: 96px; height: 60px; object-fit: cover; border-radius: 8px; flex: none;
    background: #071c10; border: 1px solid rgba(255,255,255,0.16);
  }
  .mmx-thumb.mmx-broken { outline: 2px solid #ff6b6b; }
  .mmx-img-side { flex: 1; min-width: 0; }
  .mmx-img-meta { display: flex; align-items: center; gap: 10px; margin-top: 6px; flex-wrap: wrap; }
  .mmx-img-meta code { font-size: 11px; word-break: break-all; }
  .mmx-badpath { display: block; margin-top: 6px; color: #ff8a80; font-size: 12px; font-weight: 700; }
  .mmx-hidden { display: none !important; }
  .mmx-mtg { border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; padding: 10px 12px 14px; margin-top: 12px; background: rgba(255,255,255,0.03); }
  .mmx-mtg-stage {
    position: relative; max-width: 240px; margin: 8px auto 0; aspect-ratio: 9 / 16;
    border-radius: 10px; overflow: hidden; background: #071c10;
  }
  .mmx-mtg-stage video, .mmx-mtg-stage img {
    position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;
    transition: opacity 0.3s ease;
  }
  .mmx-mtg-poster { opacity: 0; }
  .mmx-mtg-empty { color: #a9c9b0; font-size: 13px; text-align: center; padding: 24px 8px; }
  .mmx-mtg-badge { display: inline-block; margin-left: 6px; font-size: 11px; color: #a9c9b0; }
`;

function injectMmxStyle(): void {
  if (document.getElementById('mm-ext-style')) return;
  const s = document.createElement('style');
  s.id = 'mm-ext-style';
  s.textContent = MMX_STYLE;
  document.head.appendChild(s);
}

/** Sort clips/courses/montage into array order and coerce fields to safe defaults. */
function normalize(cfg: MarketingConfig): MarketingConfig {
  const c = clone(cfg);
  c.clips = (Array.isArray(c.clips) ? c.clips : [])
    .map((x, i) => ({
      ...x,
      posterAlt: typeof x.posterAlt === 'string' ? x.posterAlt : '',
      trimStart: Number(x.trimStart) || 0,
      trimEnd: Number(x.trimEnd) || 0,
      enabled: x.enabled !== false,
      heroFlag: !!x.heroFlag,
      order: typeof x.order === 'number' ? x.order : i
    }))
    .sort((a, b) => a.order - b.order);
  c.courses = (Array.isArray(c.courses) ? c.courses : [])
    .map((x, i) => ({
      ...x,
      alt: typeof x.alt === 'string' ? x.alt : '',
      enabled: x.enabled !== false,
      order: typeof x.order === 'number' ? x.order : i
    }))
    .sort((a, b) => a.order - b.order);
  c.montage = (Array.isArray(c.montage) ? c.montage : [])
    .map((x, i) => ({
      id: x.id || `m${i}`,
      videoFile: x.videoFile,
      poster: x.poster,
      posterAlt: typeof x.posterAlt === 'string' ? x.posterAlt : '',
      enabled: x.enabled !== false,
      trimStart: Number(x.trimStart) || 0,
      trimEnd: Number(x.trimEnd) || 0,
      transition: (x.transition === 'fade' ? 'fade' : 'cut') as 'cut' | 'fade',
      order: typeof x.order === 'number' ? x.order : i
    }))
    .sort((a, b) => a.order - b.order);
  // Only one hero
  let seenHero = false;
  for (const clip of c.clips) {
    if (clip.heroFlag && !seenHero) seenHero = true;
    else clip.heroFlag = false;
  }
  if (!c.hero) c.hero = clone(DEFAULT_MARKETING_CONFIG.hero);
  if (!c.reel) c.reel = clone(DEFAULT_MARKETING_CONFIG.reel);
  if (typeof c.hero.plateAlt !== 'string') c.hero.plateAlt = '';
  if (typeof c.reel.posterAlt !== 'string') c.reel.posterAlt = '';
  if (!Array.isArray(c.hero.stats)) c.hero.stats = [];
  return c;
}

export async function renderMarketingManager(app: HTMLElement, onBack: () => void): Promise<void> {
  mountApp = app;
  mountBack = onBack;
  injectMmxStyle();
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

/**
 * A comprehensive image control: library <select>, live preview thumbnail, an
 * alt-text input, a revert-to-default button and an inline "not in library"
 * warning (kept in the DOM, toggled on change) that the publish gate also checks.
 */
function imageControlHtml(opts: {
  label: string;
  scope: string;
  idx: number | null;
  field: string;
  altField: string;
  library: LibItem[];
  isKnown: (p: string) => boolean;
  value: string;
  altValue: string;
}): string {
  const idxAttr = opts.idx === null ? '' : ` data-idx="${opts.idx}"`;
  const known = opts.isKnown(opts.value);
  const kind = opts.library === POSTER_LIBRARY ? 'poster' : 'image';
  return `<div class="mmx-img" data-imgkind="${kind}">
    <label class="mm-lbl">${esc(opts.label)}<select data-field="${escAttr(opts.field)}" data-scope="${escAttr(opts.scope)}"${idxAttr}>${optionsHtml(opts.library, opts.value)}</select></label>
    <div class="mmx-img-row">
      <img class="mmx-thumb${known ? '' : ' mmx-broken'}" data-role="imgprev" src="${escAttr(opts.value)}" alt="${escAttr(opts.altValue || opts.label)}" onerror="this.classList.add('mmx-broken')"/>
      <div class="mmx-img-side">
        <label class="mm-lbl">Alt text<input type="text" data-field="${escAttr(opts.altField)}" data-scope="${escAttr(opts.scope)}"${idxAttr} value="${escAttr(opts.altValue)}" placeholder="Describe this image for accessibility"/></label>
        <div class="mmx-img-meta">
          <code data-role="imgpath">${esc(opts.value || '(none)')}</code>
          <button class="mm-icon" data-action="revert-img" data-scope="${escAttr(opts.scope)}"${idxAttr} data-field="${escAttr(opts.field)}" data-alt-field="${escAttr(opts.altField)}">Revert</button>
        </div>
        <span class="mmx-badpath${known ? ' mmx-hidden' : ''}" data-role="imgwarn">⚠ Not in the committed library — fix before publishing.</span>
      </div>
    </div>
  </div>`;
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
        ${imageControlHtml({ label: 'Poster', scope: 'clip', idx, field: 'poster', altField: 'posterAlt', library: POSTER_LIBRARY, isKnown: isKnownPoster, value: c.poster, altValue: c.posterAlt ?? '' })}
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
    ${imageControlHtml({ label: 'Art', scope: 'course', idx, field: 'art', altField: 'alt', library: IMAGE_LIBRARY, isKnown: isKnownImage, value: c.art, altValue: c.alt ?? '' })}
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
    ${imageControlHtml({ label: 'Plate image', scope: 'hero', idx: null, field: 'plateImage', altField: 'plateAlt', library: IMAGE_LIBRARY, isKnown: isKnownImage, value: h.plateImage, altValue: h.plateAlt ?? '' })}
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
    ${imageControlHtml({ label: 'Poster', scope: 'reel', idx: null, field: 'poster', altField: 'posterAlt', library: POSTER_LIBRARY, isKnown: isKnownPoster, value: r.poster, altValue: r.posterAlt ?? '' })}
  </section>`;
}

function montageRowHtml(idx: number, total: number): string {
  const m = draft.montage![idx];
  return `<div class="mmx-mtg" data-idx="${idx}">
    <div class="mm-clip-head">
      <span class="mm-ord">#${idx + 1}</span>
      <button class="mm-icon" data-action="up" data-scope="montage" data-idx="${idx}" ${idx === 0 ? 'disabled' : ''}>↑</button>
      <button class="mm-icon" data-action="down" data-scope="montage" data-idx="${idx}" ${idx === total - 1 ? 'disabled' : ''}>↓</button>
      <label class="mm-check"><input type="checkbox" data-action="enable" data-scope="montage" data-idx="${idx}" ${m.enabled ? 'checked' : ''}/> Enabled</label>
      <button class="mm-icon" data-action="remove" data-scope="montage" data-idx="${idx}">✕ Remove</button>
    </div>
    <label class="mm-lbl">Video<select data-field="videoFile" data-scope="montage" data-idx="${idx}">${optionsHtml(VIDEO_LIBRARY, m.videoFile)}</select></label>
    ${imageControlHtml({ label: 'Poster (fallback still)', scope: 'montage', idx, field: 'poster', altField: 'posterAlt', library: POSTER_LIBRARY, isKnown: isKnownPoster, value: m.poster, altValue: m.posterAlt ?? '' })}
    <div class="mm-trim">
      <label class="mm-lbl mm-num">Trim start (s)<input type="number" min="0" step="0.1" data-field="trimStart" data-scope="montage" data-idx="${idx}" value="${m.trimStart}"/></label>
      <label class="mm-lbl mm-num">Trim end (s)<input type="number" min="0" step="0.1" data-field="trimEnd" data-scope="montage" data-idx="${idx}" value="${m.trimEnd}"/></label>
      <label class="mm-lbl mm-num">Transition out<select data-field="transition" data-scope="montage" data-idx="${idx}">
        <option value="cut"${m.transition === 'cut' ? ' selected' : ''}>Hard cut</option>
        <option value="fade"${m.transition === 'fade' ? ' selected' : ''}>Short fade</option>
      </select></label>
    </div>
  </div>`;
}

function montageSectionHtml(): string {
  const list = draft.montage ?? [];
  const total = list.length;
  const enabled = list.filter((m) => m.enabled).length;
  return `<section><h2>Highlight montage <span class="mmx-mtg-badge">${enabled} of ${total} clip(s) enabled</span></h2>
    <p class="sub">An ordered sequence that plays back-to-back as one reel — chained clips, each with its own trim window and a hard cut or a short crossfade into the next.</p>
    ${list.map((_, i) => montageRowHtml(i, total)).join('')}
    <button class="btn back" data-action="add" data-scope="montage">+ Add montage clip</button>
    <h3>Sequence preview</h3>
    <p class="sub">Plays the enabled clips in order (trim windows + transitions applied), then loops.</p>
    <div id="mm-montage-preview"></div>
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
    <div class="mm-pv-courses">${m.courses.map((c) => `<div class="mm-pv-course"><img src="${escAttr(c.art)}" alt="${escAttr(c.alt || c.title)}"/><b>${esc(c.title)}</b></div>`).join('')}</div>
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
    ${montageSectionHtml()}
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
  wireMontagePreview();
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

interface MontageController {
  start(): void;
  stop(): void;
}

/**
 * Build a chained-<video> montage player inside `host`. Two stacked <video>
 * layers make the crossfade possible; a poster <img> beneath them is revealed if
 * a clip fails to load, so a broken video never blanks the stage. The sequence
 * plays enabled clips in order (each trim window applied) with a hard cut or a
 * ~0.3s opacity crossfade, then loops. No libraries, no re-encoding.
 */
function mountMontageSequence(host: HTMLElement, seq: MontageRender[]): MontageController {
  host.innerHTML = '';
  if (!seq || seq.length === 0) {
    host.innerHTML = `<div class="mmx-mtg-empty">No enabled montage clips — add or enable a clip above.</div>`;
    return { start() {}, stop() {} };
  }

  const stage = document.createElement('div');
  stage.className = 'mmx-mtg-stage';
  const poster = document.createElement('img');
  poster.className = 'mmx-mtg-poster';
  poster.src = seq[0].poster;
  poster.alt = seq[0].posterAlt || 'Highlight montage';
  const showPoster = (): void => {
    poster.style.opacity = '1';
  };
  const hidePoster = (): void => {
    poster.style.opacity = '0';
  };
  const layers: HTMLVideoElement[] = [0, 1].map(() => {
    const v = document.createElement('video');
    v.muted = true;
    v.setAttribute('muted', '');
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.preload = 'auto';
    v.style.opacity = '0';
    v.addEventListener('error', showPoster);
    return v;
  });
  stage.appendChild(poster);
  layers.forEach((v) => stage.appendChild(v));
  host.appendChild(stage);

  let front = 0;
  let pos = 0;
  let busy = false;
  let running = false;
  let raf = 0;

  const boundary = (v: HTMLVideoElement, c: MontageRender): number =>
    c.trimEnd > 0 ? c.trimEnd : Number.isFinite(v.duration) && v.duration > 0 ? v.duration - 0.05 : Infinity;

  const loadAndPlay = (v: HTMLVideoElement, c: MontageRender, onReady?: () => void): void => {
    v.onloadedmetadata = (): void => {
      if (c.trimStart > 0) {
        try {
          v.currentTime = c.trimStart;
        } catch {
          /* metadata race — retried is unnecessary, next tick corrects */
        }
      }
      onReady?.();
    };
    v.src = c.file;
    v.poster = c.poster;
    v.load();
    void v.play().then(hidePoster).catch(showPoster);
  };

  const advance = (): void => {
    if (!running) return;
    const cur = seq[pos];
    if (seq.length === 1) {
      try {
        layers[front].currentTime = cur.trimStart;
      } catch {
        /* ignore */
      }
      return;
    }
    busy = true;
    const next = (pos + 1) % seq.length;
    const a = layers[front];
    const b = layers[1 - front];
    if (cur.transition === 'fade') {
      a.pause();
      loadAndPlay(b, seq[next], () => {
        b.style.opacity = '0';
        void b.offsetWidth; // reflow so the opacity transition fires
        b.style.opacity = '1';
        window.setTimeout(() => {
          a.style.opacity = '0';
          a.pause();
          front = 1 - front;
          pos = next;
          busy = false;
        }, 320);
      });
    } else {
      loadAndPlay(a, seq[next], () => {
        pos = next;
        busy = false;
      });
    }
  };

  const tick = (): void => {
    if (!running) return;
    const v = layers[front];
    if (!busy && v.readyState >= 1 && v.currentTime >= boundary(v, seq[pos])) advance();
    raf = window.requestAnimationFrame(tick);
  };

  return {
    start(): void {
      if (running) return;
      running = true;
      front = 0;
      pos = 0;
      busy = false;
      layers[1].style.opacity = '0';
      layers[0].style.opacity = '1';
      loadAndPlay(layers[0], seq[0]);
      raf = window.requestAnimationFrame(tick);
    },
    stop(): void {
      running = false;
      if (raf) window.cancelAnimationFrame(raf);
      raf = 0;
      layers.forEach((v) => {
        try {
          v.pause();
        } catch {
          /* ignore */
        }
      });
    }
  };
}

let montageCtrl: MontageController | null = null;

/** (Re)build the admin montage sequence preview from the current draft. */
function wireMontagePreview(): void {
  if (montageCtrl) {
    montageCtrl.stop();
    montageCtrl = null;
  }
  const host = document.getElementById('mm-montage-preview');
  if (!host) return;
  montageCtrl = mountMontageSequence(host, resolveRenderModel(draft).montage);
  montageCtrl.start();
}

/** Sync an image control's preview thumbnail / path / warning after a select change. */
function updateImagePreview(sel: HTMLSelectElement): void {
  const wrap = sel.closest('.mmx-img') as HTMLElement | null;
  if (!wrap) return;
  const val = sel.value;
  const known = wrap.dataset.imgkind === 'poster' ? isKnownPoster(val) : isKnownImage(val);
  const img = wrap.querySelector<HTMLImageElement>('img[data-role=imgprev]');
  if (img) {
    img.src = val;
    img.classList.toggle('mmx-broken', !known);
  }
  const pathEl = wrap.querySelector('[data-role=imgpath]');
  if (pathEl) pathEl.textContent = val || '(none)';
  const warn = wrap.querySelector('[data-role=imgwarn]');
  if (warn) warn.classList.toggle('mmx-hidden', known);
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
  } else if (scope === 'montage') {
    const m = draft.montage![idx] as unknown as Record<string, unknown>;
    m[field] = field === 'trimStart' || field === 'trimEnd' ? num(t.value) : t.value;
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
    else if (scope === 'montage') {
      draft.montage![idx].enabled = checked;
      wireMontagePreview();
    }
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
  } else if (scope === 'montage') {
    (draft.montage![idx] as unknown as Record<string, unknown>)[field] = t.value;
    wireMontagePreview();
  } else if (scope === 'course') {
    (draft.courses[idx] as unknown as Record<string, unknown>)[field] = t.value;
  } else if (scope === 'hero') {
    (draft.hero as unknown as Record<string, unknown>)[field] = t.value;
  } else if (scope === 'reel') {
    (draft.reel as unknown as Record<string, unknown>)[field] = t.value;
  }

  if (t.tagName === 'SELECT' && (t as HTMLElement).closest('.mmx-img')) {
    updateImagePreview(t as HTMLSelectElement);
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
      else if (scope === 'montage') reorder(draft.montage!, idx, action === 'up' ? -1 : 1);
      paint();
      break;
    case 'add':
      if (scope === 'montage') {
        draft.montage!.push({
          id: `m${Date.now().toString(36)}`,
          videoFile: VIDEO_LIBRARY[0].value,
          poster: POSTER_LIBRARY[0].value,
          posterAlt: '',
          enabled: true,
          trimStart: 0,
          trimEnd: 0,
          transition: 'cut',
          order: draft.montage!.length
        });
        paint();
      }
      break;
    case 'remove':
      if (scope === 'montage') {
        draft.montage!.splice(idx, 1);
        paint();
      }
      break;
    case 'revert-img': {
      const D = DEFAULT_MARKETING_CONFIG;
      const def = revertImagePath(scope ?? '', idx);
      if (scope === 'hero') {
        draft.hero.plateImage = def;
        draft.hero.plateAlt = D.hero.plateAlt ?? '';
      } else if (scope === 'reel') {
        draft.reel.poster = def;
        draft.reel.posterAlt = D.reel.posterAlt ?? '';
      } else if (scope === 'course' && draft.courses[idx]) {
        draft.courses[idx].art = def;
        draft.courses[idx].alt = D.courses[idx]?.alt ?? '';
      } else if (scope === 'clip' && draft.clips[idx]) {
        draft.clips[idx].poster = def;
        draft.clips[idx].posterAlt = D.clips[idx]?.posterAlt ?? '';
      } else if (scope === 'montage' && draft.montage![idx]) {
        draft.montage![idx].poster = def;
        draft.montage![idx].posterAlt = D.montage?.[idx]?.posterAlt ?? '';
      }
      paint();
      break;
    }
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
  (out.montage ?? []).forEach((m, i) => {
    m.order = i;
    m.trimStart = num(String(m.trimStart));
    m.trimEnd = num(String(m.trimEnd));
  });
  out.version = (Number(draft.version) || 0) + 1;
  out.publishedAt = Date.now();
  return out;
}

async function doPublish(): Promise<void> {
  const status = document.getElementById('mm-publish-status');
  const payload = publishable();

  // Gate: never publish a broken/unknown image path.
  const badPaths = validateImagePaths(payload);
  if (badPaths.length) {
    if (status) {
      status.innerHTML =
        `⛔ Publish blocked — ${badPaths.length} image path(s) are not in the committed library:` +
        `<ul>${badPaths.map((p) => `<li><code>${esc(p)}</code></li>`).join('')}</ul>` +
        `Fix each flagged image (⚠ markers above) and try again.`;
    }
    return;
  }

  if (status) status.textContent = 'Publishing…';
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
