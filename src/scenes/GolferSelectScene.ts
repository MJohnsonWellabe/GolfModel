import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../config';
import { state } from '../core/GameState';
import { Golfer, overallRating } from '../core/types';
import { drawAvatar, drawRatingBadge, makeTitle } from '../ui/Ui';
import { GOLFERS } from '../data/golfers';
import { fadeIn, fadeToScene } from '../ui/Transitions';

const STAT_LABELS: Array<{ key: keyof Golfer['stats']; label: string }> = [
  { key: 'drivingPower', label: 'PWR' },
  { key: 'drivingAccuracy', label: 'ACC' },
  { key: 'approach', label: 'APP' },
  { key: 'chipping', label: 'CHP' },
  { key: 'putting', label: 'PUT' }
];

const CARD_BG = 0x10331c;
const LIST_TOP = 170;

/** Scrollable roster: drag to scroll, tap a card to pick. */
export class GolferSelectScene extends Phaser.Scene {
  private listC!: Phaser.GameObjects.Container;
  private scrollMin = 0;
  private dragTotal = 0;
  private lastY = 0;
  private scrolling = false;
  /** A pick requires a pointerdown INSIDE this scene — the tap that opened
   *  the scene releases here and must not select a card. */
  private downInScene = false;

  constructor() {
    super('GolferSelectScene');
  }

  create(): void {
    fadeIn(this);
    const cx = GAME_WIDTH / 2;
    const bg = this.add.graphics();
    bg.fillGradientStyle(0x1c4a28, 0x1c4a28, 0x123018, 0x123018, 1);
    bg.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    this.listC = this.add.container(0, 0);
    const cardH = 190;
    const step = cardH + 18;
    const startY = LIST_TOP + 30 + cardH / 2;
    GOLFERS.forEach((golfer, i) => {
      this.listC.add(this.makeCard(cx, startY + i * step, 660, cardH, golfer));
    });
    const contentBottom = startY + (GOLFERS.length - 1) * step + cardH / 2 + 30;
    this.scrollMin = Math.min(0, GAME_HEIGHT - contentBottom);

    // Opaque header band above the scrolling list
    const header = this.add.graphics();
    header.fillGradientStyle(0x1c4a28, 0x1c4a28, 0x1a4425, 0x1a4425, 1);
    header.fillRect(0, 0, GAME_WIDTH, LIST_TOP);
    makeTitle(this, cx, 90, 'CHOOSE YOUR GOLFER', 42);
    this.add
      .text(cx, 142, 'swipe to scroll', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '20px',
        color: '#9fbf9a'
      })
      .setOrigin(0.5);

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.y < LIST_TOP) return;
      this.scrolling = true;
      this.downInScene = true;
      this.lastY = p.y;
      this.dragTotal = 0;
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.scrolling || !p.isDown) return;
      const dy = p.y - this.lastY;
      this.lastY = p.y;
      this.dragTotal += Math.abs(dy);
      this.listC.y = Phaser.Math.Clamp(this.listC.y + dy, this.scrollMin, 0);
    });
    this.input.on('pointerup', () => {
      this.scrolling = false;
    });
  }

  private makeCard(x: number, y: number, w: number, h: number, golfer: Golfer): Phaser.GameObjects.Container {
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.35);
    g.fillRoundedRect(-w / 2 + 5, -h / 2 + 7, w, h, 20);
    g.fillStyle(CARD_BG, 1);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 20);
    g.fillStyle(golfer.color, 1);
    g.fillRoundedRect(-w / 2, -h / 2, 14, h, { tl: 20, tr: 0, br: 0, bl: 20 });
    g.lineStyle(3, 0xffffff, 0.14);
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, 20);

    // Portrait
    drawAvatar(g, -w / 2 + 92, 0, 62, golfer.look, golfer.color, CARD_BG);

    // Name
    const name = this.add
      .text(-w / 2 + 176, -h / 2 + 38, golfer.name.toUpperCase(), {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '32px',
        color: '#ffffff',
        fontStyle: 'bold'
      })
      .setOrigin(0, 0.5);

    // Overall badge
    drawRatingBadge(g, w / 2 - 72, 0, 42);
    const ovr = this.add
      .text(w / 2 - 72, -3, `${overallRating(golfer)}`, {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '34px',
        color: '#2a1f05',
        fontStyle: 'bold'
      })
      .setOrigin(0.5);
    const ovrLabel = this.add
      .text(w / 2 - 72, 24, 'OVR', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '13px',
        color: '#6b5312',
        fontStyle: 'bold'
      })
      .setOrigin(0.5);

    // Stat bars
    const items: Phaser.GameObjects.GameObject[] = [g, name, ovr, ovrLabel];
    const barX = -w / 2 + 240;
    const barW = 210;
    STAT_LABELS.forEach((stat, i) => {
      const value = golfer.stats[stat.key];
      const barY = -h / 2 + 78 + i * 26;
      const label = this.add
        .text(-w / 2 + 176, barY, stat.label, {
          fontFamily: 'Arial, sans-serif',
          fontSize: '15px',
          color: '#9fbf9a',
          fontStyle: 'bold'
        })
        .setOrigin(0, 0.5);
      g.fillStyle(0x0a2010, 1);
      g.fillRoundedRect(barX, barY - 7, barW, 14, 5);
      const fillColor = value >= 90 ? 0x43d05c : value >= 80 ? 0xc9d64a : 0xe0a53a;
      g.fillStyle(fillColor, 1);
      g.fillRoundedRect(barX, barY - 7, barW * (value / 100), 14, 5);
      g.lineStyle(2, 0x000000, 0.25);
      g.strokeRoundedRect(barX, barY - 7, barW, 14, 5);
      const num = this.add
        .text(barX + barW + 12, barY, `${value}`, {
          fontFamily: 'Arial, sans-serif',
          fontSize: '16px',
          color: '#ffffff',
          fontStyle: 'bold'
        })
        .setOrigin(0, 0.5);
      items.push(label, num);
    });

    const card = this.add.container(x, y, items);
    card.setSize(w, h);
    card.setInteractive({ useHandCursor: true });
    card.on('pointerup', () => {
      // A scroll gesture (or a tap that started in the previous scene) shouldn't select
      if (!this.downInScene || this.dragTotal > 12) return;
      state.golfer = golfer;
      this.tweens.add({
        targets: card,
        scale: 0.96,
        duration: 70,
        yoyo: true,
        onComplete: () => fadeToScene(this, 'ModeSelectScene')
      });
    });
    return card;
  }
}
