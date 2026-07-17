import { describe, expect, it } from 'vitest';
import {
  configToRenderModel,
  resolveRenderModel,
  DEFAULT_MARKETING_CONFIG,
  MarketingConfig,
  MarketingClip
} from '../src/marketing/config';

const clip = (over: Partial<MarketingClip>): MarketingClip => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  videoFile: 'marketing/videos/putt.mp4',
  poster: 'marketing/img/poster-putt.png',
  badge: 'Putt',
  title: 'Clutch putt',
  caption: 'Read the break.',
  description: '',
  enabled: true,
  heroFlag: false,
  trimStart: 0,
  trimEnd: 0,
  order: 0,
  ...over
});

const cfg = (over: Partial<MarketingConfig>): MarketingConfig => ({
  version: 1,
  publishedAt: 0,
  hero: DEFAULT_MARKETING_CONFIG.hero,
  reel: DEFAULT_MARKETING_CONFIG.reel,
  courses: [],
  clips: [],
  ...over
});

describe('configToRenderModel', () => {
  it('drops disabled clips and orders the rest by `order`', () => {
    const model = configToRenderModel(
      cfg({
        clips: [
          clip({ id: 'c', title: 'third', order: 2 }),
          clip({ id: 'a', title: 'first', order: 0 }),
          clip({ id: 'off', title: 'hidden', order: 1, enabled: false })
        ]
      })
    );
    expect(model.clips.map((c) => c.title)).toEqual(['first', 'third']);
  });

  it('maps caption→sub and videoFile→file (the existing Clip shape)', () => {
    const model = configToRenderModel(
      cfg({ clips: [clip({ caption: 'sub line', videoFile: 'marketing/videos/island.mp4' })] })
    );
    expect(model.clips[0].sub).toBe('sub line');
    expect(model.clips[0].file).toBe('marketing/videos/island.mp4');
  });

  it('promotes a heroFlag clip into the reel slot and removes it from the grid', () => {
    const model = configToRenderModel(
      cfg({
        reel: { videoFile: 'marketing/videos/montage.mp4', poster: 'marketing/img/poster-montage.png', enabled: true },
        clips: [
          clip({ id: 'grid', title: 'grid clip', order: 0 }),
          clip({
            id: 'hero',
            title: 'hero clip',
            order: 1,
            heroFlag: true,
            videoFile: 'marketing/videos/hole-in-one.mp4',
            poster: 'marketing/img/poster-ace.png',
            trimStart: 2,
            trimEnd: 6
          })
        ]
      })
    );
    // reel now comes from the hero clip, with its trim window
    expect(model.reel.file).toBe('marketing/videos/hole-in-one.mp4');
    expect(model.reel.trimStart).toBe(2);
    expect(model.reel.trimEnd).toBe(6);
    // hero clip is not duplicated in the grid
    expect(model.clips.map((c) => c.title)).toEqual(['grid clip']);
    expect(model.heroClip?.title).toBe('hero clip');
  });

  it('falls back to config.reel when no clip is flagged hero', () => {
    const model = configToRenderModel(
      cfg({
        reel: { videoFile: 'marketing/videos/montage.mp4', poster: 'marketing/img/poster-montage.png', enabled: true },
        clips: [clip({})]
      })
    );
    expect(model.reel.file).toBe('marketing/videos/montage.mp4');
    expect(model.heroClip).toBeNull();
  });

  it('carries trim values through to the mapped clip', () => {
    const model = configToRenderModel(cfg({ clips: [clip({ trimStart: 1.5, trimEnd: 4 })] }));
    expect(model.clips[0].trimStart).toBe(1.5);
    expect(model.clips[0].trimEnd).toBe(4);
  });

  it('orders and filters the course gallery too', () => {
    const model = configToRenderModel(
      cfg({
        courses: [
          { art: 'a.png', title: 'B', desc: '', enabled: true, order: 1 },
          { art: 'b.png', title: 'A', desc: '', enabled: true, order: 0 },
          { art: 'c.png', title: 'Hidden', desc: '', enabled: false, order: 2 }
        ]
      })
    );
    expect(model.courses.map((c) => c.title)).toEqual(['A', 'B']);
  });
});

describe('resolveRenderModel (static fallback)', () => {
  it('null config resolves to the built-in default render model', () => {
    const model = resolveRenderModel(null);
    const fromDefault = configToRenderModel(DEFAULT_MARKETING_CONFIG);
    expect(model.clips.map((c) => c.title)).toEqual(fromDefault.clips.map((c) => c.title));
    expect(model.hero.title).toBe(DEFAULT_MARKETING_CONFIG.hero.title);
    expect(model.clips.length).toBe(5);
  });

  it('a malformed config (missing clips array) falls back to default', () => {
    const model = resolveRenderModel({ hero: {} } as unknown as MarketingConfig);
    expect(model.clips.length).toBe(5);
  });

  it('an empty published config (no enabled clips) yields an empty grid, not the default', () => {
    const model = resolveRenderModel(cfg({ clips: [clip({ enabled: false })] }));
    expect(model.clips.length).toBe(0);
  });
});
