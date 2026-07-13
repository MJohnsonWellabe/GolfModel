#!/usr/bin/env node
/**
 * amp-elevation.mjs — scale a course's authored hill amplitude.
 *
 * The rolling-hills feel comes from each hole's `elevation[]` control points
 * (see src/systems/HeightField.ts). Port Johnson Links reads properly hilly
 * (peak-to-peak relief ~8-10 world units); the other courses were authored
 * flatter (~5). This script multiplies the dome/hollow point heights of the
 * chosen holes by a factor so their relief can be tuned up to match, and
 * prints a before/after relief report so factors are chosen by measurement,
 * not vibes.
 *
 * Tee/green flat pads are authored as `shape: "plateau"` points — those are
 * deliberately NOT scaled (raising a pad doesn't add rolling terrain, it just
 * shears the pad edges). Negative dome points (hollows) DO scale: ridge-to-
 * hollow contrast is what makes the hills read.
 *
 * Usage:
 *   node scripts/amp-elevation.mjs src/data/courses/sablebay.json --factor 1.7
 *   node scripts/amp-elevation.mjs src/data/courses/portjohnson.json --factor 1.15 --holes 2,3
 *   ... add --write to apply (default is a dry-run report).
 */
import fs from 'node:fs';

const CELL = 8; // must match HeightField.ts
const H_MIN = -6; // safety clamp — deeper than any authored hollow today
const H_MAX = 14; // safety clamp — well above any authored ridge today

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const factor = Number(argOf('--factor'));
const holesArg = argOf('--holes');
const write = args.includes('--write');

function argOf(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

if (!file || !Number.isFinite(factor)) {
  console.error('usage: node scripts/amp-elevation.mjs <course.json> --factor <f> [--holes 1,2] [--write]');
  process.exit(1);
}

const course = JSON.parse(fs.readFileSync(file, 'utf8'));
const holeFilter = holesArg ? holesArg.split(',').map(Number) : null;

/** Mirror of HeightField's splat-sum compile, sampled for relief stats. */
function relief(points, world) {
  const gw = Math.ceil(world.width / CELL) + 1;
  const gh = Math.ceil(world.height / CELL) + 1;
  const grid = new Float32Array(gw * gh);
  for (const p of points) {
    const gx0 = Math.max(0, Math.floor((p.x - p.r) / CELL));
    const gx1 = Math.min(gw - 1, Math.ceil((p.x + p.r) / CELL));
    const gy0 = Math.max(0, Math.floor((p.y - p.r) / CELL));
    const gy1 = Math.min(gh - 1, Math.ceil((p.y + p.r) / CELL));
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const d = Math.hypot(gx * CELL - p.x, gy * CELL - p.y) / p.r;
        if (d >= 1) continue;
        let t;
        if (p.shape === 'plateau') {
          const s = Math.min(1, Math.max(0, (d - 0.55) / 0.45));
          t = 1 - s * s * (3 - 2 * s);
        } else {
          const s = 1 - d;
          t = s * s * (3 - 2 * s);
        }
        grid[gy * gw + gx] += p.h * t;
      }
    }
  }
  let min = Infinity, max = -Infinity, sum = 0, sq = 0;
  for (const v of grid) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    sq += v * v;
  }
  const mean = sum / grid.length;
  return { p2p: max - min, std: Math.sqrt(sq / grid.length - mean * mean) };
}

const fmt = (n) => n.toFixed(2);
let touched = 0;
for (const hole of course.holes) {
  if (holeFilter && !holeFilter.includes(hole.number)) continue;
  const pts = hole.elevation ?? [];
  if (pts.length === 0) continue;
  const before = relief(pts, hole.world);
  const scaled = pts.map((p) =>
    p.shape === 'plateau'
      ? p
      : { ...p, h: Math.min(H_MAX, Math.max(H_MIN, Math.round(p.h * factor * 10) / 10)) }
  );
  const after = relief(scaled, hole.world);
  const domes = pts.filter((p) => p.shape !== 'plateau').length;
  console.log(
    `${course.name} #${hole.number} ${hole.name}: ${domes}/${pts.length} pts scaled x${factor}` +
      ` | p2p ${fmt(before.p2p)} -> ${fmt(after.p2p)} | std ${fmt(before.std)} -> ${fmt(after.std)}`
  );
  if (write) {
    hole.elevation = scaled;
    touched++;
  }
}

if (write) {
  fs.writeFileSync(file, JSON.stringify(course, null, 2) + '\n');
  console.log(`wrote ${file} (${touched} holes updated)`);
} else {
  console.log('(dry run — pass --write to apply)');
}
