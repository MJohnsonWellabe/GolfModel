/**
 * Marketing kit (marketing.html) — populates the character + pal roster grids
 * straight from the live game data so the press page never drifts from the real
 * roster. Screens elsewhere on the page are captured in-engine
 * (scripts/_capture_marketing is the dev-time capture; committed under
 * assets/marketing/). This page is owner-reached from the admin dashboard.
 */
import { CHARACTERS } from '../data/characters';
import { PALS } from '../data/pals';

function card(imgSrc: string, name: string, pal: boolean): string {
  const cls = pal ? 'card pal' : 'card';
  // onerror hides a tile whose portrait asset is missing rather than showing a
  // broken image — keeps the grid clean if the roster ever outruns the portraits.
  return (
    `<div class="${cls}">` +
    `<img src="${imgSrc}" alt="${name}" loading="lazy" onerror="this.closest('.card').style.display='none'" />` +
    `<span>${name}</span></div>`
  );
}

const charEl = document.getElementById('charRoster');
if (charEl) {
  charEl.innerHTML = CHARACTERS.map((c) => card(`ui/characters/${c.key}.png`, c.name, false)).join('');
}

const palEl = document.getElementById('palRoster');
if (palEl) {
  // PalDef.image is already the `ui/pals/<key>.png` path the game uses.
  palEl.innerHTML = PALS.map((p) => card(p.image, p.name, true)).join('');
}

// Graceful fallback for the scenic plates (feature + course shots): if a
// capture is missing, drop the broken <img> and leave the framed card as a soft
// green gradient rather than a broken-image icon.
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
