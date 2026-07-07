import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, COLORS } from '../config';
import { state } from '../core/GameState';
import { CourseData } from '../core/types';
import { makeTitle } from '../ui/Ui';
import amenCorner from '../data/courses/amenCorner.json';
import legends from '../data/courses/legends.json';

export class CourseSelectScene extends Phaser.Scene {
  constructor() {
    super('CourseSelectScene');
  }

  create(): void {
    const cx = GAME_WIDTH / 2;
    this.add.rectangle(cx, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, COLORS.rough);
    makeTitle(this, cx, 120, 'SELECT COURSE', 50);

    this.makeCard(cx, 420, amenCorner as CourseData, 'Holes 11, 12 and 13 — the famous corner', (g, w, h) => {
      // Winding fairway + creek + green
      g.fillStyle(COLORS.fairway, 1);
      g.fillRoundedRect(-w / 2 + 50, -h / 2 + 100, w - 100, 100, 34);
      g.fillStyle(COLORS.water, 1);
      g.fillRoundedRect(-w / 2 + 50, -h / 2 + 162, w - 100, 22, 10);
      g.fillStyle(COLORS.green, 1);
      g.fillEllipse(w / 2 - 120, -h / 2 + 128, 96, 60);
    });

    this.makeCard(cx, 840, legends as CourseData, 'Island green • the Road Hole • an ocean finish', (g, w, h) => {
      // Island green in water + a little building
      g.fillStyle(COLORS.water, 1);
      g.fillRoundedRect(-w / 2 + 50, -h / 2 + 96, w - 100, 96, 20);
      g.fillStyle(COLORS.fringe, 1);
      g.fillEllipse(-w / 2 + 170, -h / 2 + 144, 92, 62);
      g.fillStyle(COLORS.green, 1);
      g.fillEllipse(-w / 2 + 170, -h / 2 + 144, 70, 44);
      g.fillStyle(0x8a8378, 1);
      g.fillRect(w / 2 - 190, -h / 2 + 108, 90, 52);
      g.fillStyle(0x5f5b52, 1);
      g.fillTriangle(w / 2 - 196, -h / 2 + 108, w / 2 - 145, -h / 2 + 84, w / 2 - 94, -h / 2 + 108);
    });
  }

  private makeCard(
    x: number,
    y: number,
    course: CourseData,
    blurb: string,
    art: (g: Phaser.GameObjects.Graphics, w: number, h: number) => void
  ): void {
    const w = 620;
    const h = 380;
    const g = this.add.graphics();
    g.fillStyle(COLORS.uiPanel, 0.94);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 20);
    g.lineStyle(4, COLORS.accent, 1);
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, 20);
    art(g, w, h);
    // Flag on the art
    g.lineStyle(4, 0xffffff, 1);
    g.beginPath();
    g.moveTo(-w / 2 + 170, -h / 2 + 144);
    g.lineTo(-w / 2 + 170, -h / 2 + 96);
    g.strokePath();
    g.fillStyle(0xd23c3c, 1);
    g.fillTriangle(-w / 2 + 170, -h / 2 + 96, -w / 2 + 194, -h / 2 + 106, -w / 2 + 170, -h / 2 + 116);

    const name = this.add
      .text(0, -h / 2 + 48, course.name, {
        fontFamily: 'Georgia, serif',
        fontSize: '42px',
        color: '#f6f2df',
        fontStyle: 'bold'
      })
      .setOrigin(0.5);

    const totalPar = course.holes.reduce((a, hole) => a + hole.par, 0);
    const totalYds = course.holes.reduce((a, hole) => a + hole.yardage, 0);
    const info = this.add
      .text(0, h / 2 - 108, `3 holes • Par ${totalPar} • ${totalYds} yds\n${blurb}`, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '22px',
        color: '#d5e5d0',
        align: 'center'
      })
      .setOrigin(0.5);

    const cta = this.add
      .text(0, h / 2 - 42, 'TAP TO PLAY', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '28px',
        color: '#ffd54f',
        fontStyle: 'bold'
      })
      .setOrigin(0.5);

    const card = this.add.container(x, y, [g, name, info, cta]);
    card.setSize(w, h);
    card.setInteractive({ useHandCursor: true });
    card.on('pointerdown', () => {
      state.course = course;
      state.startRound();
      this.scene.start('GameScene');
    });
  }
}
