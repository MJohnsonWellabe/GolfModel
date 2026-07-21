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
 * Responsibilities beyond the clip wall / hero / course gallery:
 *   - MONTAGE: an ordered sequence of gameplay clips (`montage[]`) that the page
 *     plays back-to-back as one highlight reel. It is rendered as a chained
 *     <video> SEQUENCE at runtime (cut or short opacity crossfade between
 *     clips) — NOT a re-encoded file. `configToRenderModel` exposes the enabled,
 *     ordered sequence as `RenderModel.montage`.
 *   - IMAGE MANAGEMENT: every marketing image (hero plate, course art, clip and
 *     reel posters, montage posters) is chosen from a committed library and
 *     carries optional ALT text for accessibility. `validateImagePaths` reports
 *     any image path that is not in the committed library so the admin can block
 *     a publish that would ship a broken/unknown image.
 *
 * All schema additions are BACKWARD COMPATIBLE: a stored config that predates
 * the montage/alt fields still resolves (the new fields default; RTDB omits
 * empty arrays, so every array access is `Array.isArray`-guarded).
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
  /** Accessible description of the hero plate image. Optional/back-compat. */
  plateAlt?: string;
  title: string;
  lede: string;
  stats: HeroStat[];
}

export interface MarketingReel {
  videoFile: string;
  poster: string;
  /** Accessible description of the reel poster image. Optional/back-compat. */
  posterAlt?: string;
  enabled: boolean;
}

export interface MarketingCourse {
  art: string;
  /** Accessible description of the course art. Optional/back-compat. */
  alt?: string;
  title: string;
  desc: string;
  enabled: boolean;
  order: number;
}

/**
 * One clip in the highlight MONTAGE — an ordered sequence played back-to-back as
 * a single reel. `transition` is the effect used when leaving THIS clip for the
 * next one: a hard 'cut' or a short opacity 'fade'.
 */
export interface MontageItem {
  id: string;
  videoFile: string;
  poster: string;
  /** Accessible description of the montage clip poster. Optional/back-compat. */
  posterAlt?: string;
  enabled: boolean;
  /** Sub-range playback (seconds). trimEnd<=0 means "play to the natural end". */
  trimStart: number;
  trimEnd: number;
  transition: 'cut' | 'fade';
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
  /** Accessible description of the clip poster (when shown as a still). */
  posterAlt?: string;
  /** Sub-range playback (seconds). trimEnd<=0 means "play to the natural end". */
  trimStart: number;
  trimEnd: number;
  order: number;
}

/**
 * One FEATURE-row image on the public page (the "Depth under the
 * pick-up-and-play" section): Spin & shot shaping, True Vision, Fire streaks.
 * The rows' copy stays static markup; the IMAGE (and its alt text) is
 * configurable so the Marketing Manager owns every public marketing image.
 * Keyed by a stable id so a partial/older config only overrides the rows it
 * actually carries.
 */
export interface MarketingFeature {
  /** Stable row key: 'aim' | 'truevision' | 'fire' (extensible). */
  id: string;
  image: string;
  /** Accessible description of the feature image. Optional/back-compat. */
  alt?: string;
}

export interface MarketingConfig {
  version: number;
  publishedAt: number;
  hero: MarketingHero;
  reel: MarketingReel;
  courses: MarketingCourse[];
  clips: MarketingClip[];
  /** Ordered highlight-reel sequence. Optional/back-compat (RTDB omits empties). */
  montage?: MontageItem[];
  /** Feature-row images (aim / truevision / fire). Optional/back-compat. */
  features?: MarketingFeature[];
}

// ---- Render model (what the page actually draws) ----------------------------

/** The existing marketing Clip tile shape (was inline in main.ts). */
export interface Clip {
  badge: string;
  title: string;
  sub: string;
  poster: string;
  /** Accessible alt for the poster still (falls back to the title). */
  alt?: string;
  file?: string;
  trimStart?: number;
  trimEnd?: number;
}

export interface ReelRender {
  file: string;
  poster: string;
  posterAlt: string;
  enabled: boolean;
  trimStart: number;
  trimEnd: number;
}

/** One resolved montage step consumed by the runtime sequence player. */
export interface MontageRender {
  file: string;
  poster: string;
  posterAlt: string;
  trimStart: number;
  trimEnd: number;
  transition: 'cut' | 'fade';
}

export interface RenderModel {
  hero: MarketingHero;
  reel: ReelRender;
  courses: MarketingCourse[];
  clips: Clip[];
  /** Enabled montage clips, ordered — the highlight sequence (may be empty). */
  montage: MontageRender[];
  /** The heroFlag clip mapped to a Clip, or null (then reel uses config.reel). */
  heroClip: Clip | null;
  /** Feature-row images resolved per stable id — a row missing from the stored
   *  config falls back to its shipped default, so an older published config
   *  never blanks a feature image. */
  features: MarketingFeature[];
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
    : `<img class="poster" src="${escAttr(c.poster)}" alt="${escAttr(c.alt || c.title)}" loading="lazy" />`;
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
    alt: typeof mc.posterAlt === 'string' ? mc.posterAlt : '',
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
        posterAlt: heroClip.alt ?? '',
        enabled: true,
        trimStart: heroClip.trimStart ?? 0,
        trimEnd: heroClip.trimEnd ?? 0
      }
    : {
        file: cfg.reel?.videoFile ?? '',
        poster: cfg.reel?.poster ?? '',
        posterAlt: typeof cfg.reel?.posterAlt === 'string' ? cfg.reel.posterAlt : '',
        enabled: cfg.reel?.enabled ?? true,
        trimStart: 0,
        trimEnd: 0
      };

  // Montage: enabled items, ordered, mapped to the runtime sequence shape.
  // Defensive: RTDB omits an empty/absent montage, so guard the array.
  const montage: MontageRender[] = (Array.isArray(cfg.montage) ? cfg.montage : [])
    .filter((m) => m && m.enabled)
    .slice()
    .sort(byOrder)
    .map((m) => ({
      file: m.videoFile ?? '',
      poster: m.poster ?? '',
      posterAlt: typeof m.posterAlt === 'string' ? m.posterAlt : '',
      trimStart: Number(m.trimStart) || 0,
      trimEnd: Number(m.trimEnd) || 0,
      transition: m.transition === 'fade' ? 'fade' : 'cut'
    }));

  // Feature-row images: start from the shipped defaults, override any row the
  // stored config carries (matched by stable id, empty images ignored) — a
  // pre-features config keeps every default, a partial one only overrides what
  // it names.
  const features: MarketingFeature[] = (DEFAULT_FEATURES).map((def) => {
    const stored = (Array.isArray(cfg.features) ? cfg.features : []).find((f) => f && f.id === def.id);
    return stored && typeof stored.image === 'string' && stored.image.trim()
      ? { id: def.id, image: stored.image, alt: typeof stored.alt === 'string' ? stored.alt : def.alt }
      : { ...def };
  });

  return { hero: cfg.hero, reel, courses, clips: gridClips, montage, heroClip, features };
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

/** Shipped feature-row images — the same paths the static markup uses. */
export const DEFAULT_FEATURES: MarketingFeature[] = [
  {
    id: 'aim',
    image: 'marketing/img/feature-aim.png',
    alt: 'Aiming and shot shaping'
  },
  {
    id: 'truevision',
    image: 'marketing/img/feature-truevision.png',
    alt: 'True Vision overlay revealing the predicted shot line — carry, curve and roll'
  },
  {
    id: 'fire',
    image: 'marketing/img/feature-fire.png',
    alt: 'A golfer catches fire after back-to-back perfect swings'
  }
];

export const DEFAULT_MARKETING_CONFIG: MarketingConfig = {
  version: 0,
  publishedAt: 0,
  hero: {
    plateImage: 'marketing/img/sablebay-island.png',
    plateAlt: 'Sable Bay coastal hole at golden hour, the green tucked against the sea.',
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
    posterAlt: 'Bite-Sized Golf highlight reel — a montage of the best shots.',
    enabled: true
  },
  courses: [
    {
      art: 'marketing/img/wildwood-cherry.png',
      alt: 'Wildwood Glen — a flowering parkland hole bending along a fenced creek to the green.',
      title: 'Wildwood Glen',
      desc:
        'A lush parkland course — cherry-blossom groves, still ponds and tight, tree-lined fairways that reward shaping the ball into the pin.',
      enabled: true,
      order: 0
    },
    {
      art: 'marketing/img/sablebay-island.png',
      alt: 'Sable Bay — the island green ringed by open sea, sailboats standing off the point.',
      title: 'Sable Bay',
      desc:
        'A Pebble Beach and Torrey Pines mashup — coastal bluffs, wind-carved sand and dune fescue winding through the pines down to the sea.',
      enabled: true,
      order: 1
    },
    {
      art: 'marketing/img/timberline-pond.png',
      alt: 'Timberline — twin fairways splitting through towering timber under snow-capped peaks.',
      title: 'Timberline',
      desc:
        'Mountain golf in the pines — a checkerboard green tucked among towering timber, thin mountain air and true, honest bounces.',
      enabled: true,
      order: 2
    },
    {
      art: 'marketing/img/portjohnson-bunker.png',
      alt: 'Port Johnson Links — a links par 5 running out to a lighthouse standing in the firth.',
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
  ],
  montage: [
    {
      id: 'm-montage',
      videoFile: 'marketing/videos/montage.mp4',
      poster: 'marketing/img/poster-montage.png',
      posterAlt: 'Highlight montage opener.',
      enabled: true,
      trimStart: 0,
      trimEnd: 0,
      transition: 'cut',
      order: 0
    },
    {
      id: 'm-island',
      videoFile: 'marketing/videos/island.mp4',
      poster: 'marketing/img/poster-island.png',
      posterAlt: 'Big drive over the water on the island hole.',
      enabled: true,
      trimStart: 0,
      trimEnd: 0,
      transition: 'cut',
      order: 1
    },
    {
      id: 'm-putt',
      videoFile: 'marketing/videos/putt.mp4',
      poster: 'marketing/img/poster-putt.png',
      posterAlt: 'A clutch putt dropping into the cup.',
      enabled: true,
      trimStart: 0,
      trimEnd: 0,
      transition: 'cut',
      order: 2
    }
  ]
};

// ---- Image-path validation + per-field revert (pure, admin-facing) ----------

const POSTER_SET = new Set(POSTER_LIBRARY.map((i) => i.value));
const IMAGE_SET = new Set(IMAGE_LIBRARY.map((i) => i.value));

/** True when `path` is one of the committed images in the given library set. */
function inLibrary(set: Set<string>, path: string): boolean {
  return set.has(String(path ?? '').trim());
}

/** True when `path` is a committed poster (POSTER_LIBRARY). */
export function isKnownPoster(path: string): boolean {
  return inLibrary(POSTER_SET, path);
}

/** True when `path` is a committed image/plate (IMAGE_LIBRARY). */
export function isKnownImage(path: string): boolean {
  return inLibrary(IMAGE_SET, path);
}

/**
 * PURE: list every image path in `cfg` that is NOT in the committed library.
 * Returns human-readable `where: path` strings; an empty array means all image
 * paths are publishable. The admin calls this before publishing and blocks the
 * write (and surfaces the list) when it is non-empty, so a broken/unknown image
 * path can never reach the live page.
 */
export function validateImagePaths(cfg: MarketingConfig): string[] {
  const bad: string[] = [];
  const check = (path: string | undefined, set: Set<string>, where: string): void => {
    const p = String(path ?? '').trim();
    if (!p) {
      bad.push(`${where}: (empty)`);
      return;
    }
    if (!set.has(p)) bad.push(`${where}: ${p}`);
  };

  if (cfg.hero) check(cfg.hero.plateImage, IMAGE_SET, 'Hero plate');
  if (cfg.reel) check(cfg.reel.poster, POSTER_SET, 'Reel poster');
  (Array.isArray(cfg.courses) ? cfg.courses : []).forEach((c, i) =>
    check(c?.art, IMAGE_SET, `Course #${i + 1} art`)
  );
  (Array.isArray(cfg.clips) ? cfg.clips : []).forEach((c, i) =>
    check(c?.poster, POSTER_SET, `Clip #${i + 1} poster`)
  );
  (Array.isArray(cfg.montage) ? cfg.montage : []).forEach((m, i) =>
    check(m?.poster, POSTER_SET, `Montage #${i + 1} poster`)
  );
  (Array.isArray(cfg.features) ? cfg.features : []).forEach((f, i) =>
    check(f?.image, IMAGE_SET, `Feature ${f?.id || `#${i + 1}`} image`)
  );
  return bad;
}

/**
 * PURE: the built-in default value for an image field, keyed by the admin's
 * `data-scope` / `data-idx`. Used by the Marketing Manager's "revert" buttons to
 * restore a single image to its shipped default. Unknown scopes → '' (no-op).
 */
export function revertImagePath(scope: string, idx: number): string {
  const d = DEFAULT_MARKETING_CONFIG;
  switch (scope) {
    case 'hero':
      return d.hero.plateImage;
    case 'reel':
      return d.reel.poster;
    case 'course':
      return d.courses[idx]?.art ?? '';
    case 'clip':
      return d.clips[idx]?.poster ?? '';
    case 'montage':
      return d.montage?.[idx]?.poster ?? '';
    case 'feature':
      return DEFAULT_FEATURES[idx]?.image ?? '';
    default:
      return '';
  }
}
