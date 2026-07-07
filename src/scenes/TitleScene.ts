import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config';
import { preloadSfx } from '../core/audio/Sfx';
import { DEFAULT_THEME, shade } from '../core/rendering/Theme';
import { makeButton, makeTitle } from '../ui/Ui';
import { fadeIn, fadeToScene } from '../ui/Transitions';

export class TitleScene extends Phaser.Scene {
  constructor() {
    super('TitleScene');
  }

  preload(): void {
    preloadSfx(this);
  }

  create(): void {
    fadeIn(this);
    const cx = GAME_WIDTH / 2;
    const t = DEFAULT_THEME;
    const horizon = GAME_HEIGHT * 0.42;

    // Sky dome with sun bloom and soft clouds
    const g = this.add.graphics();
    const mid = shade(t.skyTop, 1.35);
    g.fillGradientStyle(t.skyTop, t.skyTop, mid, mid, 1);
    g.fillRect(0, 0, GAME_WIDTH, horizon * 0.6);
    g.fillGradientStyle(mid, mid, t.skyBottom, t.skyBottom, 1);
    g.fillRect(0, horizon * 0.6 - 1, GAME_WIDTH, horizon * 0.4 + 1);
    g.fillStyle(0xfff3c4, 0.2);
    g.fillCircle(560, 130, 120);
    g.fillStyle(0xfff8dc, 1);
    g.fillCircle(560, 130, 42);
    g.fillStyle(0xffffff, 0.9);
    for (const [cloudX, cloudY, w] of [
      [150, 130, 150],
      [420, 210, 110],
      [70, 300, 90]
    ]) {
      g.fillEllipse(cloudX, cloudY, w, w * 0.3);
      g.fillEllipse(cloudX + w * 0.3, cloudY - w * 0.1, w * 0.6, w * 0.22);
    }

    // Horizon treeline
    g.fillStyle(shade(t.treeCanopy, 0.72), 1);
    for (let x = -10; x < GAME_WIDTH + 10; x += 40) {
      g.fillCircle(x, horizon - 12, 16 + ((x * 7919) % 13));
    }
    g.fillStyle(shade(t.treeCanopy, 0.9), 1);
    g.fillRect(0, horizon - 14, GAME_WIDTH, 14);

    // Rolling course: rough, sweeping fairway with mow bands, green + flag
    g.fillGradientStyle(t.roughDark, t.roughDark, t.rough, t.rough, 1);
    g.fillRect(0, horizon, GAME_WIDTH, GAME_HEIGHT - horizon);
    g.fillStyle(t.fairway, 1);
    g.fillEllipse(cx + 40, GAME_HEIGHT * 0.84, GAME_WIDTH * 1.5, 720);
    g.fillStyle(0x000000, 0.06);
    for (let y = horizon + 60; y < GAME_HEIGHT; y += 110) {
      g.fillRect(0, y, GAME_WIDTH, 46);
    }
    // Distant green with flag and its shadow
    const gx = cx + 130;
    const gy = horizon + 110;
    g.fillStyle(t.fringe, 1);
    g.fillEllipse(gx, gy, 320, 120);
    g.fillStyle(t.green, 1);
    g.fillEllipse(gx, gy, 270, 96);
    g.fillStyle(t.greenLight, 0.5);
    g.fillEllipse(gx, gy, 170, 58);
    g.fillStyle(0x000000, 0.14);
    g.fillEllipse(gx - 40, gy + 6, 90, 16);
    g.lineStyle(6, 0xf5f5f0, 1);
    g.beginPath();
    g.moveTo(gx, gy);
    g.lineTo(gx, gy - 130);
    g.strokePath();
    g.fillStyle(0xd23c3c, 1);
    g.fillTriangle(gx, gy - 130, gx + 64, gy - 112, gx, gy - 94);
    // Bunker + pond accents
    g.fillStyle(t.sand, 1);
    g.fillEllipse(gx - 220, gy + 60, 150, 54);
    g.fillStyle(shade(t.sand, 1.12), 0.75);
    g.fillEllipse(gx - 220, gy + 60, 96, 30);
    g.fillStyle(t.water, 1);
    g.fillEllipse(cx - 240, GAME_HEIGHT * 0.62, 260, 90);
    g.fillStyle(t.waterDeep, 0.8);
    g.fillEllipse(cx - 240, GAME_HEIGHT * 0.62, 170, 54);

    // Soft ground shadow behind the title for readability
    g.fillStyle(0x08240f, 0.25);
    g.fillRoundedRect(cx - 320, 190, 640, 210, 40);

    makeTitle(this, cx, 260, "JOHNSON'S", 76);
    makeTitle(this, cx, 340, 'GOLF', 60);
    this.add
      .text(cx, 430, 'Two courses • a 3-hole challenge', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '28px',
        color: '#eef5ea',
        stroke: '#0b3d1f',
        strokeThickness: 4
      })
      .setOrigin(0.5);

    makeButton(this, cx, GAME_HEIGHT - 350, 340, 92, 'START', () => {
      fadeToScene(this, 'GolferSelectScene');
    });
    makeButton(this, cx, GAME_HEIGHT - 236, 340, 72, 'RECORDS', () => {
      fadeToScene(this, 'RecordsScene');
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
