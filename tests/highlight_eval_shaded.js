const H = require(process.argv[2] || '../extension/highlights.js'); const fs = require('fs');
const meta = JSON.parse(fs.readFileSync('/home/claude/e2e/hl_eval.json')); const buf = fs.readFileSync('/home/claude/e2e/hl_eval.rgba');
const N = 256 * 256 * 4; const byKind = {};
meta.forEach((m, i) => {
  const px = new Uint8ClampedArray(buf.buffer.slice(buf.byteOffset + i * N, buf.byteOffset + (i + 1) * N)); for (let y = 0; y < 256; y++) { const f = y < 70 ? 1 - 0.5 * (70 - y) / 70 : y > 186 ? 1 - 0.55 * (y - 186) / 70 : 1; for (let x = 0; x < 256; x++) { const p = (y * 256 + x) * 4; px[p] *= f; px[p + 1] *= f; px[p + 2] *= f; } }
  const r = H.findLastMove(px, m.cells);
  const want = m.truth ? [...m.truth].sort((a, b) => a - b).join() : null, got = r.pair ? [...r.pair].sort((a, b) => a - b).join() : null;
  const k = byKind[m.kind] || (byKind[m.kind] = { ok: 0, wrong: 0, miss: 0, n: 0 });
  k.n++; if (got === want) k.ok++; else if (got === null) k.miss++; else k.wrong++;
});
console.log(JSON.stringify(byKind));
