import json, sys, numpy as np, onnxruntime as ort
s = ort.InferenceSession(sys.argv[1]); TH = float(sys.argv[2]) if len(sys.argv) > 2 else 0.85
tot = ok = 0
for d in ('.', 'fp', 'g4'):
    for c in json.load(open(f'{d}/cases.json')):
        a = np.frombuffer(open(f"{d}/{c['name']}.rgba", 'rb').read(), np.uint8).reshape(576, 576, 4)[..., :3].astype(np.float32)
        if s.get_inputs()[0].shape[1] == 288: a = a.reshape(288, 2, 288, 2, 3).mean(axis=(1, 3))
        p = s.run(None, {'x': a[None]})[0][0]
        l = np.log((p[1] + 1e-6) / (p[2] + 1e-6)); got = None if p[0] >= 0.3 else 'white' if l > 1.0 else 'black' if l < -1.0 else None
        want = c['truth']
        good = (got is None) if want == 'any' else (got == want)
        tot += 1; ok += good
        if not good or d == '.': print('PASS' if good else 'FAIL', d, c['name'], want, got, np.round(p, 3))
print(f'{ok}/{tot}')
