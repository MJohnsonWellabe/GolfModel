import { describe, expect, it } from 'vitest';
import { BED_PARAMS, COURSE_BEDS } from '../../src/core/audio/beds';
import { LANDING_THUMP, SFX_VARIATION, variedParams } from '../../src/core/audio/variation';

describe('sfx variation (V2 Phase 5)', () => {
  it('varied keys stay inside their declared jitter ranges', () => {
    for (const key of Object.keys(SFX_VARIATION)) {
      const spec = SFX_VARIATION[key];
      for (const r of [0, 0.25, 0.5, 0.75, 1]) {
        const v = variedParams(key, () => r);
        expect(v.rate).toBeGreaterThanOrEqual(1 - spec.rate - 1e-9);
        expect(v.rate).toBeLessThanOrEqual(1 + spec.rate + 1e-9);
        expect(v.gainMult).toBeGreaterThanOrEqual(1 - spec.gain - 1e-9);
        expect(v.gainMult).toBeLessThanOrEqual(1 + spec.gain + 1e-9);
      }
    }
  });

  it('celebration/status keys are NOT varied — they stay canonical', () => {
    for (const key of ['hole', 'chime', 'fire', 'splash', 'ui']) {
      expect(variedParams(key, () => 0)).toEqual({ rate: 1, gainMult: 1 });
    }
  });

  it('rnd midpoint is the natural playback', () => {
    expect(variedParams('impact-driver', () => 0.5)).toEqual({ rate: 1, gainMult: 1 });
  });
});

describe('landing thumps', () => {
  it('covers every dry landing surface and leaves water to the splash', () => {
    for (const s of ['green', 'fringe', 'fairway', 'rough', 'sand']) {
      expect(LANDING_THUMP[s], s).toBeTruthy();
    }
    expect(LANDING_THUMP.water).toBeUndefined();
  });

  it('keeps thumps quiet (ambient feedback, not an impact)', () => {
    for (const spec of Object.values(LANDING_THUMP)) {
      expect(spec.volume).toBeLessThanOrEqual(0.4);
      expect(spec.volume).toBeGreaterThan(0);
    }
  });
});

describe('ambient beds', () => {
  it('every shipped course has a bed and every bed has parameters', () => {
    for (const id of ['sablebay', 'wildwood', 'timberline', 'portjohnson', 'redhollow', 'wildvalley']) {
      const kind = COURSE_BEDS[id];
      expect(kind, id).toBeTruthy();
      expect(BED_PARAMS[kind], kind).toBeTruthy();
    }
  });

  it('bed base gains stay conservative (≤0.5 pre-slider)', () => {
    expect(BED_PARAMS.coastal.base).toBeLessThanOrEqual(0.5);
    expect(BED_PARAMS.harbor.base).toBeLessThanOrEqual(0.5);
    expect(BED_PARAMS.alpine.base).toBeLessThanOrEqual(0.5);
    expect(BED_PARAMS.forest.hissGain).toBeLessThanOrEqual(0.5);
  });
});
