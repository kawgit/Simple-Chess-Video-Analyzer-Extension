import { BeliefTracker, cellsOf, CLASSES } from '../../extension/position.js';
import { Chess } from '../../extension/lib/chess.js';
const FILES='abcdefgh';
const sqIdx = s => (8-+s[1])*8+FILES.indexOf(s[0]);
function probsFrom(cells, wb, noise={}) {
  const p=new Float32Array(64*13).fill(0.0025);
  for(let bi=0;bi<64;bi++){ const ii= wb?bi:63-bi; const c=noise[bi]??cells[bi]; p[ii*13+CLASSES.indexOf(c)]=0.97; }
  return p;
}
const pairImg=(a,b,wb)=>[a,b].map(s=>wb?sqIdx(s):63-sqIdx(s));
const t=new BeliefTracker(); const g=new Chess(); const wb=false;
const feed=(cells,pair,n=2,noise)=>{ let ch=false; for(let k=0;k<n;k++){ const r=t.update(probsFrom(cells,wb,noise),pair,'auto'); ch=ch||r.changed;} return ch; };
// start position, no highlight -> discarded
feed(cellsOf(g.fen()), null); console.log('start:', t.lastDecision, t.best);
const game='e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6 O-O f6 d4 exd4 Nxd4 c5 Nb3 Qxd1 Rxd1'.split(' ');
let ply=0;
for (const san of game) {
  const before=cellsOf(g.fen()); const m=g.move(san); ply++;
  const after=cellsOf(g.fen()); const pair=pairImg(m.from,m.to,wb);
  // animation frame: highlight already new, piece mid-way (missing) - single raw scan only
  const anim=after.split(''); anim[sqIdx(m.to)]='.'; t.update(probsFrom(anim.join(''),wb),pair,'auto');
  feed(after,pair,2);
  // opponent hovers a piece: piece lifted from its square, highlight unchanged
  const hov=after.split(''); const ps=[...Array(64).keys()].find(i=>after[i]!=='.'&& (after[i]===after[i].toLowerCase())===(g.turn()==='b')&&after[i].toLowerCase()!=='k');
  hov[ps]='.'; feed(hov.join(''),pair,3);
  // chess.com-style drag: three highlights -> no pair
  feed(hov.join(''),null,3);
  const ok = t.best && t.best.fen===g.fen();
  console.log(san.padEnd(5), ok?'OK ':'BAD', 'hist', t.best&&t.best.moves.length, t.lastDecision.padEnd(40), ok?'':(t.best&&t.best.fen)+' vs '+g.fen());
}
console.log(t.positionCommand());
console.log('beliefs in history', t.history.length);
// jump (seek): position from another game, with highlight
const j=new Chess('r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3');
feed(cellsOf(j.fen()), pairImg('f1','b5',wb)); console.log('jump ->', t.best.fen, 'hist', t.best.moves.length);
// seek back into the original game: a later position of the main line is reachable from old beliefs
