// Board -> per-square class probabilities.
// Only squares whose pixels changed since the last frame are re-classified,
// so a static video costs almost nothing. Inference is pluggable: the worker
// uses onnxruntime-web (WASM SIMD); tests can plug in anything else.
(function (root) {
  'use strict';
  const CLASSES = ['.', 'K', 'Q', 'R', 'B', 'N', 'P', 'k', 'q', 'r', 'b', 'n', 'p'];
  const S = 32, BW = S * 8, NC = CLASSES.length;

  // 4x4 block-mean signature per square
  function signature(px, r, f) {
    const B = S / 4, sig = new Float32Array(48);
    for (let by = 0; by < 4; by++) for (let bx = 0; bx < 4; bx++) {
      let s0 = 0, s1 = 0, s2 = 0;
      for (let y = 0; y < B; y++) {
        let pi = ((r * S + by * B + y) * BW + f * S + bx * B) * 4;
        for (let x = 0; x < B; x++, pi += 4) { s0 += px[pi]; s1 += px[pi + 1]; s2 += px[pi + 2]; }
      }
      const k = (by * 4 + bx) * 3, n = B * B;
      sig[k] = s0 / n; sig[k + 1] = s1 / n; sig[k + 2] = s2 / n;
    }
    return sig;
  }

  class Recognizer {
    // infer(Float32Array [n*32*32*3] raw RGB 0..255, n) -> Promise<Float32Array [n*13] probabilities>
    constructor(infer) { this.infer = infer; this.reset(); }
    reset() { this.sig = new Array(64).fill(null); this.probs = new Array(64).fill(null); this.lo = 0; this.hi = 255; }

    // Video levels: some streams/reaction videos are washed out (black pieces
    // come through as mid-grey and get read as white). Stretch the board's
    // brightness range (1st..99.5th percentile) to 0..255 before classifying.
    // Only re-tuned when the range moves noticeably; then every square is redone.
    levels(px) {
      const h = new Uint32Array(256); let n = 0;
      for (let i = 0; i < px.length; i += 8) { h[(px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8]++; n++; }
      let lo = 0, hi = 255, acc = 0;
      for (let v = 0; v < 256; v++) { acc += h[v]; if (acc >= n * 0.01) { lo = v; break; } }
      acc = 0;
      for (let v = 255; v >= 0; v--) { acc += h[v]; if (acc >= n * 0.005) { hi = v; break; } }
      if (hi - lo < 120) lo = Math.max(0, hi - 120);
      if (Math.abs(lo - this.lo) > 6 || Math.abs(hi - this.hi) > 6) {
        this.lo = lo; this.hi = hi; this.sig.fill(null);
      }
    }

    async classifyBoard(px) {
      this.levels(px);
      const lo = this.lo, k = 255 / Math.max(1, this.hi - this.lo);
      const todo = [];
      const sigs = [];
      for (let i = 0; i < 64; i++) {
        const r = i >> 3, f = i & 7, s = signature(px, r, f), old = this.sig[i];
        sigs.push(s);
        let same = !!old && !!this.probs[i];
        if (same) for (let k = 0; k < 48; k++) if (Math.abs(s[k] - old[k]) > 3) { same = false; break; }
        if (!same) todo.push(i);
      }
      if (todo.length) {
        const x = new Float32Array(todo.length * S * S * 3);
        todo.forEach((i, n) => {
          const r = i >> 3, f = i & 7;
          let o = n * S * S * 3;
          for (let y = 0; y < S; y++) {
            let pi = ((r * S + y) * BW + f * S) * 4;
            for (let xx = 0; xx < S; xx++, pi += 4) {
              x[o++] = Math.min(255, Math.max(0, (px[pi] - lo) * k));
              x[o++] = Math.min(255, Math.max(0, (px[pi + 1] - lo) * k));
              x[o++] = Math.min(255, Math.max(0, (px[pi + 2] - lo) * k));
            }
          }
        });
        const p = await this.infer(x, todo.length);
        todo.forEach((i, n) => { this.probs[i] = p.slice(n * NC, (n + 1) * NC); this.sig[i] = sigs[i]; });
      }
      const probs = new Float32Array(64 * NC);
      for (let i = 0; i < 64; i++) probs.set(this.probs[i], i * NC);
      return { probs, computed: todo.length };
    }
  }

  root.ChessRecognizer = { Recognizer, CLASSES, signature };
  if (typeof module !== 'undefined') module.exports = root.ChessRecognizer;
})(typeof self !== 'undefined' ? self : globalThis);
