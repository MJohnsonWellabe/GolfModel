import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, COLORS } from './config';
import { TitleScene } from './scenes/TitleScene';
import { GolferSelectScene } from './scenes/GolferSelectScene';
import { ModeSelectScene } from './scenes/ModeSelectScene';
import { CourseSelectScene } from './scenes/CourseSelectScene';
import { GameScene } from './scenes/GameScene';
import { RecordsScene } from './scenes/RecordsScene';
import { ResultsScene } from './scenes/ResultsScene';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: COLORS.rough,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: GAME_WIDTH,
    height: GAME_HEIGHT
  },
  input: {
    activePointers: 2
  },
  scene: [
    TitleScene,
    GolferSelectScene,
    ModeSelectScene,
    CourseSelectScene,
    GameScene,
    ResultsScene,
    RecordsScene
  ]
});
