import { classify } from '../../extension/annotate.js';
const prev = { fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3', depth: 16, lines: [
  { kind: 'cp', val: 35, pv: ['f1b5','a7a6'] }, { kind: 'cp', val: 25, pv: ['d2d4','e5d4'] }, { kind: 'cp', val: 20, pv: ['f1c4','g8f6'] }] };
const t = (m, after) => console.log(m, JSON.stringify(classify(m, prev, after, null)));
t('f1b5'); t('d2d4');
t('b1c3', { depth: 16, lines: [{ kind: 'cp', val: -10, pv: ['g8f6'] }] });   // after: black to move, -0.10 for black
t('h2h4', { depth: 16, lines: [{ kind: 'cp', val: 40, pv: ['g8f6'] }] });
t('f3e5', { depth: 16, lines: [{ kind: 'cp', val: 150, pv: ['c6e5'] }] });
t('f3g1', { depth: 16, lines: [{ kind: 'cp', val: 400, pv: ['d7d5'] }] });
// only move
const p2 = { ...prev, lines: [{ kind: 'cp', val: 50, pv: ['f1b5'] }, { kind: 'cp', val: -250, pv: ['d2d4'] }] };
console.log('only', JSON.stringify(classify('f1b5', p2, null, null)));
