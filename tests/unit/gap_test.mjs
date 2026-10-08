import { BeliefTracker, cellsOf, CLASSES } from '../../extension/position.js';
import { Chess } from '../../extension/lib/chess.js';
const FILES='abcdefgh', sqIdx = s => (8-+s[1])*8+FILES.indexOf(s[0]);
function probsFrom(cells){ const p=new Float32Array(64*13).fill(0.0025); for(let i=0;i<64;i++) p[i*13+CLASSES.indexOf(cells[i])]=0.97; return p; }
const t=new BeliefTracker(), g=new Chess();
const game='e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6 O-O f6 d4 exd4 Nxd4 c5 Nb3 Qxd1 Rxd1 Bg4 f3 Be6'.split(' ');
let ply=0, ok=0, n=0;
for (const san of game) {
  const m=g.move(san); ply++;
  if (ply % 4 === 0) continue;               // this position is never seen
  const pair=[sqIdx(m.from), sqIdx(m.to)];
  let t0=performance.now();
  t.update(probsFrom(cellsOf(g.fen())), pair, 'white'); t.update(probsFrom(cellsOf(g.fen())), pair, 'white');
  const dt=performance.now()-t0;
  const good=t.best && t.best.fen===g.fen(); n++; ok+=good;
  console.log(san.padEnd(5), good?'OK ':'BAD', 'history', t.best && t.best.moves.length, `${dt.toFixed(1)} ms`);
}
console.log(ok,'/',n);
