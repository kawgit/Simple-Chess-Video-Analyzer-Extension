import { BeliefTracker, CLASSES, cellsOf } from '../extension/position.js';
const sqI = (s) => (8 - +s[1]) * 8 + 'abcdefgh'.indexOf(s[0]);
function probs(cells) { const p = new Float32Array(64 * 13); for (let i = 0; i < 64; i++) { for (let c = 0; c < 13; c++) p[i * 13 + c] = 0.001; p[i * 13 + CLASSES.indexOf(cells[i])] = 0.98; } return p; }
const real = cellsOf('4rk1r/2p3pp/p2p1p2/1p6/1N2q3/1B4R1/PB3PPP/R5K1 w - - 0 1');   // after ...Qg6-e4
const misread = real.split(''); misread[sqI('b4')] = 'Q'; const bad = misread.join('');
const pair = ['e4', 'g6'].map(sqI);
// 1) repair: same move first read with the knight as a queen, then correctly
let t = new BeliefTracker(); t.reset();
t.update(probs(bad), pair, 'white', pair); t.update(probs(bad), pair, 'white', pair);
console.log('first read :', t.best && t.best.fen.split(' ')[0]);
t.update(probs(real), pair, 'white', pair); t.update(probs(real), pair, 'white', pair);
console.log('after fix  :', t.best && t.best.fen.split(' ')[0], '|', t.lastDecision);
// 2) next move: a misread from history must not survive a confident correct read
t = new BeliefTracker(); t.reset();
t.update(probs(bad), pair, 'white', pair); t.update(probs(bad), pair, 'white', pair);
const next = real.split(''); next[sqI('g3')] = '.'; next[sqI('g6')] = 'R'; const nx = next.join('');   // Rg3-g6
const pair2 = ['g3', 'g6'].map(sqI);
t.update(probs(nx), pair2, 'white', pair2); t.update(probs(nx), pair2, 'white', pair2);
console.log('next move  :', t.best && t.best.fen.split(' ')[0], '|', t.lastDecision);
