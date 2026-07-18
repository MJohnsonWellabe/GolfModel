/**
 * Procedural per-course ambient beds (V2 Phase 5 — the audio half of
 * docs/content/COURSE_ATMOSPHERE_BIBLE.md, design in docs/23_V2_AUDIO_IDENTITY.md).
 *
 * Each bed is synthesized from one shared noise buffer + a few oscillators —
 * no downloaded assets, nothing to license, ~zero bytes shipped. All nodes
 * hang off the ambience master gain, so the existing slider and mute apply
 * instantly (constitution rule 14). Beds start only from the game's
 * first-gesture ambience hook and stop/start cleanly on course change; every
 * node is disconnected on stop.
 *
 * Tuning philosophy: parameters live in BED_PARAMS as data. Every bed is
 * deliberately conservative — an ambient bed should be missed when muted,
 * never noticed when on.
 */

import { ambienceBus, audioContext } from './engine';

export type BedKind = 'coastal' | 'harbor' | 'forest' | 'alpine' | 'desert' | 'prairie';

/** Course → bed (bible identities; expansion courses per their briefs). */
export const COURSE_BEDS: Record<string, BedKind> = {
  sablebay: 'coastal',
  portjohnson: 'harbor',
  wildwood: 'forest',
  timberline: 'alpine',
  redhollow: 'desert',
  kettlebarrens: 'prairie'
};

/** All the taste knobs in one place (see doc: tuned on-device later). */
export const BED_PARAMS = {
  coastal: { lowpassHz: 420, swellHz: 0.09, swellDepth: 0.5, base: 0.4 },
  harbor: { lowpassHz: 300, swellHz: 0.055, swellDepth: 0.55, base: 0.36, hornGapS: [75, 120], hornGain: 0.1 },
  forest: { hissHz: 3000, hissQ: 2, hissGain: 0.07, chirpGapS: [4, 9], chirpGain: 0.1 },
  alpine: { bandHz: 700, bandQ: 0.7, gustHz: 0.05, gustDepth: 0.6, base: 0.3 },
  // Red Hollow: hot dry wind (higher band than alpine, slower gusts) with
  // sparse insect clicks instead of birdsong.
  desert: { bandHz: 1100, bandQ: 0.6, gustHz: 0.035, gustDepth: 0.55, base: 0.26, clickGapS: [6, 14], clickGain: 0.06 },
  // Kettle Barrens: soft prairie wind under sparse meadow chirps — between
  // the alpine gusts and the forest's chatter.
  prairie: { bandHz: 850, bandQ: 0.65, gustHz: 0.06, gustDepth: 0.5, base: 0.24, chirpGapS: [7, 14], chirpGain: 0.08 }
} as const;

let noiseBuf: AudioBuffer | null = null;
function noise(ctx: AudioContext): AudioBuffer {
  if (!noiseBuf || noiseBuf.sampleRate !== ctx.sampleRate) {
    const len = ctx.sampleRate * 2;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

interface ActiveBed {
  kind: BedKind;
  nodes: AudioNode[];
  timers: ReturnType<typeof setTimeout>[];
}

let active: ActiveBed | null = null;

/** Looping noise source → (optional filter) → LFO-swelled gain → bus. */
function noiseSwell(
  ctx: AudioContext,
  bus: AudioNode,
  bed: ActiveBed,
  filter: BiquadFilterNode | null,
  base: number,
  lfoHz: number,
  depth: number
): void {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  src.loop = true;
  const swell = ctx.createGain();
  // The LFO modulates around base·(1−depth/2)…base·(1+depth/2), always > 0.
  swell.gain.value = base;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = lfoHz;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = (base * depth) / 2;
  lfo.connect(lfoGain);
  lfoGain.connect(swell.gain);
  if (filter) {
    src.connect(filter);
    filter.connect(swell);
  } else {
    src.connect(swell);
  }
  swell.connect(bus);
  src.start();
  lfo.start();
  bed.nodes.push(src, swell, lfo, lfoGain);
  if (filter) bed.nodes.push(filter);
}

/** A short enveloped tone (chirp note / foghorn blast). */
function tone(
  ctx: AudioContext,
  bus: AudioNode,
  freqFrom: number,
  freqTo: number,
  durS: number,
  peakGain: number,
  type: OscillatorType
): void {
  const osc = ctx.createOscillator();
  osc.type = type;
  const t0 = ctx.currentTime;
  osc.frequency.setValueAtTime(freqFrom, t0);
  if (freqTo !== freqFrom) osc.frequency.linearRampToValueAtTime(freqTo, t0 + durS);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peakGain, t0 + durS * 0.3);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + durS);
  osc.connect(g);
  g.connect(bus);
  osc.start(t0);
  osc.stop(t0 + durS + 0.05);
  osc.onended = () => {
    try {
      g.disconnect();
    } catch {
      /* gone */
    }
  };
}

/** Schedule a recurring accent with a randomized gap; timer is bed-owned. */
function recurring(bed: ActiveBed, gapS: readonly [number, number], fire: () => void): void {
  const next = (): void => {
    const gap = (gapS[0] + Math.random() * (gapS[1] - gapS[0])) * 1000;
    const t = setTimeout(() => {
      if (active !== bed) return;
      fire();
      next();
    }, gap);
    bed.timers.push(t);
  };
  next();
}

function buildBed(ctx: AudioContext, bus: AudioNode, kind: BedKind, bed: ActiveBed): void {
  if (kind === 'coastal' || kind === 'harbor') {
    const p = BED_PARAMS[kind];
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = p.lowpassHz;
    noiseSwell(ctx, bus, bed, lp, p.base, p.swellHz, p.swellDepth);
    if (kind === 'harbor') {
      const hp = BED_PARAMS.harbor;
      recurring(bed, hp.hornGapS, () => tone(ctx, bus, 105, 100, 2.6, hp.hornGain, 'sine'));
    }
    return;
  }
  if (kind === 'forest') {
    const p = BED_PARAMS.forest;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = p.hissHz;
    bp.Q.value = p.hissQ;
    noiseSwell(ctx, bus, bed, bp, p.hissGain, 0.07, 0.4);
    recurring(bed, p.chirpGapS, () => {
      // A two-note chirp: quick up-sweep then a short answering note.
      const f = 2600 + Math.random() * 800;
      tone(ctx, bus, f, f + 500, 0.14, p.chirpGain, 'sine');
      const t = setTimeout(() => {
        if (active === bed) tone(ctx, bus, f + 300, f + 150, 0.1, p.chirpGain * 0.8, 'sine');
      }, 190);
      bed.timers.push(t);
    });
    return;
  }
  // wind-family beds: alpine / desert / prairie share the band-passed gust
  // core and differ in band, pace, and their sparse accent.
  const p = BED_PARAMS[kind];
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = p.bandHz;
  bp.Q.value = p.bandQ;
  noiseSwell(ctx, bus, bed, bp, p.base, p.gustHz, p.gustDepth);
  if (kind === 'desert') {
    const d = BED_PARAMS.desert;
    // Insect click: one very short high tick, occasionally doubled.
    recurring(bed, d.clickGapS, () => {
      tone(ctx, bus, 4200, 4200, 0.03, d.clickGain, 'square');
      if (Math.random() < 0.4) {
        const t2 = setTimeout(() => {
          if (active === bed) tone(ctx, bus, 4400, 4400, 0.03, d.clickGain * 0.8, 'square');
        }, 120);
        bed.timers.push(t2);
      }
    });
  } else if (kind === 'prairie') {
    const pr = BED_PARAMS.prairie;
    recurring(bed, pr.chirpGapS, () => {
      const f = 2400 + Math.random() * 700;
      tone(ctx, bus, f, f + 350, 0.12, pr.chirpGain, 'sine');
    });
  }
}

/** Start (or switch to) the bed for `kind`. No-op when it's already playing.
 *  Returns false when WebAudio is unavailable (caller keeps the wav loop). */
export function startBed(kind: BedKind): boolean {
  const ctx = audioContext();
  const bus = ambienceBus();
  if (!ctx || !bus) return false;
  if (active?.kind === kind) return true;
  stopBed();
  const bed: ActiveBed = { kind, nodes: [], timers: [] };
  active = bed;
  try {
    buildBed(ctx, bus, kind, bed);
  } catch {
    stopBed();
    return false;
  }
  return true;
}

/** Stop and fully disconnect the active bed. Safe to call repeatedly. */
export function stopBed(): void {
  if (!active) return;
  const bed = active;
  active = null;
  for (const t of bed.timers) clearTimeout(t);
  for (const n of bed.nodes) {
    try {
      if (n instanceof AudioBufferSourceNode || n instanceof OscillatorNode) n.stop();
    } catch {
      /* already stopped */
    }
    try {
      n.disconnect();
    } catch {
      /* already disconnected */
    }
  }
}

/** The active bed kind (test/debug introspection). */
export function activeBedKind(): BedKind | null {
  return active?.kind ?? null;
}
