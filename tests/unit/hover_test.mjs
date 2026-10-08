import { BeliefTracker, cellsOf, CLASSES } from '../../extension/position.js';
import { Chess } from '../../extension/lib/chess.js';
const FILES='abcdefgh', sqIdx = s => (8-+s[1])*8+FILES.indexOf(s[0]);
function probsFrom(cells){ const p=new Float32Array(64*13).fill(0.0025); for(let i=0;i<64;i++) p[i*13+CLASSES.indexOf(cells[i])]=0.97; return p; }
function run(label, pairSqs, tintedSqs, lift, game=['e4','e5','Nf3','Nc6']) {
  const t=new BeliefTracker(), g=new Chess();
  for (const san of game) { const m=g.move(san); const c=cellsOf(g.fen()); const pr=[sqIdx(m.from),sqIdx(m.to)];
    t.update(probsFrom(c), pr, 'white', pr); t.update(probsFrom(c), pr, 'white', pr); }
  const before=t.best.fen;
  const c=cellsOf(g.fen()).split(''); for (const s of lift) c[sqIdx(s)]='.';   // lifted piece leaves its square
  const pair=pairSqs.map(sqIdx), tinted=tintedSqs.map(sqIdx);
  for (let k=0;k<3;k++) t.update(probsFrom(c.join('')), pair, 'white', tinted);
  console.log(t.best.fen===before ? 'PASS' : 'FAIL', label.padEnd(56), t.best.fen===before ? '' : 'became '+t.best.sans.slice(-1)[0], '|', t.lastDecision);
}
// last move b8-c6 (black). White lifts the f3 knight: f3 gets the same yellow.
run('pair split as c6+f3 (would read as Nxc6)', ['c6','f3'], ['b8','c6','f3'], ['f3']);
run('pair split as b8+f3 (would read as a knight move)', ['b8','f3'], ['b8','c6','f3'], ['f3']);
run('lift e4 pawn, pair e4+b8 read', ['b8','e4'], ['b8','c6','e4'], ['e4']);
run('click-select (piece stays), pair c6+f3', ['c6','f3'], ['b8','c6','f3'], []);
// 1.e4 d5: last move d7-d5. White lifts the e4 pawn: e4 gets the same yellow.
run('1.e4 d5, lift e4: pair d5+e4 (would read as exd5)', ['d5','e4'], ['d7','d5','e4'], ['e4'], ['e4','d5']);
run('1.e4 d5, click e4 (stays): pair d5+e4', ['d5','e4'], ['d7','d5','e4'], [], ['e4','d5']);
