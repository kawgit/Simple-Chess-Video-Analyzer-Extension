// Board orientation from the rank/file labels, in its own worker so it never
// holds up the square scans. One small network looks at the four edge strips
// of the board (labels inside the edge squares or just outside the board) and
// answers white-at-bottom / black-at-bottom / no readable labels. Optional: if
// it can't load, orientation falls back to move legality and piece placement.
importScripts('ort/ort.wasm.min.js');
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = new URL('ort/', self.location.href).href;

// Answer only when labels are clearly there (p(none) < 0.3) and one direction
// is clearly more likely (e^1 = 2.7x); otherwise the panel uses the fallback.
const MAX_NONE = 0.3, MIN_LOG_RATIO = 1.0;
let session = null;
const ready = ort.InferenceSession.create(new URL('model/orient.onnx', self.location.href).href, { executionProviders: ['wasm'] })
  .then((s) => { session = s; }, () => { session = null; });

let busy = false, pending = null;            // only the newest frame matters
onmessage = (e) => { if (e.data.type !== 'coordframe') return; pending = e.data; pump(); };

async function pump() {
  if (busy || !pending) return;
  busy = true;
  const m = pending; pending = null;
  try {
    await ready;
    if (session) {
      const px = new Uint8ClampedArray(m.buf), n = m.size * m.size;
      const x = new Float32Array(n * 3);
      for (let i = 0, j = 0; i < n; i++, j += 4) { x[i * 3] = px[j]; x[i * 3 + 1] = px[j + 1]; x[i * 3 + 2] = px[j + 2]; }
      const t0 = performance.now();
      const out = await session.run({ x: new ort.Tensor('float32', x, [1, m.size, m.size, 3]) });
      const p = out.p.data;
      const lr = Math.log((p[1] + 1e-6) / (p[2] + 1e-6));
      const orient = p[0] >= MAX_NONE ? null : lr > MIN_LOG_RATIO ? 'white' : lr < -MIN_LOG_RATIO ? 'black' : null;
      postMessage({ type: 'coords', orient, p: [p[0], p[1], p[2]], ms: performance.now() - t0 });
    }
  } catch (err) { /* skip this frame */ }
  busy = false; pump();
}
