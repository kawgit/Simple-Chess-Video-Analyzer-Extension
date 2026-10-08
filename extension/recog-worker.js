// Off the UI thread: square classifier (onnxruntime-web, WASM SIMD, 1 thread)
// + last-move highlight detector. One message in (board pixels), one scan out.
importScripts('recognizer.js', 'highlights.js', 'ort/ort.wasm.min.js');

ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = new URL('ort/', self.location.href).href;
const CLASSES = self.ChessRecognizer.CLASSES;

let rec = null, initError = null;
const ready = (async () => {
  try {
    const session = await ort.InferenceSession.create(new URL('model/model.onnx', self.location.href).href, { executionProviders: ['wasm'] });
    rec = new self.ChessRecognizer.Recognizer(async (x, n) => {
      const out = await session.run({ x: new ort.Tensor('float32', x, [n, 32, 32, 3]) });
      return out.p.data;
    });
  } catch (e) { initError = String(e && e.message || e); }
})();

onmessage = async (e) => {
  const m = e.data;
  await ready;
  if (initError) { postMessage({ type: 'error', error: initError, id: m.id }); return; }
  if (m.type === 'reset') { rec.reset(); return; }
  if (m.type === 'frame') {
    const t0 = performance.now();
    const px = new Uint8ClampedArray(m.buf);
    const res = await rec.classifyBoard(px);
    let cells = '';
    for (let i = 0; i < 64; i++) {
      let b = 0; for (let c = 1; c < 13; c++) if (res.probs[i * 13 + c] > res.probs[i * 13 + b]) b = c;
      cells += CLASSES[b];
    }
    const hl = self.ChessHighlights.findLastMove(px, cells);
    postMessage({ type: 'result', id: m.id, sent: m.sent, probs: res.probs, pair: hl.pair, tinted: hl.tinted, contrast: hl.contrast, spread: hl.spread, computed: res.computed, ms: performance.now() - t0 }, [res.probs.buffer]);
  }
};
