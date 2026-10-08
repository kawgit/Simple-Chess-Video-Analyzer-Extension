# Continue training from the saved checkpoint with a decaying learning rate.
import sys, time, numpy as np, torch, torch.nn.functional as F
from train import Net, load, to_t, evaluate, board_acc, export_onnx
torch.set_num_threads(2)
X, Y = load(['data/full_1.npz', 'data/full_2.npz'])
n = len(X) // 64 // 20 * 64; Xt, Yt = X[-n:], Y[-n:]; X, Y = X[:-n], Y[:-n]
net = Net(); net.load_state_dict(torch.load('final.pt'))
epochs = int(sys.argv[1]); bs = 256; steps = epochs * (len(X) // bs)
opt = torch.optim.AdamW(net.parameters(), 1e-3, weight_decay=1e-4)
sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, steps)
rng = np.random.default_rng(1)
for ep in range(epochs):
    net.train(); perm = rng.permutation(len(X)); t0 = time.time()
    for i in range(0, len(perm) - bs + 1, bs):
        idx = perm[i:i + bs]; xb = to_t(X[idx]); yb = torch.from_numpy(Y[idx])
        if rng.random() < 0.5: xb = xb.flip(3)
        sx, sy = rng.integers(-2, 3, 2); xb = torch.roll(xb, (int(sy), int(sx)), (2, 3))
        loss = F.cross_entropy(net(xb), yb, label_smoothing=0.05)
        opt.zero_grad(); loss.backward(); opt.step(); sched.step()
    acc, _ = evaluate(net, Xt, Yt)
    torch.save(net.state_dict(), 'final_ft.pt')
    print(f'ft ep {ep} sq_acc {acc:.5f} board_acc {board_acc(net, Xt, Yt):.4f} {time.time() - t0:.0f}s', flush=True)
export_onnx(net, 'final_ft.onnx'); print('exported', flush=True)
