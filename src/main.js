import { Game } from './game/Game.js';

const params = new URLSearchParams(location.search);
const game = new Game(document.getElementById('game'), document.getElementById('ui'), params);
window.__game = game; // for debugging and the smoke test
game.start();
// remove the loading cover once the first frames have been drawn
requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById('loading')?.remove()));
