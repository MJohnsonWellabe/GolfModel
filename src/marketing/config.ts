/**
 * Marketing-page configuration: schema, the built-in default (the current
 * hardcoded About-page content expressed as data), and a PURE mapper from a
 * stored `/marketingConfig` node to the render model the page consumes.
 *
 * This module has NO DOM or Firebase-SDK side effects at import time, so it is
 * safely unit-testable and shared by three callers:
 *   - the public About page (src/marketing/main.ts) — reads via REST, renders
 *   - the admin Marketing Manager (src/admin/marketing.ts) — edits + previews
 *   - the SDK publish helper (src/firebase/MarketingConfig.ts) — types only
 *
 * Asset paths use the working `marketing/...` RUNTIME prefix (publicDir:'assets'
 * flattens `assets/marketing/...` to the site root; the un-flattened
 * `assets/marketing/...` 404s on GitHub Pages), matching the shipped clip wall.
 */

// ---- Schema -----------------------------------------------------------------

export interface HeroStat {
  value: string;
  label: string;
}

export interface MarketingHero {
  plateImage: string;
  title: string;
  lede: string;
  stats: HeroStat[];
}

export interface MarketingReel {
  videoFile: string;
  poster: string;
  enabled: boolean;
}

export interface MarketingCourse {
  art: string;
  title: string;
  desc: string;
  enabled: boolean;
  order: number;
}

export interface MarketingClip {
  id: string;
  videoFile: string;
  poster: string;
  badge: string;
  title: string;
  /** Maps onto the existing Clip.sub caption line. */
  caption: string;
  /** Longer press-kit description (not shown on the tile in v1; kept for parity). */
  description: string;
  enabled: boolean;
  /** Promotes this clip into the highlight-reel slot. At most one is honored. */
  heroFlag: boolean;
  /** Sub-range playback (seconds). trimEnd<=0 means "play to the natural end". */
  trimStart: number;
  trimEnd: number;
  order: number;
}

export interface MarketingConfig {
  version: number;
  publishedAt: number;
  hero: MarketingHero;
  reel: MarketingReel;
  courses: MarketingCourse[];
  clips: MarketingClip[];
}

// ---- Render model (what the page actually draws) ----------------------------

/** The existing marketing Clip tile shape (was inline in main.ts). */
export interface Clip {
  badge: string;
  title: string;
  sub: string;
  poster: string;
  file?: string;
  trimStart?: number;
  trimEnd?: number;
}

export interface ReelRender {
  file: string;
  poster: string;
  enabled: boolean;
  trimStart: number;
  trimEnd: number;
}

export interface RenderModel {
  hero: MarketingHero;
  reel: ReelRender;
  courses: MarketingCourse[];
  clips: Clip[];
  /** The heroFlag clip mapped to a Clip, or null (then reel uses config.reel). */
  heroClip: Clip | null;
}

// ---- HTML escaping (content now originates from a remote node) ---------------

export function escHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escAttr(s: string): string {
  return escHtml(s).replace(/"/g, '&quot;');
}

// ---- Clip tile (shared by the page and the admin preview) -------------------

export function clipTile(c: Clip): string {
  const trimStart = c.trimStart && c.trimStart > 0 ? c.trimStart : 0;
  const trimEnd = c.trimEnd && c.trimEnd > 0 ? c.trimEnd : 0;
  const trimAttr = trimStart || trimEnd ? ` data-trim-start="${trimStart}" data-trim-end="${trimEnd}"` : '';
  // With a trimEnd, our timeupdate handler loops the sub-range — native `loop`
  // is dropped so the two don't fight over currentTime.
  const loopAttr = trimEnd > 0 ? '' : ' loop';
  const media = c.file
    ? `<video class="clipvid" muted${loopAttr} playsinline preload="metadata" poster="${escAttr(c.poster)}"${trimAttr}>` +
      `<source src="${escAttr(c.file)}" type="video/mp4" /></video>`
    : `<img class="poster" src="${escAttr(c.poster)}" alt="${escAttr(c.title)}" loading="lazy" />`;
  return (
    `<div class="clip"><div class="badge">${escHtml(c.badge)}</div>${media}` +
    `<div class="cap"><b>${escHtml(c.title)}</b><span>${escHtml(c.sub)}</span></div></div>`
  );
}

// ---- Pure config → render-model mapper --------------------------------------

function toClip(mc: MarketingClip): Clip {
  return {
    badge: mc.badge,
    title: mc.title,
    sub: mc.caption,
    poster: mc.poster,
    file: mc.videoFile,
    trimStart: Number(mc.trimStart) || 0,
    trimEnd: Number(mc.trimEnd) || 0
  };
}

function byOrder<T extends { order?: number }>(a: T, b: T): number {
  return (a.order ?? 0) - (b.order ?? 0);
}

/**
 * PURE: turn a well-formed config into the render model. Enabled clips are
 * ordered; a `heroFlag` clip is promoted into the reel slot and removed from the
 * grid. Defensive against missing arrays (RTDB omits empty collections).
 */
export function configToRenderModel(cfg: MarketingConfig): RenderModel {
  const clips = Array.isArray(cfg.clips) ? cfg.clips : [];
  const enabled = clips.filter((c) => c && c.enabled).slice().sort(byOrder);
  const heroSrc = enabled.find((c) => c.heroFlag) ?? null;
  const heroClip = heroSrc ? toClip(heroSrc) : null;
  const gridClips = enabled.filter((c) => c !== heroSrc).map(toClip);

  const courses = (Array.isArray(cfg.courses) ? cfg.courses : [])
    .filter((c) => c && c.enabled)
    .slice()
    .sort(byOrder);

  const reel: ReelRender = heroClip
    ? {
        file: heroClip.file ?? '',
        poster: heroClip.poster,
        enabled: true,
        trimStart: heroClip.trimStart ?? 0,
        trimEnd: heroClip.trimEnd ?? 0
      }
    : {
        file: cfg.reel?.videoFile ?? '',
        poster: cfg.reel?.poster ?? '',
        enabled: cfg.reel?.enabled ?? true,
        trimStart: 0,
        trimEnd: 0
      };

  return { hero: cfg.hero, reel, courses, clips: gridClips, heroClip };
}

/** Coalesce a possibly-absent/invalid config to the built-in default, then map.
 *  This is the single fallback point the page and admin both rely on. */
export function resolveRenderModel(cfg: MarketingConfig | null | undefined): RenderModel {
  const usable =
    cfg && typeof cfg === 'object' && cfg.hero && Array.isArray(cfg.clips)
      ? (cfg as MarketingConfig)
      : DEFAULT_MARKETING_CONFIG;
  return configToRenderModel(usable);
}

// ---- REST read (public; no Firebase SDK) ------------------------------------

/** Fetch `${baseUrl}/marketingConfig.json`. Returns null on absent/failure/offline
 *  so the caller keeps the static content. */
export async function fetchMarketingConfigREST(baseUrl: string): Promise<MarketingConfig | null> {
  if (!baseUrl) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/marketingConfig.json`, {
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    if (!data || typeof data !== 'object') return null;
    return data as MarketingConfig;
  } catch {
    return null;
  }
}

// ---- Committed asset libraries (for the admin selects) ----------------------

export interface LibItem {
  value: string;
  label: string;
}

function labelFromFile(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.[a-z0-9]+$/i, '');
}

const VIDEO_FILES = [
  // 6 named marketing clips
  'marketing/videos/hole-in-one.mp4',
  'marketing/videos/island.mp4',
  'marketing/videos/backspin.mp4',
  'marketing/videos/greenread.mp4',
  'marketing/videos/putt.mp4',
  'marketing/videos/montage.mp4',
  // 12 raw gameplay captures (the 1.0 library)
  'marketing/videos/library-092549-extra.mp4',
  'marketing/videos/library-092554-extra-short.mp4',
  'marketing/videos/library-092620-extra.mp4',
  'marketing/videos/library-092830-extra.mp4',
  'marketing/videos/library-101430-extra.mp4',
  'marketing/videos/library-101524-extra.mp4',
  'marketing/videos/library-103005-extra-short.mp4',
  'marketing/videos/library-175316-par3-tee.mp4',
  'marketing/videos/library-175345-spin.mp4',
  'marketing/videos/library-175624-drive.mp4',
  'marketing/videos/library-175907-putt.mp4',
  'marketing/videos/library-180121-truevision.mp4'
];

const POSTER_FILES = [
  'marketing/img/poster-ace.png',
  'marketing/img/poster-island.png',
  'marketing/img/poster-backspin.png',
  'marketing/img/poster-greenread.png',
  'marketing/img/poster-putt.png',
  'marketing/img/poster-montage.png'
];

/** Scenic plates + course art (the non-poster committed images). */
const IMAGE_FILES = [
  'marketing/img/sablebay-island.png',
  'marketing/img/wildwood-cherry.png',
  'marketing/img/timberline-pond.png',
  'marketing/img/portjohnson-bunker.png',
  'marketing/img/feature-aim.png',
  'marketing/img/feature-truevision.png',
  'marketing/img/feature-fire.png'
];

export const VIDEO_LIBRARY: LibItem[] = VIDEO_FILES.map((v) => ({ value: v, label: labelFromFile(v) }));
export const POSTER_LIBRARY: LibItem[] = POSTER_FILES.map((v) => ({ value: v, label: labelFromFile(v) }));
export const IMAGE_LIBRARY: LibItem[] = IMAGE_FILES.map((v) => ({ value: v, label: labelFromFile(v) }));

// ---- Built-in default (the current hardcoded About-page content, as data) ---

export const DEFAULT_MARKETING_CONFIG: MarketingConfig = {
  version: 0,
  publishedAt: 0,
  hero: {
    plateImage: 'marketing/img/sablebay-island.png',
    title: 'Pocket golf with real shot-making.',
    lede:
      'A bite-sized round you can finish on a coffee break — with true backspin, shot shaping, ' +
      'living courses, collectible characters and pals. Pick up, tee off, pull off the shot.',
    stats: [
      { value: '4', label: 'HAND-BUILT COURSES' },
      { value: '25', label: 'PLAYABLE CHARACTERS' },
      { value: '13', label: 'COLLECTIBLE PALS' },
      { value: '3-hole', label: 'QUICK ROUNDS' }
    ]
  },
  reel: {
    videoFile: 'marketing/videos/montage.mp4',
    poster: 'marketing/img/poster-montage.png',
    enabled: true
  },
  courses: [
    {
      art: 'marketing/img/wildwood-cherry.png',
      title: 'Wildwood Glen',
      desc:
        'A lush parkland course — cherry-blossom groves, still ponds and tight, tree-lined fairways that reward shaping the ball into the pin.',
      enabled: true,
      order: 0
    },
    {
      art: 'marketing/img/sablebay-island.png',
      title: 'Sable Bay',
      desc:
        'A Pebble Beach and Torrey Pines mashup — coastal bluffs, wind-carved sand and dune fescue winding through the pines down to the sea.',
      enabled: true,
      order: 1
    },
    {
      art: 'marketing/img/timberline-pond.png',
      title: 'Timberline',
      desc:
        'Mountain golf in the pines — a checkerboard green tucked among towering timber, thin mountain air and true, honest bounces.',
      enabled: true,
      order: 2
    },
    {
      art: 'marketing/img/portjohnson-bunker.png',
      title: 'Port Johnson Links',
      desc:
        'Scottish links through and through — deep pot bunkers, firm, fast-running turf and a tide that has the final say on the day.',
      enabled: true,
      order: 3
    }
  ],
  clips: [
    {
      id: 'ace',
      videoFile: 'marketing/videos/hole-in-one.mp4',
      poster: 'marketing/img/poster-ace.png',
      badge: 'Par 3',
      title: 'Tee shot to the pin',
      caption: 'Follow the full shot through the finish.',
      description: '',
      enabled: true,
      heroFlag: false,
      trimStart: 0,
      trimEnd: 0,
      order: 0
    },
    {
      id: 'island',
      videoFile: 'marketing/videos/island.mp4',
      poster: 'marketing/img/poster-island.png',
      badge: 'Drive',
      title: 'Behind the golfer',
      caption: 'Big swing, clean launch, cinematic ball flight.',
      description: '',
      enabled: true,
      heroFlag: false,
      trimStart: 0,
      trimEnd: 0,
      order: 1
    },
    {
      id: 'backspin',
      videoFile: 'marketing/videos/backspin.mp4',
      poster: 'marketing/img/poster-backspin.png',
      badge: 'Spin',
      title: 'Check & back up',
      caption: "Feels amazing — but don't overdo it.",
      description: '',
      enabled: true,
      heroFlag: false,
      trimStart: 0,
      trimEnd: 0,
      order: 2
    },
    {
      id: 'greenread',
      videoFile: 'marketing/videos/greenread.mp4',
      poster: 'marketing/img/poster-greenread.png',
      badge: 'Read',
      title: 'True Vision line',
      caption: 'See carry, curve and roll before you commit.',
      description: '',
      enabled: true,
      heroFlag: false,
      trimStart: 0,
      trimEnd: 0,
      order: 3
    },
    {
      id: 'putt',
      videoFile: 'marketing/videos/putt.mp4',
      poster: 'marketing/img/poster-putt.png',
      badge: 'Putt',
      title: 'Clutch putt',
      caption: 'Read the break. Roll it in.',
      description: '',
      enabled: true,
      heroFlag: false,
      trimStart: 0,
      trimEnd: 0,
      order: 4
    }
  ]
};
