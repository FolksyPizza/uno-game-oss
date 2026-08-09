// Bootstrap: wire up the Game, register every scene, start the loop.

import { Game } from './engine/game.js';
import { startLoop } from './engine/loop.js';
import { BootScene } from './scenes/boot.js';
import { MenuScene } from './scenes/menu.js';
import { LevelSelectScene } from './scenes/levelSelect.js';
import { ShopScene } from './scenes/shop.js';
import { PlayScene } from './scenes/play.js';
import { ResultsScene } from './scenes/results.js';

const canvas = document.getElementById('game');
const game = new Game(canvas);

game.registerScene('boot', new BootScene(game));
game.registerScene('menu', new MenuScene(game));
game.registerScene('levelSelect', new LevelSelectScene(game));
game.registerScene('shop', new ShopScene(game));
game.registerScene('play', new PlayScene(game));
game.registerScene('results', new ResultsScene(game));

game.setScene('boot');

startLoop(
  (dt) => game.update(dt),
  () => game.render(),
);
