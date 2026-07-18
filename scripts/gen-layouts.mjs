// One-shot authoring assistant: bake authored pin sets (front/back/side reads
// on each green) + one safe alternate tee per hole into the course JSONs.
// Deterministic geometry + hazard validation; results are then hand-reviewed,
// unit-validated (layouts.test.ts), and Monte-Carlo play-tested like any
// authored content. Text-surgical writes: only the hole objects gain keys.
import { readFileSync, writeFileSync } from 'node:fs';

const COURSES = ['sablebay', 'wildwood', 'timberline', 'portjohnson'];

const rot2 = (x, y, r) => [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];

function pinsFor(hole) {
  const g = hole.green;
  const rotv = g.rot ?? 0;
  // Tee direction in ellipse-local space (unit-ish).
  let [dx, dy] = [hole.tee.x - g.cx, hole.tee.y - g.cy];
  const [lx, ly] = rot2(dx, dy, -rotv);
  const ll = Math.hypot(lx, ly) || 1;
  const [ux, uy] = [lx / ll, ly / ll];
  const P = (ax, ay) => {
    const [wx, wy] = rot2(ax * g.rx, ay * g.ry, rotv);
    return { x: Math.round((g.cx + wx) * 10) / 10, y: Math.round((g.cy + wy) * 10) / 10 };
  };
  // front (toward tee), back-tucked (away), side shelf (perpendicular).
  return [P(ux * 0.55, uy * 0.55), P(-ux * 0.52, -uy * 0.52), P(-uy * 0.5, ux * 0.5)];
}

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function teeCandidateOk(hole, world, x, y) {
  const M = 40;
  if (x < M || y < M || x > world.width - M || y > world.height - M) return false;
  for (const hz of hole.hazards ?? []) {
    if (!['water', 'bunker', 'trees'].includes(hz.type)) continue;
    // The point plus a small ring must all clear the hazard (tee mound footprint).
    for (const [ox, oy] of [[0,0],[18,0],[-18,0],[0,18],[0,-18]]) {
      if (pointInPoly(x + ox, y + oy, hz.polygon)) return false;
    }
  }
  const g = hole.green;
  if (Math.hypot(x - g.cx, y - g.cy) < Math.max(g.rx, g.ry) + 30) return false;
  return true;
}

function altTeeFor(hole) {
  // Aim direction: first fairway centerline start→second point, else tee→pin.
  const rib = (hole.fairway ?? []).find((f) => !Array.isArray(f));
  let tx, ty;
  if (rib && rib.centerline?.length > 1) {
    [tx, ty] = [rib.centerline[1][0] - hole.tee.x, rib.centerline[1][1] - hole.tee.y];
  } else {
    [tx, ty] = [hole.pin.x - hole.tee.x, hole.pin.y - hole.tee.y];
  }
  const l = Math.hypot(tx, ty) || 1;
  const [ux, uy] = [tx / l, ty / l];
  // forward member tee, deeper forward, back championship tee.
  for (const d of [72, 110, -58]) {
    const x = Math.round((hole.tee.x + ux * d) * 10) / 10;
    const y = Math.round((hole.tee.y + uy * d) * 10) / 10;
    if (teeCandidateOk(hole, hole.world, x, y)) return { x, y };
  }
  return null;
}

for (const c of COURSES) {
  const path = `src/data/courses/${c}.json`;
  let src = readFileSync(path, 'utf8');
  const data = JSON.parse(src);
  for (const hole of data.holes) {
    const pins = pinsFor(hole);
    const alt = altTeeFor(hole);
    // Surgical insert: extend the authored `"pin": {...},` line in THIS hole.
    const pinLine = `"pin": ${JSON.stringify(hole.pin)}`.replace(/"/g, '\\"');
    // Find the hole block by its unique number+name pair, then its pin entry.
    const anchor = new RegExp(
      `("number":\\s*${hole.number},[\\s\\S]*?"pin":\\s*\\{[^}]*\\})`,
      ''
    );
    const m = src.match(anchor);
    if (!m) { console.log(`!! ${c} h${hole.number}: pin anchor not found`); continue; }
    const insert =
      `,\n      "pins": ${JSON.stringify(pins)}` +
      (alt ? `,\n      "tees": [${JSON.stringify(alt)}]` : '');
    src = src.replace(m[1], m[1] + insert);
    console.log(`${c} h${hole.number}: pins ${JSON.stringify(pins)} altTee ${JSON.stringify(alt)}`);
  }
  writeFileSync(path, src);
}
