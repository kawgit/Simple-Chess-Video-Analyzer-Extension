"""A short game as 1280x720 'video' frames with real last-move highlights and the
messy in-between frames: animation (piece mid-slide), hovering a piece (lichess
style: origin square emptied, piece floating), chess.com-style drag (3 squares
highlighted), and arrows coming and going."""
import sys, random, json, os
sys.path.insert(0, '/home/claude/train')
import numpy as np, chess
from PIL import Image, ImageDraw
import gen

STYLES = {
    'lichess': {'colors': ((240, 217, 181), (181, 136, 99)), 'hl': ((155, 199, 0), 105)},
    'chesscom': {'colors': ((235, 236, 208), (115, 149, 82)), 'hl': ((255, 255, 51), 128)},
}

def pos_of(b, wb):
    a = np.zeros((8, 8), np.int64)
    for sq, p in b.piece_map().items():
        r, f = 7 - chess.square_rank(sq), chess.square_file(sq)
        a[r, f] = 1 + 'KQRBNP'.index(p.symbol().upper()) + (0 if p.color else 6)
    return a if wb else a[::-1, ::-1].copy()

def img_sq(sq, wb):
    r, f = 7 - chess.square_rank(sq), chess.square_file(sq)
    return (r, f) if wb else (7 - r, 7 - f)

def main(out, pset, style, wb, seed, moves=None, labels=False):
    st = STYLES[style]; rng = random.Random(seed)
    moves = moves or 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 Na5 Bc2 c5 d4 Qc7'.split()
    b = chess.Board(); frames = []; k = 0
    piece_img = lambda c: gen.load_piece(pset, c)

    def emit(board, hl_squares, kind, fen, floating=None, extra_hl=None):
        nonlocal k
        pos = pos_of(board, wb)
        hls = []
        if hl_squares: hls.append({'squares': hl_squares, 'color': st['hl'][0], 'alpha': st['hl'][1]})
        if extra_hl: hls.append(extra_hl)
        def extra(img, M, s):
            if floating:
                name, x, y = floating
                p = piece_img(name).resize((s, s))
                img.paste(p, (int(M + x * s), int(M + y * s)), p)
        r2 = random.Random(seed * 1000 + k)   # arrows/marks differ per frame
        img, _, M, s = gen.render(r2, [pset], [], pos=pos, s=72, highlights=hls, colors=st['colors'], extra=extra, coords=False, coord_wb=(wb if labels else None))
        board_im = img.crop((M - 6, M - 6, M + 8 * s + 6, M + 8 * s + 6)).resize((600, 600), Image.LANCZOS)
        frame = Image.new('RGB', (1280, 720), (24, 26, 30)); frame.paste(board_im, (90, 50))
        d = ImageDraw.Draw(frame); d.rectangle([900, 60, 1220, 300], fill=(70, 90, 110))
        fn = f'f{k:03d}.png'; frame.save(f'{out}/{fn}')
        frames.append({'file': fn, 'kind': kind, 'fen': fen}); k += 1

    emit(b, None, 'settled', b.fen())
    last = None
    for san in moves:
        mv = b.parse_san(san); before = b.copy(); b.push(mv)
        hl = [img_sq(mv.from_square, wb), img_sq(mv.to_square, wb)]
        # animation: new highlight, moving piece halfway between squares
        mid = before.copy(); mid.remove_piece_at(mv.from_square)
        p = before.piece_at(mv.from_square)
        (r0, f0), (r1, f1) = img_sq(mv.from_square, wb), img_sq(mv.to_square, wb)
        name = ('w' if p.color else 'b') + p.symbol().upper()
        emit(mid, hl, 'anim', b.fen(), floating=(name, (f0 + f1) / 2, (r0 + r1) / 2))
        emit(b, hl, 'settled', b.fen())
        # the side to move picks up a piece and hovers it (doesn't drop it)
        mine = [sq for sq, q in b.piece_map().items() if q.color == b.turn and q.piece_type != chess.KING]
        sq = rng.choice(mine); q = b.piece_at(sq)
        lifted = b.copy(); lifted.remove_piece_at(sq)
        rr, ff = img_sq(sq, wb)
        name = ('w' if q.color else 'b') + q.symbol().upper()
        if style == 'chesscom':   # origin square highlighted in the same colour -> 3 squares
            emit(lifted, hl, 'hover', b.fen(), floating=(name, ff + 0.6, rr - 1.3), extra_hl={'squares': [(rr, ff)], 'color': st['hl'][0], 'alpha': st['hl'][1]})
        else:                     # lichess: origin square gets the green "selected" tint
            emit(lifted, hl, 'hover', b.fen(), floating=(name, ff + 0.6, rr - 1.3), extra_hl={'squares': [(rr, ff)], 'color': (20, 85, 30), 'alpha': 128})
        emit(b, hl, 'settled', b.fen())
    json.dump({'frames': frames, 'box': [90 + 6 * 600 / (8 * 72 + 12), 50 + 6 * 600 / (8 * 72 + 12), 8 * 72 * 600 / (8 * 72 + 12)]}, open(f'{out}/truth.json', 'w'))

if __name__ == '__main__':
    out = sys.argv[1]; os.makedirs(out, exist_ok=True)
    main(out, sys.argv[2], sys.argv[3], sys.argv[4] == 'white', int(sys.argv[5]))
