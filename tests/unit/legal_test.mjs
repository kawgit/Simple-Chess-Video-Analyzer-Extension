import { BeliefTracker, cellsOf, CLASSES } from '../../extension/position.js';
const FILES='abcdefgh', sqIdx = s => (8-+s[1])*8+FILES.indexOf(s[0]);
function probsFrom(cells){ const p=new Float32Array(64*13).fill(0.0025); for(let i=0;i<64;i++) p[i*13+CLASSES.indexOf(cells[i])]=0.97; return p; }
const cases = [
  ['after 1.e4 (legal)', 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR', 'e2', 'e4', true],
  ['knight "move" e2-e4 (illegal move)', 'rnbqkbnr/pppppppp/8/8/4N3/8/PPPPPPPP/R1BQKBNR', 'e2', 'e4', false],
  ['bishop through pieces c1-h6 (illegal)', 'rnbqkbnr/pppppppp/7B/8/8/8/PPPPPPPP/RN1QKBNR', 'c1', 'h6', false],
  ['Bxf7+ capture (legal)', 'r1bqkbnr/pppp1Bpp/2n5/4p3/4P3/8/PPPP1PPP/RNBQK1NR', 'c4', 'f7', true],
  ['mover left own king in check (illegal pos)', 'rnb1kbnr/pppp1ppp/8/4p3/7q/5P2/PPPPP1PP/RNBQKBNR', 'g2', 'g4', false],
  ['white castled O-O, pair e1-g1', 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1', 'e1', 'g1', true],
  ['white castled O-O, pair e1-h1', 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1', 'e1', 'h1', true],
  ['promotion e7-e8=Q (legal)', '4Q3/8/8/8/8/8/k7/6K1', 'e7', 'e8', true],
  ['en passant exd6 (legal)', 'k7/8/3P4/8/8/8/8/6K1', 'e5', 'd6', true],
  ['two white kings (illegal pos)', 'rnbqkbnr/pppppppp/8/8/4K3/8/PPPPPPPP/RNBQKBNR', 'e2', 'e4', false],
];
for (const [name, fen, f, t2, want] of cases) {
  const tr = new BeliefTracker(); const cells = cellsOf(fen + ' w - - 0 1');
  const pair = [sqIdx(f), sqIdx(t2)];
  tr.update(probsFrom(cells), pair, 'white'); tr.update(probsFrom(cells), pair, 'white');
  const got = !!tr.best;
  console.log(got === want ? 'PASS' : 'FAIL', name.padEnd(42), got ? tr.best.fen : tr.lastDecision);
}
