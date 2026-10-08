// chess.com-style labels for the last move, from Stockfish evaluations of the
// position before the move (top 3 lines) and after it.
// Loss is measured in win probability for the player who moved.
import { Chess } from './lib/chess.js';

export const LABELS = {
  brilliant: { name: 'Brilliant', color: '#1baca6', glyph: 'text', text: '!!' },
  great: { name: 'Great move', color: '#749bbf', glyph: 'text', text: '!' },
  best: { name: 'Best move', color: '#81b64c', glyph: 'star' },
  excellent: { name: 'Excellent', color: '#81b64c', glyph: 'thumb' },
  good: { name: 'Good', color: '#95af8a', glyph: 'check' },
  inaccuracy: { name: 'Inaccuracy', color: '#f7c631', glyph: 'text', text: '?!' },
  mistake: { name: 'Mistake', color: '#ffa459', glyph: 'text', text: '?' },
  miss: { name: 'Miss', color: '#ee6b55', glyph: 'cross' },
  blunder: { name: 'Blunder', color: '#ca3431', glyph: 'text', text: '??' },
};

// chess.com-style round icon, as SVG markup in a 20x20 box:
// coloured disc with a soft bottom shadow and a white glyph
export function iconSVG(label) {
  const L = LABELS[label];
  const W = 'fill="#fff"';
  let g;
  switch (L.glyph) {
    case 'star':
      g = `<path ${W} d="M10 3.6l1.95 4.02 4.43.62-3.22 3.1.79 4.4L10 13.67l-3.95 2.07.79-4.4-3.22-3.1 4.43-.62z"/>`; break;
    case 'thumb':
      g = `<path ${W} d="M5 9h2.2v6.6H5zM8.2 15.6V9.3l2.7-4.1c.5-.7 1.6-.4 1.6.5v2.8h2.6c.9 0 1.5.8 1.3 1.6l-1.1 4.4c-.2.7-.8 1.1-1.5 1.1z"/>`; break;
    case 'check':
      g = `<path fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M5.6 10.4l3 3 5.8-6.4"/>`; break;
    case 'cross':
      g = `<path fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" d="M6.6 6.6l6.8 6.8M13.4 6.6l-6.8 6.8"/>`; break;
    default: {
      const size = L.text.length > 1 ? 12 : 14.5;
      g = `<text x="10" y="${10 + size * 0.36}" text-anchor="middle" font-family="system-ui,-apple-system,'Segoe UI',sans-serif" font-weight="800" font-size="${size}" letter-spacing="-0.9" ${W}>${L.text}</text>`;
    }
  }
  return `<circle cx="10" cy="10.8" r="9.4" fill="rgba(0,0,0,.28)"/><circle cx="10" cy="10" r="9.4" fill="${L.color}"/>${g}`;
}

const MIN_DEPTH = 10;    // don't label on shallower searches
const FINAL_DEPTH = 16;  // label stops changing once both searches reach this

// side-to-move score -> win probability (0..1), same curve as the eval bar
export function winProb(line) {
  const cp = line.kind === 'mate' ? Math.sign(line.val || -1) * (10000 - Math.abs(line.val) * 10) : line.val;
  return 1 / (1 + Math.exp(-0.00368208 * cp));
}

const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
function material(c, color) {
  let m = 0;
  for (const row of c.board()) for (const p of row) if (p) m += (p.color === color ? 1 : -1) * VALUE[p.type];
  return m;
}

// Did the move give up material that the best play doesn't win straight back?
function isSacrifice(prevFen, pv) {
  const c = new Chess(); c.load(prevFen, { skipValidation: true });
  const me = c.turn(), before = material(c, me);
  let worst = 0;
  for (let i = 0; i < Math.min(pv.length, 5); i++) {
    try { c.move({ from: pv[i].slice(0, 2), to: pv[i].slice(2, 4), promotion: pv[i][4] || undefined }); } catch { break; }
    if (i % 2 === 1) worst = Math.min(worst, material(c, me) - before);   // after each opponent reply
  }
  const end = material(c, me) - before;
  return worst <= -2 && end <= -1;
}

// prev: {depth, lines} for the position before the move (mover to move)
// after: {depth, lines} for the position after it (opponent to move), may be null
// prevLabel: label of the opponent's previous move (for "miss")
// returns {label, final} or null if there isn't enough information yet
export function classify(move, prev, after, prevLabel) {
  if (!prev || prev.depth < MIN_DEPTH || !prev.lines[0]) return null;
  const best = prev.lines[0];
  const inTop = prev.lines.findIndex((l) => l && l.pv[0] === move);
  let played, playedPv;
  if (inTop >= 0) { played = winProb(prev.lines[inTop]); playedPv = prev.lines[inTop].pv; }
  else if (after && after.depth >= MIN_DEPTH && after.lines[0]) {
    played = 1 - winProb(after.lines[0]); playedPv = [move, ...after.lines[0].pv];
  } else return null;

  const wBest = winProb(best), loss = Math.max(0, wBest - played);
  const final = prev.depth >= FINAL_DEPTH && (inTop >= 0 || (after && after.depth >= FINAL_DEPTH));
  let label;
  if (inTop === 0 || loss <= 0.005) {
    const second = prev.lines[1];
    const onlyMove = second && wBest - winProb(second) >= 0.15 && wBest > 0.4;
    if (played >= 0.5 && isSacrifice(prev.fen, playedPv) && loss <= 0.02) label = 'brilliant';
    else label = onlyMove ? 'great' : 'best';
  } else if (loss <= 0.02) label = isSacrifice(prev.fen, playedPv) && played >= 0.5 ? 'brilliant' : 'excellent';
  else if ((prevLabel === 'mistake' || prevLabel === 'blunder') && wBest >= 0.6 && loss >= 0.1) label = 'miss';
  else if (loss <= 0.05) label = 'good';
  else if (loss <= 0.10) label = 'inaccuracy';
  else if (loss <= 0.20) label = 'mistake';
  else label = 'blunder';
  return { label, final };
}
