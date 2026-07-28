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
  /** True while the in-flight segment IS a shot — opened at the swing, closed
   *  when the ball comes to rest. */
  private shotOpen = false;
  /** The last COMPLETE shot: opened at a swing, closed at rest. This is what
   *  the save button exports, which is what makes a clip mean "my last shot"
   *  rather than "the last few seconds, whenever they happened to start". */
  private shotBlob: Blob | null = null;
  /** Set for exactly one rotation: the segment about to close is the shot. */
  private captureNextAsShot = false;
  /** Ceiling on a shot segment. A flight plus rollout plus slow-motion can run
   *  ~20s on a long par 5, so this is well clear of any real shot; it exists
   *  only so a swing that never resolves (a stuck state, a bug) cannot record
   *  forever. */
  private readonly shotCeilingMs = 45000;

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
    this.shotBlob = null;
    this.shotOpen = false;
    this.captureNextAsShot = false;
  }

  /**
   * Export the most recent few seconds as a downloaded clip. Returns false if
   * nothing could be produced (unsupported, not running, or nothing buffered).
   */
  async saveClip(): Promise<boolean> {
    if (!this.supported || !this.running || this.saving || !this.recorder) return false;
    this.saving = true;
    try {
      // WHICH SEGMENT IS "THE LAST SHOT".
      //   - mid-shot: the in-flight segment, which opened at the swing, so it
      //     runs from the strike to now.
      //   - after the ball has rested: the segment endShotClip closed, which is
      //     the whole shot from the swing to the stop.
      // Only with neither (the player has not swung since capture started) does
      // this fall back to the old "recent seconds" behaviour.
      const midShot = this.shotOpen;
      const currentBlob = await this.finalizeCurrent();
      const chosen = midShot ? currentBlob ?? this.shotBlob : this.shotBlob ?? currentBlob ?? this.prevBlob;
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

  /**
   * THE SWING IS THE CLIP BOUNDARY.
   *
   * Called the moment the player commits to a swing: close whatever idle
   * segment was running and open a fresh one right here, then hold rotation so
   * nothing splits the shot in half.
   *
   * Without this the boundary fell wherever a fixed 10s timer happened to leave
   * it, and `saveClip` exported whichever segment was more than half-grown — so
   * the same button gave three seconds one time and ten the next, sometimes
   * without the strike in it at all (owner: "sometimes it records three
   * seconds. sometimes ten. it doesn't seem to have any rhyme or reason").
   *
   * The rotation cost lands HERE, at address, rather than mid-flight: the
   * player is about to start the meter, the camera is parked and nothing is
   * animating, which is the quietest moment in the whole shot.
   */
  beginShotClip(): void {
    if (!this.running) return;
    // Cancel the pending cadence rotation FIRST. `rotate()` only nulls the
    // timer handle — it never cleared the timeout, which was harmless while the
    // timer was its only caller. Rotating directly without this leaves that
    // timeout armed, and it fires mid-flight: the precise split this exists to
    // prevent.
    this.clearRotateTimer();
    this.rotationPaused = false; // let this rotation through…
    this.rotate();
    this.shotOpen = true;
    this.rotationPaused = true; // …then hold the rest of the shot together
  }

  /**
   * The ball has come to rest. Close the shot's segment so it is a complete,
   * self-contained recording, keep it as THE clip, and let the idle cadence
   * resume. Safe to call when no shot is open (a hole ending, a scene
   * teardown), which is why every turn boundary can call it unconditionally.
   */
  endShotClip(): void {
    this.rotationPaused = false;
    if (!this.running || !this.shotOpen) return;
    this.shotOpen = false;
    this.captureNextAsShot = true;
    this.clearRotateTimer(); // same reason as beginShotClip
    this.rotate();
  }

  /** The swing was abandoned (too small a trace, a cancelled meter). The
   *  segment stays as an ordinary idle one — there is no shot in it. */
  cancelShotClip(): void {
    this.rotationPaused = false;
    this.shotOpen = false;
  }

  /** Close the current segment (stashing it as prevBlob) and open a fresh one. */
  private rotate(): void {
    this.rotateTimer = null;
    if (this.rotationPaused) {
      // Check back shortly rather than swapping recorders mid-swing; the
      // current segment just keeps recording a little longer. Safety valve:
      // whatever is holding rotationPaused should only ever be the brief
      // mid-swing tap sequence (a couple seconds) — but if it somehow stays
      // held far past this segment's due time (a stuck meter, a bug
      // elsewhere), force the swap anyway once overdue by a full segment's
      // worth of time. A segment can never run away past ~2×segmentMs; a
      // small risk of a mid-swing hitch beats an unbounded clip length (bug
      // report: "one clip was 43 seconds").
      // A shot in progress gets a far longer rope than the ordinary mid-swing
      // hold: splitting a clip mid-flight is the exact failure this is all for.
      const graceMs = this.shotOpen ? this.shotCeilingMs : this.segmentMs;
      const overdueMs = performance.now() - (this.segmentStartMs + graceMs);
      if (overdueMs < 0) {
        if (this.running) this.rotateTimer = setTimeout(() => this.rotate(), 250);
        return;
      }
    }
    const finished = this.recorder;
    if (!this.running || !finished || finished.state === 'inactive') return;
    const wasShot = this.captureNextAsShot;
    this.captureNextAsShot = false;
    finished.onstop = (): void => {
      if (this.chunks.length) {
        const blob = new Blob(this.chunks, { type: this.mimeType || 'video/webm' });
        this.prevBlob = blob;
        // A segment that held a whole shot is kept separately, so the ordinary
        // idle cadence cannot overwrite it before the player taps save.
        if (wasShot) this.shotBlob = blob;
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
