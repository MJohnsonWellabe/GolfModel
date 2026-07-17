/**
 * Marketing kit (marketing.html) — populates the course/character/pal rosters
 * and the gameplay-clip wall from the live game data + committed captures, so
 * the press page never drifts from the real roster. This page is owner-reached
 * from the admin dashboard.
 *
 * Highlight slot: when the published config carries a MONTAGE, the reel slot is
 * rendered as a chained-<video> SEQUENCE (each clip's trim window applied, with a
 * hard cut or a short opacity crossfade between clips, then looping). It is
 * lazy-started via IntersectionObserver (only when scrolled into view) and falls
 * back to a static poster if a clip fails to load; an empty/absent montage leaves
 * the single-video highlight reel in place — a broken montage never blanks the
 * page. Every image (hero plate, course art, clip/reel posters) carries the
 * config's ALT text for accessibility.
 */
import { CHARACTERS } from '../data/characters';
import { PALS } from '../data/pals';
import { LEADERBOARD_URL } from '../config';
import {
  Clip,
  MontageRender,
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
            `<div class="course"><img src="${escHtml(c.art).replace(/"/g, '&quot;')}" alt="${escHtml(c.alt || c.title).replace(/"/g, '&quot;')}" />` +
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
  renderMontage(m.montage);
  wireClipPlayback();
  wireImageFallbacks();
}

// ---- Montage highlight sequence --------------------------------------------
// The reel slot can play an ORDERED montage of clips back-to-back as one reel.
// Rendered as chained <video> playback (never a re-encoded file): two stacked
// layers allow a short crossfade, a poster <img> under them is revealed if a
// clip fails to load, and playback is gated to when the reel is on-screen.

interface MontageController {
  start(): void;
  stop(): void;
}

function injectMontageStyle(): void {
  if (document.getElementById('mtg-style')) return;
  const s = document.createElement('style');
  s.id = 'mtg-style';
  s.textContent = `
    .mtg-stage { position: relative; width: 100%; aspect-ratio: 9 / 16; background: #071c10; }
    .mtg-stage video, .mtg-stage img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transition: opacity 0.3s ease; }
    .mtg-poster { opacity: 0; }
  `;
  document.head.appendChild(s);
}

/** Build a chained-<video> montage player inside `host`. Mirrors the admin
 *  preview: two crossfading layers + a poster fallback, looping the sequence. */
function mountMontageSequence(host: HTMLElement, seq: MontageRender[]): MontageController {
  host.innerHTML = '';
  const stage = document.createElement('div');
  stage.className = 'mtg-stage';
  const poster = document.createElement('img');
  poster.className = 'mtg-poster';
  poster.src = seq[0].poster;
  poster.alt = seq[0].posterAlt || 'Highlight montage';
  poster.loading = 'lazy';
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
    v.preload = 'metadata';
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
          /* metadata race — next tick corrects */
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

let montageController: MontageController | null = null;
let montageObserver: IntersectionObserver | null = null;

/** Render the montage into the reel slot, or restore the single-video reel when
 *  the montage is empty/disabled. Playback is lazy-started on scroll-in. */
function renderMontage(seq: MontageRender[]): void {
  const reel = document.querySelector<HTMLElement>('.reel');
  const reelVid = document.getElementById('reelVid') as HTMLVideoElement | null;
  if (!reel) return;

  if (montageController) {
    montageController.stop();
    montageController = null;
  }
  if (montageObserver) {
    montageObserver.disconnect();
    montageObserver = null;
  }
  const prevStage = reel.querySelector('#montageStage');
  if (prevStage) prevStage.remove();

  // Empty/disabled/broken montage → keep the static single-video highlight reel.
  if (!Array.isArray(seq) || seq.length === 0) {
    if (reelVid) reelVid.style.display = '';
    return;
  }

  injectMontageStyle();
  if (reelVid) {
    reelVid.style.display = 'none';
    try {
      reelVid.pause();
    } catch {
      /* ignore */
    }
  }
  const host = document.createElement('div');
  host.id = 'montageStage';
  reel.appendChild(host);
  montageController = mountMontageSequence(host, seq);

  if ('IntersectionObserver' in window) {
    montageObserver = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) montageController?.start();
          else montageController?.stop();
        }
      },
      { threshold: 0.3 }
    );
    montageObserver.observe(host);
  } else {
    montageController.start();
  }
}

// Immediate render from the built-in default so the grid is never empty, even
// before (or without) a network round-trip. Hero/courses stay as the static
// markup on this path.
renderClipGrid(resolveRenderModel(null).clips);
renderMontage(resolveRenderModel(null).montage);
wireClipPlayback();
wireImageFallbacks();

// Then overlay the live config if one is published; failure/absence is a no-op.
void (async () => {
  const cfg = await fetchMarketingConfigREST(LEADERBOARD_URL);
  if (cfg) applyConfigModel(resolveRenderModel(cfg));
})();
