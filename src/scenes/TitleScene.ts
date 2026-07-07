import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, COLORS } from '../config';
import { preloadSfx } from '../core/audio/Sfx';
import { makeButton, makeTitle } from '../ui/Ui';

export class TitleScene extends Phaser.Scene {
  constructor() {
    super('TitleScene');
  }

  preload(): void {
    preloadSfx(this);
  }

  create(): void {
    const cx = GAME_WIDTH / 2;

    // Backdrop: sky-to-course gradient feel with simple shapes
    const g = this.add.graphics();
    g.fillGradientStyle(0x7ec8e3, 0x7ec8e3, COLORS.rough, COLORS.rough, 1);
    g.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    // Stylized fairway stripes
    g.fillStyle(COLORS.fairway, 1);
    g.fillEllipse(cx, GAME_HEIGHT * 0.78, GAME_WIDTH * 1.4, 500);
    g.fillStyle(COLORS.fairwayLight, 1);
    g.fillEllipse(cx, GAME_HEIGHT * 0.86, GAME_WIDTH * 1.2, 330);
    // A green with a flag
    g.fillStyle(COLORS.green, 1);
    g.fillEllipse(cx, GAME_HEIGHT * 0.62, 300, 120);
    g.lineStyle(6, 0xffffff, 1);
    g.beginPath();
    g.moveTo(cx, GAME_HEIGHT * 0.62);
    g.lineTo(cx, GAME_HEIGHT * 0.62 - 110);
    g.strokePath();
    g.fillStyle(0xd23c3c, 1);
    g.fillTriangle(
      cx,
      GAME_HEIGHT * 0.62 - 110,
      cx + 64,
      GAME_HEIGHT * 0.62 - 92,
      cx,
      GAME_HEIGHT * 0.62 - 74
    );

    makeTitle(this, cx, 260, "JOHNSON'S", 76);
    makeTitle(this, cx, 340, 'GOLF', 60);
    this.add
      .text(cx, 420, 'Amen Corner — a 3-hole challenge', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '28px',
        color: '#eef5ea'
      })
      .setOrigin(0.5);

    makeButton(this, cx, GAME_HEIGHT - 350, 340, 92, 'START', () => {
      this.scene.start('GolferSelectScene');
    });
    makeButton(this, cx, GAME_HEIGHT - 236, 340, 72, 'RECORDS', () => {
      this.scene.start('RecordsScene');
    }, { fill: 0x11431f, fontSize: 26 });

    this.add
      .text(cx, GAME_HEIGHT - 150, 'Tap to play — 3-click swing', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '24px',
        color: '#d7e8d3'
      })
      .setOrigin(0.5);
  }
}
