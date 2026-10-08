// Board orientation from coordinate labels (1-8 / a-h).
// Patches: every corner of every edge square (labels drawn inside the board,
// as on chess.com / lichess) plus a cell just outside each edge square (labels
// drawn around the board). A "strip" is the same kind of patch for all 8
// squares along one edge; a strip reading 8..1 top-to-bottom (or a..h left-to-
// right) means white is at the bottom, and the reverse means black is.
(function (root) {
  'use strict';
  const P = 24, CORNER = 0.34, OUT = 0.5;
  const CHARS = '12345678abcdefgh';          // model class = 1 + index, 0 = none

  // bilinear resample of a w x h region of RGBA (stride W) into a P x P RGB float block
  function resample(px, W, H, x0, y0, w, h, out, o) {
    for (let y = 0; y < P; y++) for (let x = 0; x < P; x++) {
      let sx = x0 + (x + 0.5) * w / P - 0.5, sy = y0 + (y + 0.5) * h / P - 0.5;
      sx = Math.min(Math.max(sx, 0), W - 1.001); sy = Math.min(Math.max(sy, 0), H - 1.001);
      const ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy;
      const a = (iy * W + ix) * 4, b = a + 4, c = a + W * 4, d = c + 4;
      for (let k = 0; k < 3; k++) {
        out[o++] = (px[a + k] * (1 - fx) + px[b + k] * fx) * (1 - fy) + (px[c + k] * (1 - fx) + px[d + k] * fx) * fy;
      }
    }
  }

  // Returns { data: Float32Array(n*P*P*3), strips: [{axis:'v'|'h', idx:[patch indices, top->bottom / left->right]}] }
  function extractPatches(px, size, sq, margin) {
    const specs = [], strips = [];
    const cw = sq * CORNER, ow = sq * OUT;
    const add = (x, y, w) => { specs.push([x, y, w]); return specs.length - 1; };
    const corners = [[0, 0], [1, 0], [0, 1], [1, 1]];          // TL TR BL BR
    // vertical edges: left column (f=0) and right column (f=7)
    for (const f of [0, 7]) {
      for (const [cx, cy] of corners) {
        const idx = [];
        for (let r = 0; r < 8; r++) idx.push(add(margin + f * sq + cx * (sq - cw), margin + r * sq + cy * (sq - cw), cw));
        strips.push({ axis: 'v', idx });
      }
      const idx = [];
      const ox = f === 0 ? margin - ow : margin + 8 * sq;
      for (let r = 0; r < 8; r++) idx.push(add(ox, margin + r * sq + (sq - ow) / 2, ow));
      strips.push({ axis: 'v', idx });
    }
    // horizontal edges: top row (r=0) and bottom row (r=7)
    for (const r of [0, 7]) {
      for (const [cx, cy] of corners) {
        const idx = [];
        for (let f = 0; f < 8; f++) idx.push(add(margin + f * sq + cx * (sq - cw), margin + r * sq + cy * (sq - cw), cw));
        strips.push({ axis: 'h', idx });
      }
      const idx = [];
      const oy = r === 0 ? margin - ow : margin + 8 * sq;
      for (let f = 0; f < 8; f++) idx.push(add(margin + f * sq + (sq - ow) / 2, oy, ow));
      strips.push({ axis: 'h', idx });
    }
    const data = new Float32Array(specs.length * P * P * 3);
    specs.forEach(([x, y, w], n) => resample(px, size, size, x, y, w, w, data, n * P * P * 3));
    return { data, strips, n: specs.length };
  }

  // probs: Float32Array(n*17). Returns { orient: 'white'|'black'|null, llr, used }
  function scoreStrips(probs, strips) {
    const NC = 17, eps = 1e-3;
    let llr = 0, used = 0;
    for (const s of strips) {
      let hits = 0, l = 0;
      s.idx.forEach((pi, pos) => {
        const p = (c) => probs[pi * NC + c];
        // expected class if white is at the bottom, and if black is
        const cw = s.axis === 'v' ? 1 + (7 - pos) : 9 + pos;          // '8'..'1' top->bottom | 'a'..'h' left->right
        const cb = s.axis === 'v' ? 1 + pos : 9 + (7 - pos);          // '1'..'8'            | 'h'..'a'
        const pw = p(cw), pb = p(cb);
        if (Math.max(pw, pb) > 0.5) { hits++; l += Math.log((pw + eps) / (pb + eps)); }
      });
      // a real label strip shows several labels that agree on a direction
      if (hits >= 3 && Math.abs(l) > 2) { llr += l; used++; }
    }
    const orient = Math.abs(llr) > 4 ? (llr > 0 ? 'white' : 'black') : null;
    return { orient, llr, used };
  }

  root.ChessCoords = { extractPatches, scoreStrips, P, CHARS };
  if (typeof module !== 'undefined') module.exports = root.ChessCoords;
})(typeof self !== 'undefined' ? self : globalThis);
