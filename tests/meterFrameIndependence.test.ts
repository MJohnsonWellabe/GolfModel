import { describe, expect, it } from 'vitest';
import { advanceCursor } from '../src/slice3d/meter3d';

function runSchedule(frames: number[], speed: number, bounce: boolean, dir: 1 | -1 = 1) {
  let cursor = dir === 1 ? 0 : 1;
  let dirSign = dir;
  for (const dt of frames) {
    const r = advanceCursor(cursor, dirSign, speed, dt, bounce);
    cursor = r.cursor;
    dirSign = r.dirSign;
  }
  return { cursor, dirSign };
}

describe('meter cursor is elapsed-time based, not frame-count based', () => {
  const speed = 1 / 1000;

  it('left-to-right power sweep lands identically for 60fps, 30fps, irregular and long-frame schedules', () => {
    const schedules = [
      Array.from({ length: 30 }, () => 10),
      Array.from({ length: 18 }, () => 16.6666666667),
      Array.from({ length: 9 }, () => 33.3333333333),
      [7, 22, 4, 51, 16, 83, 117]
    ];
    const expected = runSchedule([300], speed, true);
    for (const s of schedules) {
      const total = s.reduce((a, b) => a + b, 0);
      const scaled = s.map((dt) => (dt / total) * 300);
      const out = runSchedule(scaled, speed, true);
      expect(out.cursor).toBeCloseTo(expected.cursor, 10);
      expect(out.dirSign).toBe(expected.dirSign);
    }
  });

  it('right-to-left return sweep lands identically for stable, irregular and long frames', () => {
    const expected = runSchedule([260], speed, false, -1);
    for (const s of [[16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 100], [33, 33, 33, 33, 128], [260]]) {
      const total = s.reduce((a, b) => a + b, 0);
      const scaled = s.map((dt) => (dt / total) * 260);
      const out = runSchedule(scaled, speed, false, -1);
      expect(out.cursor).toBeCloseTo(expected.cursor, 10);
      expect(out.dirSign).toBe(expected.dirSign);
    }
  });

  it('power bounce handles very long frames without clamping away elapsed travel', () => {
    const a = runSchedule([2600], speed, true);
    const b = runSchedule([1000, 1000, 600], speed, true);
    expect(a.cursor).toBeCloseTo(b.cursor, 10);
    expect(a.dirSign).toBe(b.dirSign);
  });
});
