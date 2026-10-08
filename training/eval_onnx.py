# Compare ONNX models on boards from given piece sets (same synthetic boards for each model).
import sys, random, numpy as np, onnxruntime as ort, gen
models = sys.argv[1].split(','); sets = sys.argv[2].split(','); n = int(sys.argv[3])
sess = {m: ort.InferenceSession(m) for m in models}
for s in sets:
    rng = random.Random(321); X = []; Y = []
    for _ in range(n):
        b, pos = gen.sample_board(rng, [s], gen.board_textures()); X.append(gen.squares(b)); Y.append(pos.reshape(-1))
    X = np.concatenate(X).astype(np.float32); Y = np.concatenate(Y)
    row = [f'{s:10s}']
    for m in models:
        p = sess[m].run(None, {'x': X})[0].argmax(1)
        row.append(f'{m.split("/")[-1]}: sq {np.mean(p == Y):.4f} board {np.mean((p == Y).reshape(-1, 64).all(1)):.3f}')
    print('  |  '.join(row), flush=True)
