import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config';
import { bestRounds, fetchAllRounds, RoundRecord } from '../core/History';
import { GameMode } from '../core/types';
import { makeButton, makeTitle } from '../core/Ui';

const COURSES = ['Amen Corner', 'Legends Links'];
const MODES: Array<{ mode: GameMode; label: string }> = [
  { mode: 'solo', label: 'SOLO' },
  { mode: '1v1', label: '1 v 1' },
  { mode: 'scramble', label: 'SCRAMBLE' }
];

export class RecordsScene extends Phaser.Scene {
  private rounds: RoundRecord[] = [];
  private shared = false;
  private loaded = false;
  private courseIdx = 0;
  private listC: Phaser.GameObjects.Container | null = null;
  private courseBtns: Phaser.GameObjects.Container[] = [];

  constructor() {
    super('RecordsScene');
  }

  create(): void {
    this.loaded = false;
    this.rounds = [];
    this.courseIdx = 0;
    const cx = GAME_WIDTH / 2;
    const bg = this.add.graphics();
    bg.fillGradientStyle(0x1c4a28, 0x1c4a28, 0x123018, 0x123018, 1);
    bg.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    makeTitle(this, cx, 90, 'COURSE RECORDS', 46);

    // Course toggle
    this.courseBtns = COURSES.map((name, i) =>
      makeButton(this, i === 0 ? cx - 170 : cx + 170, 180, 320, 62, name, () => {
        this.courseIdx = i;
        this.styleCourseButtons();
        this.renderList();
      }, { fontSize: 24, fill: 0x11431f })
    );
    this.styleCourseButtons();

    makeButton(this, cx, GAME_HEIGHT - 90, 320, 76, 'BACK', () => {
      this.scene.start('TitleScene');
    });

    this.renderList();
    fetchAllRounds().then(({ rounds, shared }) => {
      if (!this.scene.isActive()) return;
      this.rounds = rounds;
      this.shared = shared;
      this.loaded = true;
      this.renderList();
    });
  }

  private styleCourseButtons(): void {
    this.courseBtns.forEach((btn, i) => {
      btn.setAlpha(i === this.courseIdx ? 1 : 0.55);
      btn.setScale(i === this.courseIdx ? 1 : 0.94);
    });
  }

  private fmtDate(d: number): string {
    try {
      return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  }

  private renderList(): void {
    this.listC?.destroy(true);
    const items: Phaser.GameObjects.GameObject[] = [];
    const cx = GAME_WIDTH / 2;
    const course = COURSES[this.courseIdx];

    const style = (size: number, color = '#ffffff', bold = true): Phaser.Types.GameObjects.Text.TextStyle => ({
      fontFamily: 'Arial, sans-serif',
      fontSize: `${size}px`,
      color,
      fontStyle: bold ? 'bold' : 'normal'
    });

    let y = 260;
    if (!this.loaded) {
      items.push(this.add.text(cx, 420, 'Loading records...', style(28, '#cfe2ca')).setOrigin(0.5));
    } else {
      for (const m of MODES) {
        const top = bestRounds(this.rounds, course, m.mode, 5);
        items.push(this.add.text(60, y, m.label, style(26, '#ffd54f')).setOrigin(0, 0.5));
        y += 44;
        if (top.length === 0) {
          items.push(
            this.add.text(80, y, 'No rounds yet — go set the record!', style(20, '#7fa37a', false)).setOrigin(0, 0.5)
          );
          y += 40;
        } else {
          top.forEach((r, i) => {
            const sign = r.toPar === 0 ? 'E' : r.toPar > 0 ? `+${r.toPar}` : `${r.toPar}`;
            const prefix = i === 0 ? '🏆' : ` ${i + 1}.`;
            const line = `${prefix} ${r.names}   ${r.total} (${sign})   ${r.holes.join('-')}`;
            items.push(
              this.add
                .text(80, y, line, style(i === 0 ? 24 : 20, i === 0 ? '#ffffff' : '#c9d8c4', i === 0))
                .setOrigin(0, 0.5)
            );
            items.push(
              this.add
                .text(GAME_WIDTH - 70, y, this.fmtDate(r.d), style(17, '#7fa37a', false))
                .setOrigin(1, 0.5)
            );
            y += i === 0 ? 42 : 34;
          });
        }
        y += 26;
      }
      items.push(
        this.add
          .text(
            cx,
            GAME_HEIGHT - 160,
            this.shared ? '🌐 Shared family leaderboard' : '📱 This device only — shared leaderboard not set up',
            style(19, '#9fbf9a', false)
          )
          .setOrigin(0.5)
      );
    }
    this.listC = this.add.container(0, 0, items);
  }
}
