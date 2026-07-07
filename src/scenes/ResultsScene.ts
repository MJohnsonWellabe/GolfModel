import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, COLORS } from '../config';
import { state } from '../core/GameState';
import {
  fetchAllRounds,
  isNewRecord,
  makeRoundId,
  RoundRecord,
  saveRound
} from '../firebase/History';
import { formatToPar } from '../systems/Scoring';
import { makeButton, makeTitle } from '../ui/Ui';
import { fadeIn, fadeToScene } from '../ui/Transitions';

export class ResultsScene extends Phaser.Scene {
  private newRecord = false;

  constructor() {
    super('ResultsScene');
  }

  create(): void {
    fadeIn(this);
    const cx = GAME_WIDTH / 2;
    this.add.rectangle(cx, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, COLORS.rough);

    if (!state.scoring || !state.course || !state.golfer) {
      fadeToScene(this, 'TitleScene');
      return;
    }

    const scoring = state.scoring;
    const course = state.course;
    const holes = course.holes;
    const parTotal = holes.reduce((a, h) => a + h.par, 0);

    makeTitle(this, cx, 130, 'ROUND COMPLETE', 48);

    // Scorecard panel: scramble scores as one team row
    const names =
      state.mode === 'scramble' && state.opponent
        ? [`${state.golfer.name} & ${state.opponent.name}`]
        : state.mode === '1v1' && state.opponent
          ? [state.golfer.name, state.opponent.name]
          : [state.golfer.name];

    const g = this.add.graphics();
    g.fillStyle(COLORS.uiPanel, 0.94);
    g.fillRoundedRect(cx - 320, 220, 640, 460, 20);

    const header = ['Hole', ...holes.map((h) => `${h.number}`), 'Tot'];
    const rows: string[][] = [header, ['Par', ...holes.map((h) => `${h.par}`), `${parTotal}`]];
    names.forEach((name, i) => {
      rows.push([
        name,
        ...holes.map((_, h) => `${scoring.strokes[i][h]}`),
        `${scoring.totalStrokes(i)}`
      ]);
    });

    const colX = [cx - 270, cx - 60, cx + 40, cx + 140, cx + 250];
    rows.forEach((row, r) => {
      row.forEach((cell, c) => {
        this.add
          .text(colX[c], 270 + r * 56, cell, {
            fontFamily: 'Arial, sans-serif',
            fontSize: r === 0 ? '26px' : '30px',
            color: r === 0 ? '#9fbf9a' : '#ffffff',
            fontStyle: 'bold'
          })
          .setOrigin(c === 0 ? 0 : 0.5, 0.5);
      });
    });

    // Verdict
    let verdict: string;
    if (state.mode === 'scramble') {
      const total = scoring.totalStrokes(0);
      verdict = `Team ${state.golfer.name} & ${state.opponent!.name}\nshot ${total} (${formatToPar(total, parTotal)})`;
    } else if (state.mode === '1v1') {
      const p0 = scoring.totalStrokes(0);
      const p1 = scoring.totalStrokes(1);
      const winner = p0 < p1 ? `${state.golfer.name} wins!` : p1 < p0 ? `${state.opponent!.name} wins` : 'All square — tie!';
      verdict = `${winner}\n${state.golfer.name} ${formatToPar(p0, parTotal)} • ${state.opponent!.name} ${formatToPar(p1, parTotal)}`;
    } else {
      verdict = `You shot ${scoring.totalStrokes(0)} (${formatToPar(scoring.totalStrokes(0), parTotal)})`;
    }

    this.add
      .text(cx, 560, verdict, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '32px',
        color: '#ffd54f',
        align: 'center',
        fontStyle: 'bold',
        lineSpacing: 8
      })
      .setOrigin(0.5);

    makeButton(this, cx, 760, 360, 84, 'SHARE SCORE', () => this.share(verdict), {
      fill: 0xb8912a
    });
    makeButton(this, cx, 872, 360, 84, 'PLAY AGAIN', () => {
      state.startRound();
      fadeToScene(this, 'GameScene');
    });
    makeButton(this, cx - 100, 984, 320, 84, 'MAIN MENU', () => {
      fadeToScene(this, 'TitleScene');
    });
    makeButton(this, cx + 210, 984, 220, 84, 'RECORDS', () => {
      fadeToScene(this, 'RecordsScene');
    }, { fill: 0x11431f, fontSize: 26 });

    this.persistRound();
  }

  /** Save the finished round to history/leaderboard and celebrate a record. */
  private persistRound(): void {
    this.newRecord = false;
    if (state.roundSaved || !state.course || !state.scoring || !state.golfer) return;
    state.roundSaved = true;

    const scoring = state.scoring;
    const parTotal = state.course.holes.reduce((a, h) => a + h.par, 0);
    const total = scoring.totalStrokes(0);
    const names =
      state.mode === 'scramble' && state.opponent
        ? `${state.golfer.name} & ${state.opponent.name}`
        : state.golfer.name;
    const round: RoundRecord = {
      id: makeRoundId(),
      d: Date.now(),
      course: state.course.name,
      mode: state.mode,
      names,
      golferId: state.golfer.id,
      total,
      toPar: total - parTotal,
      holes: state.course.holes.map((_, h) => scoring.strokes[0][h])
    };
    saveRound(round);

    fetchAllRounds().then(({ rounds }) => {
      if (!this.scene.isActive()) return;
      if (isNewRecord(rounds, round)) {
        this.newRecord = true;
        const banner = this.add
          .text(GAME_WIDTH / 2, 688, '🏆 NEW COURSE RECORD! 🏆', {
            fontFamily: 'Arial Black, Arial, sans-serif',
            fontSize: '34px',
            color: '#ffd54f',
            fontStyle: 'bold',
            stroke: '#3a2c05',
            strokeThickness: 6
          })
          .setOrigin(0.5)
          .setScale(0.3)
          .setAlpha(0);
        this.tweens.add({
          targets: banner,
          alpha: 1,
          scale: 1,
          duration: 350,
          ease: 'Back.easeOut'
        });
        this.tweens.add({
          targets: banner,
          scale: 1.06,
          delay: 400,
          duration: 500,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut'
        });
      }
    });
  }

  /** Compose a text summary and hand it to the phone's share sheet. */
  private share(verdict: string): void {
    const scoring = state.scoring!;
    const holes = state.course!.holes;
    const lines: string[] = [`🏌️ Johnson's Golf — ${state.course!.name}`];

    const names =
      state.mode === 'scramble' && state.opponent
        ? [`${state.golfer!.name} & ${state.opponent.name}`]
        : state.mode === '1v1' && state.opponent
          ? [state.golfer!.name, state.opponent.name]
          : [state.golfer!.name];
    names.forEach((name, i) => {
      const perHole = holes.map((_, h) => scoring.strokes[i][h]).join('-');
      lines.push(`${name}: ${scoring.totalStrokes(i)} (${perHole})`);
    });
    lines.push(verdict.replace('\n', ' — '));
    if (this.newRecord) lines.push('🏆 NEW COURSE RECORD!');
    lines.push('Play: ' + window.location.href);
    const text = lines.join('\n');

    const toast = (msg: string): void => {
      const t = this.add
        .text(GAME_WIDTH / 2, 660, msg, {
          fontFamily: 'Arial, sans-serif',
          fontSize: '28px',
          color: '#ffffff',
          backgroundColor: '#0a2010',
          padding: { x: 18, y: 10 },
          fontStyle: 'bold'
        })
        .setOrigin(0.5)
        .setDepth(200);
      this.tweens.add({ targets: t, alpha: 0, delay: 1400, duration: 400, onComplete: () => t.destroy() });
    };

    const copyFallback = (): void => {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard
          .writeText(text)
          .then(() => toast('Copied — paste it into a text!'))
          .catch(() => toast('Could not share on this device'));
      } else {
        toast('Could not share on this device');
      }
    };

    if (navigator.share) {
      navigator.share({ text }).catch((err: unknown) => {
        // AbortError = user closed the sheet; anything else -> clipboard
        if (!(err instanceof DOMException && err.name === 'AbortError')) copyFallback();
      });
    } else {
      copyFallback();
    }
  }
}
