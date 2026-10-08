"""Render a short game as 1280x720 'video' frames: board with arrows/highlights,
a held-out piece set, plus distractors (webcam box, text)."""
import os, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
import sys, random, json
sys.path.insert(0, os.path.join(ROOT, 'training'))
import numpy as np, chess
from PIL import Image, ImageDraw
import gen

def pos_from_board(b, white_bottom):
    a = np.zeros((8, 8), np.int64)
    for sq, p in b.piece_map().items():
        r, f = 7 - chess.square_rank(sq), chess.square_file(sq)
        cls = 1 + 'KQRBNP'.index(p.symbol().upper()) + (0 if p.color else 6)
        a[r, f] = cls
    return a if white_bottom else a[::-1, ::-1].copy()

def main(out, pset, white_bottom, seed):
    rng = random.Random(seed)
    moves = 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 Na5 Bc2 c5 d4 Qc7'.split()
    b = chess.Board(); fens = [b.fen()]
    for m in moves: b.push_san(m); fens.append(b.fen())
    frames = []
    for i, fen in enumerate(fens):
        bb = chess.Board(fen)
        img, pos, M, s = gen.render(rng, [pset], [], pos=pos_from_board(bb, white_bottom), s=72)
        # crop away the margin except a small border, place in 1280x720 frame
        board = img.crop((M - 6, M - 6, M + 8 * s + 6, M + 8 * s + 6))
        frame = Image.new('RGB', (1280, 720), (24, 26, 30))
        bw = 600
        board = board.resize((bw * board.size[0] // (8 * s),) * 2, Image.LANCZOS)
        frame.paste(board, (90, 50))
        d = ImageDraw.Draw(frame)
        d.rectangle([900, 60, 1220, 300], fill=(70, 90, 110))            # webcam
        d.text((910, 340), 'Ruy Lopez, Closed', fill=(230, 230, 230), font=gen.font(28))
        frame.save(f'{out}/f{i:02d}.png')
        frames.append({'file': f'f{i:02d}.png', 'fen': fen})
    # true board box in frame coords
    k = 600 / (8 * s + 12)
    json.dump({'frames': frames, 'box': [90 + 6 * k, 50 + 6 * k, 8 * s * k]}, open(f'{out}/truth.json', 'w'))

if __name__ == '__main__':
    import os
    out = sys.argv[1]; os.makedirs(out, exist_ok=True)
    main(out, sys.argv[2], sys.argv[3] == 'white', int(sys.argv[4]))
