/**
 * "Learn to play" onboarding coach — behind the `tutorial` flag, with the
 * extended lesson behind `tutorialDepth`.
 *
 * A self-contained overlay that teaches the controls one concept at a time,
 * paced to what the player is about to do on Sable Bay #1 (docs/vision/
 * 03_PLAYER_EXPERIENCE.md "New-player principles": teach by doing, one concept
 * at a time, contextual hints that disappear once understood, nothing lengthy
 * before the first shot). It owns its own DOM + a single highlight ring and
 * disposes both on stop — it never accumulates and never touches physics.
 *
 * The game drives it reactively through a small lifecycle API (start / onAiming
 * / onShot / onPenalty / onHoleDone / stop); the controller decides which card
 * to show. Cards advance on a tap, so a player can never be soft-locked waiting
 * on a gesture. A persistent "Skip" keeps the whole thing optional
 * (Constitution rule 18: never forced).
 *
 * WHAT `tutorialDepth` ADDS, AND WHY
 * ----------------------------------
 * The shipped lesson teaches the CONTROLS (aim, meter, shape, spin, aerial,
 * green read). It never mentions the two things that actually decide where a
 * new player's ball ends up — the wind blowing across the hole and the club in
 * their hands — nor what to do when a shot goes wrong. A player who does not
 * know the wind pushes the ball reads their own miss as the game being random,
 * which is exactly the "I do not know what happened" failure the player-
 * experience doc names as the thing to avoid. The extended lesson adds:
 *
 *   - a WIND card and a CLUB card on the first tee (the two inputs the HUD is
 *     already showing them and the lesson never explained);
 *   - a contextual LIE card the first time they address a ball from rough,
 *     sand or fringe — "the lie cost you distance" instead of a mystery;
 *   - a contextual RECOVERY card after a penalty, which reframes the worst
 *     moment of a first round as a normal golf problem;
 *   - a step counter, so the lesson visibly has an end;
 *   - a closing card that names the next action rather than trailing off.
 */

interface CoachCard {
  title: string;
  body: string;
  /** Element id to ring while this card shows (a control the copy points at). */
  highlight?: string;
  /** Label for the advance button (default "Got it"). */
  cta?: string;
  /** Position in the scripted spine, for the "3 / 7" counter. Contextual cards
   *  (lie, recovery) leave this unset — they are not part of the count, so the
   *  counter never jumps around or promises a step that may not happen. */
  step?: number;
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

/** The wind lesson. Wind is real, per-hole, and shown in the HUD as an arrow
 *  drawn RELATIVE to your aim (up = straight down your line) plus a speed in
 *  mph — see HoleScene.updateHud. */
export const WIND_RULE =
  'Check the wind chip at the top: the arrow points where the wind is blowing, ' +
  'drawn relative to your aim, and the number is its strength. Pointing up means ' +
  'it is behind you and the ball will fly further; across means aim into it, ' +
  'because the ball WILL drift with it. Nothing here corrects for wind but you.';

/** Lifecycle context for one aiming turn. */
export interface AimingContext {
  isPutting: boolean;
  firstTee: boolean;
  /** Surface the ball is sitting on ('fairway' | 'rough' | 'sand' | …). */
  lie: string;
}

/** How many cards the scripted spine has, for the "n / N" counter. */
const SPINE_STEPS = 8;

export class TutorialCoach {
  private root: HTMLElement | null = null;
  private cardEl: HTMLElement | null = null;
  private highlighted: HTMLElement | null = null;
  private queue: CoachCard[] = [];
  /** Cards already shown this run — each concept is introduced exactly once. */
  private readonly seen = new Set<string>();
  private onExit: (() => void) | null = null;
  private active = false;
  private deep = false;
  /** True once the closing card has been queued — the lesson is complete even
   *  if the player leaves before tapping it away. */
  private finished = false;

  /** True between start() and stop() — lets the game guard its lifecycle calls. */
  isActive(): boolean {
    return this.active;
  }

  /** True once the player reached the end of the lesson (not skipped). */
  isFinished(): boolean {
    return this.finished;
  }

  /**
   * Begin the guided hole. `onExit` fires when the player finishes or skips.
   * `deep` turns on the extended lesson (`tutorialDepth`).
   */
  start(onExit: () => void, deep = false): void {
    if (this.active) return;
    this.active = true;
    this.deep = deep;
    this.finished = false;
    this.seen.clear();
    this.onExit = onExit;
    this.buildOverlay();
  }

  /** A human turn just armed. */
  onAiming(ctx: AimingContext): void {
    if (!this.active) return;
    if (ctx.isPutting) {
      this.enqueueOnce([
        { key: 'putt', card: { title: 'Reading the green', body: PUTT_RULE, highlight: 'aimReadout', step: 7 } },
        {
          key: 'truevision',
          card: {
            title: 'True Vision',
            body:
              'Not sure of the read? Tap TRUE VISION to preview exactly how your ' +
              'current putt will roll on the real slope. You get one free look each round.',
            highlight: 'trueVisionBtn',
            step: 8
          }
        }
      ]);
      return;
    }
    if (ctx.firstTee) {
      this.enqueueOnce([
        {
          key: 'aim',
          card: {
            title: 'Aim',
            body:
              'Drag anywhere on the hole to aim, and drag farther to reach farther. ' +
              'The white line is your aim — a straight guess that ignores slope and ' +
              'wind. Reading those is your job.',
            highlight: 'clubBar',
            step: 1
          }
        },
        ...(this.deep
          ? [
              {
                key: 'wind',
                card: { title: 'Read the wind', body: WIND_RULE, highlight: 'hud', step: 2 }
              },
              {
                key: 'club',
                card: {
                  title: 'Pick your club',
                  body:
                    'The ◀ ▶ arrows change clubs, and the yardage beside the club name ' +
                    'is how far THAT club carries at full power. Match the club to the ' +
                    'distance left to the pin — a smooth full swing beats forcing a ' +
                    'short club.',
                  highlight: 'clubBar',
                  step: 3
                }
              }
            ]
          : []),
        {
          key: 'shape',
          card: {
            title: 'Shape your shot',
            body:
              'Drag the dot on the ball face to bend the flight: right for a draw ' +
              '(curves right→left), left for a fade, low for a higher launch.',
            highlight: 'strikePad',
            step: 4
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
            cta: 'Let me try',
            step: 5
          }
        }
      ]);
      return;
    }
    // A later (approach) aiming turn — introduce the planning view, and explain
    // a difficult lie the first time the player is actually standing in one.
    this.enqueueOnce([
      {
        key: 'aerial',
        card: {
          title: 'Plan from above',
          body: 'Tap AERIAL for a top-down view to scout your line, then tap it again to return.',
          highlight: 'aerialBtn',
          step: 6
        }
      }
    ]);
    if (this.deep && (ctx.lie === 'rough' || ctx.lie === 'sand' || ctx.lie === 'fringe')) {
      this.enqueueOnce([
        {
          key: 'lie',
          card: {
            title: `You're in the ${ctx.lie}`,
            body:
              'Your lie is in the HUD next to the pin distance, and it costs you: ' +
              'rough and sand take distance off the shot and kill the spin that stops ' +
              'the ball. Take enough club, aim at the fat part of the green, and get ' +
              'back in play rather than chasing the flag.',
            highlight: 'hud'
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

  /**
   * A shot found water or went out of bounds. Golf's worst first-round moment is
   * also the one most likely to end the session, so name it plainly and hand
   * back a plan instead of leaving the player to conclude the game cheated.
   */
  onPenalty(kind: 'water' | 'ob'): void {
    if (!this.active || !this.deep) return;
    this.enqueueOnce([
      {
        key: 'penalty',
        card: {
          title: kind === 'water' ? 'In the water — one shot back' : 'Out of play — one shot back',
          body:
            'That costs a penalty stroke and you play on from near where it went in. ' +
            'It happens to everybody. The recovery is the fun part: take one more club ' +
            'than you think, aim at the safe middle, and get the next one back in play.',
          cta: 'Play on'
        }
      }
    ]);
  }

  /** Hole finished — the wrap-up, then the player is on their own. */
  onHoleDone(reward?: { coins: number }): void {
    if (!this.active) return;
    this.finished = true;
    const rewardLine = reward?.coins ? ` You've earned ${reward.coins} coins for finishing the lesson.` : '';
    this.enqueueOnce([
      {
        key: 'done',
        card: {
          title: "You've got the basics!",
          body: this.deep
            ? 'Aim, wind, club, swing, shape, spin, and read the green — that is the ' +
              'whole game.' +
              rewardLine +
              ' Two holes left in this round: play them out and your score ' +
              'goes in the book. You can replay this lesson any time.'
            : 'Aim, swing, shape, spin, and read the green — that’s the whole game. ' +
              'Play on from here, or head home anytime. You can replay this lesson ' +
              'whenever you like.',
          cta: this.deep ? 'Finish my round' : 'Keep playing'
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
      `<div class="tutStep"></div><div class="tutTitle"></div><div class="tutBody"></div>` +
      `<div class="tutRow"><button class="tutSkip" type="button">Skip</button>` +
      `<button class="tutNext" type="button"></button></div>`;
    const stepEl = this.cardEl.querySelector('.tutStep') as HTMLElement;
    // Only the scripted spine is counted, and only in the extended lesson — a
    // counter that skipped numbers would read as a bug.
    stepEl.textContent = this.deep && next.step ? `Step ${next.step} of ${SPINE_STEPS}` : '';
    stepEl.style.display = stepEl.textContent ? 'block' : 'none';
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
