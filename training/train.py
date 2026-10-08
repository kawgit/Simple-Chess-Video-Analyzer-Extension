import sys, time, json, struct
import numpy as np, torch, torch.nn as nn, torch.nn.functional as F

torch.set_num_threads(2)

class Net(nn.Module):
    # conv -> BN -> ReLU blocks; BN is folded into conv weights at export.
    CH = [(3, 24), (24, 48), (48, 64), (64, 96)]
    POOL = [True, True, False, True]
    def __init__(self):
        super().__init__()
        self.convs = nn.ModuleList([nn.Conv2d(a, b, 3, padding=1, bias=False) for a, b in self.CH])
        self.bns = nn.ModuleList([nn.BatchNorm2d(b) for _, b in self.CH])
        self.fc1 = nn.Linear(96 * 4 * 4, 128)
        self.fc2 = nn.Linear(128, 13)
        self.drop = nn.Dropout(0.3)
    def forward(self, x):
        for c, b, p in zip(self.convs, self.bns, self.POOL):
            x = F.relu(b(c(x)))
            if p: x = F.max_pool2d(x, 2)
        x = x.permute(0, 2, 3, 1).reshape(x.shape[0], -1)  # HWC flatten (matches JS)
        x = self.drop(F.relu(self.fc1(x)))
        return self.fc2(x)

MEAN = 127.5; STD = 64.0

def load(paths):
    Xs, Ys = [], []
    for p in paths:
        d = np.load(p); Xs.append(d['X']); Ys.append(d['Y'])
    return np.concatenate(Xs), np.concatenate(Ys)

def to_t(xb):
    return (torch.from_numpy(xb).float().permute(0, 3, 1, 2) - MEAN) / STD

def evaluate(net, X, Y, bs=2048):
    net.eval(); correct = 0; conf = np.zeros((13, 13), np.int64)
    with torch.no_grad():
        for i in range(0, len(X), bs):
            p = net(to_t(X[i:i + bs])).argmax(1).numpy()
            np.add.at(conf, (Y[i:i + bs], p), 1)
    acc = np.trace(conf) / conf.sum()
    board_ok = (conf.sum() and None)
    return acc, conf

def board_acc(net, X, Y, bs=64 * 32):
    net.eval(); ok = 0; n = 0
    with torch.no_grad():
        for i in range(0, len(X), bs):
            p = net(to_t(X[i:i + bs])).argmax(1).numpy()
            y = Y[i:i + bs]
            ok += (p.reshape(-1, 64) == y.reshape(-1, 64)).all(1).sum(); n += len(y) // 64
    return ok / n

def export(net, path):
    """Fold BN and write a small binary + JSON header for the JS runtime."""
    net.eval(); layers = []; blobs = []
    for c, b in zip(net.convs, net.bns):
        w = c.weight.detach()  # out,in,kh,kw
        scale = b.weight / torch.sqrt(b.running_var + b.eps)
        wf = (w * scale[:, None, None, None]).detach()
        bias = (b.bias - b.running_mean * scale)
        wf = wf.permute(0, 2, 3, 1).contiguous()  # out,kh,kw,in
        blobs += [wf.numpy().astype('<f4').ravel(), bias.detach().numpy().astype('<f4')]
        layers.append({'type': 'conv', 'in': w.shape[1], 'out': w.shape[0]})
    for fc in (net.fc1, net.fc2):
        blobs += [fc.weight.detach().numpy().astype('<f4').ravel(), fc.bias.detach().numpy().astype('<f4')]
        layers.append({'type': 'fc', 'in': fc.in_features, 'out': fc.out_features})
    data = np.concatenate(blobs)
    meta = {'layers': layers, 'pool': Net.POOL, 'mean': MEAN, 'std': STD, 'size': 32,
            'classes': ['.', 'K', 'Q', 'R', 'B', 'N', 'P', 'k', 'q', 'r', 'b', 'n', 'p'], 'floats': int(data.size)}
    with open(path, 'wb') as f:
        hdr = json.dumps(meta).encode()
        f.write(struct.pack('<I', len(hdr))); f.write(hdr)
        f.write(b'\0' * ((4 - (4 + len(hdr)) % 4) % 4))
        f.write(data.tobytes())

class Deploy(nn.Module):
    """Raw RGB uint8-range floats [N,32,32,3] -> class probabilities [N,13]."""
    def __init__(self, net):
        super().__init__(); self.net = net
    def forward(self, x):
        x = (x.permute(0, 3, 1, 2) - MEAN) / STD
        return F.softmax(self.net(x), dim=1)

def export_onnx(net, path):
    net.eval()
    d = Deploy(net)
    torch.onnx.export(d, torch.zeros(64, 32, 32, 3), path, input_names=['x'], output_names=['p'],
                      dynamic_axes={'x': {0: 'n'}, 'p': {0: 'n'}}, opset_version=13, dynamo=False)


if __name__ == '__main__':
    train_paths = sys.argv[1].split(',')
    test_paths = sys.argv[2].split(',') if sys.argv[2] != '-' else []
    epochs = int(sys.argv[3]); out = sys.argv[4]
    X, Y = load(train_paths)
    print('train', X.shape, np.bincount(Y, minlength=13), flush=True)
    if test_paths: Xt, Yt = load(test_paths)
    else:
        n = len(X) // 64 // 20 * 64; Xt, Yt = X[-n:], Y[-n:]; X, Y = X[:-n], Y[:-n]
    net = Net()
    opt = torch.optim.AdamW(net.parameters(), 2e-3, weight_decay=1e-4)
    bs = 256; steps = epochs * (len(X) // bs)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, 3e-3, total_steps=steps, pct_start=0.15)
    rng = np.random.default_rng(0); step = 0
    for ep in range(epochs):
        net.train(); perm = rng.permutation(len(X)); t0 = time.time(); tl = 0
        for i in range(0, len(perm) - bs + 1, bs):
            idx = perm[i:i + bs]; xb = to_t(X[idx]); yb = torch.from_numpy(Y[idx])
            if rng.random() < 0.5: xb = xb.flip(3)
            # small random translation (+-2px) via roll
            sx, sy = rng.integers(-2, 3, 2)
            xb = torch.roll(xb, (int(sy), int(sx)), (2, 3))
            loss = F.cross_entropy(net(xb), yb, label_smoothing=0.05)
            opt.zero_grad(); loss.backward(); opt.step(); sched.step(); step += 1
            tl += loss.item()
        acc, conf = evaluate(net, Xt, Yt)
        torch.save(net.state_dict(), out + '.pt')
        print(f'ep {ep} loss {tl / (len(perm) // bs):.4f} sq_acc {acc:.5f} board_acc {board_acc(net, Xt, Yt):.4f} {time.time() - t0:.0f}s', flush=True)
    torch.save(net.state_dict(), out + '.pt')
    export_onnx(net, out + '.onnx')
    np.set_printoptions(linewidth=200)
    print(conf)
