import Phaser from 'phaser';
import { COLORS, GAME_HEIGHT, GAME_WIDTH } from '../config';
import { HoleData } from '../core/types';
import { makeButton } from './Ui';

/** Everything the HUD displays each refresh — computed by the scene. */
export interface HudView {
  holeText: string;
  toPinText: string;
  lieText: string;
  clubName: string;
  carryText: string;
  fireText: string;
  scoreText: string;
  windSpeed: number;
  /** Wind arrow rotation, radians (already view-relative). */
  windRotation: number;
}

export interface HudCallbacks {
  onPrevClub: () => void;
  onNextClub: () => void;
  onToggleView: () => void;
}

/**
 * In-round HUD: club/lie/distance panel, wind dial, hole/score panel,
 * aerial toggle, turn prompt, pop-in feedback text, hole banner and the
 * hole-complete overlay. Pure presentation — the scene supplies every value.
 */
export class GameHud {
  private clubText: Phaser.GameObjects.Text;
  private carryText: Phaser.GameObjects.Text;
  private lieText: Phaser.GameObjects.Text;
  private windText: Phaser.GameObjects.Text;
  private windArrow: Phaser.GameObjects.Container;
  private holeText: Phaser.GameObjects.Text;
  private scoreText: Phaser.GameObjects.Text;
  private distText: Phaser.GameObjects.Text;
  private fireText: Phaser.GameObjects.Text;
  private turnText: Phaser.GameObjects.Text;
  private feedback: Phaser.GameObjects.Text;
  private aerialBtnText: Phaser.GameObjects.Text;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly uiLayer: Phaser.GameObjects.Container,
    callbacks: HudCallbacks
  ) {
    const g = scene.add.graphics();
    uiLayer.add(g);
    const panel = (px: number, py: number, pw: number, ph: number): void => {
      g.fillStyle(0x000000, 0.25);
      g.fillRoundedRect(px + 3, py + 4, pw, ph, 16);
      g.fillStyle(COLORS.uiPanel, 0.88);
      g.fillRoundedRect(px, py, pw, ph, 16);
      g.lineStyle(2, 0xffffff, 0.18);
      g.strokeRoundedRect(px, py, pw, ph, 16);
    };
    panel(14, 14, 226, 178);
    panel(252, 14, 216, 130);
    panel(GAME_WIDTH - 244, 14, 230, 178);

    const style = (size: number, color = '#ffffff'): Phaser.Types.GameObjects.Text.TextStyle => ({
      fontFamily: 'Arial, sans-serif',
      fontSize: `${size}px`,
      color,
      fontStyle: 'bold'
    });

    const prev = scene.add
      .text(38, 44, '◀', style(36))
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    const next = scene.add
      .text(216, 44, '▶', style(36))
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    prev.on('pointerdown', callbacks.onPrevClub);
    next.on('pointerdown', callbacks.onNextClub);
    this.clubText = scene.add.text(127, 36, '', style(32, '#ffd54f')).setOrigin(0.5);
    this.carryText = scene.add.text(127, 64, '', style(17, '#9fbf9a')).setOrigin(0.5);
    this.lieText = scene.add.text(26, 88, '', style(20, '#cfe2ca')).setOrigin(0, 0);
    this.distText = scene.add.text(26, 118, '', style(22, '#ffffff')).setOrigin(0, 0);
    this.fireText = scene.add.text(26, 152, '', style(19, '#ff8a50')).setOrigin(0, 0);

    const wg = scene.add.graphics();
    wg.fillStyle(0x0a2010, 0.8);
    wg.fillCircle(360, 62, 38);
    wg.lineStyle(2, 0xffffff, 0.3);
    wg.strokeCircle(360, 62, 38);
    uiLayer.add(wg);
    const arrowG = scene.add.graphics();
    arrowG.fillStyle(0xffd54f, 1);
    arrowG.fillTriangle(22, 0, -10, -12, -10, 12);
    arrowG.fillRect(-22, -5, 16, 10);
    this.windArrow = scene.add.container(360, 62, [arrowG]);
    this.windText = scene.add.text(360, 122, '', style(21)).setOrigin(0.5);

    this.holeText = scene.add.text(GAME_WIDTH - 230, 28, '', style(23)).setOrigin(0, 0);
    this.scoreText = scene.add
      .text(GAME_WIDTH - 230, 96, '', style(20, '#ffd54f'))
      .setOrigin(0, 0);

    const aerialBtn = makeButton(
      scene,
      GAME_WIDTH - 84,
      236,
      132,
      54,
      'AERIAL',
      callbacks.onToggleView,
      { fontSize: 22, fill: 0x11431f }
    );
    this.aerialBtnText = aerialBtn.list[1] as Phaser.GameObjects.Text;
    uiLayer.add(aerialBtn);

    this.turnText = scene.add.text(GAME_WIDTH / 2, 218, '', style(26)).setOrigin(0.5);
    this.feedback = scene.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 160, '', {
        ...style(50),
        stroke: '#08240f',
        strokeThickness: 8
      })
      .setOrigin(0.5)
      .setAlpha(0);

    uiLayer.add([
      prev,
      next,
      this.clubText,
      this.carryText,
      this.lieText,
      this.distText,
      this.fireText,
      this.windText,
      this.windArrow,
      this.holeText,
      this.scoreText,
      this.turnText,
      this.feedback
    ]);
  }

  update(view: HudView): void {
    this.holeText.setText(view.holeText);
    this.distText.setText(view.toPinText);
    this.lieText.setText(view.lieText);
    this.clubText.setText(view.clubName);
    this.carryText.setText(view.carryText);
    this.fireText.setText(view.fireText);
    this.scoreText.setText(view.scoreText);
    this.updateWind(view.windSpeed, view.windRotation);
  }

  updateWind(speed: number, rotation: number): void {
    this.windText.setText(`Wind ${speed} mph`);
    this.windArrow.setRotation(rotation);
  }

  setTurnText(text: string): void {
    this.turnText.setText(text);
  }

  setAerialLabel(overhead: boolean): void {
    this.aerialBtnText.setText(overhead ? 'BACK' : 'AERIAL');
  }

  /** Big center-screen pop-in message (band feedback, splash, birdie...). */
  showFeedback(msg: string, color = '#ffffff', holdMs = 900): void {
    this.feedback.setText(msg).setColor(color);
    this.scene.tweens.killTweensOf(this.feedback);
    this.feedback.setAlpha(0).setScale(0.4).setY(GAME_HEIGHT / 2 - 160);
    this.scene.tweens.add({
      targets: this.feedback,
      alpha: 1,
      scale: 1,
      duration: 220,
      ease: 'Back.easeOut'
    });
    this.scene.tweens.add({
      targets: this.feedback,
      alpha: 0,
      y: GAME_HEIGHT / 2 - 220,
      delay: holdMs + 220,
      duration: 420,
      ease: 'Sine.easeIn'
    });
  }

  /** "GOLDEN BELL — Hole 12 • Par 3" fade-in/out banner at hole start. */
  showHoleBanner(hole: HoleData): void {
    const cx = GAME_WIDTH / 2;
    const g = this.scene.add.graphics();
    g.fillStyle(0x08240f, 0.92);
    g.fillRoundedRect(cx - 290, 480, 580, 190, 24);
    g.lineStyle(3, 0xffd54f, 0.8);
    g.strokeRoundedRect(cx - 290, 480, 580, 190, 24);
    const t1 = this.scene.add
      .text(cx, 540, hole.name ? hole.name.toUpperCase() : `HOLE ${hole.number}`, {
        fontFamily: 'Georgia, serif',
        fontSize: '48px',
        color: '#f6f2df',
        fontStyle: 'bold'
      })
      .setOrigin(0.5);
    const t2 = this.scene.add
      .text(cx, 608, `Hole ${hole.number}  •  Par ${hole.par}  •  ${hole.yardage} yds`, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '30px',
        color: '#ffd54f',
        fontStyle: 'bold'
      })
      .setOrigin(0.5);
    const banner = this.scene.add.container(0, 0, [g, t1, t2]).setAlpha(0).setDepth(90);
    this.uiLayer.add(banner);
    this.scene.tweens.add({ targets: banner, alpha: 1, duration: 250 });
    this.scene.tweens.add({
      targets: banner,
      alpha: 0,
      delay: 1300,
      duration: 350,
      onComplete: () => banner.destroy()
    });
  }

  /** End-of-hole score overlay with a NEXT HOLE / RESULTS button. */
  showHoleComplete(
    holeNumber: number,
    lines: string[],
    lastHole: boolean,
    onContinue: () => void
  ): void {
    const cx = GAME_WIDTH / 2;
    const g = this.scene.add.graphics();
    g.fillStyle(0x000000, 0.6);
    g.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    g.fillStyle(COLORS.uiPanel, 0.97);
    g.fillRoundedRect(cx - 310, 360, 620, 470, 24);
    g.lineStyle(3, 0xffd54f, 0.7);
    g.strokeRoundedRect(cx - 310, 360, 620, 470, 24);
    this.uiLayer.add(g);

    const title = this.scene.add
      .text(cx, 424, `HOLE ${holeNumber} COMPLETE`, {
        fontFamily: 'Georgia, serif',
        fontSize: '40px',
        color: '#f6f2df',
        fontStyle: 'bold'
      })
      .setOrigin(0.5);
    this.uiLayer.add(title);

    const body = this.scene.add
      .text(cx, 590, lines.join('\n'), {
        fontFamily: 'Arial, sans-serif',
        fontSize: '30px',
        color: '#ffffff',
        align: 'center',
        lineSpacing: 12,
        fontStyle: 'bold'
      })
      .setOrigin(0.5);
    this.uiLayer.add(body);

    const btn = makeButton(
      this.scene,
      cx,
      758,
      340,
      84,
      lastHole ? 'RESULTS' : 'NEXT HOLE',
      onContinue
    );
    this.uiLayer.add(btn);
  }
}
