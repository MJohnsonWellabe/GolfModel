#!/usr/bin/env node
/**
 * Synthesizes the game's sound effects as 16-bit mono WAVs in assets/sfx/.
 * Everything is generated from math (seeded, deterministic) so the project
 * owns its audio outright. Re-run after tweaking: node scripts/generate-sfx.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 44100;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'sfx');

/** Deterministic PRNG so regenerated files are identical. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const secs = (s) => Math.round(s * SR);

/** Exponential decay envelope. */
const decay = (i, n, k = 5) => Math.exp((-k * i) / n);
/** Linear attack then exponential decay. */
const adsr = (i, n, attack, k = 5) =>
  i < attack ? i / attack : Math.exp((-k * (i - attack)) / (n - attack));

/** One-pole lowpass over a sample array (in place). */
function lowpass(buf, alpha) {
  let y = 0;
  for (let i = 0; i < buf.length; i++) {
    y += alpha * (buf[i] - y);
    buf[i] = y;
  }
  return buf;
}

/** Mix source into target at offset with gain. */
function mixInto(target, source, offset, gain = 1) {
  for (let i = 0; i < source.length; i++) {
    const j = offset + i;
    if (j >= 0 && j < target.length) target[j] += source[i] * gain;
  }
}

function writeWav(name, samples) {
  // Normalize to -1..1 with a little headroom
  let peak = 1e-6;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  const gain = 0.85 / peak;
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * gain * 32767))), 44 + i * 2);
  }
  writeFileSync(join(OUT, name), buf);
  console.log(`wrote ${name} (${(n / SR).toFixed(2)}s)`);
}

// ------------------------------------------------------------- ingredients

/** Air whoosh: noise through a rising resonant sweep. */
function whoosh(dur, f0, f1, seed, k = 4) {
  const rand = mulberry32(seed);
  const n = secs(dur);
  const out = new Float64Array(n);
  let y = 0;
  for (let i = 0; i < n; i++) {
    const f = f0 + (f1 - f0) * (i / n);
    const alpha = Math.min(0.9, (2 * Math.PI * f) / SR);
    y += alpha * ((rand() * 2 - 1) - y);
    out[i] = y * adsr(i, n, n * 0.35, k);
  }
  return out;
}

/** Damped sine "thump/knock". */
function thump(dur, freq, seed, k = 9, drift = 0.6) {
  const n = secs(dur);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const f = freq * (1 - (drift * i) / n / 3);
    out[i] = Math.sin((2 * Math.PI * f * i) / SR) * decay(i, n, k);
  }
  return out;
}

/** Very short broadband click. */
function click(dur, seed, brightness = 0.5) {
  const rand = mulberry32(seed);
  const n = secs(dur);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = (rand() * 2 - 1) * decay(i, n, 14);
  return lowpass(out, brightness);
}

/** Bell tone with harmonics for chimes. */
function bell(dur, freq, k = 4) {
  const n = secs(dur);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * freq * i) / SR;
    out[i] =
      (Math.sin(t) + 0.5 * Math.sin(2.01 * t) + 0.25 * Math.sin(3.02 * t)) * decay(i, n, k);
  }
  return out;
}

/** Bird chirp: quick FM sweep. */
function chirp(dur, f0, f1, k = 6) {
  const n = secs(dur);
  const out = new Float64Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const f = f0 + (f1 - f0) * Math.sin((Math.PI * i) / n);
    phase += (2 * Math.PI * f) / SR;
    out[i] = Math.sin(phase) * adsr(i, n, n * 0.15, k);
  }
  return out;
}

// ------------------------------------------------------------------ sounds

mkdirSync(OUT, { recursive: true });

// Swing whoosh (downswing air)
writeWav('swing.wav', whoosh(0.28, 300, 1400, 11, 5));

// Club impacts: crack + body thump, brighter and lighter down the bag
{
  const driver = new Float64Array(secs(0.28));
  mixInto(driver, click(0.03, 21, 0.75), 0, 1.1);
  mixInto(driver, thump(0.22, 95, 22, 10), secs(0.004), 0.9);
  mixInto(driver, thump(0.06, 900, 23, 18), 0, 0.35);
  writeWav('impact-driver.wav', driver);

  const iron = new Float64Array(secs(0.2));
  mixInto(iron, click(0.025, 31, 0.85), 0, 1.0);
  mixInto(iron, thump(0.12, 180, 32, 13), secs(0.003), 0.55);
  mixInto(iron, thump(0.05, 1400, 33, 20), 0, 0.3);
  writeWav('impact-iron.wav', iron);

  const wedge = new Float64Array(secs(0.16));
  mixInto(wedge, click(0.03, 41, 0.45), 0, 0.9);
  mixInto(wedge, thump(0.1, 240, 42, 15), secs(0.002), 0.4);
  writeWav('impact-wedge.wav', wedge);

  const putt = new Float64Array(secs(0.09));
  mixInto(putt, click(0.02, 51, 0.55), 0, 0.8);
  mixInto(putt, thump(0.07, 650, 52, 22), 0, 0.5);
  writeWav('putt.wav', putt);
}

// Tree/building knock
{
  const knock = new Float64Array(secs(0.22));
  mixInto(knock, click(0.02, 61, 0.4), 0, 0.8);
  mixInto(knock, thump(0.18, 140, 62, 11), 0, 1.0);
  writeWav('hit.wav', knock);
}

// Ball drops in the cup: bounce clicks into a hollow rattle
{
  const cup = new Float64Array(secs(0.55));
  mixInto(cup, click(0.02, 71, 0.5), 0, 0.9);
  mixInto(cup, thump(0.08, 520, 72, 16), 0, 0.6);
  mixInto(cup, click(0.015, 73, 0.5), secs(0.12), 0.7);
  mixInto(cup, thump(0.07, 440, 74, 16), secs(0.12), 0.5);
  mixInto(cup, click(0.012, 75, 0.5), secs(0.21), 0.55);
  mixInto(cup, thump(0.3, 300, 76, 8), secs(0.27), 0.6);
  writeWav('hole.wav', cup);
}

// Splash: broadband burst with slow watery tail + droplets
{
  const n = secs(0.7);
  const splash = new Float64Array(n);
  const rand = mulberry32(81);
  let y = 0;
  for (let i = 0; i < n; i++) {
    const cutoff = 0.5 * Math.exp((-3 * i) / n) + 0.04;
    y += cutoff * ((rand() * 2 - 1) - y);
    splash[i] = y * adsr(i, n, secs(0.01), 4.5);
  }
  mixInto(splash, chirp(0.05, 900, 500), secs(0.28), 0.25);
  mixInto(splash, chirp(0.04, 1100, 650), secs(0.4), 0.18);
  writeWav('splash.wav', splash);
}

// Catch-fire: whoosh + rising shimmer
{
  const fire = new Float64Array(secs(0.7));
  mixInto(fire, whoosh(0.55, 200, 900, 91, 3.5), 0, 0.9);
  mixInto(fire, bell(0.4, 660, 6), secs(0.18), 0.25);
  mixInto(fire, bell(0.4, 880, 6), secs(0.3), 0.25);
  writeWav('fire.wav', fire);
}

// Birdie/eagle chime: rising two-note bell
{
  const chime = new Float64Array(secs(0.8));
  mixInto(chime, bell(0.5, 784, 5), 0, 0.8); // G5
  mixInto(chime, bell(0.6, 1175, 5), secs(0.16), 0.8); // D6
  writeWav('chime.wav', chime);
}

// UI tap
writeWav('ui.wav', (() => {
  const t = new Float64Array(secs(0.07));
  mixInto(t, thump(0.06, 520, 101, 18), 0, 0.7);
  mixInto(t, click(0.012, 102, 0.4), 0, 0.35);
  return t;
})());

// Ambience loop (~8s): soft breeze + occasional birds, loops cleanly
{
  const n = secs(8);
  const amb = new Float64Array(n);
  const rand = mulberry32(111);
  let y = 0;
  for (let i = 0; i < n; i++) {
    // Breeze: heavily lowpassed noise, slowly breathing
    y += 0.02 * ((rand() * 2 - 1) - y);
    const breath = 0.6 + 0.4 * Math.sin((2 * Math.PI * i) / n + Math.sin((4 * Math.PI * i) / n));
    amb[i] = y * 0.5 * breath;
  }
  const birdAt = [0.9, 1.15, 3.4, 3.6, 3.75, 6.1, 6.4];
  const tones = [
    [2400, 3300],
    [2900, 2300],
    [2600, 3500],
    [3100, 2500],
    [2700, 3400],
    [2500, 3200],
    [3000, 2400]
  ];
  birdAt.forEach((at, i) => {
    mixInto(amb, chirp(0.09 + (i % 3) * 0.03, tones[i][0], tones[i][1], 7), secs(at), 0.12);
  });
  writeWav('ambience.wav', amb);
}

console.log('All SFX generated into assets/sfx/');
