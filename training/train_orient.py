"""Board orientation from the coordinate labels, end to end: four edge strips
(96 x 512 gray) -> shared small CNN -> per-square features -> 3-way softmax
{none, white at bottom, black at bottom}. ~80 MMAC per frame.
Exported ONNX takes the extension's 576x576 RGB coordinate frame directly."""
import os, sys, time, numpy as np, torch, torch.nn as nn, torch.nn.functional as F
torch.set_num_threads(2)
FR, SQ, MG = 576, 64, 32; D = MG + SQ

def cbr(i, o): return nn.Sequential(nn.Conv2d(i, o, 3, padding=1, bias=False), nn.BatchNorm2d(o), nn.ReLU(inplace=True))

class OrientNet(nn.Module):
    def __init__(self):
        super().__init__()
        self.trunk = nn.Sequential(nn.Conv2d(2, 16, 5, stride=2, padding=2, bias=False), nn.BatchNorm2d(16), nn.ReLU(inplace=True),
                                   nn.MaxPool2d(2), cbr(16, 24), nn.MaxPool2d(2),
                                   cbr(24, 32), nn.MaxPool2d(2), cbr(32, 48), nn.MaxPool2d(2))   # -> 48 x 3 x 16
        self.sq = nn.Sequential(nn.Conv1d(48, 64, 3, padding=1), nn.ReLU(inplace=True), nn.AvgPool1d(2))   # -> 64 x 8 (one per square)
        self.glyph = nn.Conv1d(64, 17, 1)                   # training aid: which label is on each edge square
        self.head = nn.Sequential(nn.Dropout(0.3), nn.Linear(4 * 64 * 8, 96), nn.ReLU(inplace=True), nn.Dropout(0.2), nn.Linear(96, 3))
    def forward(self, s, aux=False):            # s: [B, 4, 96, 512] float 0..255
        B = s.shape[0]
        x = s.reshape(B * 4, 1, D, 8 * SQ)
        m = x.mean(dim=(2, 3), keepdim=True); sd = x.std(dim=(2, 3), keepdim=True) + 8.0
        # second channel: local contrast (labels are small and often faint next to the pieces)
        lm = F.avg_pool2d(x, 11, stride=1, padding=5, count_include_pad=False)
        lv = F.avg_pool2d(x * x, 11, stride=1, padding=5, count_include_pad=False) - lm * lm
        loc = (x - lm) / (torch.sqrt(lv.clamp(min=0)) + 6.0)
        f = self.sq(self.trunk(torch.cat([(x - m) / sd, loc], 1)).mean(dim=2))   # [B*4, 64, 8]
        out = self.head(f.reshape(B, -1))
        if aux: return out, self.glyph(f).reshape(B, 4, 17, 8)
        return out

class Deploy(nn.Module):                         # [1, 576, 576, 3] RGB 0..255 -> [1, 3] probabilities
    def __init__(self, net): super().__init__(); self.net = net
    def forward(self, x):
        g = x[..., 0] * 0.299 + x[..., 1] * 0.587 + x[..., 2] * 0.114        # [1, 576, 576]
        top = g[:, 0:D, MG:FR - MG]
        bottom = torch.flip(g[:, FR - D:FR, MG:FR - MG], dims=[1, 2])
        left = torch.flip(g[:, MG:FR - MG, 0:D], dims=[1]).transpose(1, 2)    # rot90 clockwise
        right = torch.flip(g[:, MG:FR - MG, FR - D:FR], dims=[2]).transpose(1, 2)  # rot90 counter-clockwise
        s = torch.stack([top, bottom, left, right], dim=1)
        return F.softmax(self.net(s), dim=1)

def augment(xb, rng):
    x = xb.float()
    B = x.shape[0]
    a = torch.from_numpy(rng.uniform(0.7, 1.3, (B, 1, 1, 1)).astype(np.float32))
    b = torch.from_numpy(rng.uniform(-30, 30, (B, 1, 1, 1)).astype(np.float32))
    x = (x - 128) * a + 128 + b
    inv = torch.from_numpy((rng.random((B, 1, 1, 1)) < 0.2).astype(np.float32))
    x = x * (1 - inv) + (255 - x) * inv
    x = x + torch.randn_like(x) * float(rng.uniform(0, 4))
    return x.clamp(0, 255)

if __name__ == '__main__':
    parts, epochs, out = sys.argv[1].split(','), int(sys.argv[2]), sys.argv[3]
    class Parts:                                # several memory-mapped files indexed as one (doesn't fit in RAM)
        def __init__(self, arrs): self.a = arrs; self.off = np.cumsum([0] + [len(x) for x in arrs])
        def __len__(self): return int(self.off[-1])
        @property
        def shape(self): return (len(self),) + self.a[0].shape[1:]
        def __getitem__(self, idx):
            part = np.searchsorted(self.off, idx, side='right') - 1
            return np.stack([self.a[p][i - self.off[p]] for p, i in zip(part, idx)])
    X = Parts([np.load(p + '_X.npy', mmap_mode='r') for p in parts]); Y = np.concatenate([np.load(p + '_Y.npy') for p in parts])
    G = np.concatenate([np.load(p + '_G.npy') for p in parts]).astype(np.int64)
    Xv = np.load(os.path.dirname(parts[0]) + '/orient_val_X.npy'); Yv = np.load(os.path.dirname(parts[0]) + '/orient_val_Y.npy'); Gv = np.load(os.path.dirname(parts[0]) + '/orient_val_G.npy').astype(np.int64)
    print('train', X.shape, np.bincount(Y, minlength=3), 'val', np.bincount(Yv, minlength=3), flush=True)
    net = OrientNet(); bs = 96; steps = epochs * (len(X) // bs)
    if len(sys.argv) > 4:
        sd0 = torch.load(sys.argv[4]); w = sd0['trunk.0.weight']
        if w.shape[1] == 1: sd0['trunk.0.weight'] = torch.cat([w, torch.zeros_like(w)], 1)   # new local-contrast channel starts at zero
        net.load_state_dict(sd0)
    opt = torch.optim.AdamW(net.parameters(), 2e-3, weight_decay=1e-4)
    sch = torch.optim.lr_scheduler.OneCycleLR(opt, float(__import__('os').environ.get('ORIENT_LR', '3e-3')), total_steps=steps, pct_start=0.1)
    rng = np.random.default_rng(0)
    for ep in range(epochs):
        net.train(); perm = rng.permutation(len(X)); t0 = time.time(); tl = 0
        for k, i in enumerate(range(0, len(perm) - bs + 1, bs)):
            idx = np.sort(perm[i:i + bs])
            xb = augment(torch.from_numpy(X[idx]), rng); yb = torch.from_numpy(Y[idx]); gb = torch.from_numpy(G[idx])
            lo, lg = net(xb, aux=True)
            loss = F.cross_entropy(lo, yb, label_smoothing=0.03) + F.cross_entropy(lg.permute(0, 1, 3, 2).reshape(-1, 17), gb.reshape(-1))
            opt.zero_grad(); loss.backward(); opt.step(); sch.step(); tl += loss.item()
            if k % 100 == 0: print(f'  ep {ep} step {k} loss {tl / (k + 1):.4f} {time.time() - t0:.0f}s', flush=True)
        net.eval(); conf = np.zeros((3, 3), int); P = []; GP = []
        with torch.no_grad():
            for i in range(0, len(Xv), 256):
                o, g = net(torch.from_numpy(Xv[i:i + 256]).float(), aux=True)
                P.append(F.softmax(o, 1).numpy()); GP.append(g.argmax(2).numpy())
        P = np.concatenate(P); GP = np.concatenate(GP); np.add.at(conf, (Yv, P.argmax(1)), 1)
        nz = Gv > 0
        print(f'   glyphs: {(GP[nz] == Gv[nz]).mean():.3f} of labels read, {(GP[~nz] > 0).mean():.4f} false glyphs', flush=True)
        # what the panel uses: answer only when confident
        sure = P.max(1) > 0.85; ans = np.where(sure, P.argmax(1), 0)
        wrong = ((ans != 0) & (ans != Yv)).sum(); hit = ((ans != 0) & (ans == Yv)).sum()
        print(f'ep {ep} acc {np.trace(conf) / conf.sum():.4f} | confident answers: correct {hit}/{(Yv != 0).sum()} wrong {wrong} | {time.time() - t0:.0f}s', flush=True)
        print(conf, flush=True)
        torch.save(net.state_dict(), out + '.pt')
    net.eval()
    torch.onnx.export(Deploy(net), torch.zeros(1, FR, FR, 3), out + '.onnx', input_names=['x'], output_names=['p'], opset_version=13, dynamo=False)
    print('exported', flush=True)
