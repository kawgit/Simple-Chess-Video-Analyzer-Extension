// Refines a rough, user-drawn board box to the actual 8x8 grid by finding the
// spacing/offset whose 9 grid lines best line up with strong edges.
(function (root) {
  'use strict';

  // rgba: Uint8ClampedArray (W*H*4). box: {x,y,w,h} rough board in these pixels.
  function snapBoard(rgba, W, H, box) {
    const g = new Float32Array(W * H);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
    const fx = fit1d(g, W, H, box.x, box.w, box.y, box.h, true);
    const fy = fit1d(g, W, H, box.y, box.h, box.x, box.w, false);
    return { x: fx.start, y: fy.start, w: fx.len, h: fy.len, score: Math.min(fx.score, fy.score) };
  }

  // Profile of |gradient| across the axis, accumulated over the other axis.
  function fit1d(g, W, H, start, len, oStart, oLen, horizontal) {
    const N = horizontal ? W : H;
    const prof = new Float32Array(N);
    const o0 = Math.max(1, Math.floor(oStart)), o1 = Math.min((horizontal ? H : W) - 2, Math.ceil(oStart + oLen));
    for (let a = 1; a < N - 1; a++) {
      let s = 0;
      for (let o = o0; o <= o1; o++) {
        s += horizontal ? Math.abs(g[o * W + a + 1] - g[o * W + a - 1]) : Math.abs(g[(a + 1) * W + o] - g[(a - 1) * W + o]);
      }
      prof[a] = s;
    }
    // high-pass: subtract a local mean so busy regions don't dominate
    const sq0 = len / 8, win = Math.max(2, Math.round(sq0 / 3));
    const hp = new Float32Array(N), cs = new Float64Array(N + 1);
    for (let a = 0; a < N; a++) cs[a + 1] = cs[a] + prof[a];
    for (let a = 0; a < N; a++) {
      const l = Math.max(0, a - win), r = Math.min(N, a + win + 1);
      hp[a] = Math.max(0, prof[a] - (cs[r] - cs[l]) / (r - l));
    }
    // take max over a +-1px window so small sub-pixel misplacements still score
    const at = (x) => {
      const i = Math.round(x);
      if (i < 1 || i >= N - 1) return 0;
      return Math.max(hp[i - 1] * 0.7, hp[i], hp[i + 1] * 0.7);
    };
    let best = { score: -1, start, len };
    const sqStep = Math.max(0.1, sq0 / 200);
    for (let sq = sq0 * 0.9; sq <= sq0 * 1.1; sq += sqStep) {
      for (let x0 = start - 0.6 * sq0; x0 <= start + 0.6 * sq0; x0 += 0.5) {
        let s = 0;
        for (let k = 1; k <= 7; k++) s += at(x0 + k * sq);
        s += 0.5 * (at(x0) + at(x0 + 8 * sq));
        if (s > best.score) best = { score: s, start: x0, len: 8 * sq };
      }
    }
    // relative strength vs. mean profile, used to judge confidence
    let mean = 0; for (let a = 0; a < N; a++) mean += hp[a]; mean /= N;
    best.score = best.score / (8 * (mean + 1e-6));
    return best;
  }

  root.ChessSnap = { snapBoard };
  if (typeof module !== 'undefined') module.exports = root.ChessSnap;
})(typeof self !== 'undefined' ? self : globalThis);
