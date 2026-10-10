import { isSacrifice } from '../extension/annotate.js';
import { Chess } from '../extension/lib/chess.js';
const uci = (fen, sans) => { const c = new Chess(fen); return sans.map((s) => { const m = c.move(s); return m.from + m.to + (m.promotion || ''); }); };
const T = [
  ['Greek gift (real sac)', 'r1bq1rk1/pppn1ppp/4p3/3pP3/1b1P4/2NB1N2/PPP2PPP/R1BQK2R w KQ - 0 8', ['Bxh7+', 'Kxh7', 'Ng5+', 'Kg8', 'Qh5', 'Re8', 'Qxf7+', 'Kh8'], true],
  ['Bxf7+ wins the queen back (not a sac)', 'r1bqk2r/pppp1ppp/2n2n2/2b1p1N1/2B1P3/8/PPPP1PPP/RNBQK2R w KQkq - 6 5', ['Bxf7+', 'Ke7', 'Bb3', 'Rf8', 'O-O', 'd6'], false],
  ['plain trade', 'rnbqkb1r/pppp1ppp/5n2/4p3/4P3/2N5/PPPP1PPP/R1BQKBNR w KQkq - 2 3', ['Bc4', 'Bc5', 'Nf3', 'Nc6'], false],
  ['exchange sac that wins it back fast', 'r4rk1/pp3ppp/2n5/8/8/2N5/PP3PPP/R2R2K1 w - - 0 1', ['Rd7', 'Rad8', 'Rxd8', 'Rxd8'], false],
  ['queen sac then smothered mate', 'r6k/6pp/7N/8/8/1Q6/6PP/6K1 w - - 0 1', ['Qg8+', 'Rxg8', 'Nf7#'], true],
];
for (const [name, fen, sans, want] of T) {
  let pv; try { pv = uci(fen, sans); } catch (e) { console.log('BAD LINE', name, e.message); continue; }
  const got = isSacrifice(fen, pv); console.log(got === want ? 'ok  ' : 'FAIL', name, got);
}
