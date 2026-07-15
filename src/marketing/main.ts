/**
 * Marketing kit (marketing.html) — populates the course/character/pal rosters
 * and the gameplay-clip wall from the live game data + committed captures, so
 * the press page never drifts from the real roster. This page is owner-reached
 * from the admin dashboard.
 */
import { CHARACTERS } from '../data/characters';
import { PALS } from '../data/pals';

function rosterCard(imgSrc: string, name: string, pal: boolean): string {
  const cls = pal ? 'card pal' : 'card';
  return (
    `<div class="${cls}">` +
    `<img src="${imgSrc}" alt="${name}" loading="lazy" onerror="this.closest('.card').style.display='none'" />` +
    `<span>${name}</span></div>`
  );
}

const charEl = document.getElementById('charRoster');
if (charEl) charEl.innerHTML = CHARACTERS.map((c) => rosterCard(`ui/characters/${c.key}.png`, c.name, false)).join('');
const palEl = document.getElementById('palRoster');
if (palEl) palEl.innerHTML = PALS.map((p) => rosterCard(p.image, p.name, true)).join('');

// ---- Gameplay clip wall -----------------------------------------------------
// Each tile loops a pre-trimmed in-engine clip (H.264 mp4, iOS-friendly). The
// clips were recorded on-device and trimmed to the action; `poster` shows until
// the clip loads. A tile with no `file` stays a still poster only.
interface Clip {
  badge: string;
  title: string;
  sub: string;
  poster: string;
  file?: string;
}

const CLIPS: Clip[] = [
  { badge: 'Par 3', title: 'Tee shot to the pin', sub: 'Darts onto the island, kick-in close.', poster: 'marketing/img/poster-ace.png', file: 'marketing/videos/hole-in-one.mp4' },
  { badge: 'Backspin', title: 'Check & back up', sub: 'Lands soft, bites by the cup.', poster: 'marketing/img/poster-backspin.png', file: 'marketing/videos/backspin.mp4' },
  { badge: 'Approach', title: 'Island carry', sub: 'Flushed over the water to the green.', poster: 'marketing/img/poster-island.png', file: 'marketing/videos/island.mp4' },
  { badge: 'Putt', title: 'Clutch putt', sub: 'Reads the break, rolls it in.', poster: 'marketing/img/poster-putt.png', file: 'marketing/videos/putt.mp4' },
  { badge: 'Short game', title: 'Spin check', sub: 'Zips back to the flag on the pond green.', poster: 'marketing/img/poster-greenread.png', file: 'marketing/videos/greenread.mp4' }
];

function clipTile(c: Clip): string {
  const media = c.file
    ? `<video class="clipvid" muted loop playsinline preload="metadata" poster="${c.poster}">` +
      `<source src="${c.file}" type="video/mp4" /></video>`
    : `<img class="poster" src="${c.poster}" alt="${c.title}" loading="lazy" />`;
  return (
    `<div class="clip"><div class="badge">${c.badge}</div>${media}` +
    `<div class="cap"><b>${c.title}</b><span>${c.sub}</span></div></div>`
  );
}

const clipGrid = document.getElementById('clipGrid');
if (clipGrid) {
  clipGrid.innerHTML = CLIPS.map(clipTile).join('');
}
{
  // Play every clip (the highlight reel + the tiles) only while it is scrolled
  // into view, so the looping videos never thrash the page.
  const vids = Array.from(document.querySelectorAll<HTMLVideoElement>('video.clipvid'));
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const v = e.target as HTMLVideoElement;
          if (e.isIntersecting) void v.play().catch(() => undefined);
          else v.pause();
        }
      },
      { threshold: 0.35 }
    );
    vids.forEach((v) => io.observe(v));
  } else {
    vids.forEach((v) => void v.play().catch(() => undefined));
  }
}

// Graceful fallback for scenic plates: a missing capture drops to a soft
// gradient rather than a broken-image icon.
for (const img of Array.from(document.querySelectorAll<HTMLImageElement>('.feature .shot img, .course img'))) {
  img.addEventListener('error', () => {
    const holder = img.parentElement;
    img.style.display = 'none';
    if (holder) {
      holder.style.minHeight = '220px';
      holder.style.background = 'linear-gradient(160deg, #0e3f22, #061a0e)';
    }
  });
}
