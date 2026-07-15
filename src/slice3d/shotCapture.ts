/**
 * Rolling "record my last shot" capture.
 *
 * Continuously records the game canvas in short SEGMENTS so that, at any
 * moment, the recent action can be exported as a SINGLE, self-contained
 * (header-included) video file. We deliberately avoid the common "keep a ring
 * buffer of MediaRecorder timeslice chunks" trick: once the initialization
 * chunk is dropped, the remaining chunks have no header and the resulting file
 * is unplayable (and keeping the header but dropping the middle leaves a
 * timestamp gap most players choke on). Instead each segment is a complete
 * recording finalized on stop().
 *
 * Strategy: one MediaRecorder on `canvas.captureStream(fps)`, restarted every
 * SEGMENT_MS. The just-finished segment is stashed as `prevBlob` (a full
 * ~SEGMENT clip). On save we finalize the in-flight segment and export whichever
 * of {current segment, prevBlob} best covers the last few seconds — always a
 * single valid recording, no concatenation.
 *
 * Mobile-web limitations (this is a browser page, not a native app):
 *  - "Save" is a browser download (into the phone's Downloads/Files), NOT a
 *    direct write to the photo gallery.
 *  - Codec support and exact clip duration vary by browser; iOS Safari records
 *    MP4/H.264 while Chrome/Firefox/Android record WebM. Unsupported browsers
 *    degrade to a no-op (the capture button hides).
 */

interface CaptureOpts {
  /** Capture frame rate. Capped low to protect the 60fps gameplay floor. */
  fps?: number;
  /** Segment length in ms — roughly the length of an exported clip. */
  segmentMs?: number;
}

type CanvasWithCapture = HTMLCanvasElement & {
  captureStream(frameRequestRate?: number): MediaStream;
};

export class ShotCapture {
  private readonly canvas: HTMLCanvasElement;
  private readonly mimeType: string;
  private readonly ext: string;
  private readonly fps: number;
  private readonly segmentMs: number;

  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private prevBlob: Blob | null = null;
  private segmentStartMs = 0;
  private rotateTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private saving = false;
  /** While true, a due segment rotation (stop/restart the recorder — real,
   *  if small, main-thread work) is deferred instead of firing immediately.
   *  Set while the swing meter is armed (main.ts, mirroring renderPacing's
   *  shadow/mirror freeze) so a rotation can never land mid-swing and cost the
   *  bar a frame — recording keeps rolling throughout, only the SWAP waits. */
  private rotationPaused = false;

  constructor(canvas: HTMLCanvasElement, opts: CaptureOpts = {}) {
    this.canvas = canvas;
    this.fps = opts.fps ?? 30;
    // ~10s segments so an exported clip runs roughly 5-10s (the current segment
    // once it has matured, else the previous full ~10s segment).
    this.segmentMs = opts.segmentMs ?? 10000;
    const picked = ShotCapture.pickMime();
    this.mimeType = picked.mime;
    this.ext = picked.ext;
  }

  /** True when this browser can record the canvas at all. */
  get supported(): boolean {
    return (
      this.mimeType !== '' &&
      typeof (this.canvas as Partial<CanvasWithCapture>).captureStream === 'function'
    );
  }

  /** Pick the best-supported container/codec, preferring MP4 (iOS Safari). */
  private static pickMime(): { mime: string; ext: string } {
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
      return { mime: '', ext: '' };
    }
    const candidates: Array<{ mime: string; ext: string }> = [
      { mime: 'video/mp4;codecs=h264', ext: 'mp4' },
      { mime: 'video/mp4', ext: 'mp4' },
      { mime: 'video/webm;codecs=vp9', ext: 'webm' },
      { mime: 'video/webm;codecs=vp8', ext: 'webm' },
      { mime: 'video/webm', ext: 'webm' }
    ];
    for (const c of candidates) {
      if (MediaRecorder.isTypeSupported(c.mime)) return c;
    }
    return { mime: '', ext: '' };
  }

  /** Begin (or resume) continuous rolling capture. Safe to call repeatedly. */
  start(): void {
    if (!this.supported || this.running) return;
    try {
      this.stream = (this.canvas as CanvasWithCapture).captureStream(this.fps);
    } catch {
      this.stream = null;
      return;
    }
    this.running = true;
    this.prevBlob = null;
    this.beginSegment();
  }

  /** Stop capturing entirely and release the stream (e.g. leaving a round). */
  stop(): void {
    this.running = false;
    this.clearRotateTimer();
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.onstop = null;
      try {
        this.recorder.stop();
      } catch {
        /* already stopping */
      }
    }
    this.recorder = null;
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    this.chunks = [];
    this.prevBlob = null;
  }

  /**
   * Export the most recent few seconds as a downloaded clip. Returns false if
   * nothing could be produced (unsupported, not running, or nothing buffered).
   */
  async saveClip(): Promise<boolean> {
    if (!this.supported || !this.running || this.saving || !this.recorder) return false;
    this.saving = true;
    try {
      const ageMs = performance.now() - this.segmentStartMs;
      const currentBlob = await this.finalizeCurrent();
      // Prefer the current segment once it has matured past the halfway mark
      // (so the exported clip runs ~5-10s); otherwise fall back to the previous
      // full ~10s segment, whose window still overlaps the recent shot.
      const minKeepMs = this.segmentMs * 0.5;
      const chosen =
        currentBlob && ageMs >= minKeepMs ? currentBlob : this.prevBlob ?? currentBlob;
      // Resume rolling capture for the next shot.
      if (this.running) this.beginSegment();
      if (!chosen || chosen.size === 0) return false;
      this.download(chosen);
      return true;
    } finally {
      this.saving = false;
    }
  }

  private beginSegment(): void {
    if (!this.running || !this.stream) return;
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(this.stream, { mimeType: this.mimeType });
    } catch {
      // A few browsers reject an explicit mimeType — fall back to the default.
      try {
        rec = new MediaRecorder(this.stream);
      } catch {
        this.running = false;
        return;
      }
    }
    this.recorder = rec;
    this.chunks = [];
    rec.ondataavailable = (e): void => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    try {
      rec.start(); // one finalized blob per segment (delivered on stop)
    } catch {
      this.running = false;
      return;
    }
    this.segmentStartMs = performance.now();
    this.rotateTimer = setTimeout(() => this.rotate(), this.segmentMs);
  }

  /** Pause/resume segment rotation. The recorder keeps recording either way —
   *  this only withholds the periodic stop/restart swap, which is what could
   *  otherwise land on the exact frame the swing meter needs. */
  setRotationPaused(paused: boolean): void {
    this.rotationPaused = paused;
  }

  /** Close the current segment (stashing it as prevBlob) and open a fresh one. */
  private rotate(): void {
    this.rotateTimer = null;
    if (this.rotationPaused) {
      // Check back shortly rather than swapping recorders mid-swing; the
      // current segment just keeps recording a little longer.
      if (this.running) this.rotateTimer = setTimeout(() => this.rotate(), 250);
      return;
    }
    const finished = this.recorder;
    if (!this.running || !finished || finished.state === 'inactive') return;
    finished.onstop = (): void => {
      if (this.chunks.length) {
        this.prevBlob = new Blob(this.chunks, { type: this.mimeType || 'video/webm' });
      }
      if (this.running) this.beginSegment();
    };
    try {
      finished.stop();
    } catch {
      if (this.running) this.beginSegment();
    }
  }

  /** Stop the in-flight recorder and resolve its finalized blob. */
  private finalizeCurrent(): Promise<Blob | null> {
    return new Promise((resolve) => {
      const rec = this.recorder;
      this.clearRotateTimer();
      if (!rec || rec.state === 'inactive') {
        resolve(null);
        return;
      }
      rec.onstop = (): void => {
        resolve(this.chunks.length ? new Blob(this.chunks, { type: this.mimeType || 'video/webm' }) : null);
      };
      try {
        rec.stop();
      } catch {
        resolve(null);
      }
    });
  }

  private clearRotateTimer(): void {
    if (this.rotateTimer !== null) {
      clearTimeout(this.rotateTimer);
      this.rotateTimer = null;
    }
  }

  private download(blob: Blob): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `johnsons-golf-${this.stamp()}.${this.ext || 'webm'}`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  }

  /** yyyymmdd-hhmmss stamp so saved clips sort and never collide. */
  private stamp(): string {
    const d = new Date();
    const p = (n: number): string => String(n).padStart(2, '0');
    return (
      `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
      `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
    );
  }
}
