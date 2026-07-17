/**
 * Marketing kit (marketing.html) — populates the course/character/pal rosters
 * and the gameplay-clip wall from the live game data + committed captures, so
 * the press page never drifts from the real roster. This page is owner-reached
 * from the admin dashboard.
 */
import { CHARACTERS } from '../data/characters';
import { PALS } from '../data/pals';
import { LEADERBOARD_URL } from '../config';
import {
  Clip,
  RenderModel,
  clipTile,
  escHtml,
  resolveRenderModel,
  fetchMarketingConfigREST
} from './config';

function rosterCard(imgSrc: string, name: string, pal: boolean): string {
  const cls = pal ? 'card pal' : 'card';
  return (
    `<div class="${cls}">` +
    `<img src="${imgSrc}" alt="${name}" loading="lazy" onerror="this.closest('.card').style.display='none'" />` +
    `<span>${name}</span></div>`
  );
}

// Spotlight a handful of the 25 characters rather than the whole roster — the
// section heading already says "25 characters, all playable."
const SPOTLIGHT_KEYS = ['chip', 'sunny', 'dez', 'lily', 'nova', 'cole', 'ivy', 'zuri'];
const charEl = document.getElementById('charRoster');
if (charEl) {
  const spotlight = SPOTLIGHT_KEYS.map((k) => CHARACTERS.find((c) => c.key === k)).filter(
    (c): c is (typeof CHARACTERS)[number] => c !== undefined
  );
  charEl.innerHTML = spotlight.map((c) => rosterCard(`ui/characters/${c.key}.png`, c.name, false)).join('');
}
const palEl = document.getElementById('palRoster');
if (palEl) palEl.innerHTML = PALS.map((p) => rosterCard(p.image, p.name, true)).join('');

// ---- Gameplay clip wall -----------------------------------------------------
// The clip grid, highlight reel, hero copy and course gallery are data-driven
// from the `/marketingConfig` RTDB node (public read). Absent/offline, the page
// renders the built-in default (identical to the previous hardcoded content) and
// leaves the static hero/course markup untouched — a graceful fallback with no
// source edits needed to go live.

/** Sub-range playback: replaces native `loop` for trimmed clips. On metadata
 *  load seek to trimStart; on each tick, when trimEnd>0 and we reach it, jump
 *  back to trimStart so the clip loops only its authored window. */
function wireTrim(v: HTMLVideoElement): void {
  if (v.dataset.trimWired) return;
  const start = Number(v.dataset.trimStart) || 0;
  const end = Number(v.dataset.trimEnd) || 0;
  if (!start && !end) return;
  v.dataset.trimWired = '1';
  const seekStart = (): void => {
    try {
      if (start > 0 && Math.abs(v.currentTime - start) > 0.05) v.currentTime = start;
    } catch {
      /* seeking before metadata — ignored, retried on loadedmetadata */
    }
  };
  v.addEventListener('loadedmetadata', seekStart);
  if (v.readyState >= 1) seekStart();
  v.addEventListener('timeupdate', () => {
    if (end > 0 && v.currentTime >= end) {
      try {
        v.currentTime = start;
      } catch {
        /* ignore */
      }
    }
  });
}

let clipObserver: IntersectionObserver | null = null;

/** Gate every clip video's playback to when it is scrolled into view (so the
 *  looping videos never thrash the page) and apply any trim window. Re-runnable
 *  after the grid/reel are re-rendered from a fetched config. */
function wireClipPlayback(): void {
  const vids = Array.from(document.querySelectorAll<HTMLVideoElement>('video.clipvid'));
  vids.forEach(wireTrim);
  if ('IntersectionObserver' in window) {
    if (clipObserver) clipObserver.disconnect();
    clipObserver = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const v = e.target as HTMLVideoElement;
          if (e.isIntersecting) void v.play().catch(() => undefined);
          else v.pause();
        }
      },
      { threshold: 0.35 }
    );
    vids.forEach((v) => clipObserver!.observe(v));
  } else {
    vids.forEach((v) => void v.play().catch(() => undefined));
  }
}

/** Graceful fallback for scenic plates: a missing capture drops to a soft
 *  gradient rather than a broken-image icon. Re-runnable after a course rebuild. */
function wireImageFallbacks(): void {
  for (const img of Array.from(document.querySelectorAll<HTMLImageElement>('.feature .shot img, .course img'))) {
    if (img.dataset.fbWired) continue;
    img.dataset.fbWired = '1';
    img.addEventListener('error', () => {
      const holder = img.parentElement;
      img.style.display = 'none';
      if (holder) {
        holder.style.minHeight = '220px';
        holder.style.background = 'linear-gradient(160deg, #0e3f22, #061a0e)';
      }
    });
  }
}

/** Render the clip grid from a model (always runs — the grid starts empty). */
function renderClipGrid(clips: Clip[]): void {
  const clipGrid = document.getElementById('clipGrid');
  if (clipGrid) clipGrid.innerHTML = clips.map(clipTile).join('');
}

/** Patch the hero copy, course gallery and reel from a fetched config. Only
 *  called when a live config exists — the static markup is otherwise kept. */
function applyConfigModel(m: RenderModel): void {
  const hero = m.hero;
  if (hero) {
    const plate = document.querySelector<HTMLElement>('header.hero .plate');
    if (plate && hero.plateImage) plate.style.backgroundImage = `url('${hero.plateImage}')`;
    const title = document.querySelector<HTMLElement>('h1.title');
    if (title && hero.title) title.textContent = hero.title;
    const lede = document.querySelector<HTMLElement>('.lede');
    if (lede && hero.lede) lede.textContent = hero.lede;
    const stats = document.querySelector<HTMLElement>('.stats');
    if (stats && Array.isArray(hero.stats) && hero.stats.length) {
      stats.innerHTML = hero.stats
        .map((s) => `<div class="stat"><b>${escHtml(s.value)}</b><span>${escHtml(s.label)}</span></div>`)
        .join('');
    }
  }

  if (m.courses.length) {
    const gallery = document.querySelector<HTMLElement>('.courses');
    if (gallery) {
      gallery.innerHTML = m.courses
        .map(
          (c) =>
            `<div class="course"><img src="${escHtml(c.art).replace(/"/g, '&quot;')}" alt="${escHtml(c.title)}" />` +
            `<div class="body"><h3>${escHtml(c.title)}</h3><p>${escHtml(c.desc)}</p></div></div>`
        )
        .join('');
    }
  }

  const reelVid = document.getElementById('reelVid') as HTMLVideoElement | null;
  if (reelVid && m.reel.enabled && m.reel.file) {
    if (m.reel.poster) reelVid.poster = m.reel.poster;
    const source = reelVid.querySelector('source');
    if (source) source.setAttribute('src', m.reel.file);
    if (m.reel.trimEnd > 0) reelVid.removeAttribute('loop');
    else reelVid.setAttribute('loop', '');
    reelVid.dataset.trimStart = String(m.reel.trimStart || 0);
    reelVid.dataset.trimEnd = String(m.reel.trimEnd || 0);
    delete reelVid.dataset.trimWired;
    reelVid.load();
  }

  renderClipGrid(m.clips);
  wireClipPlayback();
  wireImageFallbacks();
}

// Immediate render from the built-in default so the grid is never empty, even
// before (or without) a network round-trip. Hero/courses stay as the static
// markup on this path.
renderClipGrid(resolveRenderModel(null).clips);
wireClipPlayback();
wireImageFallbacks();

// Then overlay the live config if one is published; failure/absence is a no-op.
void (async () => {
  const cfg = await fetchMarketingConfigREST(LEADERBOARD_URL);
  if (cfg) applyConfigModel(resolveRenderModel(cfg));
})();
