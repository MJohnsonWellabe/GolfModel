import { describe, expect, it, beforeEach, vi } from 'vitest';
import { ShotCapture } from '../../src/slice3d/shotCapture';

/**
 * "MY LAST SHOT" HAS TO MEAN THE LAST SHOT.
 *
 * Owner: "can you make the record button go all the way back to the beginning
 * of whatever the last hit was… sometimes it records three seconds. sometimes
 * ten. it doesn't seem to have any rhyme or reason right now."
 *
 * There was a reason, and it was the wrong one. The recorder rotated on a fixed
 * ~10s timer and `saveClip` exported the current segment if it happened to be
 * more than half-grown, else the previous one — a window tied to wall-clock,
 * with no relationship to when the ball was struck. The same button therefore
 * gave a 3s clip or a 10s one depending only on WHEN you pressed it, and could
 * miss the strike entirely.
 *
 * The clip boundary now sits on the swing: `beginShotClip` at the moment the
 * player commits, `endShotClip` when the ball comes to rest. These tests drive
 * that state machine against a fake MediaRecorder, because the thing worth
 * pinning is WHICH segment gets exported, not what the codec produced.
 */

/** A MediaRecorder stand-in that reports one identifiable chunk per segment. */
let segmentSeq = 0;
class FakeRecorder {
  state = 'recording';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  readonly id = ++segmentSeq;
  start(): void {
    /* chunks are delivered on stop, as the real one does with no timeslice */
  }
  stop(): void {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob([`seg${this.id}`], { type: 'video/webm' }) });
    this.onstop?.();
  }
}

function harness(): { cap: ShotCapture; saved: () => string[] } {
  const downloaded: string[] = [];
  const canvas = {
    captureStream: () => ({ getTracks: () => [] })
  } as unknown as HTMLCanvasElement;
  const cap = new ShotCapture(canvas);
  // Route the export somewhere inspectable instead of the DOM.
  (cap as unknown as { download(b: Blob): void }).download = (b: Blob): void => {
    downloaded.push((b as unknown as { __tag: string }).__tag ?? 'blob');
  };
  return { cap, saved: () => downloaded };
}

beforeEach(() => {
  segmentSeq = 0;
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  (FakeRecorder as unknown as { isTypeSupported(m: string): boolean }).isTypeSupported = () => true;
  vi.stubGlobal('Blob', class {
    __tag: string;
    size = 8;
    constructor(parts: unknown[]) {
      this.__tag = String((parts?.[0] as { __tag?: string })?.__tag ?? parts?.[0] ?? '');
    }
  });
});

describe('the clip boundary is the swing, not a timer', () => {
  it('opens a fresh segment when the player commits to a swing', () => {
    const { cap } = harness();
    cap.start();
    const before = segmentSeq;
    cap.beginShotClip();
    expect(segmentSeq, 'committing must start a new segment').toBeGreaterThan(before);
  });

  it('holds one segment across the whole shot — no rotation mid-flight', () => {
    const { cap } = harness();
    cap.start();
    cap.beginShotClip();
    const during = segmentSeq;
    // The cadence timer coming due mid-flight must NOT swap recorders: that is
    // what used to cut a clip in half at the interesting moment.
    (cap as unknown as { rotate(): void }).rotate();
    expect(segmentSeq, 'a shot must not be split').toBe(during);
  });

  it('closes the shot at rest, and keeps it as the clip', () => {
    const { cap } = harness();
    cap.start();
    cap.beginShotClip();
    const shotSeg = segmentSeq;
    cap.endShotClip();
    expect(segmentSeq, 'rest closes the shot segment').toBeGreaterThan(shotSeg);
    // The idle cadence is free again once the shot is banked.
    (cap as unknown as { rotate(): void }).rotate();
    expect(segmentSeq).toBeGreaterThan(shotSeg + 1);
  });

  it('a cancelled swing leaves no shot behind', () => {
    const { cap } = harness();
    cap.start();
    cap.beginShotClip();
    cap.cancelShotClip();
    const after = segmentSeq;
    // Rotation is live again immediately — an abandoned swing must not hold the
    // recorder open, which is how a 43-second clip happened once before.
    (cap as unknown as { rotate(): void }).rotate();
    expect(segmentSeq).toBeGreaterThan(after);
  });

  it('stopping clears the banked shot so a new round starts clean', () => {
    const { cap } = harness();
    cap.start();
    cap.beginShotClip();
    cap.endShotClip();
    cap.stop();
    expect((cap as unknown as { shotBlob: Blob | null }).shotBlob).toBeNull();
    expect((cap as unknown as { shotOpen: boolean }).shotOpen).toBe(false);
  });
});
