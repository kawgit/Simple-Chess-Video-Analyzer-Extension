import sys, random, numpy as np, torch
import gen
from train import Net, board_acc, evaluate
net = Net(); net.load_state_dict(torch.load(sys.argv[1])); net.eval()
sets = sys.argv[2].split(',')
for s in sets:
    rng = random.Random(123)
    X = []; Y = []
    for i in range(int(sys.argv[3]) if len(sys.argv) > 3 else 120):
        b, pos = gen.sample_board(rng, [s], gen.board_textures())
        X.append(gen.squares(b)); Y.append(pos.reshape(-1))
    X = np.concatenate(X); Y = np.concatenate(Y)
    acc, conf = evaluate(net, X, Y)
    print(f'{s:12s} sq {acc:.4f} board {board_acc(net, X, Y):.3f}', flush=True)
