// Finds the last-move highlight: the unique pair of squares whose background
// carries the same translucent overlay. Works on the 256x256 board crop.
//
// 1. Background colour of each square = per-channel median of a thin ring just
//    inside the square's edge (pieces, arrows, dots and coordinates mostly miss it).
// 2. Each square colour (light/dark) has a base colour = median over that colour.
// 3. Squares that deviate clearly from their base are "tinted".
// 4. Tinted squares are grouped by whether one overlay (alpha, colour) explains
//    both: same-colour squares must match; for a light/dark pair the colour
//    difference must equal (1 - alpha) x the base difference.
// 5. Groups of exactly two are candidates. A pair must look like a move (one
//    square empty, one occupied, or a castling pattern); if several remain we
//    prefer last-move-like hues (yellow/green), otherwise report nothing.
(function (root) {
  'use strict';
  const S = 32, BW = 256;

  function median(a) { const b = Array.from(a).sort((x, y) => x - y); return b[b.length >> 1]; }
  // median of 0..255 pixel values by counting (much faster than sorting; runs every frame)
  const HIST = new Uint32Array(256);
  function medianByte(a) {
    HIST.fill(0); for (let k = 0; k < a.length; k++) HIST[a[k]]++;
    const half = a.length >> 1; let acc = 0;
    for (let v = 0; v < 256; v++) { acc += HIST[v]; if (acc > half) return v; }
    return 255;
  }

  // Background colour of each square, sampled where the piece is unlikely to be:
  //  - empty square: per-channel median over the whole square (minus a 2px border);
  //    centre dots, arrows and coordinates are a minority of the pixels.
  //  - occupied square: pooled median of the two TOP corner patches (piece bases
  //    often reach the bottom corners, tops rarely reach the top corners).
  //  - unknown occupancy: medoid of the four corner patches.
  function patch(px, r0, c0, y0, y1, x0, x1, R, G, B) {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const p = ((r0 + y) * BW + c0 + x) * 4; R.push(px[p]); G.push(px[p + 1]); B.push(px[p + 2]);
    }
  }
  function squareBackgrounds(px, cells) {
    const bgs = [];
    for (let i = 0; i < 64; i++) {
      const r0 = (i >> 3) * S, c0 = (i & 7) * S;
      if (cells && cells[i] === '.') {
        const R = [], G = [], B = []; patch(px, r0, c0, 2, S - 2, 2, S - 2, R, G, B);
        bgs.push([medianByte(R), medianByte(G), medianByte(B)]); continue;
      }
      if (cells) {
        const R = [], G = [], B = [];
        patch(px, r0, c0, 1, 7, 1, 7, R, G, B); patch(px, r0, c0, 1, 7, S - 7, S - 1, R, G, B);
        bgs.push([medianByte(R), medianByte(G), medianByte(B)]); continue;
      }
      const corners = [];
      for (const [y0, x0] of [[1, 1], [1, S - 7], [S - 7, 1], [S - 7, S - 7]]) {
        const R = [], G = [], B = []; patch(px, r0, c0, y0, y0 + 6, x0, x0 + 6, R, G, B);
        corners.push([medianByte(R), medianByte(G), medianByte(B)]);
      }
      let best = 0, bestD = Infinity;
      corners.forEach((c, k) => {
        const d = corners.reduce((s, o) => s + Math.hypot(c[0] - o[0], c[1] - o[1], c[2] - o[2]), 0);
        if (d < bestD) { bestD = d; best = k; }
      });
      bgs.push(corners[best]);
    }
    return bgs;
  }

  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const norm = (a) => Math.hypot(a[0], a[1], a[2]);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  // overlay colour H implied by bg = (1-a)*base + a*H for a given alpha
  function hueOf(rgb) {
    const [r, g, b] = rgb.map((v) => Math.max(0, Math.min(255, v)) / 255);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (d < 1e-6) return { h: 0, s: 0 };
    let h;
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    return { h: (h * 60 + 360) % 360, s: d / (mx || 1) };
  }

  // cells: optional 64-char string (image order) to judge move plausibility
  // Undo smooth brightness changes across the board: video-player gradients
  // (YouTube's title and control bars), vignettes, dark caption bands. Each
  // square's brightness relative to its colour's base is factored into a row
  // term times a column term (medians, so the two highlighted squares don't
  // move them) and divided out. A highlight changes a square's colour, which
  // this leaves alone.
  function unshade(bgs, par) {
    const baseOf = (b) => [0, 1].map((p) => [0, 1, 2].map((c) => median(b.filter((_, i) => par(i) === p).map((v) => v[c]))));
    const base = baseOf(bgs);
    const sc = bgs.map((v, i) => { const b = base[par(i)]; return dot(v, b) / Math.max(1, dot(b, b)); });
    const row = [], col = [];
    for (let r = 0; r < 8; r++) row.push(median(sc.slice(r * 8, r * 8 + 8)));
    for (let c = 0; c < 8; c++) col.push(median([0, 1, 2, 3, 4, 5, 6, 7].map((r) => sc[r * 8 + c] / Math.max(0.05, row[r]))));
    const shade = (i) => Math.max(0.15, row[i >> 3] * col[i & 7]);
    if (sc.every((_, i) => Math.abs(shade(i) - 1) < 0.04)) return bgs;   // evenly lit: leave as is
    const out = bgs.map((v, i) => v.map((x) => x / shade(i))); out.shaded = true; return out;
  }

  function findLastMove(px, cells) {
    const par = (i) => ((i >> 3) + (i & 7)) & 1;
    const raw = squareBackgrounds(px, cells);
    const bgs = unshade(raw, par);
    const base = [0, 1].map((p) => {
      const g = bgs.filter((_, i) => par(i) === p);
      return [0, 1, 2].map((c) => median(g.map((v) => v[c])));
    });
    const spread = [0, 1].map((p) => median(bgs.filter((_, i) => par(i) === p).map((v) => norm(sub(v, base[p])))));
    const baseDiff = norm(sub(base[0], base[1]));
    const dev = bgs.map((v, i) => norm(sub(v, base[par(i)])));
    const thr = [0, 1].map((p) => Math.max(16, 4 * spread[p], 0.12 * baseDiff));
    const tinted = [];
    for (let i = 0; i < 64; i++) if (dev[i] > thr[par(i)]) tinted.push(i);
    if (tinted.length < 2 || tinted.length > 16) {
      const pair = findOutlinePair(px, cells, raw, par);
      return { pair, tinted: pair ? pair.slice() : tinted, groups: [], dev, thr, bgs, base, contrast: baseDiff, spread: Math.max(...spread) };
    }

    const tol = (i, j) => 12 + 0.1 * Math.max(dev[i], dev[j]);
    function same(i, j, loose = 1) {
      if (par(i) === par(j)) return norm(sub(bgs[i], bgs[j])) < tol(i, j) * loose;
      const [a, b] = par(i) === 0 ? [i, j] : [j, i];
      const db = sub(base[0], base[1]), dg = sub(bgs[a], bgs[b]);
      const k = dot(dg, db) / Math.max(1, dot(db, db));        // = 1 - alpha
      if (k < 0.05 || k > 0.95) return false;
      const res = norm(sub(dg, db.map((v) => v * k)));
      if (res > tol(i, j) * loose) return false;
      // both squares must imply (about) the same overlay colour
      const a1 = 1 - k;
      const H1 = bgs[a].map((v, c) => (v - k * base[0][c]) / a1), H2 = bgs[b].map((v, c) => (v - k * base[1][c]) / a1);
      return norm(sub(H1, H2)) < 50 * loose / a1;
    }
    // connected components over "same overlay"
    const comp = new Map(); let nc = 0;
    for (const i of tinted) {
      if (comp.has(i)) continue;
      const stack = [i]; comp.set(i, nc);
      while (stack.length) {
        const u = stack.pop();
        for (const v of tinted) if (!comp.has(v) && same(u, v)) { comp.set(v, nc); stack.push(v); }
      }
      nc++;
    }
    const groups = Array.from({ length: nc }, () => []);
    for (const [i, c] of comp) groups[c].push(i);
    let cands = groups.filter((g) => g.length === 2).map((g) => g.sort((a, b) => a - b));
    // a third square that almost matches means we can't be sure (e.g. chess.com drag)
    cands = cands.filter(([a, b]) => !tinted.some((t) => t !== a && t !== b && (same(a, t, 1.3) || same(b, t, 1.3))));
    if (cells) cands = cands.filter(([a, b]) => movePlausible(cells, a, b));
    // on an unevenly lit board only trust typical last-move colours (yellow/green)
    const lmHue = (g) => g.every((i) => { const t = sub(bgs[i], base[par(i)]); return t[1] - t[2] > 20 && t[1] > t[0] - 25; });
    if (bgs.shaded) cands = cands.filter(lmHue);
    if (cands.length > 1) {
      // prefer typical last-move hues (yellow .. green) over red/blue marks
      // yellowness of the tint: last-move overlays push red/green up relative to blue
      const scored = cands.map((g) => {
        const lm = g.every((i) => { const t = sub(bgs[i], base[par(i)]); return t[1] - t[2] > 20 && t[1] > t[0] - 25; });
        return { g, lm };
      });
      const lmOnes = scored.filter((x) => x.lm);
      cands = lmOnes.length === 1 ? [lmOnes[0].g] : [];
    }
    // Some sites tint the from- and to-squares differently. If no same-tint
    // pair turned up but only a few squares are tinted, accept the one pair of
    // them where exactly one square holds a piece (the tracker still requires
    // a legal move).
    if (!cands.length && cells && !groups.some((g) => g.length === 2) && tinted.length >= 2 && tinted.length <= 3) {
      const alt = [];
      for (let x = 0; x < tinted.length; x++) for (let y = x + 1; y < tinted.length; y++) {
        const a = tinted[x], b = tinted[y];
        if ((cells[a] === '.') !== (cells[b] === '.')) alt.push([a, b].sort((u, v) => u - v));
      }
      if (alt.length === 1) cands = alt;
    }
    let pair = cands.length === 1 ? cands[0] : null;
    // outline-style marks: used when no filled pair is found, or when the filled
    // "pair" includes an outlined square (its edge colour leaked into the fill test)
    // (only looked for when needed: no filled pair, or a filled pair whose
    // squares carry an outline - it costs a few ms)
    const outline = (!pair && cands.length === 0) || (pair && pair.some((i) => outlinedSquare(px, i, raw, par))) ? findOutlinePair(px, cells, raw, par) : null;
    if (outline && (!pair && cands.length === 0 || pair && pair.some((i) => outline.includes(i)))) {
      pair = outline;
      for (const i of pair) if (!tinted.includes(i)) tinted.push(i);
    }
    return { pair, tinted, groups, dev, thr, bgs, base, contrast: baseDiff, spread: Math.max(...spread) };
  }

  // Outline-style last move (some chess.com themes/streams draw a coloured
  // border around the two squares instead of filling them). For each square
  // and each side, take the colour of a thin band just inside the edge (the
  // depth that differs most from the square's background). A square is
  // outlined when at least three of its four sides agree on one colour that is
  // neither its own background nor the neighbouring squares' colour (one side
  // may be hidden by the piece). Two outlined squares of the same colour that
  // look like a move are the last move.
  function ringColours(px, i, bg) {
    const r0 = (i >> 3) * S, c0 = (i & 7) * S, out = [];
    for (let side = 0; side < 4; side++) {
      let best = -1, bestC = null;
      for (let d = 0; d < 4; d++) {
        const R = [], G = [], B = [];
        for (let t = 6; t < S - 6; t++) {
          const y = side === 0 ? d : side === 1 ? S - 1 - d : t, x = side === 2 ? d : side === 3 ? S - 1 - d : t;
          const p = ((r0 + y) * BW + c0 + x) * 4; R.push(px[p]); G.push(px[p + 1]); B.push(px[p + 2]);
        }
        const c = [medianByte(R), medianByte(G), medianByte(B)], dv = norm(sub(c, bg));
        if (dv > best) { best = dv; bestC = c; }
      }
      out.push(bestC);
    }
    return out;
  }
  // colour difference ignoring overall brightness
  function chromaDist(a, b) {
    const ma = (a[0] + a[1] + a[2]) / 3, mb = (b[0] + b[1] + b[2]) / 3;
    return norm(sub(a.map((v) => v - ma), b.map((v) => v - mb)));
  }
  function outlinedSquare(px, i, bgs, par) {
    const bg = bgs[i], cols = ringColours(px, i, bg);
    const good = cols.filter((c) => Math.max(...c) - Math.min(...c) >= 25 && norm(sub(c, bg)) >= 45 && chromaDist(c, bg) >= 30);
    return good.some((c) => good.filter((o) => norm(sub(o, c)) < 40).length >= 2);
  }
  function findOutlinePair(px, cells, bgs, par) {
    const base = [0, 1].map((p) => [0, 1, 2].map((c) => median(bgs.filter((_, i) => par(i) === p).map((v) => v[c]))));
    const cols = [], ok = [];
    for (let i = 0; i < 64; i++) {
      const bg = bgs[i], other = base[1 - par(i)];
      cols.push(ringColours(px, i, bg));
      // a side "counts" when its band has a colour of its own: not the board's
      // colours (bleed, piece shadows) and not grey (piece outlines)
      ok.push(cols[i].map((c) => chromaDist(c, bg) >= 30 && chromaDist(c, other) >= 30 && Math.max(...c) - Math.min(...c) >= 25 &&
        norm(sub(c, bg)) >= 45 && norm(sub(c, other)) >= 45 && norm(sub(c, base[par(i)])) >= 45));
    }
    const sidesLike = (i, c) => cols[i].filter((o, k) => ok[i][k] && norm(sub(o, c)) < 40).length;
    // strong marks: all four sides (an empty square) or three (a piece may hide one)
    const marks = [];
    for (let i = 0; i < 64; i++) {
      const occupied = !cells || cells[i] !== '.';
      for (let k = 0; k < 4; k++) {
        if (!ok[i][k]) continue;
        const c = cols[i][k], agree = cols[i].filter((o, kk) => ok[i][kk] && norm(sub(o, c)) < 35);
        if (agree.length >= (occupied ? 3 : 4)) { marks.push({ i, c: [0, 1, 2].map((ch) => median(agree.map((o) => o[ch]))) }); break; }
      }
    }
    if (!marks.length || marks.length > 4) return null;
    // partner: another strong mark of that colour, or an occupied square showing
    // that colour on at least two sides (a piece can cover the rest)
    const pairs = [];
    for (const m of marks) for (let j = 0; j < 64; j++) {
      if (j === m.i) continue;
      const strong = marks.some((o) => o.i === j && norm(sub(o.c, m.c)) < 45);
      const weak = (!cells || cells[j] !== '.') && sidesLike(j, m.c) >= 2;
      if (!strong && !weak) continue;
      const pr = [m.i, j].sort((x, y) => x - y);
      if (cells && !movePlausible(cells, pr[0], pr[1])) continue;
      if (!pairs.some((q) => q[0] === pr[0] && q[1] === pr[1])) pairs.push(pr);
    }
    return pairs.length === 1 ? pairs[0] : null;
  }

  // one end empty & the other occupied, or both empty in a castling pattern
  function movePlausible(cells, a, b) {
    const ea = cells[a] === '.', eb = cells[b] === '.';
    if (ea !== eb) return true;
    if (ea && eb) return (a >> 3) === (b >> 3) && ((a >> 3) === 0 || (a >> 3) === 7); // king+rook origin squares after castling
    // both occupied: castling shown as king square -> destination with rook beside
    return (a >> 3) === (b >> 3) && ((a >> 3) === 0 || (a >> 3) === 7) && (cells[a].toLowerCase() === 'k' || cells[b].toLowerCase() === 'k');
  }

  root.ChessHighlights = { findLastMove, squareBackgrounds };
  if (typeof module !== 'undefined') module.exports = root.ChessHighlights;
})(typeof self !== 'undefined' ? self : globalThis);
