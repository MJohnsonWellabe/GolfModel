import Phaser from 'phaser';
import { COLORS } from '../config';
import { GolferLook } from '../core/types';

export interface ButtonOptions {
  fontSize?: number;
  fill?: number;
  textColor?: string;
}

/** Rounded-rect tap button sized for thumbs (min 48px tall). */
export function makeButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  onTap: () => void,
  opts: ButtonOptions = {}
): Phaser.GameObjects.Container {
  const h = Math.max(48, height);
  const fill = opts.fill ?? 0x1e7a3c;
  const g = scene.add.graphics();
  g.fillStyle(fill, 1);
  g.fillRoundedRect(-width / 2, -h / 2, width, h, 14);
  g.lineStyle(3, 0xffffff, 0.25);
  g.strokeRoundedRect(-width / 2, -h / 2, width, h, 14);

  const text = scene.add
    .text(0, 0, label, {
      fontFamily: 'Arial, sans-serif',
      fontSize: `${opts.fontSize ?? 30}px`,
      color: opts.textColor ?? COLORS.uiText,
      fontStyle: 'bold'
    })
    .setOrigin(0.5);

  const container = scene.add.container(x, y, [g, text]);
  container.setSize(width, h);
  container.setInteractive({ useHandCursor: true });
  container.on('pointerdown', () => {
    scene.tweens.add({ targets: container, scale: 0.95, duration: 60, yoyo: true });
    onTap();
  });
  return container;
}

/** Tiny side-view dinosaur print (a friendly little T-rex). */
export function drawDino(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  size: number,
  color: number
): void {
  g.fillStyle(color, 1);
  // Body
  g.fillEllipse(cx, cy, size * 1.1, size * 0.72);
  // Tail
  g.fillTriangle(
    cx - size * 0.5,
    cy - size * 0.05,
    cx - size * 1.05,
    cy - size * 0.32,
    cx - size * 0.42,
    cy + size * 0.26
  );
  // Head + neck
  g.fillEllipse(cx + size * 0.52, cy - size * 0.5, size * 0.52, size * 0.42);
  g.fillTriangle(
    cx + size * 0.3,
    cy - size * 0.5,
    cx + size * 0.62,
    cy - size * 0.1,
    cx + size * 0.18,
    cy
  );
  // Legs
  g.fillRect(cx - size * 0.22, cy + size * 0.24, size * 0.16, size * 0.3);
  g.fillRect(cx + size * 0.12, cy + size * 0.24, size * 0.16, size * 0.3);
  // Back plates
  for (const [dx, dy] of [
    [-0.3, -0.42],
    [-0.02, -0.5],
    [0.24, -0.44]
  ]) {
    g.fillTriangle(
      cx + size * dx - size * 0.1,
      cy + size * dy + size * 0.12,
      cx + size * dx,
      cy + size * dy - size * 0.1,
      cx + size * dx + size * 0.1,
      cy + size * dy + size * 0.12
    );
  }
  // Eye
  g.fillStyle(0xffffff, 1);
  g.fillCircle(cx + size * 0.58, cy - size * 0.54, size * 0.07);
}

/** Black line-art Pikachu-style print: round face, tall ears, cheeks, bolt tail. */
export function drawPikachu(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  s: number,
  color = 0x1a1a1a
): void {
  const lw = Math.max(1.5, s * 0.09);
  g.lineStyle(lw, color, 1);
  // Head outline
  g.strokeCircle(cx, cy, s * 0.5);
  // Ears (outlines with filled tips)
  g.beginPath();
  g.moveTo(cx - s * 0.28, cy - s * 0.4);
  g.lineTo(cx - s * 0.52, cy - s * 0.98);
  g.lineTo(cx - s * 0.06, cy - s * 0.49);
  g.moveTo(cx + s * 0.28, cy - s * 0.4);
  g.lineTo(cx + s * 0.52, cy - s * 0.98);
  g.lineTo(cx + s * 0.06, cy - s * 0.49);
  g.strokePath();
  g.fillStyle(color, 1);
  g.fillTriangle(
    cx - s * 0.52,
    cy - s * 0.98,
    cx - s * 0.42,
    cy - s * 0.72,
    cx - s * 0.28,
    cy - s * 0.82
  );
  g.fillTriangle(
    cx + s * 0.52,
    cy - s * 0.98,
    cx + s * 0.42,
    cy - s * 0.72,
    cx + s * 0.28,
    cy - s * 0.82
  );
  // Eyes + cheeks
  g.fillCircle(cx - s * 0.18, cy - s * 0.08, s * 0.07);
  g.fillCircle(cx + s * 0.18, cy - s * 0.08, s * 0.07);
  g.lineStyle(lw * 0.8, color, 1);
  g.strokeCircle(cx - s * 0.32, cy + s * 0.16, s * 0.1);
  g.strokeCircle(cx + s * 0.32, cy + s * 0.16, s * 0.1);
  // Little smile
  g.beginPath();
  g.arc(cx, cy + s * 0.12, s * 0.12, Math.PI * 0.15, Math.PI * 0.85);
  g.strokePath();
  // Lightning-bolt tail off to the right
  g.lineStyle(lw, color, 1);
  g.beginPath();
  g.moveTo(cx + s * 0.5, cy + s * 0.34);
  g.lineTo(cx + s * 0.78, cy + s * 0.16);
  g.lineTo(cx + s * 0.66, cy + s * 0.02);
  g.lineTo(cx + s * 0.95, cy - s * 0.2);
  g.strokePath();
}

/** Simple filled heart. */
export function drawHeart(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  s: number,
  color = 0xffffff
): void {
  g.fillStyle(color, 1);
  g.fillCircle(cx - s * 0.32, cy - s * 0.2, s * 0.36);
  g.fillCircle(cx + s * 0.32, cy - s * 0.2, s * 0.36);
  g.fillTriangle(cx - s * 0.64, cy - s * 0.04, cx + s * 0.64, cy - s * 0.04, cx, cy + s * 0.72);
}

/** Cap dome + brim; two-tone (Pokéball style) when `secondary` is set. */
function drawCap(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  r: number,
  primary: number,
  secondary?: number
): void {
  if (secondary !== undefined) {
    g.fillStyle(primary, 1);
    g.slice(cx, cy, r, Math.PI, Math.PI * 1.5, false);
    g.fillPath();
    g.fillStyle(secondary, 1);
    g.slice(cx, cy, r, Math.PI * 1.5, Math.PI * 2, false);
    g.fillPath();
    g.fillStyle(0xffffff, 1);
    g.fillCircle(cx, cy - r * 0.82, r * 0.14);
  } else {
    g.fillStyle(primary, 1);
    g.slice(cx, cy, r, Math.PI, Math.PI * 2, false);
    g.fillPath();
  }
}

/**
 * Vector golfer bust inside a circular frame, drawn into `g` at (cx, cy).
 * `coverColor` repaints the ring just outside the frame so the shoulders
 * never bleed onto the card background.
 */
export function drawAvatar(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  r: number,
  look: GolferLook,
  ringColor: number,
  coverColor: number
): void {
  // Frame backing (sky)
  g.fillStyle(0xcfe8f5, 1);
  g.fillCircle(cx, cy, r);

  const headY = cy - r * 0.12;
  const headR = r * (look.child ? 0.46 : 0.42);

  // Long hair mass behind the head/shoulders
  if (look.longHair && look.hair !== null) {
    g.fillStyle(look.hair, 1);
    g.fillEllipse(cx, headY + headR * 0.9, headR * 2.9, headR * 2.4);
  }

  if (look.dress) {
    // Dress: flared trapezoid with a little neckline bow
    g.fillStyle(look.shirt, 1);
    g.fillPoints(
      [
        new Phaser.Geom.Point(cx - r * 0.3, cy + r * 0.34),
        new Phaser.Geom.Point(cx + r * 0.3, cy + r * 0.34),
        new Phaser.Geom.Point(cx + r * 0.78, cy + r * 1.1),
        new Phaser.Geom.Point(cx - r * 0.78, cy + r * 1.1)
      ],
      true
    );
    g.fillStyle(0xffffff, 0.9);
    g.fillCircle(cx - r * 0.07, cy + r * 0.42, r * 0.06);
    g.fillCircle(cx + r * 0.07, cy + r * 0.42, r * 0.06);
  } else {
    // Shoulders / polo
    g.fillStyle(look.shirt, 1);
    g.fillEllipse(cx, cy + r * 0.78, r * 1.5, r * 0.95);
    // Collar
    g.fillStyle(0xffffff, 0.9);
    g.fillTriangle(cx - r * 0.14, cy + r * 0.42, cx + r * 0.14, cy + r * 0.42, cx, cy + r * 0.62);
  }

  // Shirt print
  if (look.motif === 'dino') {
    drawDino(g, cx + r * 0.02, cy + r * 0.74, r * 0.34, 0x1f5e28);
  } else if (look.motif === 'pikachu') {
    drawPikachu(g, cx, cy + r * 0.74, r * 0.3);
  } else if (look.motif === 'heart') {
    drawHeart(g, cx, cy + r * 0.74, r * 0.3);
  }

  // Head
  g.fillStyle(look.skin, 1);
  g.fillCircle(cx - headR * 0.98, headY + headR * 0.15, headR * 0.16); // ears
  g.fillCircle(cx + headR * 0.98, headY + headR * 0.15, headR * 0.16);
  g.fillCircle(cx, headY, headR);

  // Long hair framing the face
  if (look.longHair && look.hair !== null) {
    g.fillStyle(look.hair, 1);
    g.slice(cx, headY - headR * 0.1, headR * 1.06, Math.PI * 0.92, Math.PI * 2.08, false);
    g.fillPath();
    g.fillEllipse(cx - headR * 1.05, headY + headR * 0.75, headR * 0.55, headR * 1.7);
    g.fillEllipse(cx + headR * 1.05, headY + headR * 0.75, headR * 0.55, headR * 1.7);
    if (look.hairStreak !== undefined) {
      // Accent streak: one strand framing the left side of the face
      g.fillStyle(look.hairStreak, 1);
      g.fillEllipse(cx - headR * 0.82, headY + headR * 0.45, headR * 0.26, headR * 1.35);
    }
  }

  if (look.hat !== null) {
    // Cap: top half-dome (two-tone if hatSecondary) + brim
    drawCap(g, cx, headY - headR * 0.08, headR * 1.04, look.hat, look.hatSecondary);
    g.fillStyle(look.hat, 1);
    g.fillRoundedRect(cx - headR * 1.15, headY - headR * 0.2, headR * 2.3, headR * 0.22, headR * 0.1);
  } else if (look.hair !== null && !look.longHair) {
    // Hair crescent (buzz cut / short hair)
    g.fillStyle(look.hair, 1);
    g.slice(cx, headY - headR * 0.12, headR * 1.0, Math.PI * 1.05, Math.PI * 1.95, false);
    g.fillPath();
  }

  // Face
  g.fillStyle(0x2e2a26, 1);
  g.fillCircle(cx - headR * 0.34, headY + headR * 0.08, headR * 0.075);
  g.fillCircle(cx + headR * 0.34, headY + headR * 0.08, headR * 0.075);
  g.lineStyle(Math.max(2, r * 0.045), 0x8c5a44, 1);
  g.beginPath();
  g.arc(cx, headY + headR * 0.4, headR * 0.3, Math.PI * 0.15, Math.PI * 0.85);
  g.strokePath();

  // Cover ring hides shoulder overflow, then the accent ring frames it
  g.lineStyle(r * 0.5, coverColor, 1);
  g.strokeCircle(cx, cy, r + r * 0.25);
  g.lineStyle(Math.max(3, r * 0.07), ringColor, 1);
  g.strokeCircle(cx, cy, r);
}

/** Gold "overall rating" badge, drawn into `g`; caller adds the number text. */
export function drawRatingBadge(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  r: number
): void {
  g.fillStyle(0x1c1608, 1);
  g.fillCircle(cx, cy + 3, r);
  g.fillStyle(0xf3c93e, 1);
  g.fillCircle(cx, cy, r);
  g.fillStyle(0xffe28a, 1);
  g.fillCircle(cx, cy - r * 0.18, r * 0.82);
  g.lineStyle(3, 0xb8912a, 1);
  g.strokeCircle(cx, cy, r);
}

/** Standard headline text. */
export function makeTitle(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  size = 56
): Phaser.GameObjects.Text {
  return scene.add
    .text(x, y, label, {
      fontFamily: 'Georgia, serif',
      fontSize: `${size}px`,
      color: '#f6f2df',
      fontStyle: 'bold',
      stroke: '#0b3d1f',
      strokeThickness: 6
    })
    .setOrigin(0.5);
}
