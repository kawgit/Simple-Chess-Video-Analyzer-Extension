// Scan post-processing: turns a stream of scans (square probabilities + the
// highlighted last-move squares) into beliefs about the full game state.
//
// A belief = a fully defined position with a move history: rootFen + moves.
// belief_history keeps the most recent 100 beliefs. For each settled scan:
//   1. no unique last-move highlight pair            -> discard
//   2. same highlight pair as the last accepted scan -> discard
//   3. otherwise create beliefs:
//      - a default belief: the scanned position with no history (turn from the
//        highlighted move, castling iff king/rooks on home squares, en passant
//        from a highlighted double pawn push, clocks 0)
//      - one continuation belief for every belief in history from which the
//        highlighted move is a legal move leading to the scanned position
//        (history = that belief's history + the move)
// The best belief = the one from the latest accepted scan with the longest history.
import { Chess } from './lib/chess.js';

export const CLASSES = ['.', 'K', 'Q', 'R', 'B', 'N', 'P', 'k', 'q', 'r', 'b', 'n', 'p'];
const NC = 13, CI = Object.fromEntries(CLASSES.map((c, i) => [c, i]));
const FILES = 'abcdefgh';
export const MAX_BELIEFS = 100;
// A continuation may differ from the raw read only on squares the classifier
// was unsure about: its log-likelihood may be at most this much below the raw read.
const MATCH_NATS = 7;
// ...but a square the move itself changed must not be confidently read otherwise.
const TOUCHED_NATS = 2;

const imgIndex = (bi, whiteBottom) => (whiteBottom ? bi : 63 - bi);
const sqName = (bi) => FILES[bi & 7] + (8 - (bi >> 3));
const sqIndex = (name) => (8 - Number(name[1])) * 8 + FILES.indexOf(name[0]);

export function sqToImage(sq, whiteBottom) {
  const f = FILES.indexOf(sq[0]), r = 8 - Number(sq[1]);
  return whiteBottom ? { row: r, col: f } : { row: 7 - r, col: 7 - f };
}

export function placementOf(cells) { // 64 chars a8..h1
  let out = '';
  for (let r = 0; r < 8; r++) {
    let e = 0;
    for (let f = 0; f < 8; f++) {
      const c = cells[r * 8 + f];
      if (c === '.') e++; else { if (e) out += e; e = 0; out += c; }
    }
    if (e) out += e;
    if (r < 7) out += '/';
  }
  return out;
}
export function cellsOf(fen) {
  return fen.split(' ')[0].split('/').map((r) => r.replace(/\d/g, (d) => '.'.repeat(+d))).join('');
}

export function orientationScore(labels) {
  let ws = 0, wn = 0, bs = 0, bn = 0;
  labels.forEach((c, i) => {
    if (c === '.') return;
    const r = i >> 3, w = c.toLowerCase() === 'k' ? 3 : 1;
    if (c === c.toUpperCase()) { ws += r * w; wn += w; } else { bs += r * w; bn += w; }
  });
  if (!wn || !bn) return 0;
  return ws / wn - bs / bn;
}

export function sanity(cells) {
  let K = 0, k = 0, W = 0, B = 0, wp = 0, bp = 0;
  for (let i = 0; i < 64; i++) {
    const c = cells[i]; if (c === '.') continue;
    if (c === 'K') K++; if (c === 'k') k++; if (c === 'P') wp++; if (c === 'p') bp++;
    if (c === c.toUpperCase()) W++; else B++;
    if ((c === 'P' || c === 'p') && (i < 8 || i >= 56)) return 'pawn on the first/last rank';
  }
  if (K !== 1 || k !== 1) return 'need exactly one king per side';
  if (W > 16 || B > 16 || wp > 8 || bp > 8) return 'too many pieces';
  return null;
}

function castlingFromCells(c) {
  let s = '';
  if (c[60] === 'K') { if (c[63] === 'R') s += 'K'; if (c[56] === 'R') s += 'Q'; }
  if (c[4] === 'k') { if (c[7] === 'r') s += 'k'; if (c[0] === 'r') s += 'q'; }
  return s || '-';
}

function load(fen) {
  const c = new Chess();
  try { c.load(fen, { skipValidation: true }); return c; } catch { return null; }
}
function kingSquare(c, color) {
  for (const row of c.board()) for (const p of row) if (p && p.type === 'k' && p.color === color) return p.square;
  return null;
}
export function legalFor(fen) {
  const c = load(fen); if (!c) return false;
  const turn = c.turn(), other = turn === 'w' ? 'b' : 'w';
  const ks = kingSquare(c, other);
  return !!ks && !!kingSquare(c, turn) && !c.isAttacked(ks, turn);
}

// Best raw read under simple rules: one king per side, no pawns on back ranks.
function freeDecode(lp) {
  const cells = [];
  const ok = (i, c) => !((c === CI.P || c === CI.p) && (i < 8 || i >= 56));
  for (let i = 0; i < 64; i++) {
    let b = 0;
    for (let c = 1; c < NC; c++) if (ok(i, c) && lp[i * NC + c] > lp[i * NC + b]) b = c;
    cells.push(b);
  }
  for (const K of [CI.K, CI.k]) {
    let ks = 0;
    for (let i = 1; i < 64; i++) if (lp[i * NC + K] > lp[ks * NC + K]) ks = i;
    for (let i = 0; i < 64; i++) {
      if (i === ks) { cells[i] = K; continue; }
      if (cells[i] !== K) continue;
      let b = 0;
      for (let c = 1; c < NC; c++) if (c !== CI.K && c !== CI.k && ok(i, c) && lp[i * NC + c] > lp[i * NC + b]) b = c;
      cells[i] = b;
    }
  }
  return cells.map((c) => CLASSES[c]).join('');
}

// Does a chess.js move correspond to the highlighted squares?
// (castling may be shown king->destination or king->rook square)
function moveMatchesPair(m, pairSet) {
  if (pairSet.has(m.from) && pairSet.has(m.to)) return true;
  if (m.flags.includes('k') || m.flags.includes('q')) {
    const rank = m.from[1], rookFrom = (m.flags.includes('k') ? 'h' : 'a') + rank;
    return pairSet.has(m.from) && pairSet.has(rookFrom);
  }
  return false;
}

// Rebuild the position before a highlighted move and check the move is legal
// there and leads exactly to `cells`. Returns the resulting FEN or null.
function explainMove(cells, pair) {
  const target = placementOf(cells);
  const tryPrev = (prev, mover, from, to, ep) => {
    if (sanity(prev)) return null;
    const fen0 = `${placementOf(prev)} ${mover} ${castlingFromCells(prev)} ${ep || '-'} 0 1`;
    if (!legalFor(fen0)) return null;                // the side that just moved can't be the one in check before it
    const c = load(fen0); if (!c) return null;
    let ms = [];
    try { ms = c.moves({ square: sqName(from), verbose: true }); } catch { return null; }
    for (const m of ms) {
      if (m.to !== sqName(to) && !((m.flags.includes('k') || m.flags.includes('q')) && pair.includes(sqIndex((m.flags.includes('k') ? 'h' : 'a') + m.from[1])))) continue;
      c.move(m);
      const ok = c.fen().split(' ')[0] === target;
      const out = c.fen();
      c.undo();
      if (ok) return out;
    }
    return null;
  };
  for (const [from, to] of [[pair[0], pair[1]], [pair[1], pair[0]]]) {
    const P = cells[to];
    if (P !== '.' && cells[from] === '.') {
      const white = P === P.toUpperCase(), mover = white ? 'w' : 'b';
      const theirs = white ? ['.', 'q', 'r', 'b', 'n', 'p'] : ['.', 'Q', 'R', 'B', 'N', 'P'];
      const lastRank = white ? to < 8 : to >= 56;
      const movers = [P];
      if (lastRank && 'QRBNqrbn'.includes(P)) movers.push(white ? 'P' : 'p');   // promotion
      for (const piece of movers) for (const cap of theirs) {
        if ((cap === 'p' || cap === 'P') && (to < 8 || to >= 56)) continue;
        const prev = cells.split(''); prev[from] = piece; prev[to] = cap;
        const r = tryPrev(prev, mover, from, to, '-'); if (r) return r;
      }
      // en passant: pawn moved diagonally onto an empty square, captured pawn beside it
      if ((P === 'P' || P === 'p') && (from & 7) !== (to & 7)) {
        const capSq = (from & ~7) | (to & 7), prev = cells.split('');
        prev[from] = P; prev[to] = '.'; prev[capSq] = white ? 'p' : 'P';
        const r = tryPrev(prev, mover, from, to, sqName(to)); if (r) return r;
      }
    }
  }
  // castling (pair = king square + destination or rook square)
  for (const [rank, K, R, mover] of [[7, 'K', 'R', 'w'], [0, 'k', 'r', 'b']]) {
    const e = rank * 8 + 4;
    if (!pair.includes(e)) continue;
    for (const [kTo, rFrom, rTo] of [[e + 2, e + 3, e + 1], [e - 2, e - 4, e - 1]]) {
      if (cells[kTo] !== K || cells[rTo] !== R || cells[e] !== '.' || cells[rFrom] !== '.') continue;
      if (!pair.includes(kTo) && !pair.includes(rFrom)) continue;
      const prev = cells.split(''); prev[e] = K; prev[rFrom] = R; prev[kTo] = '.'; prev[rTo] = '.';
      const r = tryPrev(prev, mover, e, kTo, '-'); if (r) return r;
    }
  }
  return null;
}

let beliefSeq = 0;

export class BeliefTracker {
  constructor() { this.reset(); }

  reset() {
    this.history = [];              // belief_history, oldest first
    this.lastPairKey = null;        // highlight pair of the last accepted scan
    this.latestScan = 0; this.scanSeq = 0;
    this.best = null;
    this.prevRawKey = null; this.processedKey = null;
    this.orient = null; this.orientVotes = 0; this.whiteBottom = true;
    this.coordHint = null;
    this.lastDecision = 'waiting for a move to be highlighted';
  }

  // probs: Float32Array(64*13) in image order; pair: [i, j] image indices or null
  // returns { changed } — changed = the best belief changed
  // tinted: image indices of every highlighted-looking square in this scan
  update(probs, pair, orientationMode, tinted = null) {
    const labels = [], conf = [];
    for (let i = 0; i < 64; i++) {
      let b = 0; for (let c = 1; c < NC; c++) if (probs[i * NC + c] > probs[i * NC + b]) b = c;
      labels.push(CLASSES[b]); conf.push(probs[i * NC + b]);
    }
    this.labels = labels; this.conf = conf;
    this.updateOrientation(labels, orientationMode);
    const auto = orientationMode !== 'white' && orientationMode !== 'black';
    let { wb, lp, cells, pairSq } = this.readAs(probs, pair, this.whiteBottom);
    // Sites like chess.com tint a picked-up piece's square in the same colour as
    // the last move. A real move replaces the old highlight, so if both squares
    // of the last accepted move are still tinted, the extra square is a hover or
    // selection: nothing new happened.
    if (pairSq && this.lastPairKey && tinted && pairSq.join('') !== this.lastPairKey) {
      const tset = new Set(tinted.map((ii) => sqName(imgIndex(ii, wb))));
      if (this.lastPair.every((sq) => tset.has(sq))) { pairSq = null; this.hoverSeen = true; }
    }
    this.rawCells = cells; this.rawPair = pairSq;

    const rawKey = cells + '|' + (pairSq ? pairSq.join('') : '-');
    // fast path: a new highlight that is a legal move from a known belief is
    // accepted on the very first scan. The highlighted squares plus the previous
    // position pin down the move, so the moving piece needn't be read cleanly
    // (it may still be sliding); only the untouched squares must agree.
    if (pairSq && pairSq.join('') !== this.lastPairKey && this.history.length) {
      const res = this.processScan(cells, pairSq, lp, true);
      if (res !== null) { this.prevRawKey = this.processedKey = rawKey; return { changed: res }; }
    }
    // otherwise settle: act only on a scan that two consecutive raw scans agree on
    // (skips the frames where a piece is still sliding after the highlight appears)
    if (rawKey !== this.prevRawKey) { this.prevRawKey = rawKey; return { changed: false }; }
    if (rawKey === this.processedKey) return { changed: false };
    this.processedKey = rawKey;
    // A new highlighted move that doesn't continue any known game (the fast path
    // above found no continuation) may be a new game shown from the other side.
    // Read the board both ways: switch if only the flipped reading is a legal
    // position + legal move, or if both are and the piece placement clearly
    // says the board is flipped.
    if (auto && (this.coordHint === null || this.coordHint === undefined) && pairSq && this.history.length && pairSq.join('') !== this.lastPairKey) {
      const alt = this.readAs(probs, pair, !wb);
      const altDef = alt.pairSq && this.defaultBelief(alt.cells, alt.pairSq);
      if (altDef) {
        const curDef = this.defaultBelief(cells, pairSq);
        const sc = orientationScore(labels);          // > 0: white pieces sit lower in the image
        const favoursAlt = alt.wb ? sc > 1.0 : sc < -1.0;
        if (!curDef || favoursAlt) {
          this.orient = alt.wb; this.whiteBottom = alt.wb; this.orientVotes = 0;
          this.history = []; this.lastPairKey = null; this.lastPair = null; this.best = null;
          this.rawCells = alt.cells; this.rawPair = alt.pairSq;
          const changed = this.processScan(alt.cells, alt.pairSq, alt.lp);
          if (changed) this.lastDecision += ' (board flipped: new orientation)';
          return { changed: true };
        }
      }
    }
    return { changed: this.processScan(cells, pairSq, lp) };
  }

  // the scan read with a given orientation: per-square log-probs, decoded board
  // and highlighted squares, all in board coordinates (a8..h1)
  readAs(probs, pair, wb) {
    const lp = new Float32Array(64 * NC);
    for (let bi = 0; bi < 64; bi++) {
      const ii = imgIndex(bi, wb);
      for (let c = 0; c < NC; c++) lp[bi * NC + c] = Math.log(Math.max(probs[ii * NC + c], 1e-4));
    }
    const cells = freeDecode(lp);
    const pairSq = pair ? pair.map((ii) => sqName(imgIndex(ii, wb))).sort() : null;
    return { wb, lp, cells, pairSq };
  }

  // Orientation read from the board's coordinate labels (auto mode). Returns true
  // if it changed the orientation of a game in progress (history is reset).
  setCoordHint(wb, weak = false) {
    if (wb === null) { if (!weak) this.coordHint = null; return false; }
    this.coordHint = wb;
    if (this.orient === wb && this.whiteBottom === wb) return false;
    const had = this.history.length > 0;
    this.orient = wb; this.whiteBottom = wb; this.orientVotes = 0;
    this.history = []; this.lastPairKey = null; this.lastPair = null; this.best = null;
    this.prevRawKey = null; this.processedKey = null;
    this.lastDecision = 'board orientation read from coordinates';
    return had;
  }

  updateOrientation(labels, mode) {
    const before = this.whiteBottom;
    if (mode === 'white') this.whiteBottom = true;
    else if (mode === 'black') this.whiteBottom = false;
    else if (this.coordHint !== null && this.coordHint !== undefined) this.whiteBottom = this.coordHint;
    else if (this.history.length && this.orient !== null) {
      // locked once moves are being tracked: piece placement late in a game can
      // look "flipped" and must not throw the history away (use the Bottom
      // buttons if a video really flips the board)
    } else {
      const sc = orientationScore(labels);
      if (this.orient === null) { if (Math.abs(sc) > 0.3) this.orient = sc > 0; }
      else if ((sc > 1.5 && !this.orient) || (sc < -1.5 && this.orient)) {
        if (++this.orientVotes >= 3) { this.orient = !this.orient; this.orientVotes = 0; }
      } else this.orientVotes = 0;
      this.whiteBottom = this.orient === null ? true : this.orient;
    }
    return before !== this.whiteBottom && this.history.length > 0;
  }

  // fast: only commit if a continuation was found; returns null otherwise
  processScan(cells, pairSq, lp, fast = false) {
    if (!pairSq) {
      this.lastDecision = this.hoverSeen ? 'discarded: piece picked up (last move still highlighted)' : 'discarded: no last-move highlight found';
      this.hoverSeen = false; return false;
    }
    const pairKey = pairSq.join('');
    if (pairKey === this.lastPairKey) { this.lastDecision = 'discarded: same highlight as before'; return false; }

    const score = (c) => { let s = 0; for (let i = 0; i < 64; i++) s += lp[i * NC + CI[c[i]]]; return s; };
    const pairSet = new Set(pairSq);
    const scanId = ++this.scanSeq;
    const fresh = [];

    // continuation beliefs from every belief in history. Squares the move doesn't
    // touch must match the scan; among moves with the same squares (promotions)
    // the best-scoring one wins. Only moves starting on a highlighted square are
    // generated, which keeps this fast.
    // the whole board must agree with the result of the move, including the
    // squares the move touched (so a lifted/hovered piece can't fake a move)
    // Squares the move touched must each agree (no confident contradiction);
    // untouched squares share a small budget for misreads (arrows, cursor...).
    const stillOk = (nc, before) => {
      let d = 0;
      for (let i = 0; i < 64; i++) {
        const di = lp[i * NC + CI[nc[i]]] - lp[i * NC + CI[cells[i]]];
        if (nc[i] !== before[i]) { if (di < -TOUCHED_NATS) return false; }
        else d += di;
      }
      return d >= -MATCH_NATS;
    };
    const pickFrom = (fen0) => {   // best legal move matching the pair from fen0
      const c = load(fen0); if (!c) return null;
      const before = cellsOf(fen0);
      let pick = null;
      for (const sq of pairSq) {
        let ms = [];
        try { ms = c.moves({ square: sq, verbose: true }); } catch { continue; }
        for (const m of ms) {
          if (!moveMatchesPair(m, pairSet)) continue;
          c.move(m); const fen = c.fen(); c.undo();
          const nc = cellsOf(fen);
          if (!stillOk(nc, before)) continue;
          const sc = score(nc);
          if (!pick || sc > pick.sc) pick = { lan: m.lan, san: m.san, fen, sc };
        }
      }
      return pick;
    };
    const byFen = new Map();   // beliefs often share a position; work it out once
    for (const b of this.history) {
      if (!byFen.has(b.fen)) byFen.set(b.fen, pickFrom(b.fen));
      const pick = byFen.get(b.fen);
      if (pick) fresh.push({ id: ++beliefSeq, scanId, rootFen: b.rootFen, moves: [...b.moves, pick.lan], sans: [...b.sans, pick.san], fen: pick.fen, prevFen: b.fen, parentId: b.id });
    }
    // Gap recovery: if nothing continues, a position may have been missed in
    // between (fast moves, a scan without a readable highlight). Try one unseen
    // move by the other side first, from the latest best belief only.
    if (!fresh.length && this.best) {
      const b = this.best, c = load(b.fen);
      let opts = [];
      try { opts = c ? c.moves({ verbose: true }) : []; } catch { opts = []; }
      const found = [];
      for (const m1 of opts) {
        c.move(m1); const mid = c.fen(); c.undo();
        const pick = pickFrom(mid);
        if (pick) found.push({ m1, pick });
      }
      found.sort((x, y) => y.pick.sc - x.pick.sc);
      // only when the missed move is clear (a different reading isn't nearly as good)
      if (found.length && (found.length === 1 || found[0].pick.sc - found[1].pick.sc > 2 || found[0].pick.fen === found[1].pick.fen)) {
        const { m1, pick } = found[0];
        const midFen = (() => { c.move(m1); const f = c.fen(); c.undo(); return f; })();
        const mid = { id: ++beliefSeq, scanId, rootFen: b.rootFen, moves: [...b.moves, m1.lan], sans: [...b.sans, m1.san], fen: midFen, prevFen: b.fen, parentId: b.id };
        fresh.push({ id: ++beliefSeq, scanId, rootFen: b.rootFen, moves: [...mid.moves, pick.lan], sans: [...mid.sans, pick.san], fen: pick.fen, prevFen: midFen, parentId: mid.id });
      }
    }
    if (fast && !fresh.length) { --this.scanSeq; return null; }

    // default belief: just this scan
    const def = this.defaultBelief(cells, pairSq);
    if (def) fresh.push({ id: ++beliefSeq, scanId, rootFen: def, moves: [], sans: [], fen: def });

    if (!fresh.length) { this.lastDecision = 'discarded: illegal position or highlighted move'; return false; }

    this.history.push(...fresh);
    if (this.history.length > MAX_BELIEFS) this.history.splice(0, this.history.length - MAX_BELIEFS);
    this.lastPairKey = pairKey; this.lastPair = pairSq; this.latestScan = scanId;

    let best = null;
    for (const b of fresh) if (!best || b.moves.length > best.moves.length) best = b;
    const changed = !this.best || best.fen !== this.best.fen || best.moves.length !== this.best.moves.length;
    this.best = best;
    this.lastDecision = `accepted: ${fresh.length} belief${fresh.length > 1 ? 's' : ''}`;
    return changed;
  }

  // the scanned position with no history; null if it can't be a real position
  // The scanned position with no history. Thrown out (null) unless the position
  // is legal AND the highlighted move is a legal move that produces it: the
  // position before the move is rebuilt (trying every possible captured piece,
  // promotion, castling and en passant) and chess.js must find that move there.
  defaultBelief(cells, pairSq) {
    if (sanity(cells)) return null;
    const res = explainMove(cells, pairSq.map(sqIndex));
    if (!res) return null;
    const fen = res.split(' ').slice(0, 4).join(' ') + ' 0 1';
    return legalFor(fen) ? fen : null;
  }

  // engine command for the best belief: root position + the moves that led here
  positionCommand() {
    const b = this.best; if (!b) return null;
    return `position fen ${b.rootFen}` + (b.moves.length ? ' moves ' + b.moves.join(' ') : '');
  }
}

export function pvToSan(fen, pv, max = 10) {
  const c = load(fen); if (!c) return [];
  const out = [];
  for (const u of pv.slice(0, max)) {
    try { out.push(c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined }).san); }
    catch { break; }
  }
  return out;
}
