import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, COLORS } from '../config';
import { state } from '../core/GameState';
import { GameMode, Golfer, overallRating } from '../core/types';
import { drawAvatar, makeButton, makeTitle } from '../core/Ui';
import { OPPONENTS } from '../data/opponents';

const MODES: Array<{ mode: GameMode; label: string; blurb: string }> = [
  { mode: 'solo', label: 'SOLO', blurb: 'Stroke play — 3 holes, just you and the course' },
  { mode: '1v1', label: '1 v 1', blurb: 'Stroke play against an AI legend' },
  { mode: 'scramble', label: 'SCRAMBLE', blurb: 'Team up with a partner — play the better ball' }
];

export class ModeSelectScene extends Phaser.Scene {
  private opponentUi: Phaser.GameObjects.GameObject[] = [];
  private pendingMode: GameMode = 'solo';

  constructor() {
    super('ModeSelectScene');
  }

  create(): void {
    this.opponentUi = [];
    const cx = GAME_WIDTH / 2;
    this.add.rectangle(cx, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, COLORS.rough);
    makeTitle(this, cx, 130, 'SELECT MODE', 50);

    MODES.forEach((m, i) => {
      const y = 320 + i * 170;
      makeButton(this, cx, y, 520, 100, m.label, () => this.pickMode(m.mode), {
        fontSize: 40
      });
      this.add
        .text(cx, y + 74, m.blurb, {
          fontFamily: 'Arial, sans-serif',
          fontSize: '21px',
          color: '#cfe2ca'
        })
        .setOrigin(0.5);
    });
  }

  private pickMode(mode: GameMode): void {
    if (mode === 'solo') {
      state.mode = 'solo';
      state.opponent = null;
      this.scene.start('CourseSelectScene');
      return;
    }
    this.pendingMode = mode;
    this.showOpponentPicker();
  }

  private showOpponentPicker(): void {
    this.opponentUi.forEach((o) => o.destroy());
    this.opponentUi = [];

    const cx = GAME_WIDTH / 2;
    const panelY = GAME_HEIGHT - 290;
    const g = this.add.graphics();
    g.fillStyle(COLORS.uiPanel, 0.96);
    g.fillRoundedRect(cx - 330, panelY - 110, 660, 240, 20);
    this.opponentUi.push(g);

    const title = this.add
      .text(cx, panelY - 78, this.pendingMode === 'scramble' ? 'Choose your partner' : 'Choose your opponent', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '28px',
        color: '#ffffff',
        fontStyle: 'bold'
      })
      .setOrigin(0.5);
    this.opponentUi.push(title);

    OPPONENTS.forEach((opp, i) => {
      const x = cx - 240 + i * 160;
      const btn = this.makeOpponentChip(x, panelY + 30, opp);
      this.opponentUi.push(btn);
    });
  }

  private makeOpponentChip(x: number, y: number, opp: Golfer): Phaser.GameObjects.Container {
    const g = this.add.graphics();
    drawAvatar(g, 0, -22, 44, opp.look, opp.color, COLORS.uiPanel);
    const name = this.add
      .text(0, 38, opp.name, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '24px',
        color: '#ffffff',
        fontStyle: 'bold'
      })
      .setOrigin(0.5);
    const ovr = this.add
      .text(0, 64, `${overallRating(opp)} OVR`, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '18px',
        color: '#f3c93e',
        fontStyle: 'bold'
      })
      .setOrigin(0.5);
    const chip = this.add.container(x, y, [g, name, ovr]);
    chip.setSize(130, 160);
    chip.setInteractive({ useHandCursor: true });
    chip.on('pointerdown', () => {
      state.mode = this.pendingMode;
      state.opponent = opp;
      this.scene.start('CourseSelectScene');
    });
    return chip;
  }
}
