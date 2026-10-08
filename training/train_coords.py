"""Tiny CNN: 24x24 RGB patch -> {none, 1-8, a-h}. Exports ONNX with softmax,
input = raw RGB 0..255 floats [N,24,24,3]."""
import sys, time, numpy as np, torch, torch.nn as nn, torch.nn.functional as F
torch.set_num_threads(2)

class GlyphNet(nn.Module):
    def __init__(self):
        super().__init__()
        self.c1 = nn.Conv2d(3, 32, 3, padding=1); self.b1 = nn.BatchNorm2d(32)
        self.c2 = nn.Conv2d(32, 48, 3, padding=1); self.b2 = nn.BatchNorm2d(48)
        self.c3 = nn.Conv2d(48, 64, 3, padding=1); self.b3 = nn.BatchNorm2d(64)
        self.c4 = nn.Conv2d(64, 96, 3, padding=1); self.b4 = nn.BatchNorm2d(96)
        self.fc1 = nn.Linear(96 * 3 * 3, 128); self.fc2 = nn.Linear(128, 17); self.drop = nn.Dropout(0.3)
    def forward(self, x):
        x = F.relu(self.b1(self.c1(x)))
        x = F.max_pool2d(F.relu(self.b2(self.c2(x))), 2)      # 12
        x = F.max_pool2d(F.relu(self.b3(self.c3(x))), 2)      # 6
        x = F.max_pool2d(F.relu(self.b4(self.c4(x))), 2)      # 3
        x = self.drop(F.relu(self.fc1(x.flatten(1))))
        return self.fc2(x)

def prep(x):  # uint8 NHWC -> normalised NCHW; per-patch contrast normalisation helps faint labels
    t = torch.from_numpy(x).float().permute(0, 3, 1, 2)
    m = t.mean(dim=(1, 2, 3), keepdim=True); s = t.std(dim=(1, 2, 3), keepdim=True) + 8.0
    return (t - m) / s

class Deploy(nn.Module):
    def __init__(self, net): super().__init__(); self.net = net
    def forward(self, x):
        t = x.permute(0, 3, 1, 2)
        m = t.mean(dim=(1, 2, 3), keepdim=True); s = t.std(dim=(1, 2, 3), keepdim=True) + 8.0
        return F.softmax(self.net((t - m) / s), dim=1)

if __name__ == '__main__':
    paths, epochs, out = sys.argv[1].split(','), int(sys.argv[2]), sys.argv[3]
    X = np.concatenate([np.load(p)['X'] for p in paths]); Y = np.concatenate([np.load(p)['Y'] for p in paths])
    n = len(X) // 20; Xt, Yt, X, Y = X[:n], Y[:n], X[n:], Y[n:]
    print('train', X.shape, np.bincount(Y, minlength=17), flush=True)
    net = GlyphNet(); bs = 256; steps = epochs * (len(X) // bs)
    opt = torch.optim.AdamW(net.parameters(), 2e-3, weight_decay=1e-4)
    sch = torch.optim.lr_scheduler.OneCycleLR(opt, 3e-3, total_steps=steps, pct_start=0.15)
    rng = np.random.default_rng(0)
    for ep in range(epochs):
        net.train(); perm = rng.permutation(len(X)); t0 = time.time()
        for i in range(0, len(perm) - bs + 1, bs):
            idx = perm[i:i + bs]; xb = prep(X[idx]); yb = torch.from_numpy(Y[idx])
            loss = F.cross_entropy(net(xb), yb, label_smoothing=0.05)
            opt.zero_grad(); loss.backward(); opt.step(); sch.step()
        net.eval(); correct = 0; conf = np.zeros((17, 17), int)
        with torch.no_grad():
            for i in range(0, len(Xt), 2048):
                p = net(prep(Xt[i:i + 2048])).argmax(1).numpy(); np.add.at(conf, (Yt[i:i + 2048], p), 1)
        acc = np.trace(conf) / conf.sum()
        glyph = conf[1:, 1:].trace() / max(1, conf[1:].sum())
        fp = conf[0, 1:].sum() / max(1, conf[0].sum())
        print(f'ep {ep} acc {acc:.4f} glyph-acc {glyph:.4f} none->glyph {fp:.4f} {time.time() - t0:.0f}s', flush=True)
        torch.save(net.state_dict(), out + '.pt')
    net.eval()
    torch.onnx.export(Deploy(net), torch.zeros(160, 24, 24, 3), out + '.onnx', input_names=['x'], output_names=['p'],
                      dynamic_axes={'x': {0: 'n'}, 'p': {0: 'n'}}, opset_version=13, dynamo=False)
    print('exported', flush=True)
