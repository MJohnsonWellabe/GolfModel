/**
 * "Learn to play" onboarding coach — DEV-ONLY, behind the `tutorial` flag.
 *
 * A self-contained overlay that teaches the controls one concept at a time,
 * paced to what the player is about to do on Sable Bay #1 (docs/vision/
 * 03_PLAYER_EXPERIENCE.md "New-player principles": teach by doing, one concept
 * at a time, contextual hints that disappear once understood, nothing lengthy
 * before the first shot). It owns its own DOM + a single highlight ring and
 * disposes both on stop — it never accumulates and never touches physics.
 *
 * The game drives it reactively through a tiny lifecycle API (start/onAiming/
 * onShot/onHoleDone/stop); the controller decides which card to show. Cards
 * advance on a tap, so a player can never be soft-locked waiting on a gesture.
 * A persistent "Skip" keeps the whole thing optional (Constitution rule 18:
 * never forced).
 */

interface CoachCard {
  title: string;
  body: string;
  /** Element id to ring while this card shows (a control the copy points at). */
  highlight?: string;
  /** Label for the advance button (default "Got it"). */
  cta?: string;
}

/** The uphill-putt rule, verified against config.ts (`puttSlopePaceBoost`) and
 *  tests/simulation/putting.test.ts: +1 ft of pace per 2 in of TRUE rise (a 6:1
 *  ratio, independent of putt length), symmetric downhill; the aim line never
 *  compensates — the ▲/▼ readout is the player's to act on. */
export const PUTT_RULE =
  'Pace is everything on the green. This game runs 1 foot long for every 2 inches ' +
  'of uphill — a 6-to-1 rule, and the same in reverse going downhill. Your aim ' +
  'line does NOT add that for you: read the ▲ uphill / ▼ downhill number by the ' +
  'hole and aim past the cup to match it.';

export class TutorialCoach {
  private root: HTMLElement | null = null;
  private cardEl: HTMLElement | null = null;
  private highlighted: HTMLElement | null = null;
  private queue: CoachCard[] = [];
  /** Cards already shown this run — each concept is introduced exactly once. */
  private readonly seen = new Set<string>();
  private onExit: (() => void) | null = null;
  private active = false;

  /** True between start() and stop() — lets the game guard its lifecycle calls. */
  isActive(): boolean {
    return this.active;
  }

  /** Begin the guided hole. `onExit` fires when the player finishes or skips. */
  start(onExit: () => void): void {
    if (this.active) return;
    this.active = true;
    this.onExit = onExit;
    this.buildOverlay();
  }

  /** A human turn just armed. `isPutting` picks the green lesson vs the tee/
   *  approach lesson; `firstTee` distinguishes the opening tee shot. */
  onAiming(isPutting: boolean, firstTee: boolean): void {
    if (!this.active) return;
    if (isPutting) {
      this.enqueueOnce([
        { key: 'putt', card: { title: 'Reading the green', body: PUTT_RULE, highlight: 'aimReadout' } },
        {
          key: 'truevision',
          card: {
            title: 'True Vision',
            body:
              'Not sure of the read? Tap TRUE VISION to preview exactly how your ' +
              'current putt will roll on the real slope. You get one free look each round.',
            highlight: 'trueVisionBtn'
          }
        }
      ]);
    } else if (firstTee) {
      this.enqueueOnce([
        {
          key: 'aim',
          card: {
            title: 'Aim',
            body:
              'Drag anywhere on the hole to aim, and drag farther to reach farther. ' +
              'The white line is your aim — a straight guess that ignores slope and ' +
              'wind. Reading those is your job.',
            highlight: 'clubBar'
          }
        },
        {
          key: 'shape',
          card: {
            title: 'Shape your shot',
            body:
              'Drag the dot on the ball face to bend the flight: right for a draw ' +
              '(curves right→left), left for a fade, low for a higher launch.',
            highlight: 'strikePad'
          }
        },
        {
          key: 'hit',
          card: {
            title: 'Take your swing',
            body:
              'Tap SWING three times: once to start the meter, once to lock power, ' +
              'once to lock your strike. Land it in the PERFECT band for a pure hit.',
            highlight: 'swingBtn',
            cta: 'Let me try'
          }
        }
      ]);
    } else {
      // A later (approach) aiming turn — introduce the planning view.
      this.enqueueOnce([
        {
          key: 'aerial',
          card: {
            title: 'Plan from above',
            body: 'Tap AERIAL for a top-down view to scout your line, then tap it again to return.',
            highlight: 'aerialBtn'
          }
        }
      ]);
    }
  }

  /** The ball has just been struck — teach in-flight spin while it's airborne. */
  onShot(): void {
    if (!this.active) return;
    this.enqueueOnce([
      {
        key: 'spin',
        card: {
          title: 'Add spin in the air',
          body:
            'While the ball is flying, swipe on the screen to work it: swipe down ' +
            'for backspin (it bites and stops), up for topspin (it runs out).'
        }
      }
    ]);
  }

  /** Hole finished — the wrap-up, then the player is on their own. */
  onHoleDone(): void {
    if (!this.active) return;
    this.enqueueOnce([
      {
        key: 'done',
        card: {
          title: "You've got the basics!",
          body:
            'Aim, swing, shape, spin, and read the green — that’s the whole game. ' +
            'Play on from here, or head home anytime. You can replay this lesson ' +
            'whenever you like.',
          cta: 'Keep playing'
        }
      }
    ]);
  }

  /** Tear down the overlay + highlight. Safe to call more than once. */
  stop(): void {
    this.clearHighlight();
    this.root?.remove();
    this.root = null;
    this.cardEl = null;
    this.queue = [];
    this.active = false;
    const exit = this.onExit;
    this.onExit = null;
    exit?.();
  }

  // ---------------------------------------------------------------- internals

  private enqueueOnce(items: Array<{ key: string; card: CoachCard }>): void {
    const fresh = items.filter((i) => !this.seen.has(i.key));
    if (!fresh.length) return;
    for (const i of fresh) {
      this.seen.add(i.key);
      this.queue.push(i.card);
    }
    // Only kick the presenter if nothing is currently on screen; otherwise the
    // new cards fall in behind the one the player is reading.
    if (this.cardEl && this.cardEl.dataset.showing === '1') return;
    this.present();
  }

  private present(): void {
    const next = this.queue.shift();
    if (!next || !this.root || !this.cardEl) {
      this.clearHighlight();
      if (this.cardEl) this.cardEl.dataset.showing = '0';
      if (this.root) this.root.style.visibility = 'hidden';
      return;
    }
    this.root.style.visibility = 'visible';
    this.cardEl.dataset.showing = '1';
    this.cardEl.innerHTML =
      `<div class="tutTitle"></div><div class="tutBody"></div>` +
      `<div class="tutRow"><button class="tutSkip" type="button">Skip</button>` +
      `<button class="tutNext" type="button"></button></div>`;
    (this.cardEl.querySelector('.tutTitle') as HTMLElement).textContent = next.title;
    (this.cardEl.querySelector('.tutBody') as HTMLElement).textContent = next.body;
    (this.cardEl.querySelector('.tutNext') as HTMLElement).textContent = next.cta ?? 'Got it';
    this.cardEl.querySelector('.tutNext')!.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.present();
    });
    this.cardEl.querySelector('.tutSkip')!.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.stop();
    });
    this.setHighlight(next.highlight);
  }

  private setHighlight(id?: string): void {
    this.clearHighlight();
    if (!id) return;
    const el = document.getElementById(id);
    if (el) {
      el.classList.add('tutHi');
      this.highlighted = el;
    }
  }

  private clearHighlight(): void {
    this.highlighted?.classList.remove('tutHi');
    this.highlighted = null;
  }

  private buildOverlay(): void {
    const root = document.createElement('div');
    root.id = 'tutorialCoach';
    // Container ignores pointer events so taps pass through to the game; only the
    // card itself is interactive.
    root.style.cssText =
      'position:fixed;left:0;right:0;top:0;z-index:60;display:flex;justify-content:center;' +
      'padding:12px 12px 0;pointer-events:none;visibility:hidden;';
    const card = document.createElement('div');
    card.className = 'tutCard';
    card.dataset.showing = '0';
    card.style.pointerEvents = 'auto';
    root.appendChild(card);
    document.body.appendChild(root);
    this.root = root;
    this.cardEl = card;
  }
}
